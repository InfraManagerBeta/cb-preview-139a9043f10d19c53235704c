// app/engine/game.js
// The orchestration facade: ties the ledger, the projection, and the pure
// engine modules (duel, bracket, economy, pve, sync, npc, retention) into
// the actions the UI screens call. Every action that touches the permanent
// record appends exactly one idempotent ledger event (R83/§15.7); all
// figures the UI shows are read back from `project(ledger.all())`.

import { Ledger, EVENT_TYPES, actionKey } from './ledger.js';
import { project, checkConservation } from './projection.js';
import * as economy from './economy.js';
import * as bracketEngine from './bracket.js';
import { resolveDuel, ELEMENT_NAMES, elementIndex, duelScore, generateFlipSeed, sha256Hex, deriveRoundTag } from './duel.js';
import * as pve from './pve.js';
import * as sync from './sync.js';
import { generateNpcSeat } from './npc.js';
import { randomId } from './id.js';
import * as retention from './retention.js';
import { loadOverrides, effectiveHypothesisId } from './overrides.js';
import { toXML as narratorToXML } from './narrator.js';

// f7/advisory-8: loadFunds had a LOWER bound (amountUSD > 0, f5/crucial-1)
// but no documented UPPER one -- an unbounded custom deposit (the tap-to-
// edit amount field, app/ui/components/money-sheets.js, accepts any
// Number.isFinite positive value to the cent) could mint an arbitrarily
// large LOAD_FUNDS_DEPOSIT event with no guard anywhere in the call chain.
// A flat, documented cap, enforced at the one guard site every caller goes
// through regardless of which UI screen or arm produced the call. $1M is
// comfortably above any real single-deposit UI preset/multiple this build
// ships (see loadFundsPresets in tunables.json) while still catching a
// fat-fingered/corrupted amount (e.g. a stray extra zero, or a non-UI
// direct call) before it reaches the ledger.
const MAX_LOAD_FUNDS_AMOUNT_USD = 1e6;

/**
 * C16/AC0: thrown by every ledger-touching Game method when the kill switch
 * is active, instead of appending anything. Guarded at THIS layer (not just
 * the UI) so every caller -- every screen, the console, f2's simulator --
 * inherits the freeze automatically. The one exception is
 * Game#voidBracketOnKill, whose entire purpose is to run while killed.
 */
export class KillSwitchFrozenError extends Error {
  constructor(action) {
    super(`Game#${action}: kill switch is active -- frozen, no ledger append (AC0). An in-flight bracket is voided instead (Game#voidBracketOnKill); the ledger and balances stand exactly as they were at the kill.`);
    this.name = 'KillSwitchFrozenError';
    this.action = action;
  }
}

// A6: the ledger only needs the aggregate facts anything downstream
// (projection/retention/narration-replay) actually reads back -- not the
// full per-round detail (~1.5KB/duel: 5 rounds x move/affinity/tag/result),
// which the live UI already has from this call's own return value and never
// re-reads from the ledger THROUGH THE SAME-SESSION PATH (grep confirms no
// read site touches `payload.outcome.rounds` on a same-session/cached
// resolve). Keep every summary field, including C22's `coinFlip`
// (seed+commitment), which DOES need to persist for later re-verification.
//
// f6/crucial-1 fix: `rounds` is no longer dropped outright. A CROSS-INSTANCE
// replay (a second tab on the same bracket, or a fresh Game instance after a
// failed session write + reload -- see _reconstructResolveMatchFromLedger
// below) has no in-memory cache entry and used to reconstruct an `outcome`
// with NO `rounds` at all, which app/ui/screens/duel.js's consumers
// (buildMatchData, buildDuelTimeline, projectedAfterRound, and
// reorientOutcome's seat-B branch) all dereference unconditionally --
// dead reveal screen, uncaught TypeError. Fixed via option (a) from the
// order: persist a SLIM per-round record (`slimRoundsForLedger` below) --
// just `move1`/`move2`/`result`/`p1Affinity`/`p2Affinity`, no `tag` and no
// `round` index, both cheap to recompute (`hydrateRoundsFromLedger` below,
// used only on the reconstruct path) -- so the persisted DUEL_RESOLVED
// payload keeps the A6 "aggregate facts, not the full ~1.5KB/duel detail"
// discipline while still being enough to rebuild a presentation-complete
// outcome. PvE's own ledger event already persists its FULL outcome
// (game.js#resolvePveDuel below) -- the precedent that a duel's rounds CAN
// live on the ledger; this keeps bracket duels within about the same size
// as that precedent -- measured within ~0.2%, effectively equal (see the
// f7/advisory-5 measurement below).
//
// f7/advisory-5: MEASURED, not "a small fraction" -- a slim round record is
// 79% of a full round's size (no `tag`, no redundant `round` index, same 5
// scalar fields otherwise); per DUEL_RESOLVED event that measures out to
// 770 -> 1,205 bytes, +56.6% (the WHOLE event, slim vs full rounds -- the
// rounds array alone is ~424 B slim vs ~529 B full, +24.8%), which works
// out to roughly +3.0 KB per completed 7-match bracket -- within about 1%
// of the PvE precedent event's own per-duel size (see this comment's own
// paragraph above: PvE already persists full rounds).
// A real, bounded cost, not a rounding error, and the number this fix
// round pins in place of the old, vaguer "small fraction" claim.
//
// f7/N1: `rounds` is optional at the HYDRATE boundary (hydrateRoundsFromLedger
// below), not just at the persist boundary above. Any `DUEL_RESOLVED` event
// written by a pre-f6 build (same storage key `cheddarBattles.ledger.v1`,
// same SCHEMA_VERSION, no migration) has NO `rounds` key at all -- f1's
// original A6 slimming dropped it outright, and f6 only started keeping the
// slim form going forward. `_reconstructResolveMatchFromLedger` below treats
// a missing `rounds` array as a domain condition (`replayUnavailable: true`
// on the returned result), not a crash: the ledger's summary fields (which
// a legacy event DOES carry -- won/lost/draws, transfer, floorDrain, tie,
// combatants' stakeBefore/stakeAfter) are always enough to render the
// result card; only the round-by-round presentation is unavailable for
// those pre-upgrade duels. See app/ui/screens/duel.js's `commit()`/
// `renderResult()` for the degrade-gracefully consumer side.
function slimOutcomeForLedger(outcome) {
  return { ...outcome, rounds: slimRoundsForLedger(outcome.rounds) };
}

/** f6/crucial-1: per-round ledger record -- see slimOutcomeForLedger above. */
function slimRoundsForLedger(rounds) {
  return rounds.map((r) => ({
    move1: r.move1, move2: r.move2, result: r.result,
    p1Affinity: r.p1Affinity, p2Affinity: r.p2Affinity,
  }));
}

/**
 * f6/crucial-1: the inverse of slimRoundsForLedger -- expands the ledger's
 * slim per-round records back into resolveDuel's full round shape (adding
 * back `round`, the array's own 1-based position, and `tag`, recomputed via
 * duel.js's `deriveRoundTag` from the persisted result+affinity flags --
 * the SAME function resolveDuel itself uses, so a reconstructed round can
 * never disagree with what a live resolution would have tagged). This
 * makes a cross-instance replay's rebuilt outcome shape-identical to a live
 * resolveDuel() result, so every duel.js consumer (buildMatchData,
 * buildDuelTimeline, projectedAfterRound, reorientOutcome) can dereference
 * outcome.rounds exactly as it already does -- no separate "rounds-free"
 * branch needed in any of them.
 *
 * f7/N1: `slimRounds` is OPTIONAL here -- a legacy (pre-f6) `DUEL_RESOLVED`
 * event's persisted outcome has no `rounds` key at all (f1's original A6
 * slimming dropped it outright; f6 only started persisting the slim form
 * going forward, with no migration of events written before it). Returning
 * `null` (never throwing, never a silent empty array masquerading as "zero
 * rounds") lets the one caller (_reconstructResolveMatchFromLedger below)
 * raise this as an explicit, honestly-flagged domain condition instead of
 * an uncaught TypeError on `.map` of undefined.
 */
