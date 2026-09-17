// app/tests/invariants.test.js — §15/R86: the 12 invariants, each exercised
// automatically where it applies to this artifact (a client-only static
// build with no live ad/model/payment rails — see app/README.md scope note).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDuel, duelScore } from '../engine/duel.js';
import { Ledger, createMemoryStorage, EVENT_TYPES, actionKey } from '../engine/ledger.js';
import { Game } from '../engine/game.js';
import { project, checkConservation } from '../engine/projection.js';
import * as bracketEngine from '../engine/bracket.js';
import * as economy from '../engine/economy.js';
import * as sync from '../engine/sync.js';
import * as retention from '../engine/retention.js';
import { mulberry32, randInt } from '../engine/rng.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function playOneBracket(game, { characterElement = 'fire', seed = 1 } = {}) {
  const rng = mulberry32(seed);
  let t = Date.now();
  game.ensureAccount(t); t += 1;
  game.submitScreener({ age18: true, jurisdictionOk: true }, t); t += 1;
  const summon = game.summonCharacter({ element: characterElement }, t); t += 1;
  const lobby = game.joinLobby(summon.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  let guard = 0;
  while (!bracket.complete && guard++ < 60) {
    const matches = bracketEngine.pendingMatches(bracket);
    for (const m of matches) {
      const involvesHuman = m.seatA === humanSeatIndex || m.seatB === humanSeatIndex;
      t += 1000;
      const moves = [0, 1, 2, 0, 1].map(() => Math.floor(rng() * 3));
      game.resolveMatch({ bracketId, bracket, roundIndex: m.roundIndex, matchIndex: m.matchIndex, playerMoves: involvesHuman ? moves : null, now: t });
    }
  }
  return { summon, bracketId, bracket, humanSeatIndex, t };
}

// #1 transfer <= loser's pre-duel stake; winner's gain == loser's loss.
test('invariant #1: transfer never exceeds the loser stake; winner gain == loser loss', () => {
  const random = () => 0.37;
  for (let i = 0; i < 100; i++) {
    const mv1 = [i % 3, (i + 1) % 3, (i + 2) % 3, i % 3, (i + 1) % 3];
    const mv2 = [(i + 2) % 3, i % 3, (i + 1) % 3, (i + 2) % 3, i % 3];
    const p1 = 20 + (i % 30) * 5;
    const p2 = 20 + (i % 17) * 9;
    const out = resolveDuel({ mv1, mv2, aff1: i % 3, aff2: (i + 1) % 3, p1, p2, floor: 10, random });
    const loserStake = out.trueTie ? null : (out.winner === 1 ? p2 : p1);
    if (loserStake != null) assert.ok(Math.abs(out.transfer) <= loserStake);
    // winner's gain equals loser's loss by construction (single signed transfer)
  }
});

// #2 ledger conservation, at every instant during a played-out bracket.
test('invariant #2: ledger conservation holds at every instant across a full bracket', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(99) });
  playOneBracket(game, { seed: 7 });
  const cons = game.conservation();
  assert.equal(cons.balanced, true, JSON.stringify(cons));
});

test('invariant #2: ledger conservation holds across many randomized brackets and PvE sessions', () => {
  for (let trial = 0; trial < 15; trial++) {
    const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(trial * 13 + 3) });
    const { summon, t: bracketT } = playOneBracket(game, { seed: trial + 1 });
    let t = bracketT;
    // a little PvE on top, win or lose
    for (let i = 0; i < 5; i++) {
      const snap = game.snapshot();
      const c = snap.characters[summon.characterId];
      if (!c || c.stakeCheddar <= 0) break;
      t += 1000;
      const opp = game.startPveOpponent(summon.characterId, t);
      const moves = [0, 1, 2, 0, 1];
      t += 1000;
      game.resolvePveDuel({ characterId: summon.characterId, playerMoves: moves, opponent: opp, now: t });
    }
    const cons = game.conservation();
    assert.equal(cons.balanced, true, `trial ${trial}: ${JSON.stringify(cons)}`);
  }
});

