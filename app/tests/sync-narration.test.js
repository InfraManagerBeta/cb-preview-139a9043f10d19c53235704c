// app/tests/sync-narration.test.js — C18/R84/R73/R22: declared-but-never-
// emitted streams (SYNC_COMMIT, SYNC_HESITATED, SYNC_DISCONNECT,
// SYNC_RECONNECT, SYNC_NPC_SEATED, NARRATION_GENERATED) now emit at their
// natural point; narrator.toXML is logged as the "user message" for every
// narration; a minimal one-per-account OPEN_RESPONSE gives R22's
// character-recall metric a source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import * as bracketEngine from '../engine/bracket.js';
import * as sync from '../engine/sync.js';
import { buildMatchData, generateNarration, toXML } from '../engine/narrator.js';
import { reorientOutcome } from '../engine/duel.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

test('C18: SYNC_COMMIT is emitted on a real (non-hesitated) human commit; SYNC_HESITATED on an auto-commit', () => {
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

  game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], hesitated: false, now: t + 1000 });
  assert.equal(game.ledger.byType(EVENT_TYPES.SYNC_COMMIT).length, 1);
  assert.equal(game.ledger.byType(EVENT_TYPES.SYNC_HESITATED).length, 0);
});

test('C18: SYNC_HESITATED (not SYNC_COMMIT) is emitted for an auto-committed human duel', () => {
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

  game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], hesitated: true, now: t + 1000 });
  assert.equal(game.ledger.byType(EVENT_TYPES.SYNC_HESITATED).length, 1);
  assert.equal(game.ledger.byType(EVENT_TYPES.SYNC_COMMIT).length, 0);
});

test('C18: SYNC_NPC_SEATED is emitted when a lobby seat is filled by an NPC (distinct from the ledger NPC_SEATED at bracket-lock)', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0.5 });
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  let t = Date.now();
  const lobby = game.joinLobby(summon.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  const before = lobby.seats.map((s) => !!s);
  sync.advanceLobby(lobby, t);
  for (let i = 0; i < lobby.seats.length; i++) {
    if (!before[i] && lobby.seats[i]) {
      game.recordNpcSeatedInLobby({ lobbyCreatedAt: lobby.createdAt, tier: lobby.tier, seatIndex: i, name: lobby.seats[i].name, element: lobby.seats[i].element }, t);
    }
  }
  assert.equal(game.ledger.byType(EVENT_TYPES.SYNC_NPC_SEATED).length, 7);
});

test('C18: SYNC_DISCONNECT / SYNC_RECONNECT record leaving mid-bracket and resuming', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1' });
  game.recordSyncDisconnect('bracket-1', 1000);
  game.recordSyncReconnect('bracket-1', 2000);
  assert.equal(game.ledger.byType(EVENT_TYPES.SYNC_DISCONNECT).length, 1);
  assert.equal(game.ledger.byType(EVENT_TYPES.SYNC_RECONNECT).length, 1);
  // idempotent per bracket
  game.recordSyncDisconnect('bracket-1', 1500);
  assert.equal(game.ledger.byType(EVENT_TYPES.SYNC_DISCONNECT).length, 1);
});

test('C18/R73: NARRATION_GENERATED logs the toXML "user message" alongside the output and bypass/fallback flags', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1' });
  const outcome = {
    rounds: [
      { round: 1, move1: 'fire', move2: 'air', result: 'WIN', p1Affinity: false, p2Affinity: false, tag: null },
      { round: 2, move1: 'fire', move2: 'air', result: 'WIN', p1Affinity: false, p2Affinity: false, tag: null },
      { round: 3, move1: 'water', move2: 'fire', result: 'WIN', p1Affinity: false, p2Affinity: false, tag: null },
      { round: 4, move1: 'fire', move2: 'air', result: 'WIN', p1Affinity: false, p2Affinity: false, tag: null },
      { round: 5, move1: 'fire', move2: 'air', result: 'WIN', p1Affinity: false, p2Affinity: false, tag: null },
    ],
    won: 5, lost: 0, draws: 0, bigCount: 0, criticalCount: 0, trueTie: false, upset: false, coupDeGrace: false, floorDrain: false, identicalAllFive: false, transfer: 40, winner: 1,
  };
  const matchData = buildMatchData(outcome, { p1Name: 'Wizard A', p2Name: 'Wizard B', p1StakeBefore: 100, p2StakeBefore: 100 });
  const narration = generateNarration(matchData, { treatmentCopy: treatment.copy });
  game.logNarration({ bracketId: 'b1', roundIndex: 0, matchIndex: 0, matchData, narration });

  const events = game.ledger.byType(EVENT_TYPES.NARRATION_GENERATED);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.userMessage, toXML(matchData));
  assert.equal(events[0].payload.output, narration.text);
  assert.equal(events[0].payload.usedBypass, !!narration.usedBypass);
  assert.equal(events[0].payload.usedFallback, !!narration.usedFallback);

  // idempotent per bracket-duel identifiers
  game.logNarration({ bracketId: 'b1', roundIndex: 0, matchIndex: 0, matchData, narration });
  assert.equal(game.ledger.byType(EVENT_TYPES.NARRATION_GENERATED).length, 1);
});

test('C18/R22: submitOpenResponse records once per account; further submissions are a no-op', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1' });
  game.submitOpenResponse('I remember the coin flip.', 1000);
  game.submitOpenResponse('a different answer', 2000); // must not overwrite
  const events = game.ledger.byType(EVENT_TYPES.OPEN_RESPONSE);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.text, 'I remember the coin flip.');
  assert.equal(game.snapshot().account.openResponse.text, 'I remember the coin flip.');
});

test('C18: a scripted bracket emits every one of the six declared streams', () => {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: () => 0 });
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  let t = Date.now();
  const lobby = game.joinLobby(summon.characterId, 0, t);
  t = lobby.humanWaitDeadline + 1000;
  const before = lobby.seats.map((s) => !!s);
  sync.advanceLobby(lobby, t);
  for (let i = 0; i < lobby.seats.length; i++) {
    if (!before[i] && lobby.seats[i]) {
      game.recordNpcSeatedInLobby({ lobbyCreatedAt: lobby.createdAt, tier: lobby.tier, seatIndex: i, name: lobby.seats[i].name, element: lobby.seats[i].element }, t);
    }
  }
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, t);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  const match = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
  const outcome1 = game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [1, 1, 1, 1, 1], hesitated: false, now: t + 1000 });

  const oriented = reorientOutcome(outcome1.outcome, outcome1.humanIsSeatA);
  const matchData = buildMatchData(oriented, { p1Name: 'Wizard A', p2Name: 'Wizard B', p1StakeBefore: 100, p2StakeBefore: 100 });
  const narration = generateNarration(matchData, { treatmentCopy: treatment.copy });
  game.logNarration({ bracketId, roundIndex: match.roundIndex, matchIndex: match.matchIndex, matchData, narration });

  game.recordSyncDisconnect(bracketId, t + 2000);
  game.recordSyncReconnect(bracketId, t + 3000);

  for (const type of [
    EVENT_TYPES.SYNC_COMMIT, EVENT_TYPES.SYNC_NPC_SEATED, EVENT_TYPES.SYNC_DISCONNECT,
    EVENT_TYPES.SYNC_RECONNECT, EVENT_TYPES.NARRATION_GENERATED,
  ]) {
    assert.ok(game.ledger.byType(type).length >= 1, `expected at least one ${type} event`);
  }
});
