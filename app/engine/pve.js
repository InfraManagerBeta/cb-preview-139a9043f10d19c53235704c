// app/engine/pve.js
// R57: PvE power-building loop, the equilibrium-mix + drift house policy,
// the win-only rake, the absent floor rule (a zeroed opponent is replaced),
// and the opponent stake range (floor = tier minimum, upper = 2x player
// stake, hard cap = 1.5x that tier's "entry par").
//
// "entry par" (R57) is not separately tabulated in R62 beyond T0's summon
// cost, so — as documented in tunables.json and app/README.md — this build
// reads entry par as that tier's R63 re-entry cost, expressed in Cheddar
// (reentryUSD * cheddarPerDollar). This is a named, documented decision for
// t3/future maintainers, not an invented number: every value it multiplies
// is a shipped R62/R63 figure.

import { floorForTier, reentryForTier, usdToCheddar } from './economy.js';
import { resolveDuel, duelScore, generateFlipSeed, elementIndex, ELEMENT_NAMES } from './duel.js';
import { weightedChoice, randFloat } from './rng.js';
import { EVENT_TYPES } from './ledger.js';

export function entryParCheddar(tunables, tier) {
  const reentry = reentryForTier(tunables, tier);
  return usdToCheddar(tunables, reentry.usd);
}

/** R57: uniform 1/3 baseline, shifted +driftPct toward driftElement, the
 * remainder spread evenly across the other two elements. */
export function equilibriumMixWithDrift(driftElement, driftPct) {
  const base = 1 / 3;
  const mix = { fire: base, water: base, air: base };
  const others = ELEMENT_NAMES.filter((e) => e !== driftElement);
  mix[driftElement] += driftPct;
  for (const e of others) mix[e] -= driftPct / 2;
  return mix;
}

/** Pick a random per-session drift element. */
export function pickDriftElement(random = Math.random) {
  const i = Math.floor(random() * ELEMENT_NAMES.length);
  return ELEMENT_NAMES[i];
}

/**
 * R57: generate a fresh house opponent for a PvE session at `tier` against a
 * player with `playerStakeCheddar`. Returns the opponent's stake and its
 * per-session tendency (equilibrium mix + 3% drift toward a chosen element).
 */
export function generatePvEOpponent(tunables, { tier, playerStakeCheddar, random = Math.random }) {
  const floor = floorForTier(tunables, tier);
  const upperFromPlayer = tunables.pve.opponentRangeUpperMultiplierOfPlayerStake * playerStakeCheddar;
  const hardCap = tunables.pve.hardCapMultiplierOfEntryPar * entryParCheddar(tunables, tier);
  // A5/R57 -- DOCUMENTED, NOT CHANGED (f1 keeps the shipped, closest-law-
  // preserving behavior; f3/R87 records this in the decision record):
  // R57 is internally in tension for a SUB-FLOOR player (stakeCheddar below
  // that tier's floor -- can happen after a drain, before a re-entry/PvE
  // rebuild). Three R57 clauses collide:
  //   (a) the opponent's range upper bound is 2x the player's OWN stake,
  //   (b) the floor is stated as the range's LOWER bound regardless of (a),
  //   (c) "below the tier floor, the player rebuilds through PvE" implies
  //       the opponent should be beatable/near the player's own (small)
  //       stake, not pinned to the tier floor above it.
  // For a sub-floor player, `upperFromPlayer` (a) can sit BELOW `floor` (b),
  // so `Math.max(floor, min(upperFromPlayer, hardCap))` collapses the range
  // to a single point, [floor, floor] -- e.g. a 20C stake at tier 0
  // (floor 50) yields the fixed range [50, 50], not a rebuildable range
  // scaled off the player's actual (smaller) stake. The shipped code
  // resolves the collision by treating the floor as an absolute lower bound
  // that wins over the 2x-of-player upper bound (R57 states the floor
  // clause without a "unless sub-floor" carve-out, so literal-lower-bound
  // wins here) -- this is the closest-to-shipped-law reading, not a new
  // invented rule. Left exactly as shipped; not this fix round's call to
  // resolve the conflict (see the order's completion notes for f3).
  const upper = Math.max(floor, Math.min(upperFromPlayer, hardCap));
  const stakeCheddar = Math.round(randFloat(floor, upper, random));
  const driftElement = pickDriftElement(random);
  const tendency = equilibriumMixWithDrift(driftElement, tunables.pve.driftPerSessionPct);
  return {
    id: `pve-${Date.now()}-${Math.floor(random() * 1e6)}`,
    kind: 'house',
    tier,
    stakeCheddar,
    affinityElement: driftElement, // the element the house opponent leans toward this session
    tendency,
  };
}

/** Sample five round moves from a {fire,water,air} probability distribution. */
export function sampleMoves(tendency, random = Math.random) {
  const moves = [];
  for (let i = 0; i < 5; i++) {
    const el = weightedChoice(tendency, random);
    moves.push(ELEMENT_NAMES.indexOf(el));
  }
  return moves;
}