function hydrateRoundsFromLedger(slimRounds) {
  if (!Array.isArray(slimRounds)) return null;
  return slimRounds.map((r, i) => ({
    round: i + 1,
    move1: r.move1,
    move2: r.move2,
    result: r.result,
    p1Affinity: r.p1Affinity,
    p2Affinity: r.p2Affinity,
    tag: deriveRoundTag(r.result, r.p1Affinity, r.p2Affinity),
  }));
}

export class Game {
  constructor({ ledger, tunables, treatment, playerId, storage, overridesStorage, random = Math.random }) {
    this.ledger = ledger || new Ledger(storage);
    this.tunables = tunables;
    this.treatment = treatment;
    this.playerId = playerId;
    this.random = random;
    // C16: which storage the kill switch is read from. Defaults to whatever
    // storage the ledger itself ended up using, so sharing one memory
    // storage across `new Ledger(s)` + `new Game({ ledger, ... })` (the
    // test pattern used throughout this suite) is enough to flip the kill
    // switch and have Game see it, with no extra wiring; the real app (both
    // real localStorage) needs no override at all.
    this.overridesStorage = overridesStorage || storage || this.ledger.storage;
  }

  // ---- C16/AC0: kill switch --------------------------------------------------

  isKilled() {
    return !!loadOverrides(this.overridesStorage).killSwitch;
  }

  _assertNotKilled(action) {
    if (this.isKilled()) throw new KillSwitchFrozenError(action);
  }

  /**
   * C16/AC0: the stated kill-switch shutdown rule for a bracket that hasn't
   * finished. Unlike every other method here, this one is MEANT to run
   * while the kill switch is active -- it does not guard on isKilled().
   * It makes NO stake/tier/account change at all: every character keeps
   * exactly the stake it held at the instant of the kill. It appends
   * exactly one BRACKET_VOIDED event citing the rule, so the stop banner's
   * claim ("ledger and balances preserved exactly as they stood") is
   * literally true. Idempotent per bracketId.
   */
  voidBracketOnKill({ bracketId, bracket, now = Date.now() }) {
    const characterIds = (bracket && bracket.seats ? bracket.seats : [])
      .map((s) => s && s.characterId)
      .filter(Boolean);
    return this.ledger.append({
      key: actionKey('bracket-void', bracketId),
      type: EVENT_TYPES.BRACKET_VOIDED,
      playerId: this.playerId,
      ts: now,
      payload: {
        bracketId,
        characterIds,
        rule: 'AC0: on kill, an unfinished bracket is voided -- no auto-commit, no resolution, no stake transfer happens after the kill; every character keeps exactly the stake it held at that instant.',
      },
    });
  }

  /**
   * CB-BUILD-003/R22: `snapshot().account.anchorTs` exposes the retention
   * anchor -- the timestamp this player's first bracket concludes
   * (elimination or a bracket win), or `null` before that ever happens --
   * so a screen (reserve.js) can gate on "has a concluded first bracket"
   * by reading the snapshot, instead of re-deriving anchor logic from the
   * raw ledger itself. Purely additive: every other snapshot field is
   * unchanged, and this is the SAME `retention.computeAnchor` already used
   * by the retention metrics (single source of truth, invariant #10).
   */
  snapshot() {
    const events = this.ledger.all();
    const snap = project(events);
    snap.account.anchorTs = retention.computeAnchor(events, this.playerId);
    return snap;
  }

  conservation() {
    return checkConservation(this.snapshot());
  }

  // ---- account lifecycle ---------------------------------------------------

  ensureAccount(now = Date.now()) {
    this._assertNotKilled('ensureAccount');
    this.ledger.append({ key: actionKey('account', this.playerId), type: EVENT_TYPES.ACCOUNT_CREATED, playerId: this.playerId, ts: now, payload: {} });
    this.ledger.append({ key: actionKey('signup-grant', this.playerId), type: EVENT_TYPES.SIGNUP_GRANT, playerId: this.playerId, ts: now, payload: { amountUSD: this.tunables.economy.signupGrantUSD } });
    return this.snapshot().account;
  }

  /**
   * R70/AC1/C3: identity screener. FIXED (C3): keyed per ATTEMPT (not a
   * fixed per-player key), so a second submission after a failed first one
   * is not silently swallowed by replay protection -- the ledger holds
   * every attempt, and projection.js's replay (chronological, last write
   * wins) already surfaces the LATEST attempt's result. FIXED (A15): the
   * account (and its $25 signup grant) is written only once the screener
   * has actually PASSED -- not unconditionally at app boot -- so the
   * rejected screen's "nothing was saved beyond this screening result"
   * claim is literally true.
   */
  submitScreener({ age18, jurisdictionOk }, now = Date.now()) {
    this._assertNotKilled('submitScreener');
    const passed = !!age18 && !!jurisdictionOk;
    const reasons = [];
    if (!age18) reasons.push('under_18');
    if (!jurisdictionOk) reasons.push('jurisdiction_restricted');
    const attempt = this.ledger.byPlayerAndType(this.playerId, EVENT_TYPES.SCREENER_RESULT).length;
    this.ledger.append({
      key: actionKey('screener', this.playerId, attempt),
      type: EVENT_TYPES.SCREENER_RESULT,
      playerId: this.playerId,
      ts: now,
      payload: { passed, reasons, attempt },
    });
    if (passed) this.ensureAccount(now); // idempotent: fixed per-player keys
    return this.snapshot().account.screener;
  }

  // ---- summon (R58/R59) -----------------------------------------------------

  pickUnusedName(now = Date.now()) {
    const snap = this.snapshot();
    const used = new Set(Object.values(snap.characters).map((c) => c.name));
    const candidates = this.treatment.namePool.filter((n) => !used.has(n));
    const pool = candidates.length > 0 ? candidates : this.treatment.namePool;
    return pool[Math.floor(this.random() * pool.length)];
  }

  /**
   * C15/R19/invariant-3 fix (f2): `summonCharacter` used to always charge
   * `tunables.economy.summonUSD` (a fixed $10) regardless of the active
   * price door arm (O2) -- so a participant arriving through the $5 or
   * free-play door saw a summon button that PROMISED that price but the
   * ledger charged $10 anyway (invariant 3: displayed price === charged
   * price). Now it charges `tunables.priceDoorArms.displayedEntryPriceDefaultUSD`
   * -- which, via app.js's `effectiveTunables(tunablesRaw, overrides)`, is
   * ALREADY the active O2 arm's price by the time it reaches this.tunables
   * (see app/ui/app.js). The summon mints the SAME 100C stake regardless of
   * arm (R19's door semantics: the arm varies the DISPLAYED PRICE for the
   * same summon, not the stake) -- so the peg (20C=$1) only holds exactly
   * at the $10 default arm; at $5 it's 20C/$1, at $0 (free play) there is
   * no peg at all (100C for $0 is the free-play door's whole point) -- an
   * honest implication, not a bug, stated here and in the R8a truth line.
   */
  summonCharacter({ element, name = null }, now = Date.now()) {
    this._assertNotKilled('summonCharacter');
    const snap = this.snapshot();
    const doorPriceUSD = this.tunables.priceDoorArms.displayedEntryPriceDefaultUSD;
    if (snap.account.cashUSD < doorPriceUSD) {
      throw new Error('summonCharacter: insufficient CASH');
    }
    const characterId = randomId();
    const finalName = name || this.pickUnusedName(now);
    const event = this.ledger.append({
      key: actionKey('summon', characterId),
      type: EVENT_TYPES.CHARACTER_SUMMONED,
      playerId: this.playerId,
      ts: now,
      payload: {
        characterId,
        name: finalName,
        element,
        stakeCheddar: this.tunables.economy.summonCheddar,
        costUSD: doorPriceUSD,
      },
    });
    return event.payload;
  }

