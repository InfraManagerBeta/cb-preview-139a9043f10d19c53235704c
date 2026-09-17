// app/tests/sound-kill-switch.test.js — Round-3 fix g2 (reviewer CRUCIAL,
// AC0 + R78a [LAW]): no sound may outlive the screen that owns it — IN
// PARTICULAR over the operator's kill switch. The f5 route-aware teardown
// stopped the bed only when the NEXT screen's mount registered a new
// onUnmount; app.js's kill-switch route wrapper never mounts the screen at
// all, so the bed played on over the "Run Stopped" banner (which carries no
// mute control). The same shape leaked on the bracket-board/sitting mount
// guard clauses (redirect to lobby-entry BEFORE registering teardown).
//
// These are the BEHAVIOURAL replacements for duel-screen-structure.test.js's
// old "A3 guarantee" source-regex pin: they drive the REAL router
// (ui/router.js, hashchange and all) through the REAL kill-switch wrapper
// (ui/app.js's exported guardRoutes) over the REAL screens — the guarantee
// is tested where it actually lives, at the app level. The first test is the
// reviewer's own reproduction, re-run: bed sounding on the loss result card
// → operator flips the kill switch → player presses Continue (duel.js →
// navigate('sitting'), a BED_ROUTE) → the banner must be SILENT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage } from '../engine/ledger.js';
import * as sync from '../engine/sync.js';
import { mulberry32 } from '../engine/rng.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { resetOverrides, patchOverrides } from '../engine/overrides.js';
import { installFakeDom, uninstallFakeDom, renderedText, appRoot } from './helpers/dom-harness.js';

// ---- fakes ------------------------------------------------------------------

const audioCreated = [];
class AudioFake {
  constructor(src) {
    this.src = src;
    this.currentTime = 0;
    this.loop = false;
    this.preload = '';
    this.playing = false;
    audioCreated.push(this);
  }
  get paused() { return !this.playing; }
  play() { this.playing = true; return { catch: () => {} }; }
  pause() { this.playing = false; }
}

let previousAudio;
let previousLocalStorage;
let previousLocation;
test.before(() => {
  previousAudio = globalThis.Audio;
  previousLocalStorage = globalThis.localStorage;
  previousLocation = globalThis.location;
  globalThis.Audio = AudioFake;
  globalThis.localStorage = createMemoryStorage();
});
test.after(() => {
  globalThis.Audio = previousAudio;
  globalThis.localStorage = previousLocalStorage;
  globalThis.location = previousLocation;
});

// IMPORTANT: ui/app.js is imported here at module-evaluation time, BEFORE any
// test installs the fake DOM — document/window/location are all undefined at
// that instant, so app.js's browser-host gate skips its own main() boot and
// this import yields ONLY the exported guardRoutes (the real kill-switch
// route wrapper, the code under test).
const { guardRoutes } = await import('../ui/app.js');
const { createRouter } = await import('../ui/router.js');
const sound = await import('../ui/components/battle/sound.js');
const tunables = await loadTunables();
// The 'adjacent' treatment renders the placeholder stage (no rig, no lottie,
// no fetch) — the audio lifecycle under test is treatment-independent.
const treatment = await loadTreatment('adjacent');
const { mountDuel } = await import('../ui/screens/duel.js');
const { mountBracketBoard } = await import('../ui/screens/bracket-board.js');
const { mountSitting } = await import('../ui/screens/sitting.js');

function bedSounding() {
  const bed = audioCreated.find((a) => a.src.includes('fight-loop.wav'));
  return !!(bed && bed.playing);
}
function anySounding() {
  return audioCreated.some((a) => a.playing);
}
function muteControls() {
  return appRoot().querySelectorAll('.cb-sound-toggle');
}
function clickButton(matcher) {
  const btn = appRoot().querySelectorAll('button').find(matcher);
  assert.ok(btn, `expected a button matching ${matcher}`);
  btn.dispatch('click');
  return btn;
}
/** Let the real router's async render() (and any chained guard-clause
 * navigation it triggers) finish. */
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

/** A REAL window/location pair for ui/router.js: `location.hash`'s setter
 * fires the registered `hashchange` listeners synchronously, exactly the
 * observable contract createRouter relies on in a browser. */
function installFakeNavigation() {
  const listeners = [];
  let hash = '';
  globalThis.window = {
    scrollTo() {},
    addEventListener(type, fn) { if (type === 'hashchange') listeners.push(fn); },
    removeEventListener() {},
  };
  globalThis.location = {
    search: '',
    get hash() { return hash; },
    set hash(v) {
      if (v === hash) return;
      hash = v;
      for (const fn of [...listeners]) fn();
    },
  };
}