/**
 * Resolve one PvE duel. The floor rule is absent in PvE (R57): pass floor=0
 * so the engine never forces a full drain; if the opponent's stake reaches
 * exactly 0 through the natural transfer, `opponentZeroed` is true and the
 * caller should replace the opponent (new opponent, new tendency).
 * Rake (5%) applies only when the player wins.
 */
export function resolvePvEDuel(tunables, { playerMoves, playerAffinity, playerStakeCheddar, opponent, random = Math.random, opponentMoves: opponentMovesOverride = null, flipSeed: flipSeedOverride = null }) {
  // f5/A8: Game#resolvePveDuel now pre-samples the opponent's moves and,
  // on a true tie, pre-commits the flip seed to the ledger (COIN_FLIP_
  // COMMITTED) BEFORE calling this function at all -- the same order
  // bracket duels use (commit before resolving). Both are accepted as
  // overrides here so this pure function uses the CALLER's already-
  // committed values instead of silently generating its own (which would
  // both double-draw the RNG and produce a seed nobody committed to).
  // Any OTHER caller (e.g. this suite's own direct pve.test.js calls) that
  // doesn't pass these keeps the prior self-contained behavior exactly.
  const opponentMoves = opponentMovesOverride || sampleMoves(opponent.tendency, random);
  // f6/advisory-6: Game#resolvePveDuel (the live caller) computes ITS OWN
  // aff2 via duel.js's `elementIndex` (lowercases, throws on an unrecognized
  // element) BEFORE ever calling this function -- to decide, ahead of time,
  // whether to pre-commit a coin-flip seed. This function used to recompute
  // aff2 independently via `ELEMENT_NAMES.indexOf` (exact-case, silently
  // returns -1 instead of throwing on anything it doesn't recognize): on
  // non-canonical input (e.g. a mixed-case or corrupted `affinityElement`)
  // the two computations could disagree, so Game#resolvePveDuel's own
  // tie-precommit decision (using ITS aff2) could diverge from what THIS
  // function's resolveDuel call actually scores (using ITS OWN, different,
  // aff2) -- a duel could commit a flip seed for a "tie" that resolveDuel
  // itself does not compute as one, or vice versa. Using the SAME shared
  // `elementIndex` function here removes the possibility of disagreement
  // outright, rather than plumbing the already-resolved value through as a
  // second parameter.
  //
  // f7/advisory-7: BEHAVIOR CHANGE for any DIRECT caller of this function
  // (i.e. anyone bypassing Game#resolvePveDuel and calling
  // pve.resolvePvEDuel itself with a raw `opponent.affinityElement`, e.g. a
  // hand-built fixture or a future caller) -- `elementIndex` lowercases
  // before matching, so a wrong-case value (e.g. 'Fire') now resolves
  // CORRECTLY here, where the old exact-case `ELEMENT_NAMES.indexOf` gave
  // -1 (an aff2 that could never match a real move index, quietly making
  // every round "off affinity" instead of matching). Only a genuinely
  // unknown or whitespace-padded value (anything not in ELEMENT_NAMES even
  // case-insensitively) now THROWS. This is safe as shipped: every REAL
  // opponent object this codebase ever constructs
  // (generatePvEOpponent/generatePvERosterOpponent) sets `affinityElement`
  // from duel.js's own `ELEMENT_NAMES` list, so it is always canonical for
  // every live path (Game#resolvePveDuel, this suite's own pve.test.js
  // fixtures) -- the only caller who could ever observe the new throw is
  // one passing a genuinely corrupted/hand-rolled opponent, which is
  // exactly the input a throw (not a silently-wrong duel) should meet.
  const aff2 = elementIndex(opponent.affinityElement);
  // f4/A-k fix: bracket duels (Game#resolveMatch) generate a commit-reveal
  // flip seed BEFORE calling resolveDuel whenever the duel is a true tie
  // (C22/R54's "provably fair" coin flip -- the commitment is recordable
  // BEFORE the flip decides anything). PvE duels used to call resolveDuel
  // with no seed at all, silently falling into resolveDuel's OWN legacy
  // fallback (`coinFlip(random)`, a plain, unrecorded random draw) on a
  // PvE tie -- the exact asymmetry the brief flags. Preferring the seed
  // (rather than merely documenting the gap): compute duelScore the same
  // way Game#resolveMatch does, and pass a real flipSeed whenever this
  // duel is a true tie, so a PvE tie carries the SAME
  // commitment+revealed-seed shape a bracket duel's tie does
  // (outcome.coinFlip below).
  //
  // f5/A8 fix: a PvE tie previously carried the commit-reveal SHAPE
  // (outcome.coinFlip) but never a COIN_FLIP_COMMITTED ledger event of its
  // own the way a bracket duel's tie does -- the commitment lived only
  // inside the SAME PVE_DUEL_RESOLVED event as the reveal, i.e. recorded
  // AFTER (in the same atomic append, not genuinely BEFORE) the outcome
  // was already decided, missing the one property that makes a commit-
  // reveal scheme meaningful (the commitment must be independently
  // observable before the reveal, not just structurally present next to
  // it). Game#resolvePveDuel now appends COIN_FLIP_COMMITTED itself,
  // before ever calling this function, exactly like Game#resolveMatch.
  // (Separate, still-true limitation: app/ui/screens/pve.js does not
  // render a verification fold for this, unlike duel.js's own
  // renderCoinFlipVerification -- the data is real and available on the
  // ledger now; a fold is a follow-up UI item, not invented here.)
  const flipSeed = flipSeedOverride != null
    ? flipSeedOverride
    : (duelScore(playerMoves, opponentMoves, playerAffinity, aff2) === 0 ? generateFlipSeed(random) : null);
  const outcome = resolveDuel({
    mv1: playerMoves,
    mv2: opponentMoves,
    aff1: playerAffinity,
    aff2,
    p1: playerStakeCheddar,
    p2: opponent.stakeCheddar,
    floor: 0, // R57: no floor rule in PvE
    random,
    flipSeed,
  });

  const rake = tunables.pve.rakeOnWinsOnly;
  let playerDelta = 0;
  let opponentDelta = 0;
  let rakeTaken = 0;
  if (outcome.transfer > 0) {
    // player (character 1) won cheddar from the opponent
    rakeTaken = Math.floor(outcome.transfer * rake);
    playerDelta = outcome.transfer - rakeTaken;
    opponentDelta = -outcome.transfer;
  } else if (outcome.transfer < 0) {
    // opponent won; no rake on player losses
    playerDelta = outcome.transfer; // negative
    opponentDelta = -outcome.transfer; // positive
  }

  const opponentStakeAfter = opponent.stakeCheddar + opponentDelta;
  const opponentZeroed = opponentStakeAfter <= 0;

  return {
    opponentMoves,
    outcome,
    playerDelta,
    opponentDelta,
    rakeTaken,
    opponentStakeAfter,
    opponentZeroed,
  };
}

