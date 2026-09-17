// app/tests/reserve-recall-gate.test.js — CB-BUILD-003/R22/R49a: the
// character-recall open-response prompt is asked only AFTER the player's
// first bracket concludes (an anchor per R43's `computeAnchor`) -- never
// before a staked duel exists. Static source scan (no DOM available in
// this harness -- same style as the existing structural UI tests) plus an
// end-to-end check of the exact anchor condition reserve.js now gates on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { computeAnchor } from '../engine/retention.js';

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

test('CB-BUILD-003/R22 (defect repro): reserve.js no longer renders the recall prompt on account.openResponse alone -- it also requires a computed anchor', async () => {
  const src = await read('ui/screens/reserve.js');
  assert.ok(!/!account\.openResponse \? renderOpenResponsePrompt\(\)/.test(src), 'expected the unconditional (pre-anchor) gate to be gone');
  assert.ok(/computeAnchor/.test(src), 'expected reserve.js to import/use computeAnchor (R43) to gate the recall prompt');
  assert.ok(/anchorTs\s*!=\s*null\s*&&\s*!account\.openResponse\s*\)\s*\?\s*renderOpenResponsePrompt\(\)/.test(src), 'expected the recall prompt to render only when an anchor exists AND it has not been answered yet');
});

test('CB-BUILD-003/R22: reserve.js imports computeAnchor from engine/retention.js (R43\'s single source for "the timestamp the first bracket concludes")', async () => {
  const src = await read('ui/screens/reserve.js');
  assert.ok(/import\s*\{\s*computeAnchor\s*\}\s*from\s*['"]\.\.\/\.\.\/engine\/retention\.js['"]/.test(src));
});

test('CB-BUILD-003/R49a: RESERVE stays pressable regardless of anchor state (only the recall card is gated, not the RESERVE button itself)', async () => {
  const src = await read('ui/screens/reserve.js');
  const buttonBody = src.slice(src.indexOf("class: 'cb-btn block'"), src.indexOf('treatment.copy.reserveButton'));
  assert.ok(!/anchorTs/.test(buttonBody), 'expected the RESERVE button itself to have no anchor gating');
});

// ---- end to end: the exact anchor condition, before and after -------------

test('CB-BUILD-003/R22: before any bracket concludes, computeAnchor is null -- the exact condition reserve.js gates the recall prompt on', () => {
  const game = freshGame();
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  game.summonCharacter({ element: 'fire' }, 1001);
  // No bracket has concluded yet (no CHARACTER_ELIMINATED / CHARACTER_ADVANCED
  // event) -- the anchor must be null, so reserve.js must not show the
  // recall question yet.
  const anchorTs = computeAnchor(game.ledger.all(), game.playerId);
  assert.equal(anchorTs, null);
});

test('CB-BUILD-003/R22: once the player\'s first bracket concludes (a staked elimination), computeAnchor flips to that event\'s timestamp -- the recall prompt may now render', () => {
  const game = freshGame();
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  assert.equal(computeAnchor(game.ledger.all(), game.playerId), null, 'precondition: no anchor yet');
  game.ledger.append({
    key: 'test-eliminate',
    type: EVENT_TYPES.CHARACTER_ELIMINATED,
    playerId: 'p1',
    ts: 5000,
    payload: { characterId: summon.characterId, bracketId: 'b1', tier: 0, allDuelsStaked: true },
  });
  const anchorTs = computeAnchor(game.ledger.all(), game.playerId);
  assert.equal(anchorTs, 5000, 'expected the anchor to be the concluded bracket\'s timestamp');
});

test('CB-BUILD-003/R22: a NON-staked (hesitated) elimination does not anchor -- matches R43\'s "every duel of theirs in that bracket was staked" condition', () => {
  const game = freshGame();
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  game.ledger.append({
    key: 'test-eliminate-hesitated',
    type: EVENT_TYPES.CHARACTER_ELIMINATED,
    playerId: 'p1',
    ts: 5000,
    payload: { characterId: summon.characterId, bracketId: 'b1', tier: 0, allDuelsStaked: false },
  });
  assert.equal(computeAnchor(game.ledger.all(), game.playerId), null);
});
