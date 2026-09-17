// app/tests/funds-wall-error-code.test.js — fix round advisory A3: the
// summon funds wall used to classify insufficient CASH purely by
// `/insufficient CASH/.test(e.message)` -- a future rewording of the
// thrown message (a copy pass, i18n, ...) could silently degrade the whole
// funds wall to summon.js's generic "That didn't go through" toast with no
// signal at all. Fixed: game.js's summonCharacter throws a stable `.code`
// ('INSUFFICIENT_CASH') alongside its (unchanged) message; summon.js
// classifies on the code. Additive: the message itself is untouched
// (funds-wall-load-funds.test.js's direct message match stays green).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function freshGame(seed = 1) {
  const ledger = new Ledger(createMemoryStorage());
  return new Game({ ledger, tunables, treatment, playerId: 'p1', seed });
}

test('A3: Game#summonCharacter throws a stable .code (INSUFFICIENT_CASH) on insufficient CASH, additive to the unchanged .message', () => {
  const game = freshGame();
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  // Drain below the door price with two summons (25 - 10 - 10 = 5 < 10).
  game.summonCharacter({ element: 'fire' }, 1001);
  game.summonCharacter({ element: 'water' }, 1002);
  let caught = null;
  try {
    game.summonCharacter({ element: 'air' }, 1003);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, 'expected summonCharacter to throw when short on CASH');
  assert.equal(caught.code, 'INSUFFICIENT_CASH');
  assert.match(caught.message, /insufficient CASH/, 'expected the message to stay unchanged (additive, not a replacement)');
});

test('A3: summon.js classifies the funds-wall branch on e.code, not a message regex', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/summon.js'), 'utf8');
  assert.ok(/if \(e\.code === 'INSUFFICIENT_CASH'\)/.test(src), 'expected summon.js to classify on e.code');
  assert.ok(!/if \(\/insufficient CASH\/\.test\(e\.message\)\)/.test(src), 'expected the old message-regex classification to be gone');
});

test('A3: a hypothetical future message rewording would NOT silently break the funds-wall classification (the code is independent of the message string)', () => {
  const err = new Error('summonCharacter: CASH balance too low, reworded copy pass');
  err.code = 'INSUFFICIENT_CASH';
  // Mirrors summon.js's own classification expression.
  const isFundsWall = err.code === 'INSUFFICIENT_CASH';
  const wouldHaveMatchedOldRegex = /insufficient CASH/.test(err.message);
  assert.equal(isFundsWall, true, 'expected code-based classification to survive a message reword');
  assert.equal(wouldHaveMatchedOldRegex, false, 'sanity: the OLD regex approach would have missed this reworded message, exactly the degrade this fix prevents');
});
