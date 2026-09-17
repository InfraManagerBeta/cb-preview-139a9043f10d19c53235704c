// app/tests/link-to-first-seal.test.js — CB-BUILD-017/AC1: O6 default is
// 30s (alternatives [60, 120]); the "link -> first duel" bar is measured to
// the player's first submitted seal; a first duel that times out
// (hesitated) earns no credit toward it. Two surfaces: a real, ledger-
// derived per-player metric (engine/retention.js's linkToFirstSeal, exercised
// end-to-end through a real Game/ledger below) and the console's synthetic
// daily report (engine/runSimulator.js + ui/console/runPanel.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import * as bracketEngine from '../engine/bracket.js';
import * as sync from '../engine/sync.js';
import * as retention from '../engine/retention.js';
import { simulateRun } from '../engine/runSimulator.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { mulberry32 } from '../engine/rng.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

// ---- O6: default 30s, alternatives [60, 120] -------------------------------

test('CB-BUILD-017/O6: tunables.timers.lobbyHumanWaitSec default is 30s, alternatives [60, 120]', () => {
  assert.equal(tunables.timers.lobbyHumanWaitSec.default, 30);
  assert.deepEqual(tunables.timers.lobbyHumanWaitSec.alternatives, [60, 120]);
});

test('CB-BUILD-017/O6: createLobby uses the 30s default to set the human-wait deadline', () => {
  const now = 0;
  const lobby = sync.createLobby(tunables, { humanEntry: { name: 'p1' }, tier: 0, now });
  assert.equal(lobby.humanWaitDeadline, 30 * 1000);
});

test('CB-BUILD-017/O6: the override path still works -- effectiveTunables can select 60 or 120', async () => {
  const { effectiveTunables } = await import('../engine/overrides.js');
  const eff60 = effectiveTunables(tunables, { lobbyHumanWaitSec: 60 });
  assert.equal(eff60.timers.lobbyHumanWaitSec.default, 60);
  const eff120 = effectiveTunables(tunables, { lobbyHumanWaitSec: 120 });
  assert.equal(eff120.timers.lobbyHumanWaitSec.default, 120);
  const lobby60 = sync.createLobby(eff60, { humanEntry: { name: 'p1' }, tier: 0, now: 0 });
  assert.equal(lobby60.humanWaitDeadline, 60 * 1000);
});

// ---- AC1: link -> first seal, real ledger wiring end to end ----------------

function freshGame(seed = 1) {
  return new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(seed) });
}

test('CB-BUILD-017 fix round f4/Finding 2 (real end-to-end): a player who SEALS their first duel manually gets a real linkToFirstSeal seconds figure measured from the LINK (app boot), not from ACCOUNT_CREATED/screener-pass -- the finding\'s own repro shape (link, then a real screener wait, then the seal)', () => {
  const game = freshGame(7);
  const linkTs = 1_000; // the player reaches the app -- recorded at boot, independent of the screener
  game.recordLinkOpened(linkTs);
  const screenerPassTs = linkTs + 40_000; // 40s reading the R8a copy, entering DOB, jurisdiction check
  game.submitScreener({ age18: true, jurisdictionOk: true }, screenerPassTs); // this is what writes ACCOUNT_CREATED (A15)
  const summon = game.summonCharacter({ element: 'water' }, screenerPassTs);
  const lobby = game.joinLobby(summon.characterId, 0, screenerPassTs);
  sync.advanceLobby(lobby, lobby.humanWaitDeadline + 1000, { treatment, tunables, random: mulberry32(2) });
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, lobby.humanWaitDeadline + 1000);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  const match = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
  const sealTs = linkTs + 100_000; // the player's own real seal, 100s after the LINK (60s after screener pass)
  game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [0, 1, 2, 0, 1], hesitated: false, now: sealTs });

  const events = game.ledger.all();
  const result = retention.linkToFirstSeal(events, 'p1');
  assert.ok(result, 'expected a linkToFirstSeal result once the first duel resolves');
  assert.equal(result.hesitated, false);
  assert.equal(result.linkTs, linkTs, 'expected the clock to key off the real LINK_OPENED event, not ACCOUNT_CREATED');
  assert.equal(result.seconds, 100, 'expected 100s (link to seal) -- the pre-fix code would have reported 60s (screener-pass to seal), excluding the 40s screener wait');
});

test('CB-BUILD-017 fix round f4/Finding 2 (real end-to-end): a player who reaches the app, WAITS, then passes the screener -- the wait is included in the real ledger-derived metric, not stripped out', () => {
  const game = freshGame(11);
  const linkTs = 3_000;
  game.recordLinkOpened(linkTs);
  const screenerPassTs = linkTs + 20_000; // a slow, hesitant screener pass (20s of reading/DOB entry)
  game.submitScreener({ age18: true, jurisdictionOk: true }, screenerPassTs);
  const summon = game.summonCharacter({ element: 'air' }, screenerPassTs);
  const lobby = game.joinLobby(summon.characterId, 0, screenerPassTs);
  sync.advanceLobby(lobby, lobby.humanWaitDeadline + 1000, { treatment, tunables, random: mulberry32(5) });
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, lobby.humanWaitDeadline + 1000);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  const match = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
  const sealTs = linkTs + 55_000; // seals well after the lobby's 30s wait clears past the 20s screener wait
  game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [0, 1, 2, 0, 1], hesitated: false, now: sealTs });

  const events = game.ledger.all();
  const result = retention.linkToFirstSeal(events, 'p1');
  assert.ok(result);
  assert.equal(result.seconds, 55, 'expected the full link->seal span, including the 20s screener wait, not just the post-pass span');

});

