// app/tests/sound-round-voices.test.js — fix round f5, FINDING 2 (R78a/R78):
// `voice-round-1…5.wav` ship in the §18 bundle and the 2019 reference plays
// them — voiceRound0 at +2.2s on player-ready
// (assets/cw/reference/DuelPlayer/soundManager.js:112) and voiceRound{round+1}
// at +3.6s on each non-final round start (:136). Before this fix the modern
// app never played any of the five (grep "voice-round|voiceRound" app/ → 0
// hits): R78 says the modern engine "may never fall short" of the in-repo
// reference. These tests drive the REAL sound module on node:test's mock
// clock and assert each voice fires exactly once, on the reference's own
// trigger, at the reference's own offset — and that muting silences them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStorage } from '../engine/ledger.js';
import { resetOverrides } from '../engine/overrides.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

// A counting Audio fake (same shape as sound-arming.test.js's, plus the
// real element's `paused` property so carryBed's already-sounding check is
// exercised against the property real browsers expose).
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

function playsOf(name) {
  return audioCreated.filter((a) => a.src.includes(name) && a.playing);
}

function armAndReset() {
  resetOverrides();
  sound.armSound();
  sound.setSoundEnabled(true);
  sound.stopAll(); // also cancels any voice timer a previous test left pending
  for (const a of audioCreated) a.playing = false;
}

// ---- the offsets are the reference's own, not invented ----------------------

test('f5/FINDING 2: the voice offsets are read from the 2019 reference (soundManager.js:112 +2.2s on ready, :136 +3.6s on round start)', async () => {
  const ref = await read('../assets/cw/reference/DuelPlayer/soundManager.js');
  assert.match(ref, /scheduleOnceIn\(2\.2, \(\) => this\.start\('voiceRound0'\)\)/, 'the reference plays voiceRound0 at +2.2s on player-ready');
  assert.match(ref, /scheduleOnceIn\(3\.6, \(\) => this\.start\(`voiceRound\$\{round \+ 1\}`\)\)/, 'the reference plays the next round voice at +3.6s on each round start');
  assert.equal(sound.VOICE_ON_READY_DELAY_MS, 2200, 'the modern ready-voice offset matches the reference');
  assert.equal(sound.VOICE_ON_ROUND_START_DELAY_MS, 3600, 'the modern round-voice offset matches the reference');
});

// ---- the ready beat: voice-round-1 at +2.2s ---------------------------------

test('f5/FINDING 2: player-ready schedules voice-round-1 at +2.2s — not before, exactly once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armAndReset();
  sound.scheduleDuelReadyVoice();
  assert.equal(playsOf('voice-round-1.wav').length, 0, 'nothing plays at +0ms');
  t.mock.timers.tick(2199);
  assert.equal(playsOf('voice-round-1.wav').length, 0, 'nothing plays at +2199ms');
  t.mock.timers.tick(1);
  assert.equal(playsOf('voice-round-1.wav').length, 1, 'voice-round-1 fires exactly at +2200ms');
  t.mock.timers.tick(10_000);
  assert.equal(audioCreated.filter((a) => a.src.includes('voice-round-1.wav')).length, 1, 'one cached element — the voice fired once, no repeat');
});

// ---- each round beat schedules the NEXT round's voice at +3.6s --------------

test('f5/FINDING 2: round beats 1–4 each schedule the NEXT round\'s voice at +3.6s (the reference "looks one round ahead"); round 5 schedules none', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armAndReset();
  for (let n = 1; n <= 4; n++) {
    sound.playRoundBeat(n);
    assert.equal(playsOf(`voice-round-${n + 1}.wav`).length, 0, `round ${n}: the next voice has not fired at +0ms`);
    t.mock.timers.tick(3599);
    assert.equal(playsOf(`voice-round-${n + 1}.wav`).length, 0, `round ${n}: the next voice has not fired at +3599ms`);
    t.mock.timers.tick(1);
    assert.equal(playsOf(`voice-round-${n + 1}.wav`).length, 1, `round ${n}: voice-round-${n + 1} fires exactly at +3600ms`);
    for (const a of audioCreated) a.playing = false;
  }
  sound.playRoundBeat(5); // the final round — reference: `if (round !== 4)` guards the schedule off
  t.mock.timers.tick(60_000);
  assert.equal(audioCreated.filter((a) => a.src.startsWith === undefined && a.src.includes('voice-round-6')).length, 0, 'no sixth voice exists');
  assert.ok(audioCreated.every((a) => !a.playing || !a.src.includes('voice-round-')), 'the final round schedules no further voice');
});