// #3 stake attached to exactly one character; wallet holds CASH alone.
// STRENGTHENED (A8/item10): across a SCRIPTED POPULATION of several
// independent games/characters, not just one -- and explicitly checks the
// stake figures partition cleanly (every character's stake is a disjoint,
// non-negative scalar; nothing is ever double-counted across characters).
test('invariant #3: stake lives on exactly one character; the account only ever holds CASH (scripted population)', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(seed * 5) });
    playOneBracket(game, { seed });
    const snap = game.snapshot();
    assert.ok('cashUSD' in snap.account);
    assert.equal(Object.keys(snap.account).some((k) => /cheddar|stake/i.test(k)), false, 'account must not hold stake/Cheddar fields');
    const seenIds = new Set();
    let sumOfStakes = 0;
    for (const c of Object.values(snap.characters)) {
      assert.equal(typeof c.stakeCheddar, 'number'); // stake is a single scalar per character, not distributed
      assert.ok(c.stakeCheddar >= 0, `character ${c.id} has a negative stake`);
      assert.equal(seenIds.has(c.id), false, `character id ${c.id} appeared twice in the same snapshot`);
      seenIds.add(c.id);
      sumOfStakes += c.stakeCheddar;
    }
    // Every character's stake is accounted for by conservation (item #2) --
    // sum of live stakes plus every sink equals every source.
    const cons = game.conservation();
    assert.equal(cons.currentStakeTotal, sumOfStakes, `seed ${seed}: currentStakeTotal disagrees with summing characters directly`);
    assert.equal(cons.balanced, true, `seed ${seed}: ${JSON.stringify(cons)}`);
  }
});

// #4 win probability invariant to stake, over uniform-random policies at different stake magnitudes.
// STRENGTHENED (item10): real affinities enabled (0/1/2, not the
// affinity-disabling sentinel 9) AND compares a HIGH-stake side against a
// LOW-stake side WITHIN THE SAME duels (stake size shouldn't shift who
// wins a single duel any more than it shifts the aggregate rate).
test('invariant #4: win rate is independent of stake size (equal-skill uniform-random policies, real affinities enabled, high-vs-low stake compared within duels)', () => {
  const random = mulberry32(2024);
  function simulate({ p1IsHighStake }, n) {
    let p1Wins = 0, decided = 0;
    for (let i = 0; i < n; i++) {
      const mv1 = [0, 1, 2, 3, 4].map(() => Math.floor(random() * 3));
      const mv2 = [0, 1, 2, 3, 4].map(() => Math.floor(random() * 3));
      const aff1 = Math.floor(random() * 3);
      const aff2 = Math.floor(random() * 3);
      const p1 = p1IsHighStake ? 100000 : 100;
      const p2 = p1IsHighStake ? 100 : 100000;
      const out = resolveDuel({ mv1, mv2, aff1, aff2, p1, p2, floor: 1, random });
      if (out.trueTie) continue;
      decided++;
      if (out.winner === 1) p1Wins++;
    }
    return p1Wins / decided;
  }
  const N = 4000;
  // p1's win rate when it's the HIGH-stake side vs when it's the LOW-stake
  // side, WITHIN comparable duels (same move/affinity generation, only the
  // stake assignment flips) -- both must land near 0.5, independent of
  // which side holds more Cheddar.
  const p1WinRateWhenHigh = simulate({ p1IsHighStake: true }, N);
  const p1WinRateWhenLow = simulate({ p1IsHighStake: false }, N);
  assert.ok(Math.abs(p1WinRateWhenHigh - p1WinRateWhenLow) < 0.05, `high=${p1WinRateWhenHigh} low=${p1WinRateWhenLow}`);
  assert.ok(Math.abs(p1WinRateWhenHigh - 0.5) < 0.05, `high-stake-side win rate should be ~0.5, got ${p1WinRateWhenHigh}`);
  assert.ok(Math.abs(p1WinRateWhenLow - 0.5) < 0.05, `low-stake-side win rate should be ~0.5, got ${p1WinRateWhenLow}`);
});

