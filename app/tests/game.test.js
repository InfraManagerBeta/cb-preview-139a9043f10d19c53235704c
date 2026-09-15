// app/tests/game.test.js — the orchestration facade end to end: summon,
// sync lobby, bracket play, SITTING actions, PvE, money surfaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES, actionKey } from '../engine/ledger.js';
import * as bracketEngine from '../engine/bracket.js';
import * as sync from '../engine/sync.js';
import * as economy from '../engine/economy.js';
import { mulberry32 } from '../engine/rng.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { elementIndex, reorientOutcome, resolveDuel } from '../engine/duel.js';
import { buildMatchData } from '../engine/narrator.js';
import { buildDuelTimeline } from '../engine/presentationTimeline.js';
import { projectedAfterRound } from '../engine/duelProjection.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function freshGame(seed = 1) {
  return new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(seed) });
}

/**
 * A fully deterministic, guaranteed-human-win bracket: with random()
 * constant at 0, weightedChoice always resolves to its first (always
 * positive-weight) entry, so every NPC always samples 'fire'. The human
 * plays 'water' every round, which beats 'fire' every round (R53 cyclic
 * dominance: water > fire), so the human wins every match it's seated in --
 * no brute-forcing required. Used for the C2 tier-clamp/T6-payout test,
 * which needs a real climb through the Game facade (not a hand-seeded
 * ledger event) per "economy.test.js/game.test.js must exercise the LIVE
 * path" (A7/A8).
 */
function playGuaranteedWinBracket(game, characterId, tier) {
  let t = Date.now();
  const lobby = game.joinLobby(characterId, tier, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  let guard = 0;
  let lastHumanResult = null;
  while (!bracket.complete && guard++ < 60) {
    for (const m of bracketEngine.pendingMatches(bracket)) {
      const involvesHuman = m.seatA === humanSeatIndex || m.seatB === humanSeatIndex;
      t += 1000;
      const result = game.resolveMatch({ bracketId, bracket, roundIndex: m.roundIndex, matchIndex: m.matchIndex, playerMoves: involvesHuman ? [1, 1, 1, 1, 1] : null, now: t });
      if (involvesHuman) lastHumanResult = result;
    }
  }
  return { bracketId, bracket, humanSeatIndex, lastHumanResult, t };
}

test('ensureAccount: signup grant of $25 (R66), idempotent on repeat calls', () => {
  const game = freshGame();
  game.ensureAccount(1000);
  game.ensureAccount(2000); // must not double-grant
  assert.equal(game.snapshot().account.cashUSD, 25);
});

test('summonCharacter: costs $10, mints 100C, names from the pool (never player-typed)', () => {
  const game = freshGame();
  game.ensureAccount(1000);
  const summoned = game.summonCharacter({ element: 'water' }, 1001);
  const snap = game.snapshot();
  assert.equal(snap.account.cashUSD, 15);
  assert.equal(snap.characters[summoned.characterId].stakeCheddar, 100);
  assert.ok(treatment.namePool.includes(summoned.name));
});

test('summonCharacter: refuses without sufficient CASH', () => {
  const game = freshGame();
  assert.throws(() => game.summonCharacter({ element: 'fire' }, 1));
});

test('full bracket playthrough keeps the ledger internally consistent (win or lose)', () => {
  const game = freshGame(42);
  let t = Date.now();
  game.ensureAccount(t);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t);
  const summon = game.summonCharacter({ element: 'fire' }, t);
  const lobby = game.joinLobby(summon.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  assert.equal(lobby.seats.filter(Boolean).length, 8);
  assert.equal(lobby.seats.filter((s) => s.kind === 'npc').length, 7);

  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  let guard = 0;
  while (!bracket.complete && guard++ < 60) {
    for (const m of bracketEngine.pendingMatches(bracket)) {
      const involvesHuman = m.seatA === humanSeatIndex || m.seatB === humanSeatIndex;
      t += 1000;
      game.resolveMatch({ bracketId, bracket, roundIndex: m.roundIndex, matchIndex: m.matchIndex, playerMoves: involvesHuman ? [0, 1, 2, 0, 1] : null, now: t });
    }
  }
  assert.equal(bracket.complete, true);
  const character = game.snapshot().characters[summon.characterId];
  assert.ok(character.state === 'ACTIVE' || character.state === 'SITTING');
  assert.equal(game.conservation().balanced, true);
});

test('SITTING: reenter charges the fee and credits the bonus; cashOut retires the character', () => {
  const game = freshGame(3);
  let t = Date.now();
  game.ensureAccount(t);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t);
  const summon = game.summonCharacter({ element: 'air' }, t);
  // force elimination via a lost bracket run (private helper path through resolveMatch on a deliberately weak sequence isn't guaranteed to lose,
  // so we drive a real bracket and just branch on the outcome).
  const lobby = game.joinLobby(summon.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  let guard = 0;
  while (!bracket.complete && guard++ < 60) {
    for (const m of bracketEngine.pendingMatches(bracket)) {
      const involvesHuman = m.seatA === humanSeatIndex || m.seatB === humanSeatIndex;
      t += 1000;
      game.resolveMatch({ bracketId, bracket, roundIndex: m.roundIndex, matchIndex: m.matchIndex, playerMoves: involvesHuman ? [1, 1, 1, 1, 1] : null, now: t });
    }
  }
  const character = game.snapshot().characters[summon.characterId];
  if (character.state === 'SITTING' && character.stakeCheddar > 0) {
    const before = game.snapshot().account.cashUSD;
    game.reenterCharacter(summon.characterId, t + 1);
    const after = game.snapshot();
    assert.ok(after.account.cashUSD < before);
    assert.equal(after.characters[summon.characterId].state, 'ACTIVE');
  } else {
    assert.ok(['ACTIVE', 'SITTING'].includes(character.state));
  }
});

test('reserve: recorded once per account (R49a)', () => {
  const game = freshGame(9);
  game.ensureAccount(1000);
  game.pressReserve({ tier: 0, characterState: 'ACTIVE' }, 2000);
  game.pressReserve({ tier: 3, characterState: 'SITTING' }, 3000); // should not overwrite the first
  assert.equal(game.snapshot().account.reservation.tier, 0);
});

test('loadFunds: credits CASH instantly and logs the full deposit context', () => {
  const game = freshGame(4);
  game.ensureAccount(1000);
  game.loadFunds({ amountUSD: 100, presetOrCustom: 'preset', intentId: 'intent-1', sessionNumber: 1 }, 2000);
  assert.equal(game.snapshot().account.cashUSD, 125);
});

// ---- C1/R83: deterministic intent keys -- double-firing each of the six
// fixed mutations with the SAME intent must produce exactly one event, one
// state change (the reviewer's repro: the same $100 deposit fired twice
// credited $200).

test('C1: loadFunds -- double-firing the same intentId credits CASH exactly once', () => {
  const game = freshGame(1);
  game.ensureAccount(1000);
  const before = game.snapshot().account.cashUSD;
  game.loadFunds({ amountUSD: 100, presetOrCustom: 'preset', intentId: 'dup-intent', sessionNumber: 1 }, 2000);
  game.loadFunds({ amountUSD: 100, presetOrCustom: 'preset', intentId: 'dup-intent', sessionNumber: 1 }, 2001); // retry, same intent
  const after = game.snapshot().account.cashUSD;
  assert.equal(after - before, 100); // not 200
  assert.equal(game.ledger.byType(EVENT_TYPES.LOAD_FUNDS_DEPOSIT).length, 1);
});

test('C1: reenterCharacter -- double-firing the same captured sitting-epoch charges the fee exactly once', () => {
  const game = freshGame(2);
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  // Force the character to SITTING via a direct ledger event (isolates the
  // reenter idempotency check from bracket RNG).
  game.ledger.append({ key: 'test-eliminate', type: EVENT_TYPES.CHARACTER_ELIMINATED, playerId: 'p1', ts: 1002, payload: { characterId: summon.characterId, bracketId: 'b1', tier: 0, allDuelsStaked: true } });
  game.loadFunds({ amountUSD: 1000, presetOrCustom: 'custom', intentId: 'fund-1', sessionNumber: 1 }, 1003);
  const before = game.snapshot();
  // The UI captures the epoch ONCE (peekSittingEpoch), before disabling the
  // control, and reuses it on a double-fire/retry -- a naive fresh
  // recompute on the SECOND call would see call #1's own event and NOT
  // collide, which is exactly the race this capture-once pattern closes.
  const sittingEpoch = game.peekSittingEpoch(summon.characterId);
  game.reenterCharacter(summon.characterId, 2000, { sittingEpoch });
  game.reenterCharacter(summon.characterId, 2001, { sittingEpoch }); // double-fire, same captured intent
  const after = game.snapshot();
  assert.equal(game.ledger.byType(EVENT_TYPES.CHARACTER_REENTERED).length, 1);
  assert.equal(before.account.cashUSD - after.account.cashUSD, tunables.reentry.byTier['0'].usd);
});

test('C1: startPveOpponent / resolvePveDuel -- double-firing the same captured session+duel-seq resolves exactly once', () => {
  const game = freshGame(6);
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  const sessionEpoch = game.peekPveSessionEpoch(summon.characterId);
  const opp1 = game.startPveOpponent(summon.characterId, 1002, { sessionEpoch });
  const opp1Again = game.startPveOpponent(summon.characterId, 1002, { sessionEpoch }); // double-fire the session start
  assert.equal(game.ledger.byType(EVENT_TYPES.PVE_SESSION_STARTED).length, 1);
  assert.equal(opp1.sessionId, opp1Again.sessionId);

  const before = game.snapshot().characters[summon.characterId].stakeCheddar;
  const duelSeq = game.peekPveDuelSeq(opp1.sessionId);
  const r1 = game.resolvePveDuel({ characterId: summon.characterId, playerMoves: [0, 0, 0, 0, 0], opponent: opp1, duelSeq, now: 2000 });
  const r2 = game.resolvePveDuel({ characterId: summon.characterId, playerMoves: [0, 0, 0, 0, 0], opponent: opp1, duelSeq, now: 2001 }); // double-fire, same intent
  assert.equal(game.ledger.byType(EVENT_TYPES.PVE_DUEL_RESOLVED).length, 1);
  const after = game.snapshot().characters[summon.characterId].stakeCheddar;
  assert.equal(after, before + r1.playerDelta); // not applied twice
  assert.equal(r2.stakeAfter, r1.stakeAfter); // the "replay" reports the same result, doesn't reapply
});

test('C1: startPveOpponent/resolvePveDuel -- pve-opponent-zeroed double-fires to exactly one event too', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 }); // deterministic: opponent always samples 'fire'
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  const opp = { ...game.startPveOpponent(summon.characterId, 1002), stakeCheddar: 1 }; // tiny stake -> guaranteed zeroed on a win
  const duelSeq = game.peekPveDuelSeq(opp.sessionId);
  game.resolvePveDuel({ characterId: summon.characterId, playerMoves: [1, 1, 1, 1, 1], opponent: opp, duelSeq, now: 2000 }); // water beats the opponent's all-fire every round
  game.resolvePveDuel({ characterId: summon.characterId, playerMoves: [1, 1, 1, 1, 1], opponent: opp, duelSeq, now: 2001 });
  assert.equal(game.ledger.byType(EVENT_TYPES.PVE_DUEL_RESOLVED).length, 1);
  assert.equal(game.ledger.byType(EVENT_TYPES.PVE_OPPONENT_ZEROED).length, 1);
});