/** A real Game brought to the human's first pending quarterfinal, wired
 * through the REAL router and the REAL kill-switch wrapper (app.js's
 * guardRoutes) — the full app-level navigation stack, minus only main()'s
 * data loading. `seed` picks the deterministic rng stream. */
function buildApp(seed) {
  resetOverrides();
  // The ledger stays private per test, but the KILL SWITCH must be read from
  // the same overrides storage patchOverrides()/the route wrapper use (in the
  // real app both are localStorage) — otherwise the Game never sees the kill.
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), overridesStorage: globalThis.localStorage, tunables, treatment, playerId: 'p1', random: mulberry32(seed) });
  const t0 = Date.now();
  game.ensureAccount(t0);
  game.submitScreener({ age18: true, jurisdictionOk: true }, t0);
  const summon = game.summonCharacter({ element: 'water' }, t0);
  const lobby = game.joinLobby(summon.characterId, 0, t0 + 1000);
  sync.advanceLobby(lobby, lobby.humanWaitDeadline + 1000);
  const { bracketId, bracket } = game.lockBracketFromLobby(lobby, lobby.humanWaitDeadline + 1000);
  const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');

  const ctx = {
    treatment, tunables, game,
    session: {
      bracketId, bracket, humanSeatIndex,
      activeCharacterId: summon.characterId,
      commitWindow: null,
      hasSeenDuelPlaythrough: true, // the reveal's Skip control is available
      lastResult: null,
    },
    refreshSession() { return ctx.session; },
    patchSession(p) { Object.assign(ctx.session, p); return ctx.session; },
    toast: () => {},
    router: null,
  };
  const rawRoutes = {
    landing: () => {},
    duel: () => mountDuel(ctx),
    'bracket-board': () => mountBracketBoard(ctx),
    sitting: () => mountSitting(ctx),
    'lobby-entry': () => {}, // outside the bracket context — a bare stub is enough
    wallet: () => {},
  };
  ctx.router = createRouter(guardRoutes(rawRoutes, ctx), async () => { ctx.refreshSession(); });
  return ctx;
}

/** Seal an all-affinity hand on the mounted commit screen and skip the
 * reveal — leaves the app on the result card. Returns lastResult. */
function sealAndSkipToResult(ctx) {
  const element = 'water';
  const groups = appRoot().querySelectorAll('button').filter((b) => b.getAttribute('data-el') === element);
  assert.equal(groups.length, 5, 'five round pickers on the commit screen');
  for (const b of groups) b.dispatch('click');
  clickButton((b) => renderedText(b) === 'Seal Commitment');
  assert.ok(ctx.session.lastResult, 'the duel resolved');
  clickButton((b) => renderedText(b).includes('Skip'));
  return ctx.session.lastResult;
}

// ---- the reviewer's reproduction, re-run ------------------------------------

test('g2 CRUCIAL (AC0 + R78a): bed sounding on the loss result card → operator kills → Continue lands on the "Run Stopped" banner with the bed SILENT (nothing sounds over a surface with no mute control)', async () => {
  installFakeDom();
  installFakeNavigation();
  try {
    for (const a of audioCreated) a.playing = false; // elements are cached per WAV across tests — reset flags, never orphan the cache
    sound.armSound();
    sound.setSoundEnabled(true);
    // seed 2: the all-affinity water hand LOSES the quarterfinal (asserted —
    // same seed sound-bed-carry.test.js pins for the loss path).
    const ctx = buildApp(2);
    ctx.router.navigate('duel');
    await settle();

    const result = sealAndSkipToResult(ctx);
    assert.equal(result.humanWon, false, 'seed 2 must lose the quarterfinal (re-pick the seed if the engine changes)');
    assert.ok(bedSounding(), 'precondition (the reviewer probe\'s first line): the bed is sounding on the result card');

    // The operator flips the kill switch (console / other tab / ?kill=1).
    patchOverrides({ killSwitch: true, killSwitchReason: 'test-probe', killSwitchAt: Date.now() });

    // The player presses the loss path's Continue → navigate('sitting'), a
    // BED_ROUTE — through the REAL router and the REAL kill-switch wrapper.
    clickButton((b) => renderedText(b) === 'Continue');
    await settle();

    assert.match(renderedText(appRoot()), /Run Stopped/, 'the stop banner rendered');
    assert.equal(ctx.router.current(), 'sitting', 'on the same route the reviewer probed (a BED_ROUTE, killed)');
    assert.equal(bedSounding(), false, 'the bed is SILENT over the stop banner (was: true — the CRUCIAL finding)');
    assert.equal(anySounding(), false, 'no battle sample at all sounds over the stop banner');
    // R78a is satisfied by silence: the banner still carries no mute control,
    // and now nothing plays there for one to control.
    assert.equal(muteControls().length, 0, 'the stop banner carries no mute control — legitimate only because it is silent');
  } finally {
    uninstallFakeDom();
  }
});

