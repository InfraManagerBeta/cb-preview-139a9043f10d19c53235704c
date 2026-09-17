// app/tests/move-tap-inplace.test.js — CB-BUILD-010/§12/R83: a move tap
// mutates only that round's three buttons + the seal button's disabled
// state, in place; no buildCommitScreen() remount on selection; scroll
// position preserved. Static source scan (no DOM available in this
// harness -- same style as the existing structural UI tests, including
// the pre-existing A2 test that checks mountScreen() call counts the same
// way).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

test('CB-BUILD-010/R83 (defect repro): a move-selection onClick no longer calls buildCommitScreen()', async () => {
  const src = await read('ui/screens/duel.js');
  const commitScreenBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('// A17: the targeted per-tick update'));
  const codeOnly = commitScreenBody.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  // The ONLY buildCommitScreen() text inside its own body should be the
  // function's own declaration line ("function buildCommitScreen()"), not
  // a recursive call from inside a button's onClick.
  const callSites = (codeOnly.match(/buildCommitScreen\(\)/g) || []).length;
  assert.equal(callSites, 1, `expected exactly one buildCommitScreen() occurrence (the declaration itself) inside its own body, found ${callSites} -- a move tap must not call it`);
});

test('CB-BUILD-010/R83: buildCommitScreen() calls mountScreen(...) exactly once (a single initial build, not once per selection)', async () => {
  const src = await read('ui/screens/duel.js');
  const commitScreenBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('// A17: the targeted per-tick update'));
  const codeOnly = commitScreenBody.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const mountScreenCalls = (codeOnly.match(/mountScreen\(/g) || []).length;
  assert.equal(mountScreenCalls, 1, `expected exactly one mountScreen( call inside buildCommitScreen, found ${mountScreenCalls}`);
});

test('CB-BUILD-010/R83: a move tap calls selectMove(i, elName), which mutates only that round\'s own button group in place', async () => {
  const src = await read('ui/screens/duel.js');
  const commitScreenBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('// A17: the targeted per-tick update'));
  assert.ok(/onClick:\s*\(\)\s*=>\s*selectMove\(i,\s*elName\)/.test(commitScreenBody), 'expected each element button\'s onClick to call selectMove(i, elName)');
  assert.ok(/function selectMove\(i, elName\)/.test(commitScreenBody), 'expected a selectMove(i, elName) function');
  const selectMoveBody = commitScreenBody.slice(commitScreenBody.indexOf('function selectMove'), commitScreenBody.indexOf('const roundCards'));
  assert.ok(/roundButtonGroups\[i\]/.test(selectMoveBody), 'expected selectMove to index into roundButtonGroups[i] -- only that round\'s own buttons');
  assert.ok(/classList\.toggle\('selected'/.test(selectMoveBody), 'expected selectMove to toggle the selected class in place, not rebuild DOM nodes');
});

test('CB-BUILD-010/R83: selectMove also mutates the seal button\'s disabled state in place (setAttribute/removeAttribute), not via a rebuild', async () => {
  const src = await read('ui/screens/duel.js');
  const commitScreenBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('// A17: the targeted per-tick update'));
  const selectMoveBody = commitScreenBody.slice(commitScreenBody.indexOf('function selectMove'), commitScreenBody.indexOf('const roundCards'));
  assert.ok(/sealButtonNode\.setAttribute\('aria-disabled', 'true'\)/.test(selectMoveBody), 'expected selectMove to set aria-disabled on the seal button in place when still gated');
  assert.ok(/sealButtonNode\.removeAttribute\('aria-disabled'\)/.test(selectMoveBody), 'expected selectMove to clear aria-disabled on the seal button in place once every round is picked');
});

test('CB-BUILD-010/R83: each round\'s button group is captured once, at build time, for later in-place mutation (roundButtonGroups populated inside the round-cards map)', async () => {
  const src = await read('ui/screens/duel.js');
  const commitScreenBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('// A17: the targeted per-tick update'));
  assert.ok(/const roundButtonGroups = \[\];/.test(commitScreenBody));
  assert.ok(/roundButtonGroups\.push\(group\);/.test(commitScreenBody));
});

test('CB-BUILD-010: the seal button node is captured (sealButtonNode) so its disabled state can be mutated without a remount, and it is the button actually mounted', async () => {
  const src = await read('ui/screens/duel.js');
  const commitScreenBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('// A17: the targeted per-tick update'));
  assert.ok(/sealButtonNode = el\('button'/.test(commitScreenBody));
  assert.ok(/\.\.\.roundCards,\s*\n\s*sealButtonNode,/.test(commitScreenBody), 'expected the mounted screen to include the captured sealButtonNode, not a fresh inline button literal');
});