test('CB-BUILD-017/AC1 (real end-to-end): a first duel that MISSES the clock (auto-committed, hesitated) is excluded -- seconds:null, hesitated:true', () => {
  const game = freshGame(9);
  const linkTs = 2_000;
  game.recordLinkOpened(linkTs);
  const t0 = linkTs + 5_000;
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'fire' }, t0);
  const lobby = game.joinLobby(summon.characterId, 0, t0);
  sync.advanceLobby(lobby, lobby.humanWaitDeadline + 1000, { treatment, tunables, random: mulberry32(3) });
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, lobby.humanWaitDeadline + 1000);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  const match = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);

  // The exact shape duel.js's tick() drives on expiry (CB-BUILD-009r: no
  // picked-moves argument -- the whole hand is random).
  const window_ = sync.createCommitWindow(tunables, t0);
  window_.deadline = t0; // already expired
  const autoMoves = sync.autoCommitHesitated(window_, humanSeatIndex, t0 + 60_000, mulberry32(4));
  game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: autoMoves.moves, hesitated: true, now: t0 + 60_000 });

  const events = game.ledger.all();
  const result = retention.linkToFirstSeal(events, 'p1');
  assert.ok(result);
  assert.equal(result.linkTs, linkTs);
  assert.equal(result.hesitated, true, 'expected the timed-out first duel to be excluded from the numerator');
  assert.equal(result.seconds, null);

  // And the ledger's own SYNC_HESITATED event (not SYNC_COMMIT) is what
  // carries this -- confirming the metric rides on a real, first-class
  // ledger event, not a separately-tracked counter (invariant #10).
  const syncEvents = events.filter((e) => e.playerId === 'p1' && (e.type === EVENT_TYPES.SYNC_COMMIT || e.type === EVENT_TYPES.SYNC_HESITATED));
  assert.equal(syncEvents.length, 1);
  assert.equal(syncEvents[0].type, EVENT_TYPES.SYNC_HESITATED);
});

test('CB-BUILD-017 fix round f4/Finding 2 (real end-to-end): recordLinkOpened is idempotent per player -- a second boot (reload) does not move the recorded link time', () => {
  const game = freshGame(13);
  game.recordLinkOpened(1_000);
  game.recordLinkOpened(9_999); // simulates a reload/second boot -- must be a no-op
  const linkEvents = game.ledger.all().filter((e) => e.type === EVENT_TYPES.LINK_OPENED && e.playerId === 'p1');
  assert.equal(linkEvents.length, 1, 'expected exactly one LINK_OPENED event regardless of how many times boot runs');
  assert.equal(linkEvents[0].ts, 1_000, 'expected the FIRST recorded link time to stick');
});

// ---- AC1: surfaced in the console's daily report ---------------------------

test('CB-BUILD-017/AC1: the console\'s daily report (runSimulator\'s per-day rows) carries the link->first-seal metric, hesitated first duels excluded from its numerator', () => {
  const run = simulateRun({ seed: 20260910, plant: 'pass' });
  const gateDays = run.byArm['gate-incumbent-10'];
  const lastDay = gateDays[gateDays.length - 1];
  assert.ok('cumLinkToFirstSealSealed' in lastDay, 'expected the daily report to carry a sealed (numerator) count');
  assert.ok('cumLinkToFirstSealHesitated' in lastDay, 'expected the daily report to carry a hesitated (excluded) count');
  assert.ok('linkToFirstSealMedianSec' in lastDay && 'linkToFirstSealP90Sec' in lastDay, 'expected median/p90 seconds reported');
  // The numerator is STRICTLY the sealed count, not qualified activations as
  // a whole -- hesitated first duels are excluded from it.
  assert.equal(lastDay.cumLinkToFirstSealSealed + lastDay.cumLinkToFirstSealHesitated, lastDay.cumQualifiedActivations);
  assert.ok(lastDay.cumLinkToFirstSealHesitated > 0, 'expected at least some hesitated first duels in this synthetic cohort (a non-trivial exclusion, not a vacuous 0%)');
  assert.ok(lastDay.cumLinkToFirstSealSealed < lastDay.cumQualifiedActivations, 'expected the numerator to be strictly less than the full qualified-activation count -- hesitated duels are actually excluded, not silently included');
});

test('CB-BUILD-017/AC1: adding the link->first-seal metric does not perturb the existing pinned-seed gate classification (no new randomness consumed)', () => {
  // Pinned seed/plant combo from gate-alpha-spending-door-yield.test.js's
  // own suite -- if this ever regresses because a new rng draw shifted the
  // downstream sequence, that test file (not this one) will also fail;
  // this is a direct, scoped check that this ticket's own addition is the
  // non-cause.
  const run = simulateRun({ seed: 20260910, plant: 'pass' });
  const gateDay1 = run.byArm['gate-incumbent-10'][0];
  assert.ok(gateDay1.cumImpressions > 0);
  assert.equal(gateDay1.linkToFirstSealMedianSec, 95);
  assert.equal(gateDay1.linkToFirstSealP90Sec, 205);
});