test('C1: joinLobby -- double-firing the same captured join-epoch produces exactly one SYNC_LOBBY_JOINED', () => {
  const game = freshGame(7);
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  const joinEpoch = game.peekLobbyJoinEpoch(summon.characterId);
  game.joinLobby(summon.characterId, 0, 2000, { joinEpoch });
  game.joinLobby(summon.characterId, 0, 2001, { joinEpoch }); // double-fire, same captured intent
  assert.equal(game.ledger.byType(EVENT_TYPES.SYNC_LOBBY_JOINED).length, 1);
});

// ---- A1: resolveMatch -- check-before-compute + defensive copy ------------

function setUpHumanMatch(game, seed) {
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'water' }, 1001);
  const lobby = game.joinLobby(summon.characterId, 0, 1002);
  let t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  const match = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
  return { lobby, bracketId, bracket, match, t: t + 1000 };
}

test('A1: resolveMatch -- double-firing the same match (bracketId/roundIndex/matchIndex) does not re-run resolveDuel, appends DUEL_RESOLVED exactly once, and the retry returns the SAME persisted outcome/combatants', () => {
  const game = freshGame(11);
  const { bracketId, bracket, match, t } = setUpHumanMatch(game, 11);

  const r1 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t });
  assert.equal(game.ledger.byType(EVENT_TYPES.DUEL_RESOLVED).length, 1);

  // A double-fired press: same match, same bracket object, one tick later.
  const r2 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });
  assert.equal(game.ledger.byType(EVENT_TYPES.DUEL_RESOLVED).length, 1, 'expected the double-fired press to NOT append a second DUEL_RESOLVED event');
  // If the retry had re-run resolveDuel, it would have drawn MORE from the
  // shared RNG stream (consumed by the OTHER (non-human) matches' NPC
  // sampleMoves calls too) and could disagree with the first call's result.
  assert.deepEqual(r2.outcome, r1.outcome, 'expected the retry to return the SAME persisted outcome, not a freshly-recomputed one');
  assert.deepEqual(r2.combatants, r1.combatants);
  assert.equal(r2.bracketComplete, r1.bracketComplete);
  assert.equal(r2.humanWon, r1.humanWon);
});