/** UI hint only (not a hard gate): does this character need PvE rebuilding
 * before it could usefully re-enter its tier? */
export function needsPvERebuild(tunables, character) {
  const floor = floorForTier(tunables, character.tier);
  const reentry = reentryForTier(tunables, character.tier);
  const projected = character.stakeCheddar + reentry.bonusCheddar;
  return projected < floor;
}

/**
 * C13/R26 card 5 ("PvE depth"): draw a NAMED house opponent from the
 * treatment's seed roster -- the SAME hand-authored personalities bracket
 * NPCs use (R80/R82), not an anonymous per-session opponent -- so repeated
 * PvE sessions build a real per-name W/L record (see
 * engine/game.js:startPveOpponent, which records `opponentName` on the
 * ledger for this). Round-robins through the canonical roster by session
 * epoch: DETERMINISTIC, not randomized -- the point of a "roster" is
 * REPEATED matchups against the same named bots, not variety. Falls back
 * to the anonymous generator if the treatment has no canonical roster
 * entries at all.
 */
export function generatePvERosterOpponent(tunables, treatment, { tier, playerStakeCheddar, sessionEpoch = 0, random = Math.random }) {
  const base = generatePvEOpponent(tunables, { tier, playerStakeCheddar, random });
  const canonical = (treatment && treatment.seedRoster ? treatment.seedRoster : []).filter((r) => r.canonical);
  if (canonical.length === 0) return base;
  const pick = canonical[((sessionEpoch % canonical.length) + canonical.length) % canonical.length];
  return { ...base, name: pick.name, tendency: pick.tendency, affinityElement: pick.element, npcTag: true };
}

/**
 * C13 card 5: aggregate per-opponent-name W/L from the ledger's
 * PVE_DUEL_RESOLVED events (only the ones carrying an `opponentName` --
 * i.e. roster-drawn opponents; anonymous PvE sessions have no name to
 * group by and are excluded). From the PLAYER's outcome: outcome.winner
 * === 1 is a player win (an opponent LOSS); === -1 is an opponent WIN.
 */
export function pveRosterRecords(ledgerEvents) {
  const byName = {};
  for (const e of ledgerEvents) {
    if (e.type !== EVENT_TYPES.PVE_DUEL_RESOLVED) continue;
    const name = e.payload && e.payload.opponentName;
    if (!name) continue;
    if (!byName[name]) byName[name] = { name, w: 0, l: 0 };
    const winner = e.payload.outcome && e.payload.outcome.winner;
    if (winner === -1) byName[name].w += 1; // opponent won
    else if (winner === 1) byName[name].l += 1; // opponent lost
  }
  return byName;
}
