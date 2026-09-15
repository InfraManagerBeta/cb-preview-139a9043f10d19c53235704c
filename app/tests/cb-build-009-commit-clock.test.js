// app/tests/cb-build-009-commit-clock.test.js
// CB-BUILD-009 (R81): promote the commit clock to a prominent, persistent
// countdown -- pinned in view for the whole selection, large enough to
// read at a glance, shifting to the danger color as it nears zero (~under
// 10s) -- never a small data span. A one-line statement of the auto-commit
// rule is visible before the clock runs low. Auto-commit keeps the
// player's own selections; only unpicked rounds fill uniform-random.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { elementIndex } from '../engine/duel.js';
import { isClockDanger, computeAutoCommitMoves, COMMIT_CLOCK_DANGER_MS } from '../ui/screens/duel.js';

const duelSrc = fs.readFileSync(path.join(process.cwd(), 'app/ui/screens/duel.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(process.cwd(), 'app/styles/base.css'), 'utf8');

// ---- real behavior: the auto-commit merge rule (no DOM needed) -----------

test('CB-BUILD-009: computeAutoCommitMoves keeps every already-picked round exactly as chosen', () => {
  const moves = ['fire', null, 'water', null, 'air'];
  const merged = computeAutoCommitMoves(moves, elementIndex, () => 0); // random() => 0 for determinism
  assert.equal(merged[0], elementIndex('fire'));
  assert.equal(merged[2], elementIndex('water'));
  assert.equal(merged[4], elementIndex('air'));
});

test('CB-BUILD-009: computeAutoCommitMoves fills ONLY the unpicked (null) rounds, uniform-random over [0,3)', () => {
  const moves = [null, 'water', null, null, 'fire'];
  const merged = computeAutoCommitMoves(moves, elementIndex, () => 0.99); // random() close to 1 -> index 2
  assert.equal(merged[0], 2);
  assert.equal(merged[2], 2);
  assert.equal(merged[3], 2);
  // the picked rounds are untouched by the random fill
  assert.equal(merged[1], elementIndex('water'));
  assert.equal(merged[4], elementIndex('fire'));
});

test('CB-BUILD-009: computeAutoCommitMoves is a full pass-through when every round was already picked (a fully-manual commit is unaffected)', () => {
  const moves = ['fire', 'water', 'air', 'fire', 'water'];
  const merged = computeAutoCommitMoves(moves, elementIndex, () => { throw new Error('random must not be called when nothing is null'); });
  assert.deepEqual(merged, moves.map(elementIndex));
});

test('CB-BUILD-009: isClockDanger flips exactly at the ~10s threshold', () => {
  assert.equal(COMMIT_CLOCK_DANGER_MS, 10000);
  assert.equal(isClockDanger(10001), false);
  assert.equal(isClockDanger(10000), true);
  assert.equal(isClockDanger(9999), true);
  assert.equal(isClockDanger(0), true);
});

// ---- wiring: the screen actually uses these, and the clock is never a ----
// ---- small data span --------------------------------------------------

test('CB-BUILD-009: the commit screen no longer renders the clock as a small `cb-timer cb-data` span', () => {
  const buildBody = duelSrc.slice(duelSrc.indexOf('function buildCommitScreen'), duelSrc.indexOf('function updateClockDisplay'));
  assert.ok(!/class:\s*'cb-timer cb-data'/.test(buildBody), 'expected the commit clock to no longer use the small cb-timer/cb-data span');
  assert.ok(/class:\s*'cb-commit-clock'/.test(buildBody) || /cb-commit-clock/.test(buildBody), 'expected the commit clock to use the new prominent cb-commit-clock class');
});

test('CB-BUILD-009: the commit clock is pinned via the sticky cb-commit-topbar wrapper', () => {
  assert.ok(duelSrc.includes("class: 'cb-topbar cb-commit-topbar'"), 'expected the commit screen\'s topbar to carry the sticky modifier class');
  const rule = cssSrc.match(/\.cb-commit-topbar\s*\{[^}]+\}/s);
  assert.ok(rule, 'expected a .cb-commit-topbar rule in base.css');
  assert.ok(/position:\s*sticky/.test(rule[0]), 'expected the commit topbar to be pinned via position: sticky');
  assert.ok(/top:\s*0/.test(rule[0]), 'expected the sticky topbar to pin to the top of its scroll container');
});

test('CB-BUILD-009: .cb-commit-clock renders large (display face, far bigger than the old 13px data span) and shifts to the danger color', () => {
  const clockRule = cssSrc.match(/\.cb-commit-clock\s*\{[^}]+\}/s);
  assert.ok(clockRule, 'expected a .cb-commit-clock rule in base.css');
  const fontSizeMatch = clockRule[0].match(/font-size:\s*(\d+)px/);
  assert.ok(fontSizeMatch && Number(fontSizeMatch[1]) >= 28, 'expected the commit clock to render large enough to read at a glance (>=28px)');
  assert.ok(/var\(--font-display\)/.test(clockRule[0]), 'expected the commit clock to use the display face');

  const dangerRule = cssSrc.match(/\.cb-commit-clock\.danger\s*\{[^}]+\}/s);
  assert.ok(dangerRule, 'expected a .cb-commit-clock.danger rule in base.css');
  assert.ok(/var\(--cb-red\)/.test(dangerRule[0]), 'expected the danger state to use the loss/danger red');
});

test('CB-BUILD-009: applyClockDangerState toggles the danger class as the clock nears zero, and updateClockDisplay re-applies it every tick', () => {
  assert.ok(duelSrc.includes('function applyClockDangerState('), 'expected an applyClockDangerState helper');
  assert.ok(/isClockDanger\(remainingMs\)/.test(duelSrc), 'expected applyClockDangerState (or its caller) to use the shared isClockDanger predicate');
  const updateClockBody = duelSrc.slice(duelSrc.indexOf('function updateClockDisplay'), duelSrc.indexOf('function applyClockDangerState'));
  assert.ok(updateClockBody.includes('applyClockDangerState('), 'expected updateClockDisplay (the per-tick update) to re-apply the danger state');
});

test('CB-BUILD-009: a one-line auto-commit explainer is rendered in the prose face, unconditionally (visible before the clock ever runs low)', () => {
  const buildBody = duelSrc.slice(duelSrc.indexOf('function buildCommitScreen'), duelSrc.indexOf('function updateClockDisplay'));
  assert.ok(/el\('p',\s*\{\s*class:\s*'cb-prose[^']*'/.test(buildBody), 'expected the explainer paragraph to use the .cb-prose class (R11: prose face for every sentence a player reads)');
  assert.ok(/locked in/.test(buildBody) && /random/.test(buildBody) && /hesitated/i.test(buildBody), 'expected the explainer to state: own picks kept, unpicked rounds random, duel flagged hesitated');
});

test('CB-BUILD-009: tick() drives auto-commit through computeAutoCommitMoves, not a blind full-random fill', () => {
  const tickBody = duelSrc.slice(duelSrc.indexOf('function tick()'), duelSrc.indexOf('buildCommitScreen();\n  timerHandle'));
  assert.ok(tickBody.includes('computeAutoCommitMoves(moves, elementIndex)'), 'expected tick() to merge the in-progress moves via computeAutoCommitMoves');
  assert.ok(!/sync\.autoCommitHesitated\(/.test(tickBody), 'expected tick() to no longer CALL sync.autoCommitHesitated (which discarded in-progress picks)');
});