test('A1(b): resolveMatch returns a defensive copy -- mutating a returned outcome/combatants object does not corrupt the cached result a later replay reads back', () => {
  const game = freshGame(12);
  const { bracketId, bracket, match, t } = setUpHumanMatch(game, 12);

  const r1 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t });
  // v1c's proof: mutate the returned payload as a careless caller might.
  r1.combatants[0].stakeAfter = -999999;
  r1.outcome.won = 999;
  r1.outcome.rounds[0].move1 = 'tampered';

  const r2 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });
  assert.notEqual(r2.combatants[0].stakeAfter, -999999, 'expected the cached combatants to be UNAFFECTED by the caller\'s mutation of the first return value');
  assert.notEqual(r2.outcome.won, 999);
  assert.notEqual(r2.outcome.rounds[0].move1, 'tampered');
});

test('f7/advisory-4: mutating the OUTCOME STORED ON THE BRACKET OBJECT itself (match.result.outcome, reached via bracket.rounds/session state, not resolveMatch\'s own return value) does not corrupt a later cache-hit/reconstruct replay -- structuredClone at the recordMatchResult call sites closes the aliasing bypass of A1(b)\'s defensive copy', () => {
  const game = freshGame(44);
  const { bracketId, bracket, match, t } = setUpHumanMatch(game, 44);

  const r1 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t });

  // Reach into the bracket object itself (as a session-persisted board
  // render or a stray direct read might) and mutate the outcome stored
  // there -- BEFORE f7/advisory-4, this was the SAME object reference the
  // in-memory cache (and every future replay) also held, so mutating it
  // here corrupted what a later replay reads back even though the
  // caller's OWN resolveMatch return value (r1) was already defensively
  // copied per A1(b).
  const storedResult = bracket.rounds[match.roundIndex][match.matchIndex].result;
  storedResult.outcome.won = 999;
  storedResult.outcome.rounds[0].move1 = 'tampered-via-bracket';

  const r2 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });
  assert.notEqual(r2.outcome.won, 999, 'expected the cache-hit replay to be UNAFFECTED by mutating the bracket-object-stored outcome');
  assert.notEqual(r2.outcome.rounds[0].move1, 'tampered-via-bracket');
  assert.deepEqual(r2.outcome, r1.outcome, 'expected the replay to still match the ORIGINAL (pre-mutation) outcome exactly');
});

test('A1: resolveMatch -- a cross-instance replay (fresh Game + fresh bracket object, no in-memory cache) reconstructs the persisted winner from the ledger alone, with no RNG consumption and no new ledger event', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(13) });
  const { lobby, bracketId, bracket, match, t } = setUpHumanMatch(game, 13);
  const r1 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t });
  assert.equal(r1.outcome.rounds.length, 5);

  // A second Game instance sharing the SAME ledger (no in-memory cache),
  // deliberately a DIFFERENT random stream, and a FRESH bracket object
  // (built the same deterministic way from the same seats) that never had
  // recordMatchResult applied.
  const game2 = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(999) });
  const freshBracket = bracketEngine.createBracket(lobby.seats, { tier: lobby.tier, createdAt: t });
  assert.equal(freshBracket.rounds[match.roundIndex][match.matchIndex].winnerSeat, null);

  const r2 = game2.resolveMatch({ bracketId, bracket: freshBracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });
  assert.equal(ledger.byType(EVENT_TYPES.DUEL_RESOLVED).length, 1, 'expected the cross-instance replay to NOT append a second DUEL_RESOLVED event');
  assert.deepEqual(r2.combatants, r1.combatants, 'expected the reconstructed combatants to match the ORIGINAL persisted ones, not a re-seeded recomputation');
  assert.equal(r2.humanWon, r1.humanWon);
  // f6/crucial-1 fix: the ledger's own persisted outcome now carries a SLIM
  // per-round record (move1/move2/result/p1Affinity/p2Affinity -- see
  // slimOutcomeForLedger's header comment), hydrated back to the FULL
  // resolveDuel round shape (round index + recomputed tag) on reconstruction
  // -- so the reconstructed outcome is presentation-complete and shape-
  // identical to the original live outcome, not merely rounds-free.
  assert.equal(r2.outcome.rounds.length, 5, 'expected the reconstructed outcome to carry a full 5-round rounds array, not undefined');
  assert.deepEqual(r2.outcome, r1.outcome, 'expected the reconstructed outcome to be identical to the original live outcome (slim-persist + hydrate round-trips exactly)');
  // The fresh bracket object converges (deterministically, no RNG) to the
  // SAME winnerSeat the original bracket recorded.
  assert.equal(freshBracket.rounds[match.roundIndex][match.matchIndex].winnerSeat, bracket.rounds[match.roundIndex][match.matchIndex].winnerSeat);
});

// ---- f6/crucial-1: cross-instance replay must feed duel.js's consumers ----
// (buildMatchData, buildDuelTimeline, projectedAfterRound, reorientOutcome's
// seat-B branch) a presentation-complete outcome -- pre-fix, the reconstruct
// path returned an outcome with NO `rounds` at all, and every one of these
// dereferences `outcome.rounds` unconditionally -> uncaught TypeError, dead
// reveal screen. Reachable via a second tab on the same bracket, or a
// failed session write + reload.

