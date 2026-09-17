// app/tests/summon-name-reveal.test.js — CB-BUILD-002/R59: the name is
// assigned and first revealed BY THE ACT OF SUMMONING, on the summoned
// character -- never on the pre-summon screen, never before an element is
// chosen. No name field, no re-roll. Static source scan (no DOM available
// in this harness -- same style as the existing structural UI tests) plus
// an end-to-end check through Game#summonCharacter's own draw-at-commit
// path, which this patch relies on unmodified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');
function freshGame(seed = 1) {
  const ledger = new Ledger(createMemoryStorage());
  return new Game({ ledger, tunables, treatment, playerId: 'p1', seed });
}

// ---- defect reproduction: structural scan over the shipped source --------

test('CB-BUILD-002/R59 (defect repro): the picker never calls pickUnusedName() itself (no pre-summon draw)', async () => {
  const src = await read('ui/screens/summon.js');
  assert.ok(!/pickUnusedName\(\)/.test(src.replace(/\/\/.*$/gm, '')), 'expected no live pickUnusedName() call in summon.js (comments explaining the removal are fine, live code is not)');
});

test('CB-BUILD-002/R59 (defect repro): summonCharacter is called with no name argument (the engine draws it at commit)', async () => {
  const src = await read('ui/screens/summon.js');
  // CB-BUILD-012 refactored the call into attemptSummon(chosenElement) (so
  // a Load Funds retry can re-attempt the SAME summon) -- the call shape is
  // now `{ element: chosenElement }` rather than the shorthand `{ element }`,
  // but the point this test guards (no `name` key passed from the UI, ever)
  // still holds; assert that directly instead of pinning the exact shorthand.
  assert.ok(/ctx\.game\.summonCharacter\(\{\s*element:\s*chosenElement\s*\}\)/.test(src), 'expected summonCharacter to be called with only an element key, no name threaded from the UI');
  assert.ok(!/summonCharacter\([^)]*\bname\b/.test(src), 'expected no "name" key ever passed to summonCharacter from the UI');
});

test('CB-BUILD-002/R59 (defect repro): the picker function renders no name anywhere before the Summon press', async () => {
  const src = await read('ui/screens/summon.js');
  const pickerBody = src.slice(src.indexOf('function renderPicker'), src.indexOf('function renderReveal'));
  assert.ok(!/YOUR \$\{treatment\.nouns\.character/.test(pickerBody), 'expected no "YOUR <CHARACTER>" preview card inside the picker');
  assert.ok(!/previewName/.test(src), 'expected the previewName variable to be gone entirely');
});

test('CB-BUILD-002/R59: the reveal card (shown only after summonCharacter succeeds) is the first place the name renders, with no re-roll control and no name input field', async () => {
  const src = await read('ui/screens/summon.js');
  const revealBody = src.slice(src.indexOf('function renderReveal'));
  assert.ok(/summoned\.name/.test(revealBody), 'expected the reveal card to render the summoned character\'s name');
  assert.ok(!/type:\s*['"]text['"]/.test(revealBody), 'expected no text input (name field) on the reveal card');
  const codeOnly = src.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/[Rr]e-?roll/.test(codeOnly), 'expected no re-roll control anywhere in summon.js\'s live code');
});

// ---- end to end: the engine draws the name at commit, unmodified ---------

test('CB-BUILD-002/R59: calling summonCharacter with no name draws one from the pool at commit (game.js unmodified)', () => {
  const game = freshGame();
  game.submitScreener({ age18: true, jurisdictionOk: true }, 500);
  const summoned = game.summonCharacter({ element: 'water' }, 1000);
  assert.ok(treatment.namePool.includes(summoned.name), 'expected a name drawn from the treatment\'s pool');
  assert.equal(summoned.element, 'water');
});

test('CB-BUILD-002/R59: two summons in a row draw two DIFFERENT unused names (still pool-drawn, never player-typed, never repeated while unused names remain)', () => {
  const game = freshGame();
  game.submitScreener({ age18: true, jurisdictionOk: true }, 500);
  const first = game.summonCharacter({ element: 'fire' }, 1000);
  const second = game.summonCharacter({ element: 'air' }, 1001);
  assert.notEqual(first.name, second.name);
});
