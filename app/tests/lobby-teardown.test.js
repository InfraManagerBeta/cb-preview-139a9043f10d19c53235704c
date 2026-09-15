// app/tests/lobby-teardown.test.js — f5/A4: navigating away from the lobby
// screen must stop its 300ms tick -- same class of bug f4/A-i already fixed
// for duel.js's timers (see duel-teardown.test.js). Before this fix,
// lobby.js registered NO onUnmount teardown at all: leaving the screen left
// the interval running in the background, still appending SYNC_NPC_SEATED
// ledger events AND force-navigating to 'duel' (or 'landing' on a kill)
// out from under whatever screen the player had actually navigated to.
//
// lobby.js itself can't be executed here (it touches `document` via
// mountScreen -- unavailable in this Node harness, see app/README.md's
// node:test gotcha and every other UI screen test's static-scan-only
// approach), so this reproduces the exact interval/teardown SHAPE lobby.js
// wires up, at the layer that actually matters: does the ledger see more
// SYNC_NPC_SEATED events (or a forced navigation) after "leaving" the
// screen, or not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import * as sync from '../engine/sync.js';
import { mulberry32 } from '../engine/rng.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function stubBrowserGlobals() {
  global.location = { hash: '' };
  global.window = { addEventListener() {} };
}

function freshLobby() {
  // mulberry32(1): a real, VARIED random stream (not a constant) -- some
  // NPC join delays land early (well inside this test's observation
  // window), some land later, so a control run genuinely distinguishes
  // "interval kept running" from "interval was cleared".
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(1) });
  const t0 = Date.now();
  game.ensureAccount(t0);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'water' }, t0);
  const lobby = game.joinLobby(summon.characterId, 0, t0 + 1000);
  return { game, lobby, t0 };
}

/** Mirrors lobby.js's own tick() shape exactly (minus the DOM render()
 * call), at the same DEMO_SPEED_MULTIPLIER-accelerated virtual clock. */
function startLobbyTick({ game, lobby, realStart, onBoard }) {
  const DEMO_SPEED_MULTIPLIER = 12;
  const virtualNow = () => lobby.createdAt + (Date.now() - realStart) * DEMO_SPEED_MULTIPLIER;
  return setInterval(() => {
    const now = virtualNow();
    const before = lobby.seats.map((s) => !!s);
    sync.advanceLobby(lobby, now, { treatment, tunables });
    for (let i = 0; i < lobby.seats.length; i++) {
      if (!before[i] && lobby.seats[i]) {
        game.recordNpcSeatedInLobby({ lobbyCreatedAt: lobby.createdAt, tier: lobby.tier, seatIndex: i, name: lobby.seats[i].name, element: lobby.seats[i].element }, now);
      }
    }
    if (sync.isReadyForBoard(lobby, now)) {
      onBoard();
    }
  }, 20);
}

test('f5/A4: navigating away from the lobby BEFORE it\'s ready for the board clears the tick interval -- no further SYNC_NPC_SEATED events append and no forced navigation to \'duel\' fires', async () => {
  stubBrowserGlobals();
  const { createRouter } = await import('../ui/router.js');
  const { game, lobby } = freshLobby();

  let boardNavigations = 0;
  const timer = startLobbyTick({ game, lobby, realStart: Date.now(), onBoard: () => { boardNavigations++; } });

  const router = createRouter({ landing: () => {}, lobby: () => {}, duel: () => {} }, async () => {});
  router.start();
  // Exactly lobby.js's own registration: onUnmount clears whatever the
  // current value of `timer` is.
  router.onUnmount(() => clearInterval(timer));

  // Navigate away almost immediately -- well before the lobby's own
  // countdown/fill would naturally complete.
  await new Promise((resolve) => setTimeout(resolve, 20));
  router.navigate('landing');
  router.navigate('landing'); // same-route re-render is what actually fires render()/teardown in this stub, see router-teardown.test.js

  const seatedCountAtTeardown = game.ledger.byType(EVENT_TYPES.SYNC_NPC_SEATED).length;
  const boardNavigationsAtTeardown = boardNavigations;

  // Wait well past however long the lobby would otherwise have taken to
  // fill and reach the board -- if the interval were still alive, more
  // SYNC_NPC_SEATED events (and/or a board navigation) would have fired.
  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.equal(game.ledger.byType(EVENT_TYPES.SYNC_NPC_SEATED).length, seatedCountAtTeardown, 'expected NO further SYNC_NPC_SEATED events after navigating away');
  assert.equal(boardNavigations, boardNavigationsAtTeardown, 'expected NO forced navigation to the board after navigating away');
});

test('f5/A4 (control): WITHOUT clearing the interval on navigation, the same setup DOES keep appending/navigating past teardown (proves the reproduction is real, not vacuous)', async () => {
  stubBrowserGlobals();
  const { createRouter } = await import('../ui/router.js');
  const { game, lobby } = freshLobby();

  let boardNavigations = 0;
  const timer = startLobbyTick({ game, lobby, realStart: Date.now(), onBoard: () => { boardNavigations++; } });

  const router = createRouter({ landing: () => {}, lobby: () => {}, duel: () => {} }, async () => {});
  router.start();
  // Deliberately do NOT register onUnmount here -- the old, pre-fix behavior.

  await new Promise((resolve) => setTimeout(resolve, 20));
  router.navigate('landing');
  router.navigate('landing');

  const seatedCountAtTeardown = game.ledger.byType(EVENT_TYPES.SYNC_NPC_SEATED).length;

  await new Promise((resolve) => setTimeout(resolve, 400));
  clearInterval(timer); // stop the interval now that the test is done observing it

  const seatedCountAfter = game.ledger.byType(EVENT_TYPES.SYNC_NPC_SEATED).length;
  assert.ok(seatedCountAfter > seatedCountAtTeardown || boardNavigations > 0, 'expected the OLD (un-torn-down) behavior to keep appending SYNC_NPC_SEATED events and/or navigate to the board -- confirms the fixed test above is a real regression check, not trivially always-passing');
});