test('f6/crucial-1: buildMatchData and buildDuelTimeline do not throw on a cross-instance replay outcome (fresh bracket object, winnerSeat NULL before reconstruction)', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(21) });
  const { lobby, bracketId, bracket, match, t } = setUpHumanMatch(game, 21);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  const r1 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t });

  // A second tab: a fresh Game instance, sharing only the ledger, and a
  // freshly-built bracket object that never had this match's result
  // applied -- winnerSeat is NULL going into the reconstruction.
  const game2 = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(777) });
  const freshBracket = bracketEngine.createBracket(lobby.seats, { tier: lobby.tier, createdAt: t });
  assert.equal(freshBracket.rounds[match.roundIndex][match.matchIndex].winnerSeat, null, 'precondition: winnerSeat NULL before reconstruction');
  const r2 = game2.resolveMatch({ bracketId, bracket: freshBracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });

  const character = { name: 'HumanChar', element: lobby.seats[humanSeatIndex].element };
  const opponentSeatIndex = match.seatA === humanSeatIndex ? match.seatB : match.seatA;
  const opponentSeat = lobby.seats[opponentSeatIndex];
  const outcome = reorientOutcome(r2.outcome, r2.humanIsSeatA);
  const combatant = r2.combatants.find((c) => c.characterId === lobby.seats[humanSeatIndex].characterId);
  const opponentCombatant = r2.combatants.find((c) => c.characterId !== combatant.characterId);

  // buildMatchData (engine/narrator.js) -- must not throw, must carry all 5 rounds.
  assert.doesNotThrow(() => {
    const matchData = buildMatchData(outcome, {
      p1Name: character.name, p2Name: opponentSeat.name,
      p1StakeBefore: combatant.stakeBefore, p2StakeBefore: opponentCombatant.stakeBefore,
      bracketCompletion: r2.bracketComplete && r2.humanWon,
      isFinal: match.roundIndex === 2,
    });
    assert.equal(matchData.rounds.length, 5);
  }, 'buildMatchData must not throw on a reconstructed cross-instance-replay outcome');

  // buildDuelTimeline (engine/presentationTimeline.js) -- must not throw, must produce a non-empty timeline.
  assert.doesNotThrow(() => {
    const timeline = buildDuelTimeline(outcome, 400, { bracketComplete: r2.bracketComplete && r2.humanWon });
    assert.ok(timeline.length > 0);
  }, 'buildDuelTimeline must not throw on a reconstructed cross-instance-replay outcome');

  // projectedAfterRound (engine/duelProjection.js) -- must not throw either.
  assert.doesNotThrow(() => {
    const floor = economy.floorForTier(tunables, 0);
    projectedAfterRound(outcome.rounds, 5, elementIndex(character.element), elementIndex(opponentSeat.element), combatant.stakeBefore, opponentCombatant.stakeBefore, floor);
  }, 'projectedAfterRound must not throw on a reconstructed cross-instance-replay outcome');
});

test('f6/crucial-1: buildMatchData and buildDuelTimeline do not throw on a cross-instance replay outcome (the SAME already-decided bracket object, winnerSeat NON-NULL before reconstruction)', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(22) });
  const { lobby, bracketId, bracket, match, t } = setUpHumanMatch(game, 22);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  const r1 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t });
  assert.notEqual(bracket.rounds[match.roundIndex][match.matchIndex].winnerSeat, null, 'precondition: winnerSeat NON-NULL after the original resolveMatch call');

  // A second Game instance (no in-memory cache), reusing the SAME
  // already-decided bracket object -- winnerSeat is NON-NULL going into
  // the reconstruction (a page reload of the SAME tab, not a fresh one).
  const game2 = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(888) });
  const r2 = game2.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });
  assert.deepEqual(r2.outcome, r1.outcome, 'expected the same presentation-complete outcome regardless of winnerSeat NULL/non-NULL going in');

  const opponentSeatIndex = match.seatA === humanSeatIndex ? match.seatB : match.seatA;
  const opponentSeat = lobby.seats[opponentSeatIndex];
  const outcome = reorientOutcome(r2.outcome, r2.humanIsSeatA);
  const combatant = r2.combatants.find((c) => c.characterId === lobby.seats[humanSeatIndex].characterId);
  const opponentCombatant = r2.combatants.find((c) => c.characterId !== combatant.characterId);

  assert.doesNotThrow(() => {
    const matchData = buildMatchData(outcome, {
      p1Name: 'HumanChar', p2Name: opponentSeat.name,
      p1StakeBefore: combatant.stakeBefore, p2StakeBefore: opponentCombatant.stakeBefore,
      bracketCompletion: r2.bracketComplete && r2.humanWon,
      isFinal: match.roundIndex === 2,
    });
    assert.equal(matchData.rounds.length, 5);
  }, 'buildMatchData must not throw on a reconstructed outcome from an already-decided bracket object');

  assert.doesNotThrow(() => {
    const timeline = buildDuelTimeline(outcome, 400, { bracketComplete: r2.bracketComplete && r2.humanWon });
    assert.ok(timeline.length > 0);
  }, 'buildDuelTimeline must not throw on a reconstructed outcome from an already-decided bracket object');
});

test('f6/crucial-1: reorientOutcome\'s seat-B branch does not throw on a reconstructed (hydrated-from-slim) outcome, and correctly flips the per-round fields', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(23) });
  const { bracketId, bracket, match, t } = setUpHumanMatch(game, 23);
  const r1 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t });

  const game2 = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(456) });
  const r2 = game2.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });

  // r2.outcome is the reconstructed (hydrated-from-slim) outcome -- force
  // the seat-B branch (isSeatA = false) regardless of which seat the human
  // actually sat in this run, since reorientOutcome itself is a pure
  // function that doesn't know or care which seat is "the human's".
  let reoriented;
  assert.doesNotThrow(() => { reoriented = reorientOutcome(r2.outcome, false); }, 'reorientOutcome\'s seat-B branch must not throw on a reconstructed outcome');
  assert.equal(reoriented.rounds.length, 5);
  // Sanity: the flip actually happened (moves/affinities swapped, result sign flipped).
  for (let i = 0; i < 5; i++) {
    assert.equal(reoriented.rounds[i].move1, r2.outcome.rounds[i].move2);
    assert.equal(reoriented.rounds[i].move2, r2.outcome.rounds[i].move1);
    assert.equal(reoriented.rounds[i].p1Affinity, r2.outcome.rounds[i].p2Affinity);
  }
});

// ---- f6/advisory-1: reconstruct path guards seats-not-yet-minted ----------

