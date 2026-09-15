// app/tests/price-arm-summon-charge.test.js — f2/C15/R19/invariant-3:
// summonCharacter charges the ACTIVE price door arm's displayed price
// (O2), minting the same 100C stake regardless of arm; the summon button
// copy shows that same price.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { effectiveTunables, defaultOverrides } from '../engine/overrides.js';
import { mulberry32 } from '../engine/rng.js';
import { summonButtonLabel } from '../ui/screens/summon.js';

const tunablesRaw = await loadTunables();
const treatment = await loadTreatment('incumbent');

function gameWithArm(priceDoorArm) {
  const overrides = { ...defaultOverrides(), priceDoorArm };
  const tunables = effectiveTunables(tunablesRaw, overrides);
  const game = new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId: 'p1', random: mulberry32(1) });
  game.ensureAccount(1000);
  return { game, tunables };
}

test('C15: the default arm ($10) charges $10 for 100C, unchanged from before', () => {
  const { game } = gameWithArm('default');
  const before = game.snapshot().account.cashUSD;
  const summoned = game.summonCharacter({ element: 'fire' }, 1001);
  const after = game.snapshot().account.cashUSD;
  assert.equal(before - after, 10);
  assert.equal(game.snapshot().characters[summoned.characterId].stakeCheddar, 100);
});

test('C15: the "under" arm ($5) charges $5 for the SAME 100C summon', () => {
  const { game, tunables } = gameWithArm('under');
  assert.equal(tunables.priceDoorArms.displayedEntryPriceDefaultUSD, tunablesRaw.priceDoorArms.alternatives.under);
  const before = game.snapshot().account.cashUSD;
  const summoned = game.summonCharacter({ element: 'fire' }, 1001);
  const after = game.snapshot().account.cashUSD;
  assert.equal(before - after, tunablesRaw.priceDoorArms.alternatives.under);
  assert.equal(game.snapshot().characters[summoned.characterId].stakeCheddar, 100);
});

test('C15: the "over" arm charges the over price for the SAME 100C summon', () => {
  const { game, tunables } = gameWithArm('over');
  const before = game.snapshot().account.cashUSD;
  const summoned = game.summonCharacter({ element: 'fire' }, 1001);
  const after = game.snapshot().account.cashUSD;
  assert.equal(before - after, tunablesRaw.priceDoorArms.alternatives.over);
  assert.equal(game.snapshot().characters[summoned.characterId].stakeCheddar, 100);
});

test('C15: the free-play arm ($0) charges $0 for the SAME 100C summon', () => {
  const { game } = gameWithArm('freePlay');
  const before = game.snapshot().account.cashUSD;
  const summoned = game.summonCharacter({ element: 'fire' }, 1001);
  const after = game.snapshot().account.cashUSD;
  assert.equal(before - after, 0);
  assert.equal(game.snapshot().characters[summoned.characterId].stakeCheddar, 100);
});

test('C15: the ledger event itself carries the charged costUSD, matching the active arm (auditable, not just a snapshot side-effect)', () => {
  const { game } = gameWithArm('under');
  const summoned = game.summonCharacter({ element: 'fire' }, 1001);
  const event = game.ledger.byType(EVENT_TYPES.CHARACTER_SUMMONED).find((e) => e.payload.characterId === summoned.characterId);
  assert.equal(event.payload.costUSD, tunablesRaw.priceDoorArms.alternatives.under);
});

test('C15: the summon button copy shows the active arm price (matches what is actually charged)', () => {
  for (const [arm, expectedUSD] of [['default', tunablesRaw.priceDoorArms.displayedEntryPriceDefaultUSD], ['under', tunablesRaw.priceDoorArms.alternatives.under], ['over', tunablesRaw.priceDoorArms.alternatives.over], ['freePlay', tunablesRaw.priceDoorArms.alternatives.freePlay]]) {
    const overrides = { ...defaultOverrides(), priceDoorArm: arm };
    const tunables = effectiveTunables(tunablesRaw, overrides);
    const label = summonButtonLabel(treatment, tunables);
    assert.ok(label.includes(`$${expectedUSD}`), `expected "${label}" to include $${expectedUSD} for arm ${arm}`);
    assert.ok(label.includes('100C'), `expected "${label}" to still mint 100C regardless of arm`);
  }
});