  // ---- lobby / sync bracket (§11) -------------------------------------------

  /**
   * C1/R83: FIXED -- the idempotency key used to be `actionKey('lobby-join',
   * randomId())`, which made replay protection vacuous (every press mints
   * its own always-unique key, so a double-fired press always produced a
   * second join). Now keyed on `characterId + join-epoch` (the count of
   * this character's prior lobby joins).
   *
   * `joinEpoch` defaults to the ledger-derived count (the natural value for
   * a normal single press) but ALSO accepts an explicit override: per R83
   * ("the UI layer must mint the intent once per press and reuse it on
   * retry"), a real double-fired press is two *sequential* JS calls (the
   * browser dispatches a rapid double-click as two separate, non-
   * overlapping events) -- if the caller recomputed the epoch fresh on each
   * call it would see call #1's own just-appended event and increment past
   * it, defeating the protection. So the UI (lobby-entry.js) calls
   * `peekLobbyJoinEpoch(characterId)` ONCE right before the press, holds
   * that number, disables the control, and passes it through explicitly --
   * that captured value is what makes a genuine retry collide on the same
   * key. Callers that don't need this (tests, one-shot scripts) can omit it
   * and get the sensible default.
   */
  peekLobbyJoinEpoch(characterId) {
    return this.ledger.byType(EVENT_TYPES.SYNC_LOBBY_JOINED).filter((e) => e.payload && e.payload.characterId === characterId).length;
  }

  joinLobby(characterId, tier, now = Date.now(), { joinEpoch } = {}) {
    this._assertNotKilled('joinLobby');
    const character = this.snapshot().characters[characterId];
    if (!character) throw new Error('joinLobby: unknown character');
    if (!economy.meetsMinimumStake(this.tunables, character, tier)) {
      throw new Error('joinLobby: stake below tier floor');
    }
    const epoch = joinEpoch != null ? joinEpoch : this.peekLobbyJoinEpoch(characterId);
    this.ledger.append({
      key: actionKey('lobby-join', characterId, epoch),
      type: EVENT_TYPES.SYNC_LOBBY_JOINED,
      playerId: this.playerId,
      ts: now,
      payload: { characterId, tier, freshEntry: true, joinEpoch: epoch },
    });
    const lobby = sync.createLobby(this.tunables, { humanEntry: { id: this.playerId, characterId, name: character.name, element: character.element }, tier, now });
    sync.buildFillPlan(lobby, this.tunables, this.treatment, this.random);
    return lobby;
  }

  /**
   * C18: a lobby seat being filled by an NPC during the countdown (distinct
   * from NPC_SEATED, which mints the NPC as a ledger-tracked bracket
   * character once the lobby locks). Keyed on the lobby's own creation
   * timestamp + seat index, both stable for the life of one lobby, so a
   * re-tick over an already-filled seat is a no-op.
   */
  recordNpcSeatedInLobby({ lobbyCreatedAt, tier, seatIndex, name, element }, now = Date.now()) {
    this._assertNotKilled('recordNpcSeatedInLobby');
    return this.ledger.append({
      key: actionKey('sync-npc-seated', this.playerId, lobbyCreatedAt, seatIndex),
      type: EVENT_TYPES.SYNC_NPC_SEATED,
      playerId: this.playerId,
      ts: now,
      payload: { tier, seatIndex, name, element },
    });
  }

  /** C18: "leaving mid-bracket" -- call when the app is about to unload
   * (or the player navigates away) while a bracket is still in progress. */
  recordSyncDisconnect(bracketId, now = Date.now()) {
    this._assertNotKilled('recordSyncDisconnect');
    return this.ledger.append({
      key: actionKey('sync-disconnect', bracketId),
      type: EVENT_TYPES.SYNC_DISCONNECT,
      playerId: this.playerId,
      ts: now,
      payload: { bracketId },
    });
  }

  /** C18: "resume" -- call on boot when a persisted session resumes into a
   * bracket that hadn't completed. */
  recordSyncReconnect(bracketId, now = Date.now()) {
    this._assertNotKilled('recordSyncReconnect');
    return this.ledger.append({
      key: actionKey('sync-reconnect', bracketId),
      type: EVENT_TYPES.SYNC_RECONNECT,
      playerId: this.playerId,
      ts: now,
      payload: { bracketId },
    });
  }

  /**
   * Lock the lobby into a bracket: every seat (human and NPC alike) becomes
   * a ledger-tracked character before any duel resolves. NPCs "act as
   * players in every way" (R80) and their W/L records live on the shared
   * ledger, so their starting stake is minted here (NPC_SEATED) — this is
   * what keeps invariant #2 (ledger conservation) true once bracket stake
   * moves between a human seat and an NPC seat.
   */
  lockBracketFromLobby(lobby, now = Date.now()) {
    this._assertNotKilled('lockBracketFromLobby');
    const bracketId = randomId();
    const floor = economy.floorForTier(this.tunables, lobby.tier);
    const npcStartingStake = floor * 2; // matches the R55 floor-doubling convention; documented in app/README.md
    for (let i = 0; i < lobby.seats.length; i++) {
      const seat = lobby.seats[i];
      if (seat.kind === 'npc' && !seat.characterId) {
        const characterId = `npc-${bracketId}-${i}`;
        seat.characterId = characterId;
        this.ledger.append({
          key: actionKey('npc-seat', bracketId, i),
          type: EVENT_TYPES.NPC_SEATED,
          playerId: null,
          ts: now,
          payload: { characterId, name: seat.name, element: seat.element, tier: lobby.tier, stakeCheddar: npcStartingStake },
        });
      }
    }
    const bracket = bracketEngine.createBracket(lobby.seats, { tier: lobby.tier, createdAt: now });
    this.ledger.append({
      key: actionKey('bracket-create', bracketId),
      type: EVENT_TYPES.BRACKET_CREATED,
      playerId: this.playerId,
      ts: now,
      payload: { bracketId, tier: lobby.tier, seats: lobby.seats.map((s) => ({ name: s.name, kind: s.kind, npcTag: s.kind === 'npc' })) },
    });
    return { bracketId, bracket };
  }

  // ---- bracket duel resolution (R53-R56) ------------------------------------