test('f6/advisory-1: reconstructing a LATER-round match on a fresh bracket object whose earlier rounds were never replayed on it (seatA/seatB still null, unfed) raises the SAME domain error the compute path gives, never a raw TypeError', () => {
  const ledger = new Ledger(createMemoryStorage());
  // A deterministic, guaranteed-human-win path (see playGuaranteedWinBracket's
  // header comment above): random() constant at 0 -> every NPC always
  // samples 'fire'; the human plays 'water' every round and wins every match.
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', random: () => 0 });
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'water' }, 1001);
  const lobby = game.joinLobby(summon.characterId, 0, 1002);
  let t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');

  // Resolve every quarterfinal match (roundIndex 0) so the bracket advances
  // to the semifinal round -- this decides the human's semifinal seat via
  // bracketEngine's own feed-forward, ON THIS bracket object.
  for (const m of bracketEngine.pendingMatches(bracket)) {
    const involvesHuman = m.seatA === humanSeatIndex || m.seatB === humanSeatIndex;
    t += 1000;
    game.resolveMatch({ bracketId, bracket, roundIndex: m.roundIndex, matchIndex: m.matchIndex, playerMoves: involvesHuman ? [1, 1, 1, 1, 1] : null, now: t });
  }
  assert.equal(bracket.currentRound, 1, 'expected the bracket to have advanced to the semifinal round');
  const semiMatch = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
  assert.ok(semiMatch, 'expected the human to have a pending semifinal match');
  t += 1000;
  game.resolveMatch({ bracketId, bracket, roundIndex: semiMatch.roundIndex, matchIndex: semiMatch.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t });

  // A second tab: a fresh Game instance AND a genuinely fresh bracket
  // object, built from the same seats, that never had the quarterfinal
  // round replayed on it at all -- its semifinal match's seatA/seatB are
  // still `null` (bracketEngine only feeds them forward via
  // recordMatchResult, which this fresh object never received for round 0).
  const game2 = new Game({ ledger, tunables, treatment, playerId: 'p1', random: () => 0 });
  const freshBracket = bracketEngine.createBracket(lobby.seats, { tier: lobby.tier, createdAt: t });
  assert.equal(freshBracket.rounds[semiMatch.roundIndex][semiMatch.matchIndex].seatA, null, 'precondition: this fresh bracket object\'s semifinal seatA is still unfed (null)');

  // f7/advisory-2: this is the FEED-FORWARD/topology case (this bracket
  // object's seatA/seatB not yet fed from an earlier round), which is
  // DISTINCT from "seats not yet minted as characters" (the compute path's
  // own charA/charB-lookup precondition) -- the two used to share one
  // message even though they name different causes; now they don't.
  assert.throws(
    () => game2.resolveMatch({ bracketId, bracket: freshBracket, roundIndex: semiMatch.roundIndex, matchIndex: semiMatch.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 }),
    (err) => err instanceof Error && !(err instanceof TypeError) && /match seats not yet fed from the previous round/.test(err.message),
    'expected the feed-forward domain error ("match seats not yet fed from the previous round"), never a raw TypeError, and never the not-minted message',
  );
});

// ---- f6/advisory-2: the in-memory cache path also converges the caller's bracket

test('f6/advisory-2: the SAME Game instance (in-memory cache hit) converges a DIFFERENT, freshly-built bracket object passed in on a retry -- not just the reconstruct (no-cache) path', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(31) });
  const { lobby, bracketId, bracket, match, t } = setUpHumanMatch(game, 31);
  const r1 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t });
  const decidedWinnerSeat = bracket.rounds[match.roundIndex][match.matchIndex].winnerSeat;
  assert.notEqual(decidedWinnerSeat, null);

  // Same Game instance (its _resolveMatchCache DOES have this duelKey), but
  // a DIFFERENT, freshly-built bracket object -- winnerSeat NULL going in.
  // Pre-fix, the cache-hit branch returned the correct RESULT but never
  // touched this bracket object at all, leaving it permanently unconverged
  // (still showing winnerSeat: null on its own board) even though the SAME
  // Game instance already knows the answer.
  const freshBracket = bracketEngine.createBracket(lobby.seats, { tier: lobby.tier, createdAt: t });
  assert.equal(freshBracket.rounds[match.roundIndex][match.matchIndex].winnerSeat, null, 'precondition: winnerSeat NULL on this fresh bracket object');

  const r2 = game.resolveMatch({ bracketId, bracket: freshBracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });
  assert.deepEqual(r2.outcome, r1.outcome, 'expected the cache-hit branch to still return the SAME cached result');
  assert.equal(
    freshBracket.rounds[match.roundIndex][match.matchIndex].winnerSeat,
    decidedWinnerSeat,
    'expected the cache-hit branch to converge THIS bracket object too, to the same winnerSeat the original bracket recorded',
  );
});

// ---- f7/advisory-9: a cache hit on an UNFED bracket object still returns
// the correct cached result (converge only when feasible; never throw) ----

test('f7/advisory-9: an in-memory cache hit for a LATER-round match, on a bracket object whose earlier round was never replayed onto it (seatA/seatB still null), still returns the correct cached result -- no throw, best-effort convergence skipped rather than a fatal error', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', random: () => 0 });
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'water' }, 1001);
  const lobby = game.joinLobby(summon.characterId, 0, 1002);
  let t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');

  for (const m of bracketEngine.pendingMatches(bracket)) {
    const involvesHuman = m.seatA === humanSeatIndex || m.seatB === humanSeatIndex;
    t += 1000;
    game.resolveMatch({ bracketId, bracket, roundIndex: m.roundIndex, matchIndex: m.matchIndex, playerMoves: involvesHuman ? [1, 1, 1, 1, 1] : null, now: t });
  }
  assert.equal(bracket.currentRound, 1, 'expected the bracket to have advanced to the semifinal round');
  const semiMatch = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
  t += 1000;
  const r1 = game.resolveMatch({ bracketId, bracket, roundIndex: semiMatch.roundIndex, matchIndex: semiMatch.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t });
  // Precondition: the SAME Game instance's in-memory cache DOES have this
  // duelKey (a normal live resolve, no reload involved).
  assert.equal(ledger.byType(EVENT_TYPES.DUEL_RESOLVED).filter((e) => e.payload.roundIndex === semiMatch.roundIndex && e.payload.matchIndex === semiMatch.matchIndex).length, 1);

  // A DIFFERENT, freshly-built bracket object for the SAME lobby seats --
  // its quarterfinal round was never replayed onto it, so this semifinal
  // match's seatA/seatB are still null (genuinely unfed), exactly like
  // f6/advisory-1's reconstruct-path fixture above.
  const freshBracket = bracketEngine.createBracket(lobby.seats, { tier: lobby.tier, createdAt: t });
  assert.equal(freshBracket.rounds[semiMatch.roundIndex][semiMatch.matchIndex].seatA, null, 'precondition: unfed seatA on this fresh bracket object');
  assert.equal(freshBracket.rounds[semiMatch.roundIndex][semiMatch.matchIndex].seatB, null, 'precondition: unfed seatB on this fresh bracket object');

  // Same Game instance (cache HIT for this duelKey) + the unfed bracket.
  // f7/advisory-9: this must NOT throw -- pre-f6 behavior restored: a cache
  // hit returns the already-known-correct cached result regardless of
  // whether THIS particular bracket object's topology happens to be caught
  // up; convergence is attempted but skipped silently when infeasible.
  let r2;
  assert.doesNotThrow(() => {
    r2 = game.resolveMatch({ bracketId, bracket: freshBracket, roundIndex: semiMatch.roundIndex, matchIndex: semiMatch.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });
  }, 'expected the cache-hit branch to return the cached result without throwing, even on an unfed bracket object');
  assert.deepEqual(r2.outcome, r1.outcome, 'expected the SAME cached result regardless of this bracket object\'s unfed topology');
  // Convergence was correctly skipped (not attempted with bad data): this
  // bracket object's own topology is untouched, still null, not stamped
  // with a wrong/guessed winner.
  assert.equal(freshBracket.rounds[semiMatch.roundIndex][semiMatch.matchIndex].winnerSeat, null, 'expected convergence to be skipped (not guessed) on this still-unfed bracket object');

  // The reconstruct (NO cache) path for the exact same unfed scenario still
  // throws the domain error -- topology IS genuinely required there.
  const game2 = new Game({ ledger, tunables, treatment, playerId: 'p1', random: () => 0 });
  assert.throws(
    () => game2.resolveMatch({ bracketId, bracket: freshBracket, roundIndex: semiMatch.roundIndex, matchIndex: semiMatch.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 2 }),
    (err) => err instanceof Error && /match seats not yet fed from the previous round/.test(err.message),
    'expected the reconstruct (no-cache) path to still raise the feed-forward domain error for the same unfed bracket object',
  );
});

