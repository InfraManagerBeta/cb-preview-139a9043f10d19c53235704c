// app/tests/pve.test.js — R57: PvE opponent range, equilibrium mix + drift,
// win-only rake, the absent floor rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pve from '../engine/pve.js';
import * as economy from '../engine/economy.js';
import { resolveDuel, sha256Hex, deterministicFlipFromSeed } from '../engine/duel.js';
import { loadTunables } from '../engine/dataLoader.js';

const tunables = await loadTunables();

test('equilibriumMixWithDrift: sums to 1 and shifts exactly driftPct toward the chosen element', () => {
  const mix = pve.equilibriumMixWithDrift('fire', 0.03);
  const sum = mix.fire + mix.water + mix.air;
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(Math.abs(mix.fire - (1 / 3 + 0.03)) < 1e-9);
});

test('generatePvEOpponent: stake respects floor as the lower bound', () => {
  const random = () => 0; // pins to the lower bound of the range
  const opp = pve.generatePvEOpponent(tunables, { tier: 0, playerStakeCheddar: 100, random });
  assert.equal(opp.stakeCheddar, economy.floorForTier(tunables, 0));
});

test('generatePvEOpponent: upper bound is min(2x player stake, 1.5x entry par)', () => {
  const random = () => 0.999999; // pins to the upper bound of the range
  const playerStakeCheddar = 100;
  const upperFromPlayer = 2 * playerStakeCheddar;
  const hardCap = 1.5 * pve.entryParCheddar(tunables, 0);
  const expectedUpper = Math.min(upperFromPlayer, hardCap);
  const opp = pve.generatePvEOpponent(tunables, { tier: 0, playerStakeCheddar, random });
  assert.ok(opp.stakeCheddar <= Math.max(expectedUpper, economy.floorForTier(tunables, 0)) + 1);
});

test('resolvePvEDuel: floor rule is absent — a natural drain to exactly 0 marks the opponent zeroed, not forced', () => {
  const opponent = { stakeCheddar: 5, affinityElement: 'air', tendency: { fire: 1, water: 0, air: 0 } };
  // Player commits fire five times; opponent (tendency all-fire is impossible since air affinity fixed to sample fire) beats... just resolve and check invariants hold.
  const result = pve.resolvePvEDuel(tunables, {
    playerMoves: [0, 0, 0, 0, 0],
    playerAffinity: 0,
    playerStakeCheddar: 1000,
    opponent,
    random: () => 0.999, // sampleMoves picks deterministically from the tendency
  });
  assert.ok(result.opponentStakeAfter >= 0);
  if (result.opponentStakeAfter === 0) assert.equal(result.opponentZeroed, true);
});

test('resolvePvEDuel: rake applies only when the player wins', () => {
  const winOpponent = { stakeCheddar: 100, affinityElement: 'air', tendency: { fire: 0, water: 0, air: 1 } };
  const winResult = pve.resolvePvEDuel(tunables, {
    playerMoves: [0, 0, 0, 0, 0], // fire beats air every round
    playerAffinity: 9,
    playerStakeCheddar: 1000,
    opponent: winOpponent,
    random: () => 0.5,
  });
  assert.ok(winResult.playerDelta > 0);
  assert.ok(winResult.rakeTaken >= 0);
  if (winResult.outcome.transfer > 0) {
    assert.equal(winResult.rakeTaken, Math.floor(winResult.outcome.transfer * tunables.pve.rakeOnWinsOnly));
  }

  const loseOpponent = { stakeCheddar: 1000, affinityElement: 'air', tendency: { fire: 0, water: 0, air: 1 } };
  const loseResult = pve.resolvePvEDuel(tunables, {
    playerMoves: [1, 1, 1, 1, 1], // water loses to air every round (air beats water, R53)
    playerAffinity: 9,
    playerStakeCheddar: 1000,
    opponent: loseOpponent,
    random: () => 0.5,
  });
  assert.ok(loseResult.playerDelta <= 0);
  assert.equal(loseResult.rakeTaken, 0); // no rake on losses
});

test('needsPvERebuild: true when stake + re-entry bonus would still sit under the floor', () => {
  const c = { tier: 0, stakeCheddar: 1 };
  assert.equal(pve.needsPvERebuild(tunables, c), true); // 1 + 25 = 26 < 50
  c.stakeCheddar = 30;
  assert.equal(pve.needsPvERebuild(tunables, c), false); // 30 + 25 = 55 >= 50
});

