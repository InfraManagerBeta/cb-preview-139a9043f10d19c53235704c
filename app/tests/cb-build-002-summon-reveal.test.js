// app/tests/cb-build-002-summon-reveal.test.js — CB-BUILD-002/R59: the
// summon screen no longer previews the wizard's name before summon/before
// an element is chosen. The name is drawn server-side by
// Game#summonCharacter AT COMMIT and first revealed on the result/
// character card after the Summon press (a small reveal moment).
//
// Reproduces the symptom first: the delivered summon.js called
// `pickUnusedName()` at MOUNT time (before the player has even picked an
// element) and displayed it in a `previewName` card -- so the "assigned"
// name was visible, and re-rollable by simply reloading the screen, well
// before the player committed to anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function freshGame(playerId = 'p-cb002') {
  return new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId });
}

test('CB-BUILD-002 symptom, reproduced: the delivered summon.js called pickUnusedName() at mount and rendered a previewName card', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/summon.js'), 'utf8');
  assert.equal(/const previewName = ctx\.game\.pickUnusedName\(\)/.test(src), false, 'expected the mount-time pickUnusedName() preview call to be gone');
  assert.equal(/previewName/.test(src), false, 'expected zero references to a previewName card anywhere in summon.js');
});

test('CB-BUILD-002/R59: summonCharacter is called with no `name` -- the engine draws it server-side, at commit, not the screen', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/summon.js'), 'utf8');
  assert.ok(src.includes('ctx.game.summonCharacter({ element })'), 'expected the Summon press to call summonCharacter with only { element } -- no client-picked name');
  assert.equal(/summonCharacter\(\{ element, name:/.test(src), false, 'expected zero call sites that pass a pre-picked name into summonCharacter');
});

test('CB-BUILD-002/R59: the name is revealed on a post-summon result/character card (renderReveal), never on the pre-summon picker', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/summon.js'), 'utf8');
  assert.ok(src.includes('function renderReveal'), 'expected a renderReveal step after a successful summon');
  // The reveal function must read the name off the RETURNED summoned
  // object (the server-side draw), not off any client-side state.
  const revealBody = src.slice(src.indexOf('function renderReveal'));
  assert.ok(/summoned\.name/.test(revealBody), 'expected renderReveal to display summoned.name (the server-drawn name)');
  // The element picker (render(), before renderReveal is ever called) must
  // not display any character name at all.
  const pickerBody = src.slice(src.indexOf('function render('), src.indexOf('function renderReveal'));
  assert.equal(/summoned\.name|previewName/.test(pickerBody), false, 'expected the pre-summon picker to render no character name');
});

test('CB-BUILD-002: renderReveal is reached only from a successful summonCharacter call (inside the try block, after ctx.patchSession)', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/summon.js'), 'utf8');
  // CB-BUILD-012 later extracted the Summon press's body into
  // attemptSummon() (so a funds-wall retry can call the identical path) --
  // the summonCharacter -> patchSession -> renderReveal sequence itself is
  // unchanged, just moved into that named function.
  const attemptSummonBody = src.slice(src.indexOf('function attemptSummon'), src.indexOf('function retrySummon'));
  assert.ok(/summonCharacter\(\{ element \}\)[\s\S]*renderReveal\(summoned\)/.test(attemptSummonBody), 'expected renderReveal(summoned) to run right after a successful summonCharacter call');
});

test('CB-BUILD-002 end to end (engine): summonCharacter with no name draws one from the treatment name pool -- not predetermined before the call', () => {
  const game = freshGame();
  game.ensureAccount(1000);
  const summoned = game.summonCharacter({ element: 'fire' }, 1001);
  assert.ok(treatment.namePool.includes(summoned.name), 'expected the drawn name to come from the treatment\'s name pool');
  assert.equal(summoned.element, 'fire');

  const event = game.ledger.byType(EVENT_TYPES.CHARACTER_SUMMONED).find((e) => e.payload.characterId === summoned.characterId);
  assert.ok(event, 'expected a CHARACTER_SUMMONED ledger event');
  assert.equal(event.payload.name, summoned.name, 'expected the ledger-recorded name to match the name returned to the caller (the same server-side draw)');
});

test('CB-BUILD-002 end to end (engine): two summons in the same session draw two DIFFERENT names (no re-roll/repeat while unused names remain) -- the draw happens fresh at each commit', () => {
  const game = freshGame('p-cb002-two');
  game.ensureAccount(1000);
  const first = game.summonCharacter({ element: 'fire' }, 1001);
  const second = game.summonCharacter({ element: 'water' }, 1002);
  assert.notEqual(first.name, second.name, 'expected pickUnusedName() to avoid a name already in use');
});
