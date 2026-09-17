// app/tests/gated-seal-missing-highlight.test.js — CB-BUILD-008 optional
// enhancement (folded, manager-announced on PR #8): "pressing a still-gated
// SEAL COMMITMENT briefly highlights the rounds still missing a move, so
// the player is told what is left rather than met with a dead control."
// Keeps the disabled LOOK (CB-BUILD-008's core fix); no gate-logic change.
// Static source scan (no DOM available in this harness -- same style as
// the existing move-tap-inplace.test.js/duel-screen-structure.test.js).
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

test('CB-BUILD-008 optional: a press of the seal button while still gated calls flashMissingRounds() instead of a silent no-op; a real (ungated) press still commits exactly as before', async () => {
  const src = await read('ui/screens/duel.js');
  const commitScreenBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('// A17: the targeted per-tick update'));
  const sealBody = commitScreenBody.slice(commitScreenBody.indexOf('sealButtonNode = el('), commitScreenBody.indexOf('mountScreen(['));
  assert.ok(/if \(!moves\.some\(\(m\) => m == null\)\) commit\(moves\.map\(elementIndex\), false\);/.test(sealBody), 'expected the ungated branch to still call commit(...) exactly as before');
  assert.ok(/else flashMissingRounds\(\);/.test(sealBody), 'expected the gated (no-op) branch to now call flashMissingRounds() instead of doing nothing');
});

test('CB-BUILD-008 optional: flashMissingRounds() highlights ONLY the rounds with a null move, toggling a CSS class in place (no rebuild)', async () => {
  const src = await read('ui/screens/duel.js');
  const commitScreenBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('// A17: the targeted per-tick update'));
  const fnBody = commitScreenBody.slice(commitScreenBody.indexOf('function flashMissingRounds'), commitScreenBody.indexOf('const roundCards = moves.map'));
  assert.ok(/moves\.forEach\(\(m, i\) => \{ if \(m == null\) missingIdxs\.push\(i\); \}\);/.test(fnBody), 'expected flashMissingRounds to collect exactly the null-move round indices');
  assert.ok(/roundCardNodes\[i\]\.classList\.add\('cb-round-missing'\)/.test(fnBody), 'expected the missing rounds\' own card nodes to get a highlight class added, in place');
  assert.ok(/roundCardNodes\[i\]\.classList\.remove\('cb-round-missing'\)/.test(fnBody), 'expected the highlight to be cleared again (a brief highlight, not a permanent one)');
  assert.ok(/setTimeout\(/.test(fnBody), 'expected the highlight removal to be scheduled (a brief highlight), not immediate');
});

test('CB-BUILD-008 optional: roundCardNodes captures each round\'s own card element at build time (parallel array to roundButtonGroups), for later per-round mutation', async () => {
  const src = await read('ui/screens/duel.js');
  const commitScreenBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('// A17: the targeted per-tick update'));
  assert.ok(/const roundCardNodes = \[\];/.test(commitScreenBody));
  assert.ok(/roundCardNodes\.push\(card\);/.test(commitScreenBody));
});

test('CB-BUILD-008 optional: the enhancement does not touch the gate itself -- selectMove\'s aria-disabled wiring and the seal button\'s initial aria-disabled expression are byte-identical to the pre-existing gate logic', async () => {
  const src = await read('ui/screens/duel.js');
  const commitScreenBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('// A17: the targeted per-tick update'));
  const selectMoveBody = commitScreenBody.slice(commitScreenBody.indexOf('function selectMove'), commitScreenBody.indexOf('// CB-BUILD-008 optional enhancement: "briefly'));
  assert.ok(/sealButtonNode\.setAttribute\('aria-disabled', 'true'\)/.test(selectMoveBody));
  assert.ok(/sealButtonNode\.removeAttribute\('aria-disabled'\)/.test(selectMoveBody));
  assert.ok(/'aria-disabled':\s*moves\.some\(\(m\) => m == null\),/.test(commitScreenBody), 'expected the seal button\'s initial aria-disabled expression to be unchanged');
});

test('CB-BUILD-008 optional: base.css defines the brief highlight as a bounded (900ms-scale) animation, not a permanent state change, and reuses the loss/danger color -- no new color role introduced', async () => {
  const css = await read('styles/base.css');
  assert.ok(/\.cb-round-missing[^{]*\{[^}]*animation:\s*cbRoundMissingPulse/s.test(css) || /cb-round-missing[\s\S]*?animation:\s*cbRoundMissingPulse/.test(css), 'expected a .cb-round-missing rule with a named, bounded animation');
  assert.ok(/@keyframes cbRoundMissingPulse/.test(css), 'expected the keyframes to be defined');
  assert.ok(/\.cb-round-missing[\s\S]{0,120}var\(--cb-red\)/.test(css), 'expected the highlight to reuse the existing loss/danger red role, not introduce a new color');
});

test('CB-BUILD-008 optional: buildCommitScreen still calls mountScreen(...) exactly once (the enhancement adds no extra mount/rebuild)', async () => {
  const src = await read('ui/screens/duel.js');
  const commitScreenBody = src.slice(src.indexOf('function buildCommitScreen'), src.indexOf('// A17: the targeted per-tick update'));
  const codeOnly = commitScreenBody.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const mountScreenCalls = (codeOnly.match(/mountScreen\(/g) || []).length;
  assert.equal(mountScreenCalls, 1, `expected exactly one mountScreen( call, found ${mountScreenCalls}`);
});