  /**
   * Resolve one bracket match between whichever two seats it holds. There is
   * at most one human seat in this single-device build: when the human's
   * seat is one side of this match, the caller supplies `playerMoves` (the
   * committed moves, or a uniform-random auto-commit flagged `hesitated` —
   * R81/R42). Any match where neither seat is human (the rest of the
   * bracket, playing out live under spectate — R81) samples both sides from
   * their seated tendency with no playerMoves needed.
   *
   * C16/AC0: guarded at the top -- if the kill switch is active, this
   * throws instead of auto-committing/resolving/moving stake (the tick
   * loop in app/ui/screens/duel.js checks isKilled() itself first and calls
   * voidBracketOnKill instead of ever reaching this call, but the guard
   * here means ANY caller, including f2's console/simulator, is frozen too).
   */
  resolveMatch({ bracketId, bracket, roundIndex, matchIndex, playerMoves = null, hesitated = false, now = Date.now() }) {
    this._assertNotKilled('resolveMatch');
    const match = bracket.rounds[roundIndex][matchIndex];
    const seatA = bracket.seats[match.seatA];
    const seatB = bracket.seats[match.seatB];

    // A1 fix (v1c): check-before-compute, the same discipline resolvePveDuel
    // already has -- a replayed/retried call for the SAME match (identical
    // bracketId/roundIndex/matchIndex -- e.g. a double-fired commit press;
    // duel.js's commit button has no submitting-guard) must return the
    // ALREADY-decided result, not re-run resolveDuel: a second RNG-driven
    // resolution draws MORE from the shared random stream and can pick a
    // DIFFERENT winner than the one already on the ledger, and the SECOND
    // call's own bracketEngine.recordMatchResult would silently overwrite
    // this bracket object's winnerSeat/currentRound/complete/champion with
    // that different, never-persisted outcome -- v1c's proof that a second
    // press "rewrites history" the ledger itself never agreed to.
    //
    // The duel-resolved ledger event is the source of truth for "has this
    // match already been decided". This Game instance also keeps a
    // same-process, same-session cache of the FULL first-call result
    // (including outcome.rounds -- the ledger's own DUEL_RESOLVED payload
    // deliberately omits rounds, see slimOutcomeForLedger's comment above,
    // since the live UI normally never re-reads them from the ledger) so a
    // same-session retry (the realistic double-fire case this fixes) still
    // gets a full, animatable outcome; a cross-instance replay with no
    // cache entry (e.g. a fresh Game/page reload) reconstructs from the
    // ledger's own persisted payload instead (f6/crucial-1: that payload's
    // `rounds` is now a SLIM per-round record, not absent -- see
    // slimOutcomeForLedger's header comment -- so the reconstruction below
    // still returns a presentation-complete outcome).
    const duelKey = actionKey('bracket-duel', bracketId, roundIndex, matchIndex);
    if (this.ledger.hasKey(duelKey)) {
      const cached = this._resolveMatchCache && this._resolveMatchCache.get(duelKey);
      let result;
      if (cached) {
        // f6/advisory-2: the reconstruct path below (no cache hit) already
        // converges the CALLER's bracket object (calls recordMatchResult
        // when this bracket's own match.winnerSeat is still null -- e.g. a
        // freshly-built bracket object on a same-session retry that didn't
        // go through the original resolveMatch call). The cache-hit branch
        // used to skip this entirely, leaving the two replay paths
        // asymmetric: a cache hit could return a correct RESULT while
        // leaving the CALLER's bracket object unconverged (still showing
        // winnerSeat: null on its board). Converge it here too, the same
        // way, so both replay paths leave the bracket object consistent.
        //
        // f7/advisory-9: convergence here is BEST-EFFORT, not required --
        // _convergeBracketIfNeeded silently skips (no throw) when this
        // caller's bracket object doesn't have this match's own seats fed
        // yet (an earlier round never replayed onto THIS bracket object).
        // Restores the pre-f6 behavior a cache hit always had: it can
        // return the ALREADY-KNOWN-CORRECT cached result regardless of
        // whether this particular bracket object's topology happens to be
        // caught up -- converge when feasible, never require it.
        this._convergeBracketIfNeeded({ bracket, roundIndex, matchIndex, match, seatA, seatB, combatants: cached.combatants, outcome: cached.outcome });
        result = cached;
      } else {
        result = this._reconstructResolveMatchFromLedger({ bracket, bracketId, roundIndex, matchIndex, match, seatA, seatB, duelKey });
      }
      return structuredClone(result); // A1(b): defensive copy -- no caller can mutate the cached/ledger-derived object
    }

    // f8/advisory-5: the SAME "match seats not yet fed from the previous
    // round" domain error the reconstruct path above already throws
    // (`_reconstructResolveMatchFromLedger`'s `!seatA || !seatB` guard) --
    // mirrored here on the COMPUTE path. Without this, an unfed seat
    // (`bracket.seats[match.seatA/seatB]` still `undefined` because an
    // earlier round hasn't been replayed onto THIS bracket object yet) hit
    // a raw, uncaught TypeError off `seatA.characterId` below, one line
    // before the (different) "seats not yet minted as characters" domain
    // error even had a chance to run.
    if (!seatA || !seatB) throw new Error('resolveMatch: match seats not yet fed from the previous round');

    const snap = this.snapshot();
    const charA = snap.characters[seatA.characterId];
    const charB = snap.characters[seatB.characterId];
    // f7/advisory-2: this is the "characters not yet minted" domain error --
    // distinct from the "match seats not yet fed from the previous round"
    // error the reconstruct path below raises. The two used to share one
    // message even though they name different preconditions (this one is
    // about characters existing in the projection; that one is about THIS
    // bracket object's own seatA/seatB topology) -- kept apart now so a
    // caught error actually names its real cause.
    if (!charA || !charB) throw new Error('resolveMatch: seats not yet minted as characters');

    const mv1 = seatA.kind === 'human' ? playerMoves : pve.sampleMoves(seatA.tendency, this.random);
    const mv2 = seatB.kind === 'human' ? playerMoves : pve.sampleMoves(seatB.tendency, this.random);
    if (!mv1 || !mv2) throw new Error('resolveMatch: playerMoves required for the human seat');

    const involvesHuman = seatA.kind === 'human' || seatB.kind === 'human';

    // C18: SYNC_COMMIT / SYNC_HESITATED -- the natural point is the human's
    // own commit press (real) or auto-commit (hesitated). Deterministic key
    // shared with the bracket-duel key below (idempotent together).
    if (involvesHuman) {
      this.ledger.append({
        key: actionKey('sync-commit', bracketId, roundIndex, matchIndex),
        type: hesitated ? EVENT_TYPES.SYNC_HESITATED : EVENT_TYPES.SYNC_COMMIT,
        playerId: this.playerId,
        ts: now,
        payload: { bracketId, roundIndex, matchIndex },
      });
    }

    const aff1 = elementIndex(seatA.element);
    const aff2 = elementIndex(seatB.element);

    // C22: commit-reveal coin flip. duelScore is pure (no RNG), so we know
    // BEFORE calling resolveDuel whether this will be a true tie; if so,
    // generate the seed and commit its SHA-256 to the ledger FIRST, then
    // pass the seed into resolveDuel so the flip is a deterministic
    // function of it (reveal happens on the DUEL_RESOLVED event below).
    let flipSeed = null;
    if (duelScore(mv1, mv2, aff1, aff2) === 0) {
      flipSeed = generateFlipSeed(this.random);
      this.ledger.append({
        key: actionKey('coinflip-commit', bracketId, roundIndex, matchIndex),
        type: EVENT_TYPES.COIN_FLIP_COMMITTED,
        playerId: involvesHuman ? this.playerId : null,
        ts: now,
        payload: { bracketId, roundIndex, matchIndex, commitment: sha256Hex(flipSeed) },
      });
    }

    const floor = economy.floorForTier(this.tunables, charA.tier);
    const outcome = resolveDuel({
      mv1, mv2,
      aff1, aff2,
      p1: charA.stakeCheddar, p2: charB.stakeCheddar,
      floor, random: this.random, flipSeed,
    });

    const aWon = outcome.trueTie ? outcome.coinFlipWinner === 1 : outcome.winner === 1;
    const bWon = !aWon;
    const transferToA = outcome.trueTie ? 0 : (outcome.winner === 1 ? outcome.transfer : -Math.abs(outcome.transfer));
    const stakeAAfter = charA.stakeCheddar + transferToA;
    const stakeBAfter = charB.stakeCheddar - transferToA;

    const combatants = [
      { characterId: charA.id, tier: charA.tier, won: aWon, stakeBefore: charA.stakeCheddar, stakeAfter: stakeAAfter },
      { characterId: charB.id, tier: charB.tier, won: bWon, stakeBefore: charB.stakeCheddar, stakeAfter: stakeBAfter },
    ];

    this.ledger.append({
      key: actionKey('bracket-duel', bracketId, roundIndex, matchIndex),
      type: EVENT_TYPES.DUEL_RESOLVED,
      playerId: involvesHuman ? this.playerId : null,
      ts: now,
      payload: { bracketId, roundIndex, matchIndex, staked: true, hesitated, combatants, outcome: slimOutcomeForLedger(outcome) },
    });

    const winnerSeatIndex = aWon ? match.seatA : match.seatB;
    // f7/advisory-4: store a structuredClone of `outcome` on the bracket
    // object, not the same reference this function also caches (below) and
    // returns (via structuredClone at the very end) to the caller. Without
    // this, `bracket.rounds[roundIndex][matchIndex].result.outcome` and
    // `this._resolveMatchCache.get(duelKey).outcome` were the SAME object;
    // A1(b)'s defensive copy only protects the RETURNED value -- any code
    // that reaches the bracket object directly (e.g. reading match.result
    // off a session-persisted bracket) could still mutate the shared
    // original and corrupt what a later cache-hit/reconstruct replay reads
    // back, an aliasing bypass of A1(b)'s whole point.
    bracketEngine.recordMatchResult(bracket, roundIndex, matchIndex, winnerSeatIndex, { outcome: structuredClone(outcome) });

    // C4/R43/R42: track, per bracket, which characters had ANY duel of
    // theirs auto-committed ("hesitated") -- both seats of a hesitated
    // match count, since the duel itself sits outside the staked-duel
    // definition for either side. Read back below when a character's
    // bracket-ending event (eliminated or advanced) needs the true
    // allDuelsStaked flag, instead of the old hardcoded `true`.
    if (!bracket.hesitatedCharacterIds) bracket.hesitatedCharacterIds = [];
    if (hesitated) {
      if (!bracket.hesitatedCharacterIds.includes(charA.id)) bracket.hesitatedCharacterIds.push(charA.id);
      if (!bracket.hesitatedCharacterIds.includes(charB.id)) bracket.hesitatedCharacterIds.push(charB.id);
    }

    for (const combatant of combatants) {
      if (!combatant.won) {
        const seatKind = combatant.characterId === charA.id ? seatA.kind : seatB.kind;
        const wasHesitated = bracket.hesitatedCharacterIds.includes(combatant.characterId);
        this.ledger.append({
          key: actionKey('eliminate', bracketId, combatant.characterId),
          type: EVENT_TYPES.CHARACTER_ELIMINATED,
          playerId: seatKind === 'human' ? this.playerId : null,
          ts: now,
          payload: { characterId: combatant.characterId, bracketId, tier: combatant.tier, allDuelsStaked: !wasHesitated },
        });
      }
    }

    // f4/N1: the exact payload the CHARACTER_ADVANCED event carries, when
    // the bracket completed this match -- captured here and returned to
    // the caller UNCHANGED so both the reveal's prize-award moment AND the
    // win-card screen (app/ui/screens/duel.js) read the SAME figures the
    // ledger event recorded, instead of independently re-deriving them
    // from tierLadder.tiers[...].prizeCheddar (which is how N1 happened:
    // the ledger paid $999,999.92 CASH + stake at 20:1 for a T6 win, but
    // both UI sites still showed the raw, never-paid 20,000,000C figure).
    let characterAdvancedPayload = null;

    if (bracket.complete) {
      const championId = combatants.find((c) => c.won).characterId;
      const championIsHuman = championId === charA.id ? seatA.kind === 'human' : seatB.kind === 'human';
      const championTier = championId === charA.id ? charA.tier : charB.tier;
      const championStakeAtWin = championId === charA.id ? stakeAAfter : stakeBAfter;
      const priorRecords = championId === charA.id ? charA.records : charB.records;
      const nextTierRaw = championTier + 1;
      const projectedRecord = { w: (priorRecords[championTier]?.w || 0) + 1, l: priorRecords[championTier]?.l || 0 };
      const canAdvance = economy.canEnterTier({ records: { ...priorRecords, [championTier]: projectedRecord } }, nextTierRaw);
      // C2: the tier-clamp + T6-payout-as-cash logic lives in ONE place
      // (economy.bracketWinOutcome) so the live path and economy.test.js
      // exercise the same fixed rule instead of a re-implemented-inline,
      // unclamped copy (which is exactly how C2 happened).
      const winOutcome = economy.bracketWinOutcome(this.tunables, { championTier, canAdvance, stakeCheddarAtWin: championStakeAtWin });
      const championHesitated = bracket.hesitatedCharacterIds.includes(championId);
      characterAdvancedPayload = {
        characterId: championId, bracketId, tier: championTier,
        newTier: winOutcome.newTier,
        wonBracket: true,
        allDuelsStaked: !championHesitated, // C4
        toppedOut: winOutcome.toppedOut, // C2
        prizeCheddar: winOutcome.prizeCheddar, prizeUSD: winOutcome.prizeUSD,
        ...(winOutcome.toppedOut ? {
          payoutCashUSD: winOutcome.payoutCashUSD,
          stakeCashedOutCheddar: winOutcome.stakeCashedOutCheddar,
          stakeCashUSD: winOutcome.stakeCashUSD,
        } : {}),
      };
      this.ledger.append({
        key: actionKey('advance', bracketId, championId),
        type: EVENT_TYPES.CHARACTER_ADVANCED,
        playerId: championIsHuman ? this.playerId : null,
        ts: now,
        payload: characterAdvancedPayload,
      });
      this.ledger.append({
        key: actionKey('bracket-complete', bracketId),
        type: EVENT_TYPES.BRACKET_COMPLETED,
        playerId: this.playerId,
        ts: now,
        payload: { bracketId },
      });
    }

    const result = {
      outcome, combatants, bracketComplete: bracket.complete,
      humanWon: seatA.kind === 'human' ? aWon : (seatB.kind === 'human' ? bWon : null),
      humanIsSeatA: seatA.kind === 'human',
      // f4/N1: null when the bracket didn't complete this match; otherwise
      // the SAME object appended as the CHARACTER_ADVANCED payload.
      characterAdvancedPayload,
      // f7/N1: a freshly-resolved (live compute) match always has a full
      // rounds array -- never the legacy summary-only condition the
      // reconstruct path can raise. Explicit here so the shape is the same
      // regardless of which path produced the result (see
      // _reconstructResolveMatchFromLedger below).
      replayUnavailable: false,
    };
    // A1: cache the full (rounds-intact) result in-memory, keyed by the
    // SAME idempotency key the ledger uses, so a same-session retry above
    // replays this exact result instead of reconstructing a rounds-free
    // approximation from the ledger.
    if (!this._resolveMatchCache) this._resolveMatchCache = new Map();
    this._resolveMatchCache.set(duelKey, result);
    return structuredClone(result); // A1(b): defensive copy -- no caller can mutate the cached object
  }