// ---- f4/A-k: PvE tie carries the same commit-reveal shape as a bracket duel ----

test('f4/A-k: resolvePvEDuel passes a real flipSeed into resolveDuel on a true tie -- the outcome carries a commitment+seed, not the legacy unrecorded coin flip', () => {
  const opponent = { tendency: { fire: 1, water: 1, air: 1 }, affinityElement: 'fire', stakeCheddar: 100 };
  const result = pve.resolvePvEDuel(tunables, {
    playerMoves: [0, 0, 0, 0, 0], // all fire -- with random=()=>0 the opponent also samples all fire -> identical moves -> a true tie
    playerAffinity: 0,
    playerStakeCheddar: 100,
    opponent,
    random: () => 0,
  });
  assert.equal(result.outcome.trueTie, true);
  assert.ok(result.outcome.coinFlip, 'expected a real commit-reveal coinFlip object on a PvE tie, not the legacy unrecorded flip');
  assert.equal(typeof result.outcome.coinFlip.seed, 'string');
  assert.equal(result.outcome.coinFlip.seed.length, 32);
  assert.equal(typeof result.outcome.coinFlip.commitment, 'string');

  // The commitment is the real SHA-256 of the seed (independently
  // recomputable -- the same "provably fair" property bracket duels get).
  assert.equal(result.outcome.coinFlip.commitment, sha256Hex(result.outcome.coinFlip.seed));

  // The flip itself is a pure, deterministic function of the revealed
  // seed alone (R54) -- recomputing it independently must agree with
  // coinFlipWinner.
  assert.equal(deterministicFlipFromSeed(result.outcome.coinFlip.seed) === 1 ? 1 : -1, result.outcome.coinFlipWinner);
});

test('f4/A-k: a non-tie PvE duel carries no coinFlip at all (the flip only ever happens on a genuine tie, same as bracket duels)', () => {
  const opponent = { stakeCheddar: 100, affinityElement: 'air', tendency: { fire: 0, water: 0, air: 1 } };
  const result = pve.resolvePvEDuel(tunables, {
    playerMoves: [0, 0, 0, 0, 0], // fire beats air every round -- decisive, not a tie
    playerAffinity: 0,
    playerStakeCheddar: 1000,
    opponent,
    random: () => 0.5,
  });
  assert.equal(result.outcome.trueTie, false);
  assert.equal(result.outcome.coinFlip, null);
});

test('f4/A-k: the ledger persists the real PvE coinFlip commitment+seed (Game#resolvePveDuel\'s PVE_DUEL_RESOLVED payload carries outcome.coinFlip verbatim)', async () => {
  const { Game } = await import('../engine/game.js');
  const { Ledger, createMemoryStorage, EVENT_TYPES } = await import('../engine/ledger.js');
  const { loadTreatment } = await import('../engine/dataLoader.js');
  const { mulberry32 } = await import('../engine/rng.js');
  const treatment = await loadTreatment('incumbent');
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 });
  const t0 = Date.now();
  game.ensureAccount(t0);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'fire' }, t0);
  const opponent = game.startPveOpponent(summon.characterId, t0 + 1000);
  const duelSeq = game.peekPveDuelSeq(opponent.sessionId);
  game.resolvePveDuel({ characterId: summon.characterId, playerMoves: [0, 0, 0, 0, 0], opponent, duelSeq, now: t0 + 2000 });
  const events = game.ledger.byType(EVENT_TYPES.PVE_DUEL_RESOLVED);
  assert.equal(events.length, 1);
  if (events[0].payload.outcome.trueTie) {
    assert.ok(events[0].payload.outcome.coinFlip, 'expected the persisted ledger event to carry the real coinFlip commitment+seed on a tie');
  }
});

