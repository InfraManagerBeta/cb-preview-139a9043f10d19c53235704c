// app/tests/commit-clock-autocommit.test.js — CB-BUILD-009r/R81: the owner
// reversed the round-1 preserve-partial rule on 2026-09-15. A missed clock
// now auto-commits a uniform-random FIVE-move sequence -- the WHOLE hand,
// including any rounds the player already picked -- flagged "hesitated" and
// excluded from staked-duel metrics (R42). The duel proceeds without the
// player and earns nothing in their favour.
//
// The commit window's countdown must still be a prominent, persistent,
// pinned clock that shifts to the danger color as it nears zero, with a
// one-line statement (shown before the clock ever runs low) of what
// auto-commit does at zero -- now updated to say all five are random.
// Static source scan over duel.js (no DOM available in this harness) plus a
// real end-to-end check of engine/sync.js's autoCommitHesitated, which is
// where the actual fill logic lives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sync from '../engine/sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

// ---- the reverted rule: the WHOLE hand is randomized, every time ----------

test('CB-BUILD-009r/R81: a missed clock auto-commits a uniform-random FIVE-move hand, consuming randomness for every round, no picked-moves parameter accepted', () => {
  const window_ = sync.createCommitWindow({ timers: { commitWindowSec: { default: 60 } } }, 0);
  window_.deadline = 0; // already expired
  let calls = 0;
  const rng = () => { calls++; return 0; };
  const result = sync.autoCommitHesitated(window_, 0, 1000, rng);
  assert.equal(calls, 5, 'expected all 5 rounds to consume randomness -- there is no picked-moves parameter to seed partial survival');
  assert.deepEqual(result.moves, [0, 0, 0, 0, 0]);
  assert.equal(result.hesitated, true, 'flagged hesitated -- R42: excluded from staked-duel metrics');
});

test('CB-BUILD-009r/R81: even a FULLY-picked set of moves (a genuine race between the last button press and the tick) is discarded entirely and re-rolled at random -- the round-1 preserve-partial behaviour is reverted', () => {
  const window_ = sync.createCommitWindow({ timers: { commitWindowSec: { default: 60 } } }, 0);
  window_.deadline = 0;
  let calls = 0;
  const rng = () => { calls++; return 0.99; }; // would produce index 2 every time if consulted
  // sync.autoCommitHesitated no longer accepts a picked-moves argument at
  // all (CB-BUILD-009r drops it) -- calling with the pre-revert 5-arg shape
  // must not seed anything; the 5th positional argument is simply ignored
  // because the parameter no longer exists.
  const result = sync.autoCommitHesitated(window_, 0, 1000, rng, [0, 1, 2, 0, 1]);
  assert.deepEqual(result.moves, [2, 2, 2, 2, 2], 'expected every round re-rolled, none of the "picked" values surviving');
  assert.equal(calls, 5, 'expected randomness consulted for every round, including ones a 5th argument tried to pre-seed');
});

test('CB-BUILD-009r/R81: autoCommitHesitated\'s function signature no longer names a picked-indices parameter', async () => {
  const src = await read('engine/sync.js');
  const sig = src.slice(src.indexOf('export function autoCommitHesitated'), src.indexOf('export function autoCommitHesitated') + 200);
  assert.ok(/autoCommitHesitated\(window, seatId, now, random = Math\.random\)/.test(sig), 'expected the restored, untouched full-random signature (no pickedElementIndices parameter)');
});

// ---- duel.js: no merge helper, no picked-indices passed in -----------------

test('CB-BUILD-009r/R81: duel.js\'s tick() calls autoCommitHesitated WITHOUT computing or passing picked-element indices (the merge helper foreman added is gone)', async () => {
  const src = await read('ui/screens/duel.js');
  const tickBody = src.slice(src.indexOf('function tick()'), src.indexOf('buildCommitScreen();\n  timerHandle'));
  assert.ok(!/pickedElementIndices/.test(tickBody), 'expected the picked-element-indices computation to be gone from tick()');
  assert.ok(/sync\.autoCommitHesitated\(window_, humanSeatIndex, Date\.now\(\), Math\.random\)/.test(tickBody), 'expected autoCommitHesitated called with no picked-moves argument');
});

// ---- structural scan: the clock/copy still exist, updated for R81 ---------

test('CB-BUILD-009r/R81: the commit clock is a prominent, pinned element (not the old small inline cb-timer span) -- scoped to the commit screen; the separate intermission countdown (R81\'s different 20-30s window) is untouched', async () => {
  const src = await read('ui/screens/duel.js');
  const buildCommitBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('function updateClockDisplay'));
  assert.ok(!/cb-timer cb-data/.test(buildCommitBody), 'expected the old small cb-timer span to be gone from the commit screen');
  assert.ok(/cb-commit-clock/.test(buildCommitBody), 'expected the new prominent commit-clock class in the commit screen');
});

test('CB-BUILD-009r/R81: the clock shifts to a "danger" class as it nears zero, both on initial build and on every tick', async () => {
  const src = await read('ui/screens/duel.js');
  assert.ok(/COMMIT_CLOCK_DANGER_MS/.test(src), 'expected a named danger threshold constant');
  assert.ok(/remainingMs <= COMMIT_CLOCK_DANGER_MS/.test(src), 'expected buildCommitScreen to apply the danger class based on the threshold');
  const updateClockBody = src.slice(src.indexOf('function updateClockDisplay'), src.indexOf('function updateClockDisplay') + 400);
  assert.ok(/classList\.toggle\('danger'/.test(updateClockBody), 'expected updateClockDisplay to toggle the danger class every tick too');
});

test('CB-BUILD-009r/R81: the on-screen rule statement now says all five moves are chosen at random at zero, including any already picked -- NOT that picks survive', async () => {
  const src = await read('ui/screens/duel.js');
  const buildBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('function updateClockDisplay'));
  assert.ok(/all five moves are chosen at random/i.test(buildBody), 'expected the reverted-rule copy: all five moves chosen at random');
  assert.ok(/already.{0,6}picked/i.test(buildBody), 'expected the copy to state that even already-picked rounds are re-rolled');
  assert.ok(/hesitated/i.test(buildBody), 'expected the explanatory line to still name the "hesitated" flag');
  assert.ok(!/for that round only/i.test(buildBody), 'expected the superseded "only that round" (preserve-partial) copy to be gone');
  assert.ok(!/your own picks stay exactly as chosen/i.test(buildBody), 'expected the superseded preserve-partial copy to be gone');
});

test('CB-BUILD-009: the commit-clock CSS defines a pinned/sticky element with a distinct danger color', async () => {
  const css = await read('styles/base.css');
  assert.ok(/\.cb-commit-clock\s*\{[^}]*position:\s*sticky/s.test(css), 'expected .cb-commit-clock to be pinned (position: sticky)');
  assert.ok(/\.cb-commit-clock\.danger\s*\{[^}]*color:\s*var\(--cb-red\)/s.test(css), 'expected .cb-commit-clock.danger to shift to the danger (red) color');
});