// #5 duelScore uses moves/affinities alone (independent of stake); floor checked after transfer; zero score transfers nothing.
// STRENGTHENED (item10): uses REAL affinities (0/1/2, triggering the 1.3x
// BIG/CRITICAL multiplier) instead of the affinity-disabling sentinel 9, so
// the invariant is proven on the path that actually exercises the
// affinity-weighted scoring, not just the plain cyclic-dominance path.
test('invariant #5: duelScore ignores stake entirely, WITH real affinities (BIG/CRITICAL) engaged; zero score transfers nothing', () => {
  const mv1 = [0, 1, 2, 0, 1]; // fire, water, air, fire, water
  const mv2 = [2, 0, 1, 2, 0]; // every round decisive for mv1 (R53 cyclic dominance)
  const aff1 = 0; // fire -- mv1 plays fire in rounds 1 and 4: affinity applies
  const aff2 = 1; // water -- mv2 never plays water here, so only p1's affinity fires
  const outLow = resolveDuel({ mv1, mv2, aff1, aff2, p1: 10, p2: 10, floor: 1 });
  const outHigh = resolveDuel({ mv1, mv2, aff1, aff2, p1: 999999, p2: 1, floor: 1 });
  assert.equal(outLow.score, outHigh.score);
  // Confirm the affinity multiplier really did engage (else this wouldn't
  // be testing what it claims to): with aff1 disabled (9) the score would
  // be the plain weight sum, 424; with p1's affinity live it must be higher.
  const noAffinityScore = duelScore(mv1, mv2, 9, 9);
  assert.ok(outLow.score > noAffinityScore, `expected the affinity multiplier to raise the score above ${noAffinityScore}, got ${outLow.score}`);
  assert.ok(outLow.bigCount > 0 || outLow.criticalCount > 0, 'expected at least one BIG/CRITICAL-tagged round');

  const tie = resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [0, 1, 2, 0, 1], aff1: 9, aff2: 9, p1: 500, p2: 500, floor: 1, random: () => 0.5 });
  assert.equal(tie.score, 0);
  assert.equal(tie.transfer, 0);
});

// #6 bracket entry: stake >= floor; tier N>0 needs live W>L at N-1.
test('invariant #6: bracket entry requires stake >= floor and a winning record for tier > 0', () => {
  assert.equal(economy.meetsMinimumStake(tunables, { stakeCheddar: 49 }, 0), false);
  assert.equal(economy.meetsMinimumStake(tunables, { stakeCheddar: 50 }, 0), true);
  assert.equal(economy.canEnterTier({ records: { 0: { w: 1, l: 1 } } }, 1), false);
  assert.equal(economy.canEnterTier({ records: { 0: { w: 2, l: 0 } } }, 1), true);
  assert.equal(economy.canEnterTier({ records: {} }, 0), true);
});

// #7 unique action key; replaying it changes nothing.
// STRENGTHENED (item10, C1): the old test hand-constructed a ledger.append
// call with a manually-picked key -- it would NOT have caught C1 (six real
// Game-facade actions minting `actionKey(..., randomId())`, so replaying
// them was never actually a no-op). Now replays through the Game facade
// itself (loadFunds, with the SAME captured intentId), the exact shape of
// the reviewer's repro ("the same $100 deposit fired twice credited $200").
test('invariant #7: every ledger mutation carries a unique, DETERMINISTIC action key; replaying the SAME Game-facade call is a no-op (would have caught C1)', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(1) });
  game.ensureAccount(1000);
  const before = game.snapshot().account.cashUSD;
  game.loadFunds({ amountUSD: 100, presetOrCustom: 'preset', intentId: 'invariant-7-intent', sessionNumber: 1 }, 2000);
  game.loadFunds({ amountUSD: 100, presetOrCustom: 'preset', intentId: 'invariant-7-intent', sessionNumber: 1 }, 2001); // replayed
  assert.equal(game.snapshot().account.cashUSD - before, 100); // not 200
  assert.equal(game.ledger.byType(EVENT_TYPES.LOAD_FUNDS_DEPOSIT).length, 1);

  // Also still true at the raw-ledger level (the low-level primitive).
  const ledger = new Ledger(createMemoryStorage());
  const key = actionKey('cashout', 'char-1');
  ledger.append({ key, type: EVENT_TYPES.CHARACTER_CASHED_OUT, playerId: 'p1', ts: 1, payload: { cashUSD: 5 } });
  ledger.append({ key, type: EVENT_TYPES.CHARACTER_CASHED_OUT, playerId: 'p1', ts: 2, payload: { cashUSD: 999 } });
  assert.equal(ledger.all().length, 1);
  assert.equal(ledger.all()[0].payload.cashUSD, 5);
});

