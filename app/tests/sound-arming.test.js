// app/tests/sound-arming.test.js — CB-BUILD-016 / R78a [LAW]: sound is ON by
// default; because phones withhold audio until a gesture, it ARMS on the
// player's first tap (pointerdown) and not before; it is first heard during
// the summon ceremony (R74a); a mute control is visible wherever sound
// plays; an explicit mute persists. Functional tests run the real sound
// module against a counting Audio fake and the real summon screen through
// the fake-DOM harness; wiring is checked by static scan where the harness
// has no browser (repo convention).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage } from '../engine/ledger.js';
import { defaultOverrides, patchOverrides, resetOverrides } from '../engine/overrides.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { installFakeDom, uninstallFakeDom, renderedText, appRoot } from './helpers/dom-harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

// ---- fakes -----------------------------------------------------------------

// A counting Audio fake: nothing here plays for real, but every construction
// and play/pause is observable.
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
  play() { this.playing = true; return { catch: () => {} }; }
  pause() { this.playing = false; }
}

// A one-shot-capable event target fake (the "first tap anywhere" surface).
function fakeTapTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type) { for (const fn of [...(listeners.get(type) || [])]) fn({ type }); },
    count(type) { return (listeners.get(type) || []).length; },
  };
}

let previousAudio;
let previousLocalStorage;
let previousLottie;
let previousFetch;
test.before(() => {
  previousAudio = globalThis.Audio;
  previousLocalStorage = globalThis.localStorage;
  previousLottie = globalThis.lottie;
  previousFetch = globalThis.fetch;
  globalThis.Audio = AudioFake;
  globalThis.localStorage = createMemoryStorage(); // so the override layer persists across calls in this process
  // an inert player + a failing fetch: the ceremony flow degrades honestly
  // and resolves fast — this file tests the SOUND beats, not the sequence.
  globalThis.lottie = {
    loadAnimation: () => ({
      setSubframe() {}, goToAndStop() {}, play() {}, pause() {}, resize() {}, destroy() {},
      addEventListener() {},
    }),
  };
  globalThis.fetch = async () => ({ ok: false, status: 503 });
});
test.after(() => {
  globalThis.Audio = previousAudio;
  globalThis.localStorage = previousLocalStorage;
  globalThis.lottie = previousLottie;
  globalThis.fetch = previousFetch;
});

const sound = await import('../ui/components/battle/sound.js');
const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');
const { mountSummon } = await import('../ui/screens/summon.js');

