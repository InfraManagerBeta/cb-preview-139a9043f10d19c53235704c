// app/tests/rig-timing.test.js — CB-BUILD-005/006, AC1 timing row (app-side
// teeth; the parity harness in tools/parity re-measures the same constants
// against rendered output): the runtime's animation sources ARE the
// reference's — 30fps, 1720×1400, the reference's own per-state clip
// lengths — played unmodified inside the verified presentation timeline
// (R75 ordering, O9 cadence, <45s ceiling: presentation-timeline.test.js
// keeps guarding those; nothing here re-times the timeline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RIG_ASSETS = path.resolve(__dirname, '..', '..', 'assets', 'rig');

// The reference library's per-state clip lengths in frames at 30fps —
// constant across every combo the harness sampled (and across all three
// vendored elements, asserted below).
const REFERENCE_FRAMES = {
  idle: 34, charge: 42, chargeloop: 18, attack: 32, hit: 60,
  reset: 60, cancel: 60, win: 112, lose: 112, draw: 112,
};

test('every vendored shape set carries the reference constants: 30fps, 1720x1400, the reference per-state clip lengths', async () => {
  for (const element of ['FIRE', 'WATER', 'WIND']) {
    for (const [state, frames] of Object.entries(REFERENCE_FRAMES)) {
      const j = JSON.parse(await fs.readFile(path.join(RIG_ASSETS, 'fallback', element, `${state}.json`), 'utf8'));
      assert.equal(j.fr, 30, `${element}/${state}: fps`);
      assert.equal(j.w, 1720, `${element}/${state}: width`);
      assert.equal(j.h, 1400, `${element}/${state}: height`);
      assert.equal(j.op - j.ip, frames, `${element}/${state}: clip length (frames)`);
      assert.equal(j.v, '5.5.2', `${element}/${state}: the library's Lottie version`);
    }
  }
});

test('the affinity-cape FX overlays are reference-timed too (30fps, full frame)', async () => {
  for (const element of ['FIRE', 'WATER', 'WIND']) {
    for (const kind of ['win', 'lose']) {
      const j = JSON.parse(await fs.readFile(path.join(RIG_ASSETS, 'fx', `affinitycape${kind}-${element}.json`), 'utf8'));
      assert.equal(j.fr, 30, `${element}/${kind}: fps`);
      assert.equal(j.w, 1720, `${element}/${kind}: width`);
      assert.equal(j.h, 1400, `${element}/${kind}: height`);
      assert.ok(j.op - j.ip > 0, `${element}/${kind}: non-empty`);
    }
  }
});

test('the stage plays clips at their native rate (no setSpeed / no fps override) and maps timeline states to reference clips', async () => {
  const src = await fs.readFile(path.resolve(__dirname, '..', 'ui', 'components', 'battle', 'rigStage.js'), 'utf8');
  assert.ok(!/setSpeed\(/.test(src), 'no playback-rate tampering');
  assert.ok(!/\bfr\s*[:=]/.test(src), 'no fps override');
  // the reference DuelPlayer semantics: winner plays RESET, loser plays HIT
  assert.ok(/hitSuccess:\s*'reset'/.test(src), 'hitSuccess maps to the reference winner clip (reset)');
  assert.ok(/battleIdle:\s*'idle'/.test(src), 'battleIdle maps to the idle clip');
  assert.ok(/chargeLoop:\s*'chargeloop'/.test(src), 'chargeLoop maps to the looping charge clip');
  // loop policy per the reference: idle + chargeLoop loop, the rest hold
  assert.ok(/LOOP_CLIPS = new Set\(\['idle', 'chargeloop'\]\)/.test(src), 'reference loop policy');
});
