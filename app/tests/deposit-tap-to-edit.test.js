// app/tests/deposit-tap-to-edit.test.js — f2/A11/R67: the deposit figure is
// tap-to-edit, supplying a custom amount TO THE CENT (steppers stay
// whole-dollar). Static structural check (no DOM harness -- see
// app/README.md's node:test gotcha) plus a pure test of the cent-rounding
// logic extracted into its own assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

test('A11: the Load Funds sheet renders a tap-to-edit amount input with cent precision (step=0.01), and the whole-dollar steppers remain', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/components/money-sheets.js'), 'utf8');
  assert.ok(src.includes("type: 'number', step: '0.01'"), 'expected a step=0.01 (to-the-cent) numeric input');
  assert.ok(src.includes('editingAmount'), 'expected a tap-to-edit state toggle');
  assert.ok(src.includes('cb-amount-figure-tappable'), 'expected the display-mode figure to be a real tappable button');
  assert.ok(/Math\.round\(amount\)\s*-\s*1/.test(src) && /Math\.round\(amount\)\s*\+\s*1/.test(src), 'expected the +/- steppers to stay whole-dollar');
});

test('A11: commitEdit rounds a hand-typed value to the cent (not silently truncating sub-cent noise, not re-flooring to whole dollars)', () => {
  // Mirrors money-sheets.js's commitEdit rounding rule in isolation.
  const toCent = (raw) => Math.round(parseFloat(raw) * 100) / 100;
  assert.equal(toCent('47.636'), 47.64);
  assert.equal(toCent('5'), 5);
  assert.equal(toCent('12.3'), 12.3);
  assert.equal(toCent('0.01'), 0.01);
});

test('f4/A-f: O8\'s load-funds presets derive from the ACTIVE price-door arm\'s entry price (O2), not the fixed tunables.economy.summonUSD constant', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/components/money-sheets.js'), 'utf8');
  assert.ok(src.includes('tunables.priceDoorArms.displayedEntryPriceDefaultUSD'), 'expected openLoadFundsSheet to read the active price-door arm\'s displayed entry price');
  assert.ok(!/const entryUSD = tunables\.economy\.summonUSD/.test(src), 'expected the fixed $10 constant to no longer drive the O8 presets');
});

test('f4/A-f: presetAmounts scale with the effective entry price -- overrides.js:effectiveTunables\'s O2 override changes what the Load Funds presets show', async () => {
  const { effectiveTunables, defaultOverrides } = await import('../engine/overrides.js');
  const { loadTunables } = await import('../engine/dataLoader.js');
  const tunablesRaw = await loadTunables();

  const defaultTunables = effectiveTunables(tunablesRaw, defaultOverrides());
  const underTunables = effectiveTunables(tunablesRaw, { ...defaultOverrides(), priceDoorArm: 'under' }); // O2 alternative: $5
  const overTunables = effectiveTunables(tunablesRaw, { ...defaultOverrides(), priceDoorArm: 'over' }); // O2 alternative: $25

  const entryFor = (t) => t.priceDoorArms.displayedEntryPriceDefaultUSD;
  assert.equal(entryFor(defaultTunables), 10);
  assert.equal(entryFor(underTunables), 5);
  assert.equal(entryFor(overTunables), 25);

  const preset = defaultTunables.loadFundsPresets.default;
  const presetAmountsUnder = preset.multiples.map((m) => entryFor(underTunables) * m);
  const presetAmountsOver = preset.multiples.map((m) => entryFor(overTunables) * m);
  assert.notDeepEqual(presetAmountsUnder, presetAmountsOver, 'expected the O2 arm switch to change the derived preset amounts');
});

// f5/crucial-1: f4's A-f fix regressed the free-play arm (O2='freePlay',
// entryUSD=0) -- presets collapsed to [0, 0], the default amount was $0,
// and Game#loadFunds happily logged a $0 "deposit". Regression coverage
// for the fix: preset basis falls back to tunables.economy.summonUSD ONLY
// when the active arm's price is $0 (not for the three paying arms), and
// Game#loadFunds refuses amountUSD <= 0 outright.
test('f5/crucial-1: money-sheets.js\'s preset-basis logic covers all four O2 arms (default/under/over/freePlay), and freePlay falls back to the summonUSD par instead of $0', async () => {
  const { effectiveTunables, defaultOverrides } = await import('../engine/overrides.js');
  const { loadTunables } = await import('../engine/dataLoader.js');
  const tunablesRaw = await loadTunables();

  // Mirrors money-sheets.js's basis computation exactly (source-of-truth
  // duplicated here, same pattern as the commitEdit toCent test above).
  const basisFor = (t) => (t.priceDoorArms.displayedEntryPriceDefaultUSD > 0
    ? t.priceDoorArms.displayedEntryPriceDefaultUSD
    : t.economy.summonUSD);

  const arms = {
    default: effectiveTunables(tunablesRaw, defaultOverrides()),
    under: effectiveTunables(tunablesRaw, { ...defaultOverrides(), priceDoorArm: 'under' }),
    over: effectiveTunables(tunablesRaw, { ...defaultOverrides(), priceDoorArm: 'over' }),
    freePlay: effectiveTunables(tunablesRaw, { ...defaultOverrides(), priceDoorArm: 'freePlay' }),
  };

  assert.equal(arms.default.priceDoorArms.displayedEntryPriceDefaultUSD, 10);
  assert.equal(arms.under.priceDoorArms.displayedEntryPriceDefaultUSD, 5);
  assert.equal(arms.over.priceDoorArms.displayedEntryPriceDefaultUSD, 25);
  assert.equal(arms.freePlay.priceDoorArms.displayedEntryPriceDefaultUSD, 0);

  // Three paying arms: basis IS the active arm's own positive price.
  assert.equal(basisFor(arms.default), 10);
  assert.equal(basisFor(arms.under), 5);
  assert.equal(basisFor(arms.over), 25);
  // freePlay ($0 door): basis falls back to the fixed summonUSD par, NOT 0.
  assert.equal(basisFor(arms.freePlay), arms.freePlay.economy.summonUSD);
  assert.notEqual(basisFor(arms.freePlay), 0);

  const preset = arms.default.loadFundsPresets.default;
  for (const arm of ['default', 'under', 'over', 'freePlay']) {
    const presetAmounts = preset.multiples.map((m) => basisFor(arms[arm]) * m);
    assert.ok(presetAmounts.every((p) => p > 0), `expected every preset amount for the ${arm} arm to be positive (no $0 presets)`);
  }
});

