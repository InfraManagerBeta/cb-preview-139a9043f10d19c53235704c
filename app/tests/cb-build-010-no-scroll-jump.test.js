// app/tests/cb-build-010-no-scroll-jump.test.js
// CB-BUILD-010 (§12/R83): a move tap must mutate ONLY the tapped round's
// three buttons (toggling `selected`) and the seal button's disabled
// state IN PLACE -- it must stop calling buildCommitScreen() (a full
// mountScreen() remount, which resets scroll via window.scrollTo(0,0)) on
// a selection. The A17 fix already did this for the timer; this extends
// the same approach to move selection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyRoundSelectionClasses, isSealDisabled } from '../ui/screens/duel.js';

const duelSrc = fs.readFileSync(path.join(process.cwd(), 'app/ui/screens/duel.js'), 'utf8');

// ---- real behavior: the in-place DOM mutation helpers (fakes, no real ----
// ---- DOM/document required) ----------------------------------------------

function fakeButton() {
  const classes = new Set();
  return {
    classes,
    classList: {
      toggle(name, cond) {
        if (cond === undefined ? !classes.has(name) : cond) classes.add(name);
        else classes.delete(name);
      },
    },
  };
}

test('CB-BUILD-010: applyRoundSelectionClasses marks ONLY the chosen element button as selected, un-selecting the other two in the SAME round', () => {
  const round = { fire: fakeButton(), water: fakeButton(), air: fakeButton() };
  applyRoundSelectionClasses(round, ['fire', 'water', 'air'], 'water');
  assert.equal(round.fire.classes.has('selected'), false);
  assert.equal(round.water.classes.has('selected'), true);
  assert.equal(round.air.classes.has('selected'), false);

  // Re-selecting a different element in the SAME round flips the selection
  // (toggle, not merely add) -- exactly one button carries `selected`.
  applyRoundSelectionClasses(round, ['fire', 'water', 'air'], 'fire');
  assert.equal(round.fire.classes.has('selected'), true);
  assert.equal(round.water.classes.has('selected'), false);
  assert.equal(round.air.classes.has('selected'), false);
});

test('CB-BUILD-010: applyRoundSelectionClasses never touches a button object outside the round map it was given', () => {
  const roundA = { fire: fakeButton(), water: fakeButton(), air: fakeButton() };
  const roundB = { fire: fakeButton(), water: fakeButton(), air: fakeButton() };
  applyRoundSelectionClasses(roundA, ['fire', 'water', 'air'], 'air');
  assert.equal(roundA.air.classes.has('selected'), true);
  // roundB is an entirely separate object graph -- untouched.
  assert.equal(roundB.fire.classes.has('selected'), false);
  assert.equal(roundB.water.classes.has('selected'), false);
  assert.equal(roundB.air.classes.has('selected'), false);
});

test('CB-BUILD-010: isSealDisabled is true while any round is unpicked, false once all five are picked', () => {
  assert.equal(isSealDisabled([null, null, null, null, null]), true);
  assert.equal(isSealDisabled(['fire', 'water', 'air', 'fire', null]), true);
  assert.equal(isSealDisabled(['fire', 'water', 'air', 'fire', 'water']), false);
});

// ---- wiring: the screen actually uses in-place mutation on a tap, not a --
// ---- rebuild --------------------------------------------------------------

test('CB-BUILD-010: a move-button tap calls selectMove(), not buildCommitScreen()', () => {
  const buildBody = duelSrc.slice(duelSrc.indexOf('function buildCommitScreen'), duelSrc.indexOf('function selectMove'));
  assert.ok(/onClick:\s*\(\)\s*=>\s*selectMove\(i,\s*elName\)/.test(buildBody), 'expected the per-round element buttons to call selectMove(i, elName) on tap');
  assert.ok(!/moves\[i\] = elName; buildCommitScreen\(\)/.test(buildBody), 'expected the old inline "set + full rebuild" onClick to be gone');
});

test('CB-BUILD-010: selectMove() itself never calls buildCommitScreen() or mountScreen() (no remount, so no scroll reset)', () => {
  const selectMoveBody = duelSrc.slice(duelSrc.indexOf('function selectMove'), duelSrc.indexOf('function updateSealButtonState'));
  assert.ok(!/buildCommitScreen\(\)/.test(selectMoveBody), 'expected selectMove() to never call buildCommitScreen()');
  assert.ok(!/mountScreen\(/.test(selectMoveBody), 'expected selectMove() to never call mountScreen() directly either');
  assert.ok(selectMoveBody.includes('applyRoundSelectionClasses('), 'expected selectMove() to mutate the tapped round\'s buttons via applyRoundSelectionClasses');
  assert.ok(selectMoveBody.includes('updateSealButtonState()'), 'expected selectMove() to refresh the seal button\'s disabled state in place');
});

test('CB-BUILD-010: updateSealButtonState() mutates the existing seal button node in place (setAttribute/removeAttribute), not a rebuild', () => {
  const body = duelSrc.slice(duelSrc.indexOf('function updateSealButtonState'), duelSrc.indexOf('function updateSealButtonState') + 400);
  assert.ok(/sealButtonNode\.setAttribute\('aria-disabled', 'true'\)/.test(body), 'expected updateSealButtonState to setAttribute on the kept seal button node');
  assert.ok(/sealButtonNode\.removeAttribute\('aria-disabled'\)/.test(body), 'expected updateSealButtonState to removeAttribute when re-enabled');
  assert.ok(!/buildCommitScreen\(\)/.test(body), 'expected no rebuild inside updateSealButtonState');
});

test('CB-BUILD-010: buildCommitScreen() keeps persistent per-round button references (roundButtonRefs) and the seal button reference (sealButtonNode) for later in-place mutation', () => {
  assert.ok(duelSrc.includes('let roundButtonRefs = [];'), 'expected an outer roundButtonRefs array declared once per mount');
  assert.ok(duelSrc.includes('let sealButtonNode = null;'), 'expected an outer sealButtonNode reference declared once per mount');
  const buildBody = duelSrc.slice(duelSrc.indexOf('function buildCommitScreen'), duelSrc.indexOf('function selectMove'));
  assert.ok(/roundButtonRefs\[i\]\[elName\] = btn;/.test(buildBody), 'expected each round\'s button to be stored in roundButtonRefs[i][elName] as it is built');
  assert.ok(/sealButtonNode = el\('button'/.test(buildBody), 'expected the seal button node itself to be captured into sealButtonNode at build time');
});

test('CB-BUILD-010 (control, mirrors the A17 test convention): buildCommitScreen is still called exactly once per mount/auto-commit path, never from inside a move tap', () => {
  // Count every buildCommitScreen() CALL site (not the function's own
  // declaration, and not a comment mentioning it) across the whole file --
  // there should be exactly one, the trailing kick-off call at the bottom
  // of mountDuel().
  const codeOnly = duelSrc.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  const callSites = (codeOnly.match(/(?<!function )buildCommitScreen\(\)/g) || []).length;
  assert.equal(callSites, 1, `expected exactly one buildCommitScreen() CALL (the initial mount kick-off), found ${callSites}`);
});