test('f5/FINDING 2: a full duel plays each of the five voices exactly once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armAndReset();
  const fired = [];
  // ready, then the five round beats spaced out like a real reveal
  sound.scheduleDuelReadyVoice();
  for (let n = 1; n <= 5; n++) {
    t.mock.timers.tick(6000);
    for (const a of audioCreated) { if (a.playing && /voice-round-\d\.wav/.test(a.src)) { fired.push(a.src.match(/voice-round-(\d)\.wav/)[1]); a.playing = false; } }
    sound.playRoundBeat(n);
  }
  t.mock.timers.tick(6000);
  for (const a of audioCreated) { if (a.playing && /voice-round-\d\.wav/.test(a.src)) { fired.push(a.src.match(/voice-round-(\d)\.wav/)[1]); a.playing = false; } }
  assert.deepEqual(fired, ['1', '2', '3', '4', '5'], 'voice-round-1…5 each fired exactly once, in order');
});

// ---- muting silences the voices --------------------------------------------

test('f5/FINDING 2: a mute landing INSIDE the scheduled window silences the pending voice (and stopAll cancels outright)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armAndReset();
  sound.scheduleDuelReadyVoice();
  t.mock.timers.tick(1000);
  sound.setSoundEnabled(false); // the mute control's own action — stopAll() inside cancels pending voices
  t.mock.timers.tick(10_000);
  assert.equal(playsOf('voice-round-1.wav').length, 0, 'the muted voice never fires');
  sound.setSoundEnabled(true);

  // and while muted, a round beat schedules nothing at all
  sound.setSoundEnabled(false);
  sound.playRoundBeat(2);
  sound.setSoundEnabled(true); // un-muting later must not resurrect a voice scheduled while muted
  t.mock.timers.tick(10_000);
  assert.equal(playsOf('voice-round-3.wav').length, 0, 'a beat played out muted schedules no voice');
});

test('f5/FINDING 2: stopAllExceptBed (the skip/teardown path) cancels pending voices but leaves the bed sounding', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armAndReset();
  sound.playLoop();
  const loop = audioCreated.find((a) => a.src.includes('fight-loop.wav'));
  assert.ok(loop && loop.playing, 'precondition: the bed is sounding');
  sound.playRoundBeat(1);
  sound.stopAllExceptBed();
  t.mock.timers.tick(10_000);
  assert.equal(playsOf('voice-round-2.wav').length, 0, 'the pending voice was cancelled');
  assert.equal(loop.playing, true, 'the bed kept sounding');
  sound.stopAll();
  assert.equal(loop.playing, false, 'stopAll still stops everything (the A3 guarantee)');
});

// ---- wiring (static scan; matches the repo's convention) --------------------

test('f5/FINDING 2 (wiring): duel.js schedules the ready voice with the reveal and the round voices ride the round beats', async () => {
  const duelSrc = await read('ui/screens/duel.js');
  assert.ok(/playIntro\(\);\s*\n\s*playLoop\(\);[\s\S]{0,400}scheduleDuelReadyVoice\(\);/.test(duelSrc), 'the reveal\'s player-ready beat schedules voice-round-1');
  const soundSrc = await read('ui/components/battle/sound.js');
  assert.ok(/if \(n !== 5\) scheduleVoice\(n \+ 1, VOICE_ON_ROUND_START_DELAY_MS\);/.test(soundSrc), 'playRoundBeat schedules the NEXT round\'s voice, except after the final round');
  assert.ok(/voice-round-\$\{n\}\.wav/.test(soundSrc), 'the §18 voice samples are addressed by their bundle names');
});