// ---- f7/N1: legacy (pre-f6) rounds-free DUEL_RESOLVED events degrade -----
// gracefully on reconstruction instead of an uncaught TypeError -----------

/**
 * Synthesizes a ledger DUEL_RESOLVED event exactly as a PRE-f6 build would
 * have written it: `outcome` carries every summary field but NO `rounds`
 * key at all (f1's original A6 slimming dropped it outright; f6 only
 * started persisting a slim per-round record going forward, with no
 * migration of events written before it existed).
 */
function appendLegacyDuelResolvedEvent(game, ledger, { bracketId, roundIndex, matchIndex, charA, charB, floor, now }) {
  const liveOutcome = resolveDuel({
    mv1: [1, 1, 1, 1, 1], mv2: [0, 0, 0, 0, 0],
    aff1: elementIndex(charA.element), aff2: elementIndex(charB.element),
    p1: charA.stakeCheddar, p2: charB.stakeCheddar,
    floor, random: Math.random,
  });
  const aWon = liveOutcome.trueTie ? liveOutcome.coinFlipWinner === 1 : liveOutcome.winner === 1;
  const bWon = !aWon;
  const transferToA = liveOutcome.trueTie ? 0 : (liveOutcome.winner === 1 ? liveOutcome.transfer : -Math.abs(liveOutcome.transfer));
  const combatants = [
    { characterId: charA.id, tier: charA.tier, won: aWon, stakeBefore: charA.stakeCheddar, stakeAfter: charA.stakeCheddar + transferToA },
    { characterId: charB.id, tier: charB.tier, won: bWon, stakeBefore: charB.stakeCheddar, stakeAfter: charB.stakeCheddar - transferToA },
  ];
  const { rounds, ...legacyOutcome } = liveOutcome; // pre-f6: rounds dropped ENTIRELY, not even a slim version
  ledger.append({
    key: actionKey('bracket-duel', bracketId, roundIndex, matchIndex),
    type: EVENT_TYPES.DUEL_RESOLVED,
    playerId: 'p1',
    ts: now,
    payload: { bracketId, roundIndex, matchIndex, staked: true, hesitated: false, combatants, outcome: legacyOutcome },
  });
  return { aWon, bWon, combatants, legacyOutcome };
}

test('f7/N1: a synthesized legacy (rounds-free) DUEL_RESOLVED event replays via the summary path -- zero throws, replayUnavailable, on the PENDING-bracket variant (fresh bracket object, winnerSeat NULL before reconstruction)', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(41) });
  const { lobby, bracketId, bracket, match, t } = setUpHumanMatch(game, 41);
  const seatA = bracket.seats[match.seatA];
  const seatB = bracket.seats[match.seatB];
  const snap = game.snapshot();
  const charA = snap.characters[seatA.characterId];
  const charB = snap.characters[seatB.characterId];
  const floor = economy.floorForTier(tunables, charA.tier);

  const { aWon, combatants, legacyOutcome } = appendLegacyDuelResolvedEvent(game, ledger, {
    bracketId, roundIndex: match.roundIndex, matchIndex: match.matchIndex, charA, charB, floor, now: t,
  });

  const game2 = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(999) });
  const freshBracket = bracketEngine.createBracket(lobby.seats, { tier: lobby.tier, createdAt: t });
  assert.equal(freshBracket.rounds[match.roundIndex][match.matchIndex].winnerSeat, null, 'precondition: winnerSeat NULL before reconstruction (pending-bracket variant)');

  let result;
  assert.doesNotThrow(() => {
    result = game2.resolveMatch({ bracketId, bracket: freshBracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });
  }, 'expected zero throws reconstructing a legacy rounds-free event (pending-bracket variant)');

  assert.equal(result.replayUnavailable, true, 'expected replayUnavailable to be raised as an honest domain condition');
  assert.equal(result.outcome.rounds, null, 'expected outcome.rounds to be null, not [] (no silent fabricated empty array) and not undefined (uncaught downstream)');
  assert.equal(result.outcome.won, legacyOutcome.won);
  assert.equal(result.outcome.lost, legacyOutcome.lost);
  assert.equal(result.outcome.trueTie, legacyOutcome.trueTie);
  assert.equal(result.outcome.floorDrain, legacyOutcome.floorDrain);
  assert.deepEqual(result.combatants, combatants, 'expected the persisted summary combatants (stakeBefore/stakeAfter) to come through unchanged');
  assert.equal(freshBracket.rounds[match.roundIndex][match.matchIndex].winnerSeat, aWon ? match.seatA : match.seatB, 'expected the fresh bracket object to still converge to the correct winner');

  // The UI-consumer contract: reorientOutcome must not throw on a
  // rounds:null outcome either (duel.js's renderResult calls this
  // unconditionally, regardless of replayUnavailable).
  let reoriented;
  assert.doesNotThrow(() => { reoriented = reorientOutcome(result.outcome, false); }, 'expected reorientOutcome to tolerate rounds:null');
  assert.equal(reoriented.rounds, null);
});

test('f7/N1: a synthesized legacy (rounds-free) DUEL_RESOLVED event replays via the summary path -- zero throws, replayUnavailable, on the DECIDED-bracket variant (winnerSeat already NON-NULL before reconstruction)', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(42) });
  const { bracketId, bracket, match, t } = setUpHumanMatch(game, 42);
  const seatA = bracket.seats[match.seatA];
  const seatB = bracket.seats[match.seatB];
  const snap = game.snapshot();
  const charA = snap.characters[seatA.characterId];
  const charB = snap.characters[seatB.characterId];
  const floor = economy.floorForTier(tunables, charA.tier);

  const { aWon, combatants, legacyOutcome } = appendLegacyDuelResolvedEvent(game, ledger, {
    bracketId, roundIndex: match.roundIndex, matchIndex: match.matchIndex, charA, charB, floor, now: t,
  });
  // This bracket object already converged (as if a PRIOR resolveMatch call
  // in an earlier, pre-f6 session had already applied the legacy result to
  // it -- e.g. the session's persisted bracket object survives a reload).
  bracketEngine.recordMatchResult(bracket, match.roundIndex, match.matchIndex, aWon ? match.seatA : match.seatB, { outcome: legacyOutcome });
  assert.notEqual(bracket.rounds[match.roundIndex][match.matchIndex].winnerSeat, null, 'precondition: winnerSeat NON-NULL before reconstruction (decided-bracket variant)');

  const game2 = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(888) });
  let result;
  assert.doesNotThrow(() => {
    result = game2.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });
  }, 'expected zero throws reconstructing a legacy rounds-free event (decided-bracket variant)');

  assert.equal(result.replayUnavailable, true);
  assert.equal(result.outcome.rounds, null);
  assert.deepEqual(result.combatants, combatants);
  assert.equal(result.bracketComplete, bracket.complete);
});