test('f5/crucial-1: money-sheets.js source computes the preset basis with a positive-price guard (falls back off the $0 free-play arm)', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/components/money-sheets.js'), 'utf8');
  assert.ok(/activeEntryUSD > 0/.test(src), 'expected a positive-price guard before using the active arm\'s price as the preset basis');
  assert.ok(src.includes('tunables.economy.summonUSD'), 'expected a fallback to tunables.economy.summonUSD for the $0 door');
});

test('f5/crucial-1: Game#loadFunds refuses a $0 (or negative) amountUSD -- a $0 deposit is not a deposit and must not reach the ledger', async () => {
  const { Game } = await import('../engine/game.js');
  const { Ledger, createMemoryStorage } = await import('../engine/ledger.js');
  const { loadTunables, loadTreatment } = await import('../engine/dataLoader.js');
  const tunables = await loadTunables();
  const treatment = await loadTreatment('incumbent');
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p-f5-1' });

  assert.throws(
    () => game.loadFunds({ amountUSD: 0, presetOrCustom: 'preset', intentId: 'zero-1', sessionNumber: 1 }, 1000),
    /amountUSD/,
    'expected a $0 deposit to be refused',
  );
  assert.throws(
    () => game.loadFunds({ amountUSD: -5, presetOrCustom: 'custom', intentId: 'neg-1', sessionNumber: 1 }, 1000),
    /amountUSD/,
    'expected a negative deposit to be refused',
  );
  // No LOAD_FUNDS_DEPOSIT event should have been appended for either refusal.
  const deposits = ledger.all().filter((e) => e.type === 'LOAD_FUNDS_DEPOSIT');
  assert.equal(deposits.length, 0, 'expected zero deposit events logged from the refused $0/negative calls');

  // A genuine positive deposit still works.
  game.loadFunds({ amountUSD: 25, presetOrCustom: 'preset', intentId: 'pos-1', sessionNumber: 1 }, 1000);
  const depositsAfter = ledger.all().filter((e) => e.type === 'LOAD_FUNDS_DEPOSIT');
  assert.equal(depositsAfter.length, 1);
});

test('f7/advisory-8: Game#loadFunds refuses an amountUSD over the documented upper bound ($1,000,000) -- the guard site now carries an upper bound, not just the lower one', async () => {
  const { Game } = await import('../engine/game.js');
  const { Ledger, createMemoryStorage } = await import('../engine/ledger.js');
  const { loadTunables, loadTreatment } = await import('../engine/dataLoader.js');
  const tunables = await loadTunables();
  const treatment = await loadTreatment('incumbent');
  const ledger = new Ledger(createMemoryStorage());
  const game = new Game({ ledger, tunables, treatment, playerId: 'p-f7-8' });

  assert.throws(
    () => game.loadFunds({ amountUSD: 1e6 + 0.01, presetOrCustom: 'custom', intentId: 'over-cap', sessionNumber: 1 }, 1000),
    /amountUSD/,
    'expected an amount just over the cap to be refused',
  );
  const deposits = ledger.all().filter((e) => e.type === 'LOAD_FUNDS_DEPOSIT');
  assert.equal(deposits.length, 0, 'expected zero deposit events logged from the refused over-cap call');

  // The cap itself is inclusive -- exactly $1,000,000 is still accepted.
  game.loadFunds({ amountUSD: 1e6, presetOrCustom: 'custom', intentId: 'at-cap', sessionNumber: 1 }, 1000);
  const depositsAfter = ledger.all().filter((e) => e.type === 'LOAD_FUNDS_DEPOSIT');
  assert.equal(depositsAfter.length, 1);

  // A normal preset amount is nowhere near the cap and is unaffected.
  game.loadFunds({ amountUSD: 25, presetOrCustom: 'preset', intentId: 'normal-1', sessionNumber: 1 }, 1000);
  assert.equal(ledger.all().filter((e) => e.type === 'LOAD_FUNDS_DEPOSIT').length, 2);
});
