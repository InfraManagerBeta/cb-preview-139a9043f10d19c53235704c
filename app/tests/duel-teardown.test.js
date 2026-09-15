// app/tests/duel-teardown.test.js — f4/A-i: navigating away mid-commit must
// stop a pending auto-commit-hesitated from ever firing. This exercises
// the REAL ingredients duel.js's own commit-tick uses (engine/sync.js's
// createCommitWindow/autoCommitHesitated, a real Game/Ledger, a real
// bracket's pending match) combined with the REAL, shipped router.js's
// onUnmount teardown mechanism (see router-teardown.test.js for that
// mechanism in isolation) -- duel.js itself can't be executed here (it
// touches `document`, unavailable in this Node harness -- see
// app/README.md's node:test gotcha and every other UI screen test's
// static-scan-only approach), so this reproduces the exact interval/
// commit-window/teardown SHAPE duel.js wires up, at the layer that
// actually matters: does the ledger see a hesitated commit after
// "leaving" the screen, or not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import * as sync from '../engine/sync.js';
import * as bracketEngine from '../engine/bracket.js';
import { mulberry32 } from '../engine/rng.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function stubBrowserGlobals() {
  global.location = { hash: '' };
  global.window = { addEventListener() {} };
}

function freshPendingMatch() {
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(1) });
  const t0 = Date.now();
  game.ensureAccount(t0);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'water' }, t0);
  const lobby = game.joinLobby(summon.characterId, 0, t0 + 1000);
  sync.advanceLobby(lobby, lobby.humanWaitDeadline + 1000);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, lobby.humanWaitDeadline + 1000);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
  const match = bracketEngine.pendingMatches(bracket).find((m) => m.seatA === humanSeatIndex || m.seatB === humanSeatIndex);
  return { game, bracketId, bracket, humanSeatIndex, match };
}

/** Mirrors duel.js's own tick()/commit() shape exactly, at a fake, very
 * short commit-window deadline so the test doesn't need to wait real
 * seconds. Returns the interval id (what duel.js calls `timerHandle`). */
function startCommitTick({ game, bracketId, bracket, match, humanSeatIndex, window_ }) {
  return setInterval(() => {
    const remaining = window_.deadline - Date.now();
    if (remaining <= 0) {
      const autoMoves = sync.autoCommitHesitated(window_, humanSeatIndex, Date.now());
      if (autoMoves) {
        game.resolveMatch({ bracketId, bracket, roundIndex: match.roundIndex, matchIndex: match.matchIndex, playerMoves: autoMoves.moves, hesitated: true, now: Date.now() });
      }
    }
  }, 20);
}

test('f4/A-i: navigating away BEFORE the commit deadline clears the tick interval -- no hesitated auto-commit event ever fires', async () => {
  stubBrowserGlobals();
  const { createRouter } = await import('../ui/router.js');
  const { game, bracketId, bracket, match, humanSeatIndex } = freshPendingMatch();

  const window_ = sync.createCommitWindow(tunables, Date.now(), 0.1); // a 100ms commit window
  const timerHandle = startCommitTick({ game, bracketId, bracket, match, humanSeatIndex, window_ });

  const router = createRouter({ landing: () => {}, duel: () => {} }, async () => {});
  router.start();
  // Exactly duel.js's own registration: onUnmount clears whatever the
  // current value of `timerHandle` is.
  router.onUnmount(() => clearInterval(timerHandle));

  // Navigate away WELL BEFORE the 100ms deadline elapses.
  await new Promise((resolve) => setTimeout(resolve, 20));
  router.navigate('landing');
  router.navigate('landing'); // same-route re-render is what actually fires render()/teardown in this stub, see router-teardown.test.js

  // Now wait PAST the original deadline -- if the interval were still
  // alive, it would have auto-committed by now.
  await new Promise((resolve) => setTimeout(resolve, 200));

  const hesitatedEvents = game.ledger.byType(EVENT_TYPES.DUEL_RESOLVED).filter((e) => e.payload.hesitated);
  assert.equal(hesitatedEvents.length, 0, 'expected NO hesitated auto-commit event after navigating away before the deadline');
});

test('f4/A-i (control): WITHOUT clearing the interval on navigation, the same setup DOES auto-commit past the deadline (proves the reproduction is real, not vacuous)', async () => {
  stubBrowserGlobals();
  const { createRouter } = await import('../ui/router.js');
  const { game, bracketId, bracket, match, humanSeatIndex } = freshPendingMatch();

  const window_ = sync.createCommitWindow(tunables, Date.now(), 0.1);
  const timerHandle = startCommitTick({ game, bracketId, bracket, match, humanSeatIndex, window_ });

  const router = createRouter({ landing: () => {}, duel: () => {} }, async () => {});
  router.start();
  // Deliberately do NOT register onUnmount here -- the old, pre-fix behavior.

  await new Promise((resolve) => setTimeout(resolve, 20));
  router.navigate('landing');
  router.navigate('landing');

  await new Promise((resolve) => setTimeout(resolve, 200));
  clearInterval(timerHandle); // stop the interval now that the test is done observing it

  const hesitatedEvents = game.ledger.byType(EVENT_TYPES.DUEL_RESOLVED).filter((e) => e.payload.hesitated);
  assert.equal(hesitatedEvents.length, 1, 'expected the OLD (un-torn-down) behavior to still auto-commit -- confirms the fixed test above is a real regression check, not trivially always-passing');
});