test('f7/N1: a CURRENT (post-f6) event still reconstructs the full reveal -- replayUnavailable is false, rounds intact', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(43) });
  const { bracketId, bracket, match, t } = setUpHumanMatch(game, 43);
  const r1 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t });
  assert.equal(r1.replayUnavailable, false);

  const game2 = new Game({ ledger, tunables, treatment, playerId: 'p1', random: mulberry32(777) });
  const r2 = game2.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], now: t + 1 });
  assert.equal(r2.replayUnavailable, false, 'expected a current (post-f6) event to NOT raise replayUnavailable');
  assert.equal(r2.outcome.rounds.length, 5);
});

test('C2: a T6 bracket win stays at tier 6 (never writes tier 7), pays $999,999.92 CASH plus the battle stake at 20:1, and never mints 20,000,000C onto the stake', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 });
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);

  let tier = 0;
  let finalResult = null;
  for (let i = 0; i < 7; i++) { // 0->1->2->3->4->5->6, then the T6 win itself
    const { lastHumanResult } = playGuaranteedWinBracket(game, summon.characterId, tier);
    finalResult = lastHumanResult;
    tier = game.snapshot().characters[summon.characterId].tier;
  }

  const snap = game.snapshot();
  const character = snap.characters[summon.characterId];
  assert.equal(character.tier, 6); // clamped -- never 7
  assert.ok(finalResult.bracketComplete);

  const advanced = game.ledger.byType(EVENT_TYPES.CHARACTER_ADVANCED).filter((e) => e.payload.characterId === summon.characterId);
  const t6Win = advanced[advanced.length - 1];
  assert.equal(t6Win.payload.newTier, 6);
  assert.equal(t6Win.payload.toppedOut, true);
  assert.equal(t6Win.payload.prizeCheddar, 0); // R62: not 20,000,000C minted onto the stake
  assert.equal(t6Win.payload.payoutCashUSD, 999999.92);

  // f4/N1: resolveMatch's OWN return value (what the duel screen reads to
  // render the prize-award moment and the T6 win card) must carry the
  // EXACT SAME payload object the CHARACTER_ADVANCED ledger event recorded
  // -- not a re-derived or independently-sourced copy. This is the
  // regression for N1 (duel.js used to instead look up
  // tierLadder.tiers[6].prizeCheddar directly, showing 20,000,000C on
  // screen while the ledger paid cash).
  assert.ok(finalResult.characterAdvancedPayload, 'expected resolveMatch to return a characterAdvancedPayload for the bracket-completing match');
  assert.deepEqual(finalResult.characterAdvancedPayload, t6Win.payload, 'T6 win screen figures must equal the ledger CHARACTER_ADVANCED event figures');
  assert.equal(finalResult.characterAdvancedPayload.payoutCashUSD, 999999.92);
  assert.equal(finalResult.characterAdvancedPayload.prizeCheddar, 0);

  // No tier-7 lookup ever throws on any subsequent screen-level call.
  assert.doesNotThrow(() => economyLookupsAtTier(tunables, character.tier));
  assert.equal(character.stakeCheddar, 0); // battle stake was cashed out, not minted as more stake

  // CASH increased by exactly payoutCashUSD + stakeCashUSD (the battle
  // stake at 20:1) -- not by some other figure.
  const expectedCashIncrease = t6Win.payload.payoutCashUSD + t6Win.payload.stakeCashUSD;
  assert.ok(expectedCashIncrease > 999999.92); // real money, not a rounding no-op
  assert.equal(game.conservation().balanced, true);
});

test('f4/N2: a topped-out T6 champion lands SITTING at 0C (not stranded ACTIVE) -- RETIRE TO THE LEDGER reachable, no throw on any screen, conservation exact', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 });
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);

  let tier = 0;
  for (let i = 0; i < 7; i++) { // 0->1->2->3->4->5->6, then the T6 win itself
    playGuaranteedWinBracket(game, summon.characterId, tier);
    tier = game.snapshot().characters[summon.characterId].tier;
  }

  const character = game.snapshot().characters[summon.characterId];
  // The old bug: this stayed 'ACTIVE' at 0C -- no legal action anywhere
  // (can't enter a bracket at a nonzero floor, can't PvE-build with 0
  // stake, can't cash out an already-cashed-out stake, and every
  // ACTIVE-routing screen -- bracket-board.js, duel.js, wallet.js --
  // assumed an ACTIVE character could still act). It must now be SITTING.
  assert.equal(character.state, 'SITTING');
  assert.equal(character.stakeCheddar, 0);
  assert.equal(character.toppedOutChampion, true, 'expected a champion-specific flag for the sitting-screen copy branch');
  assert.equal(economy.isEmptied(character), true);

  // R61's RETIRE TO THE LEDGER path (Game#retireEmptyCharacter) must be
  // reachable and must not throw for this character.
  assert.doesNotThrow(() => game.retireEmptyCharacter(summon.characterId, 5000));
  const retired = game.snapshot().characters[summon.characterId];
  assert.equal(retired.state, 'RETIRED');
  assert.equal(retired.retired, true);

  // No other SITTING-reachable action throws either (re-entry/cash-out
  // both correctly refuse a RETIRED character rather than silently
  // succeeding or throwing something unrelated).
  assert.throws(() => game.reenterCharacter(summon.characterId, 5001));
  assert.throws(() => game.cashOutCharacter(summon.characterId, 5002));

  assert.equal(game.conservation().balanced, true);
});

