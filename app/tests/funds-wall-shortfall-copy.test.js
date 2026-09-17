// app/tests/funds-wall-shortfall-copy.test.js — CB-BUILD-012 fix round
// (C4): R67 ("states the shortfall in player language AND opens Load Funds
// inline") and §12/R83 ("explained in player language ... the resolving
// action offered in the same place") both require the EXPLANATION, not
// just the resolving action -- both funds walls (summon.js, sitting.js's
// re-entry) opened the sheet with ZERO explanation of what was short.
// Fixed: money-sheets.js's openLoadFundsSheet accepts an optional
// `shortfall` option; both walls now pass one, computed from the SAME
// numbers their own screens already display (never `e.message` -- see
// no-raw-error-text.test.js, which stays green: NO error text, but an
// explanation). Tests assert the RENDERED copy, with REAL numbers, through
// the real el()/mountScreen() via the shared fake-DOM harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { installFakeDom, uninstallFakeDom, renderedText } from './helpers/dom-harness.js';

let mountSummon;
let mountSitting;

test.before(async () => {
  ({ mountSummon } = await import('../ui/screens/summon.js'));
  ({ mountSitting } = await import('../ui/screens/sitting.js'));
});
test.beforeEach(() => { installFakeDom(); });
test.afterEach(() => { uninstallFakeDom(); });

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function sheetOverlay() {
  return document.body.children.find((n) => n.className && n.className.includes('cb-sheet-overlay'));
}

test('C4/R67: the summon funds wall states the shortfall in player language, with real numbers, when it opens Load Funds', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', seed: 1 });
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  // Drain CASH below the $10 door price: two summons (25 - 10 - 10 = 5).
  game.summonCharacter({ element: 'fire' }, 1001);
  game.summonCharacter({ element: 'water' }, 1002);
  assert.equal(game.snapshot().account.cashUSD, 5);

  const ctx = {
    treatment, tunables, game,
    router: { navigate: () => {} },
    patchSession: () => {},
    toast: () => {},
  };
  mountSummon(ctx);
  // Pick an element, then press Summon -- triggers the insufficient-CASH
  // branch (5 < 10) and opens Load Funds.
  const elBtn = document.getElementById('app').querySelectorAll('button').find((b) => b.getAttribute('data-el') === 'fire');
  assert.ok(elBtn, 'expected an element picker button');
  elBtn.dispatch('click');
  const summonBtn = document.getElementById('app').querySelectorAll('button').find((b) => renderedText(b).startsWith('Summon ('));
  assert.ok(summonBtn, 'expected the Summon button to render once an element is picked');
  summonBtn.dispatch('click');

  const overlay = sheetOverlay();
  assert.ok(overlay, 'expected the Load Funds sheet to open on insufficient CASH');
  const text = renderedText(overlay);
  assert.match(text, /Summon costs \$10\.00/, `expected the shortfall line to name the action and its real cost, got: "${text}"`);
  assert.match(text, /you have \$5\.00/, `expected the shortfall line to name the real current balance, got: "${text}"`);
  assert.match(text, /Add at least \$5\.00 to continue/, `expected the shortfall line to name the real amount needed, got: "${text}"`);
});

let tsCounter = 3000;
function eliminate(game, characterId) {
  tsCounter += 1;
  game.ledger.append({
    key: `test-eliminate-${characterId}-${tsCounter}`,
    type: EVENT_TYPES.CHARACTER_ELIMINATED,
    playerId: game.playerId,
    ts: tsCounter,
    payload: { characterId, bracketId: 'test-bracket', tier: 0, allDuelsStaked: true },
  });
}
function reenter(game, characterId) {
  tsCounter += 1;
  const sittingEpoch = game.peekSittingEpoch(characterId);
  game.reenterCharacter(characterId, tsCounter, { sittingEpoch });
}

test('C4/R67: the re-entry funds wall states the shortfall in player language, with real numbers, when it opens Load Funds', () => {
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', seed: 1 });
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const summoned = game.summonCharacter({ element: 'fire' }, 1001); // cash 25-10=15
  eliminate(game, summoned.characterId); reenter(game, summoned.characterId); // 15-5=10
  eliminate(game, summoned.characterId); reenter(game, summoned.characterId); // 10-5=5
  eliminate(game, summoned.characterId); reenter(game, summoned.characterId); // 5-5=0
  eliminate(game, summoned.characterId); // SITTING, cash=0
  assert.equal(game.snapshot().account.cashUSD, 0);

  const ctx = {
    treatment, tunables, game,
    router: { navigate: () => {} },
    refreshSession: () => ({ activeCharacterId: summoned.characterId, bracket: null }),
    patchSession: () => {},
    toast: () => {},
  };
  mountSitting(ctx);
  const btn = document.getElementById('app').querySelectorAll('button').find((b) => renderedText(b) === 'Load Funds to re-enter');
  assert.ok(btn, 'expected the funds-short Re-enter/Load-Funds button');
  btn.dispatch('click');

  const overlay = sheetOverlay();
  assert.ok(overlay, 'expected the Load Funds sheet to open');
  const text = renderedText(overlay);
  assert.match(text, /Re-entering costs \$5\.00/, `expected the shortfall line to name the action and its real cost, got: "${text}"`);
  assert.match(text, /you have \$0\.00/, `expected the shortfall line to name the real current balance, got: "${text}"`);
  assert.match(text, /Add at least \$5\.00 to continue/, `expected the shortfall line to name the real amount needed, got: "${text}"`);
});

test('C4: openLoadFundsSheet with NO shortfall option renders no shortfall line at all (opt-in, backward compatible -- e.g. cashPill\'s own bare open)', async () => {
  const { openLoadFundsSheet } = await import('../ui/components/money-sheets.js');
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p1', seed: 1 });
  game.submitScreener({ age18: true, jurisdictionOk: true }, 1000);
  const ctx = { treatment, tunables, game };
  openLoadFundsSheet(ctx);
  const overlay = sheetOverlay();
  assert.ok(overlay);
  const text = renderedText(overlay);
  assert.ok(!/costs \$/.test(text), 'expected no shortfall copy when no shortfall option was passed');
});