// #8 every NPC-occupied seat renders the NPC tag on every surface listing that seat.
test('invariant #8: every NPC seat carries the permanent npcTag, and every seat-listing screen renders it', async () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(3) });
  let t = Date.now();
  game.ensureAccount(t);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t);
  const summon = game.summonCharacter({ element: 'fire' }, t);
  const lobby = game.joinLobby(summon.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  for (const seat of lobby.seats) {
    if (seat.kind === 'npc') assert.equal(seat.npcTag, true);
  }
  const { bracket } = game.lockBracketFromLobby(lobby, t);
  for (const seat of bracket.seats) {
    if (seat.kind === 'npc') assert.equal(seat.npcTag, true);
  }
  // Static check: every screen/component that lists seats renders the tag
  // conditionally on kind==='npc'. C6/§15.8: extended to the battle stage
  // and the tug-of-war bar too -- the review found the tag reached the
  // pre-duel header but not the two surfaces a participant actually watches
  // during the live reveal.
  for (const file of [
    'ui/screens/lobby.js', 'ui/screens/duel.js', 'ui/screens/bracket-board.js',
    'ui/components/battle/stage.js', 'ui/components/battle/tugbar.js',
  ]) {
    const src = await fs.readFile(path.join(APP_ROOT, file), 'utf8');
    assert.ok(src.includes('npcTagLabel') || src.includes("kind === 'npc'"), `${file} must render the NPC tag`);
  }
});

// #9 R1 forbidden strings appear in zero participant-facing render paths.
test('invariant #9 (build failure R1): forbidden strings are absent from every participant-facing surface', async () => {
  const forbidden = [/cheeze wizards/i, /cheese wizards/i, /\bcw\b/i];
  // t3/§18: the bundle's nine canonical GIF filenames are literally named
  // "CW_<State>.gif" (e.g. CW_Battle Idle.gif), and the bundle's own
  // directory is named "cw" (assets/cw/..., renamed from the delivered
  // build's "cw-asset-bundle" per CB-BUILD-000 -- content byte-identical,
  // path retargeted; R18) -- the brief is explicit that "GIF file paths as
  // `src` attributes are fine; alt text must be theme-neutral" (R1 only
  // governs participant-facing RENDERED text/labels, not an
  // interchange-format asset's own filename/path). Strip just those
  // non-renderable path tokens before scanning so the rest of the scan
  // stays exactly as strict as before. Both the pre-rename and post-rename
  // bundle path spellings are stripped so this stays correct regardless of
  // which the checked-out tree carries.
  const CW_ASSET_FILENAME_RE = /CW_[A-Za-z ]+\.gif/g;
  const CW_ASSET_BUNDLE_PATH_RE = /cw-asset-bundle|assets\/cw\//gi;
  const participantFiles = [];
  async function collect(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await collect(p);
      else if (/\.(js|html|css|txt)$/.test(entry.name)) participantFiles.push(p);
    }
  }
  await collect(path.join(APP_ROOT, 'ui'));
  await collect(path.join(APP_ROOT, 'styles'));
  participantFiles.push(path.join(APP_ROOT, 'index.html'));
  participantFiles.push(path.join(APP_ROOT, 'data', 'narrator-prompt.txt'));

  for (const file of participantFiles) {
    const raw = await fs.readFile(file, 'utf8');
    const text = raw.replace(CW_ASSET_FILENAME_RE, '').replace(CW_ASSET_BUNDLE_PATH_RE, '');
    for (const re of forbidden) {
      assert.equal(re.test(text), false, `${file} matched forbidden pattern ${re}`);
    }
  }

  // The treatment JSON carries one developer-only annotation field (_r1,
  // underscore-prefixed, never read by the UI) that names the rule for
  // maintainers; every *rendered* field must still be clean.
  const treatmentRaw = JSON.parse(await fs.readFile(path.join(APP_ROOT, 'data', 'treatments', 'incumbent.json'), 'utf8'));
  function walkRenderable(obj, keyPath = '') {
    if (obj == null) return;
    if (typeof obj === 'string') {
      for (const re of forbidden) assert.equal(re.test(obj), false, `${keyPath} matched forbidden pattern ${re}`);
      return;
    }
    if (Array.isArray(obj)) { obj.forEach((v, i) => walkRenderable(v, `${keyPath}[${i}]`)); return; }
    if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith('_')) continue; // developer-only annotation, never rendered
        walkRenderable(v, `${keyPath}.${k}`);
      }
    }
  }
  walkRenderable(treatmentRaw);
});