  /**
   * A1: reconstructs resolveMatch's return shape from the ledger alone (no
   * in-memory cache hit -- e.g. a fresh Game instance/page reload between
   * the original press and a retry). Deterministic, no RNG: derives the
   * winner from the PERSISTED combatants and, if this particular bracket
   * object hasn't already had the result applied to it (match.winnerSeat
   * still null -- e.g. a freshly-built bracket object in a test), replays
   * bracketEngine.recordMatchResult with that already-decided winner so
   * this instance converges to the same state, instead of ever calling
   * resolveDuel/consuming randomness again. `outcome` here is rebuilt from
   * the ledger's own SLIM per-round payload (f6/crucial-1: see
   * slimOutcomeForLedger's header comment) via `hydrateRoundsFromLedger`,
   * so it is presentation-complete -- shape-identical to what a live
   * resolveDuel() call returns -- and every duel.js consumer can
   * dereference outcome.rounds exactly as it already does.
   *
   * f7/N1: a LEGACY (pre-f6) `DUEL_RESOLVED` event has no `rounds` at all --
   * `hydrateRoundsFromLedger` returns `null` for it (never throws). This is
   * an honest domain condition, not an error: the returned result carries
   * `replayUnavailable: true` and `outcome.rounds === null`, and the ONE
   * consumer (app/ui/screens/duel.js) renders the summary-only result card
   * with a one-line notice instead of the round-by-round presentation.
   * Every summary field (won/lost/draws/transfer/floorDrain/trueTie/
   * coinFlip) and the combatants' stakeBefore/stakeAfter are UNAFFECTED --
   * legacy events carry those exactly as before f6 ever existed.
   */
  _reconstructResolveMatchFromLedger({ bracket, bracketId, roundIndex, matchIndex, match, seatA, seatB, duelKey }) {
    // f7/advisory-2: this is the "match seats not yet fed from the previous
    // round" domain error -- a fresh/reloaded bracket object whose earlier
    // round hasn't been replayed onto it yet, so bracket.seats[match.seatA]/
    // [match.seatB] are still `undefined`. Distinct from (and previously,
    // incorrectly, worded the SAME as) the "seats not yet minted as
    // characters" error resolveMatch's own compute path raises above --
    // that one is about characters not existing in the projection; THIS one
    // is about THIS bracket object's own seatA/seatB topology not being fed
    // forward yet. The reconstruct path genuinely needs a real seatA/seatB
    // (to know which physical seat index is "this side") to rebuild
    // humanWon/humanIsSeatA at all, so this stays a thrown domain error,
    // never a raw TypeError off `seatA.characterId` below.
    if (!seatA || !seatB) throw new Error('resolveMatch: match seats not yet fed from the previous round');
    const duelEvent = this.ledger.findByKey(duelKey);
    const { combatants, outcome: slimOutcome } = duelEvent.payload;
    const hydratedRounds = hydrateRoundsFromLedger(slimOutcome.rounds);
    const outcome = { ...slimOutcome, rounds: hydratedRounds };
    this._convergeBracketIfNeeded({ bracket, roundIndex, matchIndex, match, seatA, seatB, combatants, outcome });
    const seatACombatant = combatants.find((c) => c.characterId === seatA.characterId);
    const aWon = seatACombatant ? seatACombatant.won : false;
    const bWon = !aWon;
    let characterAdvancedPayload = null;
    if (bracket.complete) {
      const championCombatant = combatants.find((c) => c.won);
      if (championCombatant) {
        const advanceEvent = this.ledger.findByKey(actionKey('advance', bracketId, championCombatant.characterId));
        if (advanceEvent) characterAdvancedPayload = advanceEvent.payload;
      }
    }
    return {
      outcome, combatants, bracketComplete: bracket.complete,
      humanWon: seatA.kind === 'human' ? aWon : (seatB.kind === 'human' ? bWon : null),
      humanIsSeatA: seatA.kind === 'human',
      characterAdvancedPayload,
      // f7/N1: true only for a legacy (pre-f6) rounds-free event -- the ONE
      // signal app/ui/screens/duel.js needs to skip the round-by-round
      // presentation and render the summary-only result card instead.
      replayUnavailable: hydratedRounds === null,
    };
  }

