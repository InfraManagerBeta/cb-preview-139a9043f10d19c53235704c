// app/tests/sound-bed-carry.test.js — fix round f5, FINDING 1 (R78a [LAW] /
// CB-BUILD-016 "carry the bed through the bracket"): the §18 audio bed
// "plays through the bracket as the 2019 client played it" — before this fix
// duel.js stopAll()'d on unmount AND at the result card, so audio existed
// only during the duel reveal. These tests mount the REAL screens
// (duel.js's commit/reveal/result/intermission phases, bracket-board.js,
// sitting.js) through the fake-DOM harness and a router shim with the real
// router's unmount-then-mount semantics, and walk the manager's
// past-the-examples path: duel → result → intermission → next commit screen
// → bracket board → sitting, asserting at EVERY step that the bed is still
// sounding and a visible mute control is present — and that a player who
// mutes stays muted across the whole path. Leaving the bracket context
// (lobby-entry, wallet, …) still stops everything (the A3 guarantee).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage } from '../engine/ledger.js';
import * as sync from '../engine/sync.js';
import { mulberry32 } from '../engine/rng.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { resetOverrides } from '../engine/overrides.js';
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
test.before(() => {
  previousAudio = globalThis.Audio;
  previousLocalStorage = globalThis.localStorage;
  globalThis.Audio = AudioFake;
  globalThis.localStorage = createMemoryStorage();
});
test.after(() => {
  globalThis.Audio = previousAudio;
  globalThis.localStorage = previousLocalStorage;
});

const sound = await import('../ui/components/battle/sound.js');
const tunables = await loadTunables();
// The 'adjacent' treatment renders the placeholder stage (no rig, no lottie,
// no fetch) — the sound lifecycle under test is treatment-independent.
const treatment = await loadTreatment('adjacent');
const { mountDuel } = await import('../ui/screens/duel.js');
const { mountBracketBoard } = await import('../ui/screens/bracket-board.js');
const { mountSitting } = await import('../ui/screens/sitting.js');

function bedElement() {
  return audioCreated.find((a) => a.src.includes('fight-loop.wav')) || null;
}
function bedSounding() {
  const bed = bedElement();
  return !!(bed && bed.playing);
}
function muteControl() {
  return appRoot().querySelector('.cb-sound-toggle');
}
function clickButton(matcher) {
  const btn = appRoot().querySelectorAll('button').find(matcher);
  assert.ok(btn, `expected a button matching ${matcher}`);
  btn.dispatch('click');
  return btn;
}
async function waitFor(cond, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = cond();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor: condition never became true');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A router shim with the REAL router.js semantics that matter here: on
 * navigate, current() flips to the NEW route FIRST, then the previous
 * screen's onUnmount teardown runs, then the new screen mounts — exactly
 * render()'s order (the hash has already moved when teardown runs). */
function makeRouterShim(routes, startRoute) {
  let current = startRoute;
  let unmountFn = null;
  const shim = {
    current: () => current,
    onUnmount(fn) { unmountFn = fn; },
    navigate(route) {
      current = route;
      const fn = unmountFn;
      unmountFn = null;
      if (fn) { try { fn(); } catch { /* teardown never blocks navigation */ } }
      (routes[route] || (() => {}))();
    },
    visited: [],
  };
  return shim;
}

/** A real Game brought to the human's first pending quarterfinal, plus the
 * ctx duel.js needs. `seed` picks the deterministic rng stream. */
function freshDuelCtx(seed) {
  resetOverrides();
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(seed) });
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
  const routes = {
    duel: () => mountDuel(ctx),
    'bracket-board': () => mountBracketBoard(ctx),
    sitting: () => mountSitting(ctx),
    'lobby-entry': () => {}, // outside the bracket context — a bare stub is enough
    wallet: () => {},
    landing: () => {},
  };
  ctx.router = makeRouterShim(routes, 'duel');
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
  // the reveal mounted; the bed must already be sounding there
  assert.ok(bedSounding(), 'the bed sounds during the reveal');
  clickButton((b) => renderedText(b).includes('Skip'));
  return ctx.session.lastResult;
}

// ---- the carry path ---------------------------------------------------------