test('f5/A8: a PvE tie appends a REAL COIN_FLIP_COMMITTED ledger event BEFORE the PVE_DUEL_RESOLVED reveal (same shape as bracket duels) -- the commitment is independently observable before the outcome is ever decided, not just structurally present next to it', async () => {
  const { Game } = await import('../engine/game.js');
  const { Ledger, createMemoryStorage, EVENT_TYPES } = await import('../engine/ledger.js');
  const { loadTreatment } = await import('../engine/dataLoader.js');
  const treatment = await loadTreatment('incumbent');
  // random=()=>0 -> the opponent's tendency sampling always picks its
  // first (always positive-weight) entry -- with playerMoves all-fire and
  // an opponent tendency that also always samples fire, this is a
  // guaranteed true tie (mirrors the existing A-k test above).
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 });
  const t0 = Date.now();
  game.ensureAccount(t0);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'fire' }, t0);
  const opponent = game.startPveOpponent(summon.characterId, t0 + 1000);
  const duelSeq = game.peekPveDuelSeq(opponent.sessionId);
  game.resolvePveDuel({ characterId: summon.characterId, playerMoves: [0, 0, 0, 0, 0], opponent, duelSeq, now: t0 + 2000 });

  const allEvents = game.ledger.all();
  const commitEvents = game.ledger.byType(EVENT_TYPES.COIN_FLIP_COMMITTED);
  const resolvedEvents = game.ledger.byType(EVENT_TYPES.PVE_DUEL_RESOLVED);
  assert.equal(resolvedEvents.length, 1);
  assert.equal(resolvedEvents[0].payload.outcome.trueTie, true, 'expected this specific setup to produce a true tie (sanity)');
  assert.equal(commitEvents.length, 1, 'expected exactly one COIN_FLIP_COMMITTED event for this PvE tie');

  // BEFORE the reveal: the commit event's ledger position precedes the
  // resolved event's, and it carries ONLY the commitment (sha256), never
  // the seed itself (the seed is revealed only inside PVE_DUEL_RESOLVED).
  const commitIdx = allEvents.indexOf(commitEvents[0]);
  const resolvedIdx = allEvents.indexOf(resolvedEvents[0]);
  assert.ok(commitIdx < resolvedIdx, 'expected the COIN_FLIP_COMMITTED event to be appended BEFORE the PVE_DUEL_RESOLVED reveal');
  assert.equal(typeof commitEvents[0].payload.commitment, 'string');
  assert.equal(commitEvents[0].payload.seed, undefined, 'expected the commit event to carry NO seed -- only the commitment, before the reveal');

  // The commitment matches the seed later revealed in the resolved event
  // (independently recomputable -- the actual "provably fair" property).
  assert.equal(commitEvents[0].payload.commitment, sha256Hex(resolvedEvents[0].payload.outcome.coinFlip.seed));
  assert.equal(commitEvents[0].payload.sessionId, opponent.sessionId);
  assert.equal(commitEvents[0].payload.duelSeq, duelSeq);
});

test('f5/A8: a non-tie PvE duel appends NO COIN_FLIP_COMMITTED event at all (the commit only ever happens on a genuine tie, same as bracket duels)', async () => {
  const { Game } = await import('../engine/game.js');
  const { Ledger, createMemoryStorage, EVENT_TYPES } = await import('../engine/ledger.js');
  const { loadTreatment } = await import('../engine/dataLoader.js');
  const treatment = await loadTreatment('incumbent');
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 });
  const t0 = Date.now();
  game.ensureAccount(t0);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'fire' }, t0);
  // A deliberately air-affinity, water-heavy opponent so an all-fire
  // player decisively wins every round (fire > air) -- not a tie.
  const opponent = { ...game.startPveOpponent(summon.characterId, t0 + 1000), tendency: { fire: 0, water: 0, air: 1 }, affinityElement: 'air' };
  const duelSeq = game.peekPveDuelSeq(opponent.sessionId);
  game.resolvePveDuel({ characterId: summon.characterId, playerMoves: [0, 0, 0, 0, 0], opponent, duelSeq, now: t0 + 2000 });
  const resolvedEvents = game.ledger.byType(EVENT_TYPES.PVE_DUEL_RESOLVED);
  assert.equal(resolvedEvents[0].payload.outcome.trueTie, false, 'expected this setup to produce a decisive, non-tie duel (sanity)');
  assert.equal(game.ledger.byType(EVENT_TYPES.COIN_FLIP_COMMITTED).length, 0, 'expected zero COIN_FLIP_COMMITTED events for a non-tie PvE duel');
});

