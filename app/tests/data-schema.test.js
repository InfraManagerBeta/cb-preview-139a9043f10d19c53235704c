// app/tests/data-schema.test.js — the treatment-config and tunables schema
// t3 reads: no theme-bound value hardcoded in the engine, every §14/R85
// tunable present as data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

test('treatment config carries every R12 theme-bound field the engine/UI need', async () => {
  const t = await loadTreatment('incumbent');
  for (const field of ['workingTitle', 'logoMark', 'nouns', 'elements', 'colors', 'fonts', 'namePool', 'seedRoster', 'copy', 'narrator']) {
    assert.ok(field in t, `treatment missing ${field}`);
  }
  assert.ok(t.namePool.length >= 20);
  assert.equal(t.seedRoster.filter((r) => r.canonical).length, 7); // R82 exact seed roster
  for (const noun of ['character', 'stakeUnit', 'headlinePrize', 'floor']) assert.ok(t.nouns[noun]);
});

test('tunables carries every R85 tunable category as data', async () => {
  const tn = await loadTunables();
  for (const field of ['engine', 'floors', 'economy', 'tierLadder', 'reentry', 'bracket', 'pve', 'timers', 'loadFundsPresets', 'npcFillDensity', 'runActivation', 'narrator', 'gate', 'caps']) {
    assert.ok(field in tn, `tunables missing ${field}`);
  }
  assert.deepEqual(tn.engine.weights, [78, 79, 81, 86, 100]);
  assert.equal(tn.engine.affinityMultiplier, 1.3);
  assert.equal(tn.engine.transferCapMultiplier, 7);
});