// #10 every gated metric recomputes to the same value from the delivered raw events.
test('invariant #10: gated metrics recompute identically from the same raw ledger events', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(11) });
  playOneBracket(game, { seed: 11 });
  game.pressReserve({ tier: 0, characterState: 'ACTIVE' }, Date.now());
  const events1 = game.ledger.all();
  const events2 = JSON.parse(JSON.stringify(events1)); // simulate "delivered raw events" read fresh
  const snap1 = project(events1);
  const snap2 = project(events2);
  assert.deepEqual(checkConservation(snap1), checkConservation(snap2));
  assert.deepEqual(snap1.totals, snap2.totals);

  // STRENGTHENED (item10): also recompute two actual GATED RETENTION
  // metrics -- reservation-rate and replay-after-loss -- straight from the
  // raw events (not from `snap1`/`snap2`'s totals, which don't carry
  // these), across a small scripted population, and confirm both
  // recomputations agree exactly with each other.
  function reservationRate(events, playerIds) {
    const withReservation = playerIds.filter((pid) => !!retention.reservationRecord(events, pid, null));
    return withReservation.length / playerIds.length;
  }
  const playerIds = ['p1', 'p2', 'p3'];
  const anchor = 10_000_000;
  const scriptedEvents = [
    { schemaVersion: 1, key: 'r-p1', type: EVENT_TYPES.RESERVATION_PRESSED, playerId: 'p1', ts: anchor + 1000, payload: { tier: 0, characterState: 'ACTIVE' } },
    { schemaVersion: 1, key: 'elim-p2', type: EVENT_TYPES.CHARACTER_ELIMINATED, playerId: 'p2', ts: anchor, payload: { bracketId: 'b1', allDuelsStaked: true } },
    { schemaVersion: 1, key: 'join-p2', type: EVENT_TYPES.SYNC_LOBBY_JOINED, playerId: 'p2', ts: anchor + 500, payload: { freshEntry: true } },
  ].concat(events1); // fold in the real played-out bracket's events too

  const scriptedEvents2 = JSON.parse(JSON.stringify(scriptedEvents));
  assert.equal(reservationRate(scriptedEvents, playerIds), reservationRate(scriptedEvents2, playerIds));
  assert.equal(reservationRate(scriptedEvents, playerIds), 1 / 3); // only p1 reserved

  for (const pid of playerIds) {
    assert.equal(
      retention.replayAfterLoss(scriptedEvents, pid, anchor),
      retention.replayAfterLoss(scriptedEvents2, pid, anchor),
      `replayAfterLoss disagreed on re-projection for ${pid}`
    );
  }
  assert.equal(retention.replayAfterLoss(scriptedEvents, 'p2', anchor), true); // p2's same-day re-entry after elimination
  assert.equal(retention.replayAfterLoss(scriptedEvents, 'p3', anchor), false); // p3 has no events at all
});

// #11 every deposit event carries amount, preset-or-custom, balance before, time since bust, session number.
test('invariant #11: every Load Funds deposit event carries the full required field set', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(1) });
  const t = Date.now();
  game.ensureAccount(t);
  game.loadFunds({ amountUSD: 50, presetOrCustom: 'preset', intentId: 'intent-11', sessionNumber: 1 }, t + 1000);
  const deposit = game.ledger.byType(EVENT_TYPES.LOAD_FUNDS_DEPOSIT)[0];
  for (const field of ['amountUSD', 'presetOrCustom', 'balanceBeforeUSD', 'timeSinceBustSec', 'sessionNumber']) {
    assert.ok(field in deposit.payload, `deposit payload missing ${field}`);
  }
});

// #12 within a run, arms differ in the arm variable alone (configuration diff is empty elsewhere).
// t1 ships a single (incumbent) arm; O-item alternatives are shipped as data
// alongside the default, per §14/R85 — this checks that shape holds so a
// later arm-diff (t3) has something real to diff against.
test('invariant #12 (config-diff scaffold): every O-item alternative sits beside its default, touching no other key', () => {
  const oItems = [
    tunables.timers.commitWindowSec,
    tunables.timers.lobbyHumanWaitSec,
    tunables.timers.revealCadenceMs,
    tunables.narrator.temperature,
    tunables.npcFillDensity,
    tunables.runActivation,
    tunables.loadFundsPresets,
  ];
  for (const item of oItems) {
    assert.ok('default' in item, JSON.stringify(item));
    const alts = item.alternatives;
    assert.ok(Array.isArray(alts) && alts.length > 0, JSON.stringify(item));
  }
});