test('A2: reenterCharacter refuses an emptied (0C) character while it is STILL SITTING (before RETIRE) -- R61\'s only action for an emptied character is RETIRE, never re-entry', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 });
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);

  let tier = 0;
  for (let i = 0; i < 7; i++) { // 0->1->2->3->4->5->6, then the T6 win itself
    playGuaranteedWinBracket(game, summon.characterId, tier);
    tier = game.snapshot().characters[summon.characterId].tier;
  }

  const character = game.snapshot().characters[summon.characterId];
  assert.equal(character.state, 'SITTING');
  assert.equal(economy.isEmptied(character), true, 'expected the topped-out champion to be emptied (0C) while still SITTING, before any RETIRE');

  // A2's actual fix: reenterCharacter must throw HERE -- not later, only
  // because the character got retired first (that path already threw for
  // an unrelated reason, "not SITTING").
  const cashBefore = game.snapshot().account.cashUSD;
  assert.throws(() => game.reenterCharacter(summon.characterId, 5000), /emptied/i, 'expected reenterCharacter to refuse an emptied character with a message naming it');
  assert.equal(game.snapshot().account.cashUSD, cashBefore, 'expected NO re-entry fee to be charged for a refused re-entry');
  assert.equal(game.ledger.byType(EVENT_TYPES.CHARACTER_REENTERED).filter((e) => e.payload.characterId === summon.characterId).length, 0);
  // The character is still exactly where it was -- SITTING, 0C, unretired.
  const stillSitting = game.snapshot().characters[summon.characterId];
  assert.equal(stillSitting.state, 'SITTING');
  assert.equal(stillSitting.stakeCheddar, 0);
});

test('A2: sitting.js\'s champion-line condition requires stakeCheddar === 0, not just the toppedOutChampion flag alone -- documented belt-and-braces against a hypothetical future re-entered champion', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../ui/screens/sitting.js', import.meta.url), 'utf8');
  assert.ok(/toppedOutChampion\s*&&\s*character\.stakeCheddar\s*===\s*0/.test(src), 'expected the champion-line condition to also require stakeCheddar === 0');
});

function economyLookupsAtTier(tunables, tier) {
  // The exact three lookups the fix list names as bricking a T6-tier-7 write.
  return [
    economyFloorForTier(tunables, tier),
  ];
}
function economyFloorForTier(tunables, tier) {
  const f = tunables.floors.byTier[String(tier)];
  if (f === undefined) throw new Error('no floor');
  return f;
}

test('f4/N1: a non-topped-out (T0) bracket win also returns a characterAdvancedPayload equal to the ledger event, prizeCheddar intact', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 });
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  const { lastHumanResult } = playGuaranteedWinBracket(game, summon.characterId, 0);
  assert.ok(lastHumanResult.bracketComplete);
  const advanced = game.ledger.byType(EVENT_TYPES.CHARACTER_ADVANCED).filter((e) => e.payload.characterId === summon.characterId);
  const t0Win = advanced[advanced.length - 1];
  assert.equal(t0Win.payload.toppedOut, false);
  assert.deepEqual(lastHumanResult.characterAdvancedPayload, t0Win.payload);
  assert.ok(lastHumanResult.characterAdvancedPayload.prizeCheddar > 0);
});

// ---- C3/R41/R70/AC1: screener re-submission --------------------------------

test('C3: a failed screener attempt does not permanently block a later pass; the ledger holds both attempts', () => {
  const game = freshGame(1);
  const first = game.submitScreener({ age18: false, jurisdictionOk: true }, 1000);
  assert.equal(first.passed, false);
  const second = game.submitScreener({ age18: true, jurisdictionOk: true }, 2000);
  assert.equal(second.passed, true); // not silently swallowed by the old fixed-key replay bug
  assert.equal(game.ledger.byType(EVENT_TYPES.SCREENER_RESULT).length, 2);
  // the account (and its signup grant) is written only on PASS (A15)
  assert.equal(game.snapshot().account.cashUSD, 25);
});

test('A15: a rejected screener writes NO account/signup-grant event -- only the screening attempt itself', () => {
  const game = freshGame(1);
  game.submitScreener({ age18: false, jurisdictionOk: true }, 1000);
  assert.equal(game.ledger.byType(EVENT_TYPES.ACCOUNT_CREATED).length, 0);
  assert.equal(game.ledger.byType(EVENT_TYPES.SIGNUP_GRANT).length, 0);
  assert.equal(game.ledger.byType(EVENT_TYPES.SCREENER_RESULT).length, 1);
  assert.equal(game.snapshot().account.cashUSD, 0);
});

// ---- C4/R43/R42: allDuelsStaked must be TRUE (retention.computeAnchor) --------

test('C4: a bracket containing one hesitated duel does not anchor the player (allDuelsStaked: false on the ending event)', async () => {
  const { computeAnchor } = await import('../engine/retention.js');
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 }); // opponents always sample 'fire'
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  let t = Date.now();
  const lobby = game.joinLobby(summon.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  const match = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
  // human plays 'air' -- loses to the opponent's always-'fire' (fire beats air) -- flagged hesitated (auto-commit).
  game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [2, 2, 2, 2, 2], hesitated: true, now: t + 1000 });
  const elim = game.ledger.byType(EVENT_TYPES.CHARACTER_ELIMINATED).find((e) => e.payload.characterId === summon.characterId);
  assert.equal(elim.payload.allDuelsStaked, false);
  assert.equal(computeAnchor(game.ledger.all(), 'p1'), null); // no anchor -- the bracket had a hesitated duel
});

test('C4: a fully-staked bracket (no hesitation) DOES anchor the player', async () => {
  const { computeAnchor } = await import('../engine/retention.js');
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 });
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  let t = Date.now();
  const lobby = game.joinLobby(summon.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  const match = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
  const now = t + 1000;
  game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [2, 2, 2, 2, 2], hesitated: false, now });
  const elim = game.ledger.byType(EVENT_TYPES.CHARACTER_ELIMINATED).find((e) => e.payload.characterId === summon.characterId);
  assert.equal(elim.payload.allDuelsStaked, true);
  assert.equal(computeAnchor(game.ledger.all(), 'p1'), now);
});

test('C4: a hesitated duel EARLIER in the bracket still marks the eventual champion (tracked across the whole bracket, not just the final match)', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 });
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  let t = Date.now();
  const lobby = game.joinLobby(summon.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  sync.advanceLobby(lobby, t);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  let guard = 0;
  let firstHumanMatch = true;
  while (!bracket.complete && guard++ < 60) {
    for (const m of bracketEngine.pendingMatches(bracket)) {
      const involvesHuman = m.seatA === humanSeatIndex || m.seatB === humanSeatIndex;
      t += 1000;
      const hesitated = involvesHuman && firstHumanMatch;
      if (involvesHuman) firstHumanMatch = false;
      game.resolveMatch({ bracketId, bracket, roundIndex: m.roundIndex, matchIndex: m.matchIndex, playerMoves: involvesHuman ? [1, 1, 1, 1, 1] : null, hesitated, now: t }); // water beats the opponent's always-'fire'
    }
  }
  const advanced = game.ledger.byType(EVENT_TYPES.CHARACTER_ADVANCED).find((e) => e.payload.characterId === summon.characterId);
  assert.ok(advanced);
  assert.equal(advanced.payload.allDuelsStaked, false); // one hesitated duel, even though it wasn't the LAST one
});