// ---- the same guarantee holds while killed, on every route -------------------

test('g2 CRUCIAL: with the kill switch already down, EVERY route mount silences audio (no screen mounts, so no screen-level teardown can — the wrapper itself must)', async () => {
  installFakeDom();
  installFakeNavigation();
  try {
    for (const a of audioCreated) a.playing = false;
    sound.armSound();
    sound.setSoundEnabled(true);
    const ctx = buildApp(11);
    patchOverrides({ killSwitch: true, killSwitchReason: 'test-probe', killSwitchAt: Date.now() });
    for (const route of ['duel', 'bracket-board', 'sitting', 'wallet']) {
      sound.playLoop(); // a bed somehow left sounding (the class under test)
      assert.ok(bedSounding(), `precondition: the bed is sounding before mounting ${route}`);
      ctx.router.navigate(route);
      await settle();
      assert.match(renderedText(appRoot()), /Run Stopped/, `${route}: the stop banner rendered`);
      assert.equal(anySounding(), false, `${route}: silent over the stop banner`);
    }
  } finally {
    uninstallFakeDom();
  }
});

// ---- the two narrower guard-clause paths the reviewer also reproduced --------

test('g2 CRUCIAL: mountBracketBoard\'s no-bracket guard redirect to lobby-entry stops the bed (teardown registered BEFORE the guard + router-level release)', async () => {
  installFakeDom();
  installFakeNavigation();
  try {
    for (const a of audioCreated) a.playing = false;
    sound.armSound();
    sound.setSoundEnabled(true);
    const ctx = buildApp(11);
    ctx.session.bracket = null; // no bracket → mountBracketBoard guard-clauses out
    sound.playLoop();
    assert.ok(bedSounding(), 'precondition: a carried bed is sounding');
    ctx.router.navigate('bracket-board');
    await settle();
    assert.equal(ctx.router.current(), 'lobby-entry', 'the guard clause redirected to lobby-entry');
    assert.equal(bedSounding(), false, 'lobby-entry is outside the bracket context — the bed stopped (the A3 guarantee)');
    assert.equal(anySounding(), false, 'nothing lingers on lobby-entry');
  } finally {
    uninstallFakeDom();
  }
});

test('g2 CRUCIAL: mountSitting\'s no-character guard redirect to lobby-entry stops the bed', async () => {
  installFakeDom();
  installFakeNavigation();
  try {
    for (const a of audioCreated) a.playing = false;
    sound.armSound();
    sound.setSoundEnabled(true);
    const ctx = buildApp(11);
    ctx.session.activeCharacterId = 'no-such-character'; // → mountSitting guard-clauses out
    sound.playLoop();
    assert.ok(bedSounding(), 'precondition: a carried bed is sounding');
    ctx.router.navigate('sitting');
    await settle();
    assert.equal(ctx.router.current(), 'lobby-entry', 'the guard clause redirected to lobby-entry');
    assert.equal(bedSounding(), false, 'the bed stopped on lobby-entry');
    assert.equal(anySounding(), false, 'nothing lingers on lobby-entry');
  } finally {
    uninstallFakeDom();
  }
});

// ---- the mid-action catch-site: a kill landing DURING the duel ---------------

test('g2: a kill landing mid-reveal reaches renderResult\'s logNarration catch-site — the shared stop banner itself silences everything (no route change happens at all)', async () => {
  installFakeDom();
  installFakeNavigation();
  try {
    for (const a of audioCreated) a.playing = false;
    sound.armSound();
    sound.setSoundEnabled(true);
    const ctx = buildApp(2);
    ctx.router.navigate('duel');
    await settle();

    const element = 'water';
    const groups = appRoot().querySelectorAll('button').filter((b) => b.getAttribute('data-el') === element);
    for (const b of groups) b.dispatch('click');
    clickButton((b) => renderedText(b) === 'Seal Commitment');
    assert.ok(bedSounding(), 'precondition: the bed is sounding during the reveal');

    // The kill lands while the reveal is on screen…
    patchOverrides({ killSwitch: true, killSwitchReason: 'test-probe', killSwitchAt: Date.now() });
    // …and the player skips to the result: renderResult → carryBed →
    // logNarration throws KillSwitchFrozenError → the catch renders the
    // stop banner in place, with NO navigation for any teardown to ride.
    clickButton((b) => renderedText(b).includes('Skip'));

    assert.match(renderedText(appRoot()), /Run Stopped/, 'the catch-site rendered the stop banner');
    assert.equal(anySounding(), false, 'the stop banner silenced the bed and every one-shot');
  } finally {
    uninstallFakeDom();
  }
});