  /**
   * f6/advisory-2: shared by both replay paths (the reconstruct path above
   * and, now, the in-memory cache-hit branch in resolveMatch) -- if this
   * PARTICULAR bracket object hasn't already had this match's result
   * applied (match.winnerSeat still null), replay bracketEngine.
   * recordMatchResult with the already-decided winner (derived from the
   * PERSISTED/cached combatants, never recomputed) so the caller's bracket
   * object converges to the same state either replay path would leave it
   * in. A no-op when the bracket object already has this match decided.
   */
  _convergeBracketIfNeeded({ bracket, roundIndex, matchIndex, match, seatA, seatB, combatants, outcome }) {
    if (match.winnerSeat != null) return;
    // f7/advisory-1 (guard symmetry) + advisory-9 (converge only when
    // feasible): EITHER seat missing means THIS bracket object's topology
    // for this match isn't fed yet -- whether that's because NEITHER
    // feeder match has been replayed onto it (fully unfed) or only ONE has
    // (half-fed, the asymmetric case the old `!seatA`-only guard let
    // through). Either way, convergence is not POSSIBLE here: without a
    // real seatA AND seatB we cannot map "who won" back onto a genuine
    // local seat index, and the old half-fed path proved that guessing
    // (falling through to `match.seatB` while it was still `null`) directly
    // produces a bad stamped result (recordMatchResult(..., null, ...)
    // silently "succeeding" because `match.seatB === null` too).
    //
    // This is NOT itself an error, though -- it is a silent, no-op skip,
    // not a throw. The two callers need different reactions to the exact
    // same "not fed yet" condition: _reconstructResolveMatchFromLedger
    // (above) has ALREADY thrown its own "match seats not yet fed from the
    // previous round" domain error before ever reaching this call, for the
    // path where topology is genuinely REQUIRED to rebuild the result at
    // all. The OTHER caller -- resolveMatch's cache-hit branch -- already
    // has an ALREADY-KNOWN-CORRECT cached result in hand; it does not need
    // this bracket object's topology to return that result correctly, so
    // f7/advisory-9 restores the pre-f6 behavior: a cache hit returns the
    // cached result regardless, converging this bracket object only when
    // feasible, never treating "not fed yet" as fatal.
    if (!seatA || !seatB) return;
    const seatACombatant = combatants.find((c) => c.characterId === seatA.characterId);
    const aWon = seatACombatant ? seatACombatant.won : false;
    const winnerSeatIndex = aWon ? match.seatA : match.seatB;
    // f7/advisory-4: structuredClone -- see the compute path's identical
    // comment above this same call shape; this call site has the same
    // aliasing risk (bracket.match.result.outcome sharing a reference with
    // the cached/reconstructed `outcome` this function was handed).
    bracketEngine.recordMatchResult(bracket, roundIndex, matchIndex, winnerSeatIndex, { outcome: structuredClone(outcome) });
  }

  // ---- SITTING actions (R60/R63/R68/R61) ------------------------------------

  /**
   * C1/R83: FIXED -- keyed on `characterId + sitting-epoch` (the count of
   * this character's PRIOR re-entries), derived from ledger state by
   * default. Also accepts an explicit `sittingEpoch` override for the same
   * reason as `peekLobbyJoinEpoch`/`joinLobby` above: a real double-fired
   * press is two sequential calls, and re-deriving the epoch fresh on each
   * one would see call #1's own event and not collide. The UI
   * (sitting.js) calls `peekSittingEpoch(characterId)` once, disables the
   * Re-enter control, and passes the captured value through on any retry.
   */
  peekSittingEpoch(characterId) {
    return this.ledger.byType(EVENT_TYPES.CHARACTER_REENTERED).filter((e) => e.payload && e.payload.characterId === characterId).length;
  }

  reenterCharacter(characterId, now = Date.now(), { sittingEpoch } = {}) {
    this._assertNotKilled('reenterCharacter');
    const epoch = sittingEpoch != null ? sittingEpoch : this.peekSittingEpoch(characterId);
    const key = actionKey('reenter', characterId, epoch);
    // C1/R83: check-before-compute -- a replayed/retried press (same
    // captured epoch) is a no-op that returns the current (already-updated)
    // state, rather than re-validating "must still be SITTING" (which would
    // now be false, since call #1 already flipped it to ACTIVE) and
    // throwing on a harmless retry.
    if (this.ledger.hasKey(key)) return this.snapshot().characters[characterId];
    const snap = this.snapshot();
    const character = snap.characters[characterId];
    if (!character || character.state !== 'SITTING') throw new Error('reenterCharacter: character not SITTING');
    // A2 fix: R61's emptied-character card offers exactly ONE action --
    // RETIRE (Game#retireEmptyCharacter) -- never re-entry. Before this
    // fix, an emptied character (stakeCheddar <= 0, economy.isEmptied)
    // that somehow reached this call anyway (a stale UI, a direct API
    // call, a future screen bypassing sitting.js's own isEmptied() branch)
    // could still re-enter and pay a real re-entry fee for a character R61
    // says should only ever be retired.
    if (economy.isEmptied(character)) {
      throw new Error('reenterCharacter: character is emptied (0C) -- the only action for an emptied character is RETIRE (R61); it cannot re-enter');
    }
    if (snap.account.cashUSD < economy.reentryForTier(this.tunables, character.tier).usd) {
      throw new Error('reenterCharacter: insufficient CASH for re-entry fee');
    }
    const fee = economy.reentryForTier(this.tunables, character.tier);
    this.ledger.append({
      key,
      type: EVENT_TYPES.CHARACTER_REENTERED,
      playerId: this.playerId,
      ts: now,
      payload: { characterId, tier: character.tier, feeUSD: fee.usd, bonusCheddar: fee.bonusCheddar, sittingEpoch: epoch },
    });
    return this.snapshot().characters[characterId];
  }