test('f5/FINDING 1: the bed carries duel → result → intermission → next commit screen → bracket board → sitting, with a visible mute at every step; leaving the bracket stops it', async () => {
  installFakeDom();
  try {
    for (const a of audioCreated) a.playing = false; // elements are cached per WAV across tests — reset flags, never orphan the cache
    sound.armSound();
    sound.setSoundEnabled(true);
    // seed 11: the all-affinity water hand WINS the quarterfinal without
    // completing the bracket (asserted below — the test is loud, not lucky,
    // about the seed's meaning).
    const ctx = freshDuelCtx(11);
    ctx.router.navigate('duel');

    // Commit screen: R78a's visible mute is already present (the bed
    // carries INTO later commit screens; the control is the same one).
    assert.ok(muteControl(), 'mute control on the commit screen');

    const result = sealAndSkipToResult(ctx);
    assert.equal(result.humanWon, true, 'seed 11 must win the quarterfinal (re-pick the seed if the engine changes)');
    assert.equal(result.bracketComplete, false, 'and the bracket continues');

    // Result card: the bed is STILL sounding (the old code stopAll()'d here).
    assert.ok(bedSounding(), 'the bed sounds on the result card');
    assert.ok(muteControl(), 'mute control on the result card');

    // Next Duel → the R81 intermission (20–30s, demo-accelerated).
    clickButton((b) => renderedText(b) === 'Next Duel');
    assert.match(renderedText(appRoot()), /Intermission/, 'the intermission mounted');
    assert.ok(bedSounding(), 'the bed sounds through the intermission');
    assert.ok(muteControl(), 'mute control on the intermission');

    // The intermission auto-advances to the next duel's commit screen.
    await waitFor(() => renderedText(appRoot()).includes('Seal Commitment'));
    assert.ok(bedSounding(), 'the bed sounds on the NEXT commit screen');
    assert.ok(muteControl(), 'mute control on the next commit screen');

    // Bracket board (the player can always look at the board mid-run).
    ctx.router.navigate('bracket-board');
    assert.ok(bedSounding(), 'the bed sounds on the bracket board');
    assert.ok(muteControl(), 'mute control on the bracket board');

    // Sitting (the eliminated player's screen / spectate door) also carries.
    ctx.router.navigate('sitting');
    assert.ok(bedSounding(), 'the bed sounds on the sitting screen');
    assert.ok(muteControl(), 'mute control on the sitting screen');
    // …and spectating leads back to the board with the bed intact.
    ctx.router.navigate('bracket-board');
    assert.ok(bedSounding(), 'the bed survives sitting → board (post-elimination spectating)');

    // Leaving the bracket context stops EVERYTHING (the A3 guarantee).
    ctx.router.navigate('lobby-entry');
    assert.equal(bedSounding(), false, 'leaving the bracket for lobby-entry stops the bed');
    assert.ok(audioCreated.every((a) => !a.playing), 'no battle sample lingers outside the bracket');
  } finally {
    uninstallFakeDom();
  }
});

// ---- mute persistence across the same path ----------------------------------

test('f5/FINDING 1: a player who mutes at the result card STAYS muted across intermission and the next commit screen', async () => {
  installFakeDom();
  try {
    for (const a of audioCreated) a.playing = false; // elements are cached per WAV across tests — reset flags, never orphan the cache
    sound.armSound();
    sound.setSoundEnabled(true);
    const ctx = freshDuelCtx(11);
    ctx.router.navigate('duel');
    const result = sealAndSkipToResult(ctx);
    assert.equal(result.humanWon, true, 'seed 11 wins (same seed as above)');

    // Mute ON the result card, via the visible control itself.
    assert.ok(bedSounding(), 'precondition: the bed sounds at the result card');
    muteControl().dispatch('click');
    assert.equal(sound.isSoundEnabled(), false, 'the control muted the sound layer');
    assert.equal(bedSounding(), false, 'the bed fell silent at once');

    clickButton((b) => renderedText(b) === 'Next Duel');
    assert.match(renderedText(appRoot()), /Intermission/);
    assert.equal(bedSounding(), false, 'still muted through the intermission');
    assert.match(renderedText(muteControl()), /SOUND OFF/, 'the intermission control reads muted');

    await waitFor(() => renderedText(appRoot()).includes('Seal Commitment'));
    assert.equal(bedSounding(), false, 'still muted on the next commit screen');
    assert.match(renderedText(muteControl()), /SOUND OFF/, 'the commit-screen control reads muted');
    assert.ok(audioCreated.every((a) => !a.playing), 'nothing plays anywhere while muted');

    ctx.router.navigate('landing'); // teardown: clear the commit tick
    sound.setSoundEnabled(true);
  } finally {
    uninstallFakeDom();
  }
});

// ---- the loss path: result → sitting keeps the bed --------------------------

test('f5/FINDING 1: an ELIMINATED player keeps the bed from the loss result card onto sitting (Continue) and the board (spectate)', async () => {
  installFakeDom();
  try {
    for (const a of audioCreated) a.playing = false; // elements are cached per WAV across tests — reset flags, never orphan the cache
    sound.armSound();
    sound.setSoundEnabled(true);
    // seed 2: the all-affinity water hand LOSES the quarterfinal (asserted).
    const ctx = freshDuelCtx(2);
    ctx.router.navigate('duel');
    const result = sealAndSkipToResult(ctx);
    assert.equal(result.humanWon, false, 'seed 2 must lose the quarterfinal (re-pick the seed if the engine changes)');

    assert.ok(bedSounding(), 'the bed sounds on the loss result card');
    clickButton((b) => renderedText(b) === 'Continue');
    assert.ok(bedSounding(), 'the bed carries onto sitting');
    assert.ok(muteControl(), 'mute control on sitting');

    ctx.router.navigate('bracket-board');
    assert.ok(bedSounding(), 'the bed carries onto the board (post-elimination spectating)');

    ctx.router.navigate('wallet');
    assert.equal(bedSounding(), false, 'leaving for the wallet stops the bed');
  } finally {
    uninstallFakeDom();
  }
});
