// app/tests/overrides.test.js — R14/AC0 row 1: the console override layer
// (localStorage `consoleOverrides`) the engine/UI read, and its pure
// effective-value computation (effectiveTunables/effectiveTreatmentId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../engine/ledger.js';
import {
  defaultOverrides, loadOverrides, saveOverrides, patchOverrides, resetOverrides,
  effectiveTunables, effectiveTreatmentId,
} from '../engine/overrides.js';
import { loadTunables } from '../engine/dataLoader.js';

const tunables = await loadTunables();

test('loadOverrides() returns the default shape when nothing is stored', () => {
  const storage = createMemoryStorage();
  const o = loadOverrides(storage);
  assert.deepEqual(o, defaultOverrides());
});

test('patchOverrides() merges onto the current stored state and persists it', () => {
  const storage = createMemoryStorage();
  patchOverrides({ treatmentId: 'adjacent' }, storage);
  patchOverrides({ killSwitch: true }, storage);
  const o = loadOverrides(storage);
  assert.equal(o.treatmentId, 'adjacent');
  assert.equal(o.killSwitch, true);
});

test('resetOverrides() restores the exact default shape', () => {
  const storage = createMemoryStorage();
  patchOverrides({ treatmentId: 'far', killSwitch: true }, storage);
  resetOverrides(storage);
  assert.deepEqual(loadOverrides(storage), defaultOverrides());
});

test('effectiveTreatmentId: null/absent override falls back to the given default', () => {
  assert.equal(effectiveTreatmentId(defaultOverrides(), 'incumbent'), 'incumbent');
  assert.equal(effectiveTreatmentId({ ...defaultOverrides(), treatmentId: 'adjacent' }, 'incumbent'), 'adjacent');
});

test('effectiveTunables: O5/O6/O9/O10 overrides apply without mutating the input object', () => {
  const before = JSON.stringify(tunables);
  const eff = effectiveTunables(tunables, {
    ...defaultOverrides(),
    commitWindowSec: 45, lobbyHumanWaitSec: 30, revealCadenceMs: 900, narratorTemperature: 0.5,
  });
  assert.equal(eff.timers.commitWindowSec.default, 45);
  assert.equal(eff.timers.lobbyHumanWaitSec.default, 30);
  assert.equal(eff.timers.revealCadenceMs.default, 900);
  assert.equal(eff.narrator.temperature.default, 0.5);
  assert.equal(JSON.stringify(tunables), before, 'effectiveTunables must not mutate its input');
});

test('effectiveTunables: O7 (npcFillDensity) and O8 (loadFundsPresets) select the named alternative', () => {
  const eff = effectiveTunables(tunables, { ...defaultOverrides(), npcFillDensityId: 'fillTo8Min2Humans', loadFundsPresetsIndex: 2 });
  assert.equal(eff.npcFillDensity.default.id, 'fillTo8Min2Humans');
  assert.equal(eff.npcFillDensity.default.minHumans, 2);
  assert.deepEqual(eff.loadFundsPresets.default, tunables.loadFundsPresets.alternatives[1]);
});

test('effectiveTunables: O2 (price door arm) overrides the displayed entry price', () => {
  const eff = effectiveTunables(tunables, { ...defaultOverrides(), priceDoorArm: 'under' });
  assert.equal(eff.priceDoorArms.displayedEntryPriceDefaultUSD, tunables.priceDoorArms.alternatives.under);
});

test('effectiveTunables: no overrides at all reproduces the shipped defaults exactly', () => {
  const eff = effectiveTunables(tunables, defaultOverrides());
  assert.deepEqual(eff, tunables);
});