  cashOutCharacter(characterId, now = Date.now()) {
    this._assertNotKilled('cashOutCharacter');
    const snap = this.snapshot();
    const character = snap.characters[characterId];
    if (!character || character.state !== 'SITTING') throw new Error('cashOutCharacter: character must be SITTING');
    const cashUSD = economy.cheddarToUsd(this.tunables, character.stakeCheddar);
    this.ledger.append({
      key: actionKey('cashout', characterId),
      type: EVENT_TYPES.CHARACTER_CASHED_OUT,
      playerId: this.playerId,
      ts: now,
      payload: { characterId, cashUSD },
    });
    return this.snapshot().characters[characterId];
  }

  retireEmptyCharacter(characterId, now = Date.now()) {
    this._assertNotKilled('retireEmptyCharacter');
    this.ledger.append({
      key: actionKey('retire-empty', characterId),
      type: EVENT_TYPES.CHARACTER_RETIRED_EMPTY,
      playerId: this.playerId,
      ts: now,
      payload: { characterId },
    });
    return this.snapshot().characters[characterId];
  }

  // ---- PvE (R57) -------------------------------------------------------------

  /**
   * C1/R83: FIXED -- keyed on `characterId + prior-session-count` instead of
   * a random id. The minted `sessionId` is threaded through to
   * resolvePveDuel (below) so ITS key can be `sessionId + duel-seq`.
   * Accepts an explicit `sessionEpoch` override for the same double-fire
   * reason documented on `joinLobby`/`reenterCharacter` above.
   */
  peekPveSessionEpoch(characterId) {
    return this.ledger.byType(EVENT_TYPES.PVE_SESSION_STARTED).filter((e) => e.payload && e.payload.characterId === characterId).length;
  }

  startPveOpponent(characterId, now = Date.now(), { sessionEpoch } = {}) {
    this._assertNotKilled('startPveOpponent');
    const character = this.snapshot().characters[characterId];
    const epoch = sessionEpoch != null ? sessionEpoch : this.peekPveSessionEpoch(characterId);
    const sessionId = `${characterId}::pve-session-${epoch}`;
    // C13/R26 card 5 ("PvE depth"): when that hypothesis is ACTIVE (O3),
    // draw a NAMED roster opponent instead of an anonymous one, so repeated
    // sessions build a real per-name record (see pve.js:generatePvERosterOpponent).
    const useRoster = effectiveHypothesisId(loadOverrides(this.overridesStorage)) === 'pve_depth';
    const opponent = useRoster
      ? pve.generatePvERosterOpponent(this.tunables, this.treatment, { tier: character.tier, playerStakeCheddar: character.stakeCheddar, sessionEpoch: epoch, random: this.random })
      : pve.generatePvEOpponent(this.tunables, { tier: character.tier, playerStakeCheddar: character.stakeCheddar, random: this.random });
    this.ledger.append({
      key: actionKey('pve-session', characterId, epoch),
      type: EVENT_TYPES.PVE_SESSION_STARTED,
      playerId: this.playerId,
      ts: now,
      payload: { characterId, sessionId, tier: character.tier, opponentStakeCheddar: opponent.stakeCheddar, opponentAffinity: opponent.affinityElement, opponentName: opponent.name || null },
    });
    return { ...opponent, sessionId };
  }

  /**
   * C1/R83: FIXED -- `pve-duel` and `pve-opponent-zeroed` are now keyed on
   * `sessionId + duel-seq` (the count of prior PVE_DUEL_RESOLVED events for
   * that session), derived from ledger state by default, with an explicit
   * `duelSeq` override available for the same double-fire reason as above
   * (the UI's "Fight" button should peek/capture this once and disable
   * itself for the duration of the press). Requires `opponent.sessionId`
   * (returned by startPveOpponent above).
   */
  peekPveDuelSeq(sessionId) {
    return this.ledger.byType(EVENT_TYPES.PVE_DUEL_RESOLVED).filter((e) => e.payload && e.payload.sessionId === sessionId).length;
  }

  resolvePveDuel({ characterId, playerMoves, opponent, duelSeq: duelSeqOverride, now = Date.now() }) {
    this._assertNotKilled('resolvePveDuel');
    if (!opponent || !opponent.sessionId) throw new Error('resolvePveDuel: opponent.sessionId is required (C1/R83) -- start the session via Game#startPveOpponent');
    const duelSeq = duelSeqOverride != null ? duelSeqOverride : this.peekPveDuelSeq(opponent.sessionId);
    const key = actionKey('pve-duel', opponent.sessionId, duelSeq);
    // C1/R83: check-before-compute -- a replayed/retried press (same
    // captured session+duel-seq) returns the ALREADY-PERSISTED result
    // instead of recomputing pve.resolvePvEDuel again, which would consume
    // more of the shared RNG stream and could disagree with what's on the
    // ledger (the ledger's own append-dedup alone doesn't prevent that
    // extra, wasted, possibly-divergent computation).
    const existing = this.ledger.findByKey(key);
    if (existing) {
      return {
        outcome: existing.payload.outcome,
        playerDelta: existing.payload.stakeAfter - existing.payload.stakeBefore,
        rakeTaken: existing.payload.rakeTaken,
        opponentZeroed: existing.payload.opponentZeroed,
        stakeAfter: existing.payload.stakeAfter,
      };
    }
    const character = this.snapshot().characters[characterId];
    if (!character) throw new Error('resolvePveDuel: unknown character');
    const playerAffinity = elementIndex(character.element);
    // A8 fix: sample the opponent's moves and, on a true tie, commit the
    // flip seed to the ledger BEFORE ever resolving the duel -- the same
    // order/shape Game#resolveMatch already uses for bracket duels. Both
    // are then passed into pve.resolvePvEDuel so it uses these
    // already-committed values instead of generating its own (which would
    // both double-draw the RNG and produce a seed nobody committed to).
    const opponentMoves = pve.sampleMoves(opponent.tendency, this.random);
    const aff2 = elementIndex(opponent.affinityElement);
    let flipSeed = null;
    if (duelScore(playerMoves, opponentMoves, playerAffinity, aff2) === 0) {
      flipSeed = generateFlipSeed(this.random);
      this.ledger.append({
        key: actionKey('pve-coinflip-commit', opponent.sessionId, duelSeq),
        type: EVENT_TYPES.COIN_FLIP_COMMITTED,
        playerId: this.playerId,
        ts: now,
        payload: { sessionId: opponent.sessionId, duelSeq, commitment: sha256Hex(flipSeed) },
      });
    }
    const result = pve.resolvePvEDuel(this.tunables, {
      playerMoves,
      playerAffinity,
      playerStakeCheddar: character.stakeCheddar,
      opponent,
      random: this.random,
      opponentMoves,
      flipSeed,
    });
    const stakeAfter = character.stakeCheddar + result.playerDelta;
    this.ledger.append({
      key,
      type: EVENT_TYPES.PVE_DUEL_RESOLVED,
      playerId: this.playerId,
      ts: now,
      payload: {
        characterId, sessionId: opponent.sessionId, duelSeq, staked: true, hesitated: false,
        stakeBefore: character.stakeCheddar, stakeAfter,
        rakeTaken: result.rakeTaken, opponentZeroed: result.opponentZeroed,
        outcome: result.outcome,
        opponentName: opponent.name || null, // C13 card 5: roster W/L aggregation key
      },
    });
    if (result.opponentZeroed) {
      this.ledger.append({
        key: actionKey('pve-opponent-zeroed', opponent.sessionId, duelSeq),
        type: EVENT_TYPES.PVE_OPPONENT_ZEROED,
        playerId: this.playerId,
        ts: now,
        payload: { characterId, sessionId: opponent.sessionId, duelSeq },
      });
    }
    return { ...result, stakeAfter };
  }

