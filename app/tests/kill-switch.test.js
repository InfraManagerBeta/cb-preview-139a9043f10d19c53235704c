// app/tests/kill-switch.test.js — C16/A4/AC0: the kill switch must stop an
// in-flight duel, not just gate navigation. Guarded at the Game layer (every
// ledger-touching method), not only the UI, so any caller (console, f2's
// simulator, a screen) inherits the freeze. On kill, an unfinished bracket
// is VOIDED: no auto-commit, no resolution, no stake transfer -- every
// character keeps exactly the stake it held at that instant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, KillSwitchFrozenError } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { patchOverrides } from '../engine/overrides.js';
import * as bracketEngine from '../engine/bracket.js';
import * as sync from '../engine/sync.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function freshGameWithSharedStorage(seed = () => 0) {
  const storage = createMemoryStorage();
  const game = new Game({ ledger: new Ledger(storage), tunables, treatment, playerId: 'p1', storage, random: seed });
  return { game, storage };
}

test('C16: isKilled() reflects the shared overrides storage; false by default', () => {
  const { game, storage } = freshGameWithSharedStorage();
  assert.equal(game.isKilled(), false);
  patchOverrides({ killSwitch: true }, storage);
  assert.equal(game.isKilled(), true);
});

test('C16: EVERY ledger-touching Game method freezes (throws KillSwitchFrozenError) once killed -- guarded at the Game layer, not just the UI', () => {
  const { game, storage } = freshGameWithSharedStorage();
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  patchOverrides({ killSwitch: true }, storage);

  assert.throws(() => game.ensureAccount(2000), KillSwitchFrozenError);
  assert.throws(() => game.submitScreener({ age18: true, jurisdictionOk: true }, 2000), KillSwitchFrozenError);
  assert.throws(() => game.summonCharacter({ element: 'water' }, 2000), KillSwitchFrozenError);
  assert.throws(() => game.joinLobby(summon.characterId, 0, 2000), KillSwitchFrozenError);
  assert.throws(() => game.lockBracketFromLobby({ seats: [], tier: 0 }, 2000), KillSwitchFrozenError);
  assert.throws(() => game.resolveMatch({ bracketId: 'b', bracket: { rounds: [[]] }, roundIndex: 0, matchIndex: 0 }), KillSwitchFrozenError);
  assert.throws(() => game.reenterCharacter(summon.characterId, 2000), KillSwitchFrozenError);
  assert.throws(() => game.cashOutCharacter(summon.characterId, 2000), KillSwitchFrozenError);
  assert.throws(() => game.retireEmptyCharacter(summon.characterId, 2000), KillSwitchFrozenError);
  assert.throws(() => game.startPveOpponent(summon.characterId, 2000), KillSwitchFrozenError);
  assert.throws(() => game.resolvePveDuel({ characterId: summon.characterId, playerMoves: [0, 0, 0, 0, 0], opponent: { sessionId: 'x' } }), KillSwitchFrozenError);
  assert.throws(() => game.loadFunds({ amountUSD: 10, presetOrCustom: 'preset', intentId: 'i', sessionNumber: 1 }, 2000), KillSwitchFrozenError);
  assert.throws(() => game.pressReserve({ tier: 0, characterState: 'ACTIVE' }, 2000), KillSwitchFrozenError);
  assert.throws(() => game.recordSyncDisconnect('b1', 2000), KillSwitchFrozenError);
  assert.throws(() => game.recordSyncReconnect('b1', 2000), KillSwitchFrozenError);
  assert.throws(() => game.recordNpcSeatedInLobby({ lobbyCreatedAt: 1, tier: 0, seatIndex: 1, name: 'x', element: 'fire' }, 2000), KillSwitchFrozenError);
  assert.throws(() => game.submitOpenResponse('hi', 2000), KillSwitchFrozenError);
  // f4/A-g: logNarration was guarded (_assertNotKilled) but missing from
  // this "EVERY ledger-touching method" regression list -- closing that
  // gap (the actual UI catch-site fix lives in duel.js's renderResult,
  // scanned in duel-screen-structure.test.js).
  assert.throws(() => game.logNarration({ bracketId: 'b1', roundIndex: 0, matchIndex: 0, matchData: {}, narration: { text: 'x' } }, 2000), KillSwitchFrozenError);

  // Nothing new was appended by any of the throws above.
  assert.equal(game.ledger.byType(EVENT_TYPES.CHARACTER_SUMMONED).length, 1);
});

test('C16: kill mid-commit-window -- no auto-commit event, the bracket is voided, every balance is unchanged', () => {
  const { game, storage } = freshGameWithSharedStorage();
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

  const balancesBefore = game.snapshot();

  // The kill switch flips mid-commit-window (before the human ever commits).
  patchOverrides({ killSwitch: true }, storage);

  // The tick's auto-commit path (app/ui/screens/duel.js) must check isKilled()
  // BEFORE calling sync.autoCommitHesitated/resolveMatch and, finding it
  // killed, call voidBracketOnKill instead -- simulated here directly at the
  // Game layer (the layer the fix is guarded at, so the UI screen inherits
  // this automatically).
  assert.equal(game.isKilled(), true);
  assert.throws(() => game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: [0, 0, 0, 0, 0], hesitated: true, now: t + 1000 }), KillSwitchFrozenError);
  assert.equal(game.ledger.byType(EVENT_TYPES.DUEL_RESOLVED).length, 0); // no auto-commit/resolution happened

  const voidEvent = game.voidBracketOnKill({ bracketId, bracket, now: t + 1001 });
  assert.equal(voidEvent.type, EVENT_TYPES.BRACKET_VOIDED);
  assert.ok(/AC0/.test(voidEvent.payload.rule));

  const balancesAfter = game.snapshot();
  for (const id of Object.keys(balancesBefore.characters)) {
    assert.equal(balancesAfter.characters[id].stakeCheddar, balancesBefore.characters[id].stakeCheddar, `character ${id} stake changed after kill`);
  }
  assert.equal(balancesAfter.account.cashUSD, balancesBefore.account.cashUSD);
  assert.equal(balancesAfter.brackets[bracketId].voided, true);

  // voidBracketOnKill itself is idempotent per bracket (calling it again is a no-op).
  const before = game.ledger.byType(EVENT_TYPES.BRACKET_VOIDED).length;
  game.voidBracketOnKill({ bracketId, bracket, now: t + 2000 });
  assert.equal(game.ledger.byType(EVENT_TYPES.BRACKET_VOIDED).length, before);
});

test('C16: voidBracketOnKill itself is NOT frozen by the kill switch (its whole purpose is to run while killed)', () => {
  const { game, storage } = freshGameWithSharedStorage();
  patchOverrides({ killSwitch: true }, storage);
  assert.doesNotThrow(() => game.voidBracketOnKill({ bracketId: 'b1', bracket: { seats: [] }, now: 1000 }));
});