async function waitFor(cond, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = cond();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor: condition never became true');
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ---- default ON ------------------------------------------------------------

test('CB-BUILD-016/R78a: sound is ON by default — the shipped default, not an override a player must find', () => {
  resetOverrides();
  assert.equal(defaultOverrides().soundEnabled, true, 'the default override layer ships soundEnabled: true');
  assert.equal(sound.isSoundEnabled(), true, 'isSoundEnabled() reads true on a fresh install');
});

test('CB-BUILD-016/R78a: an explicit mute persists (and unmute restores)', () => {
  resetOverrides();
  sound.setSoundEnabled(false);
  assert.equal(sound.isSoundEnabled(), false, 'mute persists');
  sound.setSoundEnabled(true);
  assert.equal(sound.isSoundEnabled(), true, 'unmute persists');
});

// ---- arming: first pointerdown, not before ---------------------------------

test('CB-BUILD-016/R78a: sound does NOT arm (and never touches Audio) before the first tap, even though it is enabled', () => {
  resetOverrides();
  assert.equal(sound.isSoundEnabled(), true, 'precondition: enabled');
  assert.equal(sound.isSoundArmed(), false, 'not armed before any gesture');
  audioCreated.length = 0;
  sound.playIntro();
  sound.playLoop();
  sound.playRoundBeat(1);
  assert.equal(audioCreated.length, 0, 'no Audio is constructed or played before the arming tap');
});

test('CB-BUILD-016/R78a: the first pointerdown arms, one-shot (the hook removes itself)', () => {
  const target = fakeTapTarget();
  sound.installFirstTapArming(target);
  assert.equal(sound.isSoundArmed(), false, 'installing the hook does not arm by itself');
  assert.equal(target.count('pointerdown'), 1, 'the hook listens for pointerdown');
  target.dispatch('pointerdown');
  assert.equal(sound.isSoundArmed(), true, 'the first tap arms the audio layer');
  assert.equal(target.count('pointerdown'), 0, 'one-shot: the hook removed itself after the first tap');
  target.dispatch('pointerdown'); // a second tap is a no-op, never an error
  assert.equal(sound.isSoundArmed(), true);
});

// f5 advisory: `pointerdown` alone left a keyboard / assistive-technology
// user permanently unarmed — silence forever. A `keydown` satisfies browser
// autoplay policy equally, so the hook arms on whichever gesture lands first.
test('f5 advisory: the first KEYDOWN arms too (keyboard/AT users), one-shot — both listeners come off together', () => {
  sound.disarmSoundForTests();
  const target = fakeTapTarget();
  sound.installFirstTapArming(target);
  assert.equal(sound.isSoundArmed(), false, 'installing the hook does not arm by itself');
  assert.equal(target.count('keydown'), 1, 'the hook listens for keydown as well');
  target.dispatch('keydown');
  assert.equal(sound.isSoundArmed(), true, 'the first keydown arms the audio layer');
  assert.equal(target.count('keydown'), 0, 'one-shot: the keydown listener removed itself');
  assert.equal(target.count('pointerdown'), 0, 'and the pointerdown listener came off with it');

  // and the tap path removes the keydown listener symmetrically
  sound.disarmSoundForTests();
  const target2 = fakeTapTarget();
  sound.installFirstTapArming(target2);
  target2.dispatch('pointerdown');
  assert.equal(sound.isSoundArmed(), true, 'ends armed (later tests in this process rely on it)');
  assert.equal(target2.count('keydown'), 0, 'a tap removes the keydown listener too');
  assert.equal(target2.count('pointerdown'), 0);
});

test('CB-BUILD-016/R78a: once armed and enabled, the bed plays (and mute stops it immediately)', () => {
  resetOverrides();
  assert.equal(sound.isSoundArmed(), true, 'armed by the previous test\'s tap (module state, same process)');
  const constructedBefore = audioCreated.length;
  sound.playIntro();
  sound.playLoop();
  const intro = audioCreated.find((a) => a.src.includes('fight-intro.wav'));
  assert.ok(intro && intro.playing, 'the intro sting plays');
  const loop = audioCreated.find((a) => a.src.includes('fight-loop.wav'));
  assert.ok(loop && loop.playing && loop.loop === true, 'the bed loop plays, looping');
  sound.setSoundEnabled(false); // the mute control's own action
  assert.equal(loop.playing, false, 'mute stops the bed at once');
  assert.equal(intro.playing, false, 'mute stops everything at once');
  const constructedAfterMute = audioCreated.length;
  sound.playIntro();
  assert.equal(audioCreated.length, constructedAfterMute, 'muted: nothing new plays or constructs');
  assert.equal(intro.playing, false, 'muted: the cached element stays paused');
  assert.ok(audioCreated.length - constructedBefore <= 2, 'one cached element per WAV, never re-constructed');
  sound.setSoundEnabled(true);
});

// ---- first heard with the summon ceremony; mute visible where sound plays --

test('CB-BUILD-016/R78a + R74a: the summon press starts the ceremony audio (first thing heard), with the mute control visible on the ceremony screen', async () => {
  resetOverrides();
  installFakeDom();
  try {
    const ledger = new Ledger(createMemoryStorage());
    const game = new Game({ ledger, tunables, treatment, playerId: 'p1', seed: 3 });
    game.submitScreener({ age18: true, jurisdictionOk: true }, 500);
    const ctx = {
      treatment, tunables, game,
      router: { navigate: () => {}, onUnmount: () => {} },
      patchSession: () => {},
      toast: () => {},
    };
    mountSummon(ctx);
    // Audio elements are cached by the sound layer across tests (by design:
    // one element per WAV) — flag-reset every known instance, then assert on
    // what PLAYS, and on new constructions where none should happen.
    for (const a of audioCreated) a.playing = false;
    const constructedBefore = audioCreated.length;
    assert.equal(appRoot().querySelector('.cb-sound-toggle'), null, 'no sound plays on the picker — no mute control needed there');

    const elBtn = appRoot().querySelectorAll('button').find((b) => b.getAttribute('data-el') === 'fire');
    elBtn.dispatch('click');
    assert.equal(audioCreated.length, constructedBefore, 'picking an element constructs nothing new');
    assert.ok(audioCreated.every((a) => !a.playing), 'picking an element plays nothing');
    const summonBtn = appRoot().querySelectorAll('button').find((b) => renderedText(b).startsWith('Summon ('));
    summonBtn.dispatch('click');

    const intro = audioCreated.find((a) => a.src.includes('fight-intro.wav'));
    const loop = audioCreated.find((a) => a.src.includes('fight-loop.wav'));
    assert.ok(intro && intro.playing, 'the summon audio starts WITH the ceremony (the arming tap was the press itself)');
    assert.ok(loop && loop.playing, 'the bed carries through the ceremony');

    // R78a: a mute control visible wherever sound plays — here, now.
    const toggle = appRoot().querySelector('.cb-sound-toggle');
    assert.ok(toggle, 'the mute control is on the ceremony screen');
    assert.ok(renderedText(toggle).includes('SOUND ON'), 'and reads as ON');
    toggle.dispatch('click');
    assert.equal(loop.playing, false, 'muting from the ceremony stops the bed');
    assert.equal(sound.isSoundEnabled(), false);
    sound.setSoundEnabled(true);

    // let the (degraded, failing-fetch) ceremony resolve its reveal before
    // the fake DOM comes down, so no continuation runs against a dead document
    await waitFor(() => appRoot().querySelectorAll('button').some((b) => renderedText(b) === 'Continue'));
  } finally {
    uninstallFakeDom();
  }
});

// ---- wiring (static scan; no browser in this harness) ----------------------

test('CB-BUILD-016/R78a (wiring): app.js installs the first-tap arming hook; the duel screen still renders its own mute control; the summon screen starts the ceremony audio', async () => {
  const appSrc = await read('ui/app.js');
  assert.ok(/installFirstTapArming\(\)/.test(appSrc), 'app.js arms on the first tap anywhere');
  const soundSrc = await read('ui/components/battle/sound.js');
  assert.ok(/pointerdown/.test(soundSrc), 'the arming gesture is pointerdown (the earliest tap event)');
  assert.ok(/keydown/.test(soundSrc), 'f5 advisory: keydown arms too (keyboard/AT users)');
  const duelSrc = await read('ui/screens/duel.js');
  assert.ok(/cb-sound-toggle/.test(duelSrc), 'the duel screen keeps its visible mute control (unregressed)');
  const summonSrc = await read('ui/screens/summon.js');
  assert.ok(/playSummonCeremony\(\)/.test(summonSrc), 'the summon screen starts the audio with the ceremony');
  assert.ok(/soundToggleButton\(\)/.test(summonSrc), 'the summon ceremony screen renders the mute control');
});