  // ---- narration audit trail (C18/R73/R72) -----------------------------------

  /**
   * C18: `narrator.toXML` had zero callers, so R73's "every user message
   * logged" was unmet. Log the XML "user message" (the exact R72 record the
   * narrator template consumed) alongside the rendered output and its
   * bypass/fallback flags, once per duel. Keyed with the same identifiers
   * as the underlying bracket-duel event (idempotent together).
   */
  logNarration({ bracketId, roundIndex, matchIndex, matchData, narration }, now = Date.now()) {
    this._assertNotKilled('logNarration');
    return this.ledger.append({
      key: actionKey('narration', bracketId, roundIndex, matchIndex),
      type: EVENT_TYPES.NARRATION_GENERATED,
      playerId: this.playerId,
      ts: now,
      payload: {
        bracketId, roundIndex, matchIndex,
        userMessage: narratorToXML(matchData),
        output: narration.text,
        usedBypass: !!narration.usedBypass,
        usedFallback: !!narration.usedFallback,
        regenerations: narration.regenerations || 0,
      },
    });
  }

  // ---- R22 character-recall source: one-per-account open response -----------

  /** C18/R22: a short, optional, ONCE-per-account free-text prompt (asked
   * after a first elimination or on reserve) so R22's character-recall
   * metric has an actual data source. Silently a no-op past the first
   * successful submission (never overwrites). */
  submitOpenResponse(text, now = Date.now()) {
    this._assertNotKilled('submitOpenResponse');
    const already = this.ledger.byPlayerAndType(this.playerId, EVENT_TYPES.OPEN_RESPONSE).length > 0;
    if (already) return this.snapshot().account.openResponse;
    this.ledger.append({
      key: actionKey('open-response', this.playerId),
      type: EVENT_TYPES.OPEN_RESPONSE,
      playerId: this.playerId,
      ts: now,
      payload: { text: String(text == null ? '' : text).slice(0, 500) }, // keep it lean
    });
    return this.snapshot().account.openResponse;
  }

  // ---- C13/R26 manifest hypothesis wiring (card 3/card 4) --------------------

  /** C13/R26 card 4 ("Marquee scheduled brackets"): the reminder opt-in is
   * this card's one ledger-backed action (the schedule itself is simulated/
   * computed -- see engine/hypotheses.js:nextMarqueeSlot). Idempotent per
   * player+slot so re-opting into the SAME slot is a no-op. */
  optInMarqueeReminder(slotStartsAt, now = Date.now()) {
    this._assertNotKilled('optInMarqueeReminder');
    return this.ledger.append({
      key: actionKey('marquee-optin', this.playerId, slotStartsAt),
      type: EVENT_TYPES.MARQUEE_REMINDER_OPT_IN,
      playerId: this.playerId,
      ts: now,
      payload: { slotStartsAt },
    });
  }

  /** C13/R26 card 3 ("Spectate after elimination"): one event per board
   * view by an eliminated player, feeding the §13 "spectate rate" metric.
   *
   * f4/A-a fix: previously keyed on `randomId()` (the exact C1 double-fire
   * pattern this build's own C1 fixes elsewhere were written to close --
   * every call minted a fresh key, so the idempotency layer was a no-op
   * and re-renders/double-fires inflated the metric arbitrarily). The
   * honest §13 semantics for a spectate-RATE metric is "once per bracket
   * per player" -- keying on `spectate-view::bracketId::playerId` makes a
   * repeated view of the SAME still-open board a real no-op (idempotent),
   * while a genuinely new bracket (or a different player id) still
   * records its own event. */
  recordSpectateView(bracketId, now = Date.now()) {
    this._assertNotKilled('recordSpectateView');
    return this.ledger.append({
      key: actionKey('spectate-view', bracketId, this.playerId),
      type: EVENT_TYPES.SPECTATE_VIEW,
      playerId: this.playerId,
      ts: now,
      payload: { bracketId },
    });
  }

  // ---- money surfaces (R64-R70) ----------------------------------------------

  /**
   * C1/R83: FIXED -- `intentId` is now REQUIRED, minted ONCE per press by
   * the UI (app/ui/components/money-sheets.js) and reused on retry, instead
   * of this method minting its own random id per call (which made a
   * double-fired press credit twice -- the reviewer's repro: the same $100
   * deposit fired twice credited $200).
   * C19/R67/§15.11: `sessionNumber` is now the caller-supplied CURRENT
   * app-session number (threaded from app/ui/session.js), not "count of
   * prior deposits + 1" (which wasn't a session number at all).
   */
  loadFunds({ amountUSD, presetOrCustom, intentId, sessionNumber }, now = Date.now()) {
    this._assertNotKilled('loadFunds');
    if (!intentId) throw new Error('loadFunds: intentId is required (C1/R83) -- the UI must mint one once per press and reuse it on retry');
    if (sessionNumber == null) throw new Error('loadFunds: sessionNumber is required (C19/R67) -- thread it from app/ui/session.js');
    // f5/crucial-1 fix: a $0 (or negative) amount is not a deposit -- §13's
    // per-account "every Load Funds deposit with its context" instrumentation
    // is for real deposits; logging a $0 no-op would carry a phantom event
    // into that stream. Refuse it here (the one place this can be enforced
    // regardless of which UI screen or arm produced the call).
    // f6/advisory-3: `!(amountUSD > 0)` alone lets two malformed inputs
    // through -- `Infinity > 0` is true, and a numeric STRING like `"10"`
    // compares as `true` too (JS coerces `"10" > 0`), so either could slip
    // past this guard and mint a deposit event with a non-finite or
    // non-numeric-typed amountUSD. `Number.isFinite` rejects both (it is
    // strict about type -- a string is never "finite" to it) while still
    // passing every real, finite positive amount unchanged.
    if (!(Number.isFinite(amountUSD) && amountUSD > 0)) throw new Error('loadFunds: amountUSD must be > 0 (a $0 deposit is not a deposit)');
    // f7/advisory-8: the documented upper bound -- see MAX_LOAD_FUNDS_AMOUNT_USD above.
    if (amountUSD > MAX_LOAD_FUNDS_AMOUNT_USD) throw new Error(`loadFunds: amountUSD must not exceed $${MAX_LOAD_FUNDS_AMOUNT_USD.toLocaleString()} per deposit`);
    const snap = this.snapshot();
    const busts = retention.bustToTopUp(this.ledger.all(), this.playerId);
    const lastBust = busts.length ? busts[busts.length - 1] : null;
    this.ledger.append({
      key: actionKey('deposit', intentId),
      type: EVENT_TYPES.LOAD_FUNDS_DEPOSIT,
      playerId: this.playerId,
      ts: now,
      payload: {
        amountUSD, presetOrCustom,
        balanceBeforeUSD: snap.account.cashUSD,
        timeSinceBustSec: lastBust && lastBust.seconds == null ? Math.round((now - lastBust.bustTs) / 1000) : null,
        sessionNumber,
      },
    });
    return this.snapshot().account;
  }

  pressReserve({ tier, characterState }, now = Date.now()) {
    this._assertNotKilled('pressReserve');
    this.ledger.append({
      key: actionKey('reserve', this.playerId),
      type: EVENT_TYPES.RESERVATION_PRESSED,
      playerId: this.playerId,
      ts: now,
      payload: { tier, characterState },
    });
    return this.snapshot().account.reservation;
  }
}
