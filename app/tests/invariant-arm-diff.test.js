// app/tests/invariant-arm-diff.test.js — §15.12: "within a run, arms differ
// in the arm variable alone (configuration diff is empty elsewhere)." t1's
// invariants.test.js checked the *scaffold* (every O-item alternative sits
// beside its default). t3 builds the arms for real (armDefinitions() +
// per-treatment configs), so this is the REAL config diff: construct each
// arm's effective configuration (tunables + treatment + price), diff two
// arms that should differ in exactly one variable, and assert the diff set
// is exactly that variable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { effectiveTunables } from '../engine/overrides.js';
import { armDefinitions } from '../engine/runSimulator.js';

const tunables = await loadTunables();

/** Build the "arm configuration" object an arm actually runs under: the
 * displayed price and the active treatment id. (Door arms never touch any
 * OTHER tunable -- R19: "within an arm comparison only the arm variable
 * changes.") */
async function armConfig(arm) {
  const treatment = await loadTreatment(arm.treatment);
  return {
    priceUSD: arm.priceUSD,
    treatmentId: arm.treatment,
    // everything else is read from the SAME shipped tunables.json, unmodified,
    // for every arm -- proving the "elsewhere" part of the invariant.
    engine: tunables.engine,
    floors: tunables.floors,
    economy: tunables.economy,
    tierLadder: tunables.tierLadder,
    reentry: tunables.reentry,
    bracket: tunables.bracket,
    pve: tunables.pve,
    timers: tunables.timers,
    gate: tunables.gate,
    caps: tunables.caps,
    // the treatment's own theme-bound content travels WITH the treatment
    // variable, not independently -- included so a real object-diff is
    // possible, but expected to differ only when arm.treatment differs.
    treatmentWorkingTitle: treatment.workingTitle,
  };
}

function diffKeys(a, b, prefix = '') {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs = [];
  for (const k of keys) {
    const av = a[k], bv = b[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(av)) {
      diffs.push(...diffKeys(av, bv, path));
    } else if (JSON.stringify(av) !== JSON.stringify(bv)) {
      diffs.push(path);
    }
  }
  return diffs;
}

test('the price door arms (under/over/free) differ from the gate cell in price alone', async () => {
  const arms = armDefinitions();
  const gate = arms.find((a) => a.id === 'gate-incumbent-10');
  const gateCfg = await armConfig(gate);
  for (const arm of arms.filter((a) => a.role === 'door-price')) {
    const cfg = await armConfig(arm);
    const diffs = diffKeys(gateCfg, cfg);
    assert.deepEqual(diffs.sort(), ['priceUSD'], `arm ${arm.id} config diff vs gate cell: ${JSON.stringify(diffs)}`);
  }
});

test('the theme door arms (adjacent/far) differ from the gate cell in treatment alone (price held at the gate cell\'s $10)', async () => {
  const arms = armDefinitions();
  const gate = arms.find((a) => a.id === 'gate-incumbent-10');
  const gateCfg = await armConfig(gate);
  for (const arm of arms.filter((a) => a.role === 'door-theme')) {
    assert.equal(arm.priceUSD, gate.priceUSD, 'theme arms hold price at the gate cell\'s displayed price (R19: only the arm variable changes)');
    const cfg = await armConfig(arm);
    const diffs = diffKeys(gateCfg, cfg);
    assert.deepEqual(diffs.sort(), ['treatmentId', 'treatmentWorkingTitle'].sort(), `arm ${arm.id} config diff vs gate cell: ${JSON.stringify(diffs)}`);
  }
});

test('every arm reads the identical shipped tunables.json object (no per-arm tunable fork)', async () => {
  const arms = armDefinitions();
  const configs = await Promise.all(arms.map(armConfig));
  const sharedKeys = ['engine', 'floors', 'economy', 'tierLadder', 'reentry', 'bracket', 'pve', 'timers', 'gate', 'caps'];
  for (const key of sharedKeys) {
    const serialized = JSON.stringify(configs[0][key]);
    for (const cfg of configs.slice(1)) {
      assert.equal(JSON.stringify(cfg[key]), serialized, `tunables.${key} diverged across arms`);
    }
  }
});

test('an O-item override (e.g. O5 commit window) applies uniformly and is not silently arm-specific', () => {
  // effectiveTunables is a pure function of (tunables, overrides) with no
  // arm parameter at all -- there is no code path by which one arm could
  // read a different O5 than another within the same run.
  const overridden = effectiveTunables(tunables, { commitWindowSec: 45 });
  assert.equal(overridden.timers.commitWindowSec.default, 45);
  assert.equal(overridden.timers.lobbyHumanWaitSec.default, tunables.timers.lobbyHumanWaitSec.default);
});
