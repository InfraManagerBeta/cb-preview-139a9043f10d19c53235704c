// app/tests/cb-build-003-reserve-anchor-gate.test.js — CB-BUILD-003/R49a/R22:
// the reserve screen's open-response ("What do you remember about your
// last match?") prompt is gated on a concluded first bracket (an anchor);
// until then it is hidden entirely. RESERVE itself stays pressable and
// reachable from a cold start (it's offered in the played funnel, not
// gated) -- only the recall CARD is gated.
//
// Reproduces the symptom first: the delivered reserve.js rendered the
// recall prompt whenever `!account.openResponse`, with no check at all for
// whether the player had ever played a staked duel -- so a brand-new
// account, zero brackets played, was asked "What do you remember about
// your last match?"
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

function freshGame(playerId = 'p-cb003') {
  return new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId });
}

test('CB-BUILD-003 symptom, reproduced: the delivered reserve.js rendered the recall prompt on `!account.openResponse` alone, with no anchor check', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/reserve.js'), 'utf8');
  assert.equal(/!account\.openResponse \? renderOpenResponsePrompt\(\)/.test(src), false, 'expected the ungated (no-anchor-check) render call to be gone');
});

test('CB-BUILD-003/R22: reserve.js gates renderOpenResponsePrompt() on an anchor (snapshot().account.anchorTs)', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/reserve.js'), 'utf8');
  assert.ok(/anchorTs/.test(src), 'expected reserve.js to read account.anchorTs');
  assert.ok(/!account\.openResponse && hasAnchor \? renderOpenResponsePrompt\(\)/.test(src), 'expected the recall card to require BOTH no-prior-answer AND an anchor');
});

test('CB-BUILD-003/R49a: RESERVE stays pressable regardless of the anchor -- the reserve button/pressReserve call is not itself gated on hasAnchor', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/reserve.js'), 'utf8');
  const reserveButtonSection = src.slice(src.indexOf('account.reservation'), src.indexOf('!account.openResponse'));
  assert.equal(/hasAnchor/.test(reserveButtonSection), false, 'expected the RESERVE press button/confirmed-card branch to be unconditioned on hasAnchor');
  assert.ok(reserveButtonSection.includes('pressReserve'), 'expected the reserve press action to remain reachable');
});

test('CB-BUILD-003/Game#snapshot: account.anchorTs is null before any bracket concludes', () => {
  const game = freshGame();
  game.ensureAccount(1000);
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  game.summonCharacter({ element: 'fire' }, 1001);
  assert.equal(game.snapshot().account.anchorTs, null);
});

test('CB-BUILD-003/Game#snapshot: account.anchorTs is set to the timestamp the player\'s first bracket concludes (elimination), all duels staked', () => {
  const game = freshGame('p-cb003-elim');
  game.ensureAccount(1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  assert.equal(game.snapshot().account.anchorTs, null, 'no anchor yet -- character is still ACTIVE');

  const elimTs = 5000;
  game.ledger.append({
    key: 'test-eliminate-cb003', type: EVENT_TYPES.CHARACTER_ELIMINATED, playerId: 'p-cb003-elim', ts: elimTs,
    payload: { characterId: summon.characterId, bracketId: 'b1', tier: 0, allDuelsStaked: true },
  });

  assert.equal(game.snapshot().account.anchorTs, elimTs);
});

test('CB-BUILD-003/Game#snapshot: a hesitated (not-all-staked) elimination does NOT anchor -- matches retention.js\'s existing computeAnchor rule', () => {
  const game = freshGame('p-cb003-hesitated');
  game.ensureAccount(1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);
  game.ledger.append({
    key: 'test-eliminate-hesitated', type: EVENT_TYPES.CHARACTER_ELIMINATED, playerId: 'p-cb003-hesitated', ts: 5000,
    payload: { characterId: summon.characterId, bracketId: 'b1', tier: 0, allDuelsStaked: false },
  });
  assert.equal(game.snapshot().account.anchorTs, null);
});

test('CB-BUILD-003 end to end: the reserve screen\'s actual gating condition, evaluated against a real Game snapshot both before and after an anchor', () => {
  const game = freshGame('p-cb003-e2e');
  game.ensureAccount(1000);
  const summon = game.summonCharacter({ element: 'fire' }, 1001);

  // Mirrors reserve.js's own gate: `!account.openResponse && account.anchorTs != null`.
  const gateBefore = game.snapshot().account;
  const hasAnchorBefore = gateBefore.anchorTs != null;
  assert.equal(hasAnchorBefore, false, 'expected no recall card before any bracket concludes');

  game.ledger.append({
    key: 'test-eliminate-e2e', type: EVENT_TYPES.CHARACTER_ELIMINATED, playerId: 'p-cb003-e2e', ts: 9000,
    payload: { characterId: summon.characterId, bracketId: 'b1', tier: 0, allDuelsStaked: true },
  });

  const gateAfter = game.snapshot().account;
  const hasAnchorAfter = gateAfter.anchorTs != null;
  assert.equal(hasAnchorAfter, true, 'expected the recall card to become eligible once the first bracket concludes');
});
