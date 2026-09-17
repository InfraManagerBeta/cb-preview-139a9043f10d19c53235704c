// app/tests/sound-bed-duck.test.js — Round-3 fix g2 (advisory, R78a "the bed
// as the 2019 client played it"): the reference's onDuelPlayerRoundStart does
// THREE things (assets/cw/reference/DuelPlayer/soundManager.js:117,131,136):
// stop('fightLoop'), start the round sample, and — if not the final round —
// restart('fightLoop') at +2.2s alongside the next voice at +3.6s. Fix round
// f5 ported only the voice: the bed no longer DUCKED under the round beat.
// These tests drive the real sound module on node:test's mock clock and
// assert all three siblings now fire on the reference's own offsets — and
// that the resume timer can never violate the A3 guarantee (stopAll cancels
// it; a mute landing inside the window silences it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStorage } from '../engine/ledger.js';
import { resetOverrides } from '../engine/overrides.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

// A counting Audio fake (same shape as sound-round-voices.test.js's).
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

function bed() {
  return audioCreated.find((a) => a.src.includes('fight-loop.wav')) || null;
}
function beat(n) {
  return audioCreated.find((a) => a.src.includes(`fight-round-${n}.wav`)) || null;
}

function armAndReset() {
  resetOverrides();
  sound.armSound();
  sound.setSoundEnabled(true);
  sound.stopAll(); // also cancels any voice/bed timer a previous test left pending
  for (const a of audioCreated) a.playing = false;
}

// ---- the offset is the reference's own, not invented -------------------------

test('g2 advisory: the duck-resume offset is read from the 2019 reference (soundManager.js:117 stop, :131 restart at +2.2s)', async () => {
  const ref = await fs.readFile(path.join(APP_ROOT, '../assets/cw/reference/DuelPlayer/soundManager.js'), 'utf8');
  assert.match(ref, /this\.stop\('fightLoop'\);/, 'the reference stops the bed on every round start');
  assert.match(ref, /scheduleOnceIn\(2\.2, \(\) => this\.restart\('fightLoop'\)\)/, 'the reference restarts the bed at +2.2s on each non-final round start');
  assert.equal(sound.BED_RESTART_ON_ROUND_START_DELAY_MS, 2200, 'the modern resume offset matches the reference');
});

// ---- the duck: stop under the beat, resume at +2.2s --------------------------

test('g2 advisory: each non-final round beat DUCKS the bed (stops it with the beat, resumes it exactly at +2.2s)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armAndReset();
  sound.playLoop();
  assert.ok(bed() && bed().playing, 'precondition: the bed is sounding');
  for (let n = 1; n <= 4; n++) {
    sound.playRoundBeat(n);
    assert.equal(bed().playing, false, `round ${n}: the bed stopped under the beat (reference :117)`);
    assert.ok(beat(n) && beat(n).playing, `round ${n}: the round sample is playing`);
    t.mock.timers.tick(2199);
    assert.equal(bed().playing, false, `round ${n}: the bed has not resumed at +2199ms`);
    t.mock.timers.tick(1);
    assert.equal(bed().playing, true, `round ${n}: the bed resumed exactly at +2200ms (reference :131)`);
    t.mock.timers.tick(10_000); // drain the +3.6s voice timer before the next beat
    for (const a of audioCreated) { if (!a.src.includes('fight-loop.wav')) a.playing = false; }
  }
});

test('g2 advisory: the FINAL round beat stops the bed and schedules NO resume (reference: `if (round !== 4)` guards both siblings off)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armAndReset();
  sound.playLoop();
  sound.playRoundBeat(5);
  assert.equal(bed().playing, false, 'the bed stopped under the final beat');
  t.mock.timers.tick(60_000);
  assert.equal(bed().playing, false, 'no resume ever fires after the final round (the result card\'s carryBed() is the resume)');
});

test('g2 advisory: carryBed() reaching the result card DURING the duck window resumes the bed at once; the later resume timer leaves it alone (no restart-from-the-top blip)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armAndReset();
  sound.playLoop();
  sound.playRoundBeat(2);
  assert.equal(bed().playing, false, 'ducked');
  sound.stopAllExceptBed(); // the skip/carry path: one-shots and voices cut, the BED lifecycle (incl. its pending resume) is left alone
  sound.carryBed(); // the result card mounts inside the +2.2s window
  assert.equal(bed().playing, true, 'carryBed resumed the bed immediately');
  bed().currentTime = 42; // sentinel: a reset would zero this
  t.mock.timers.tick(10_000);
  assert.equal(bed().playing, true, 'still sounding after the resume timer fired');
  assert.equal(bed().currentTime, 42, 'the resume timer did NOT reset an already-sounding bed');
});

// ---- the resume timer can never violate the A3 guarantee ---------------------

test('g2 advisory (A3): stopAll() inside the duck window cancels the pending resume — leaving the bracket (or the kill-switch stop banner) mid-duck stays SILENT', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armAndReset();
  sound.playLoop();
  sound.playRoundBeat(1);
  assert.equal(bed().playing, false, 'ducked');
  sound.releaseAudioForRoute('lobby-entry'); // a non-bracket route → stopAll()
  t.mock.timers.tick(60_000);
  assert.equal(bed().playing, false, 'the pending resume never fired after a full stop');
  assert.ok(audioCreated.every((a) => !a.playing), 'nothing sounds at all');
});

test('g2 advisory (A3): a mute landing inside the duck window silences the pending resume; un-muting later does not resurrect it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armAndReset();
  sound.playLoop();
  sound.playRoundBeat(3);
  t.mock.timers.tick(1000);
  sound.setSoundEnabled(false); // the mute control's own action — stopAll() inside cancels the resume
  sound.setSoundEnabled(true);
  t.mock.timers.tick(60_000);
  assert.equal(bed().playing, false, 'the muted resume never fires, even after un-muting');
});

test('g2 advisory: a beat played out muted ducks nothing and schedules nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armAndReset();
  sound.setSoundEnabled(false);
  sound.playRoundBeat(2);
  t.mock.timers.tick(60_000);
  assert.ok(audioCreated.every((a) => !a.playing), 'nothing plays while muted');
  sound.setSoundEnabled(true);
});
