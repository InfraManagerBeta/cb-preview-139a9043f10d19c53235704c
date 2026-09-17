// app/tests/rig-distinctness.test.js — C7 (fix round F2), the suite-side
// slice of AC1's DISTINCTNESS criterion: a cheap, node-only diff that binds
// "the two combatants are visually distinct" into every suite run (the full
// rendered-pixel measurement lives in tools/parity/check-d-ac1.mjs; this
// test guards the same property at the layer-tree level so a regression is
// caught by `node --test` alone, no canvas needed).
//
// The hardest case is exercised deliberately: a SAME-ELEMENT duel served
// from the SAME source shape files (the vendored fallback sets — what the
// stage plays when the bucket is down), so the two combatants' entire
// distinctness rests on the live per-wizard recolour. Their recoloured
// layer trees must differ for EVERY duel state — and provably by colour
// alone (geometry digests stay identical when the source shapes are
// identical).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRigLoadout, DUEL_STATES } from '../ui/components/battle/rigAssets.js';
import { wizardIdentity } from '../engine/wizardRig.js';
import { recolorAnimation, geometryDigest, colourInventory } from '../engine/rigRecolor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RIG_ASSETS = path.resolve(__dirname, '..', '..', 'assets', 'rig');

/** Serve every url (bucket or local) from the vendored library files —
 * same fake as rig-stage.test.js; the network is never touched. */
function localFetch() {
  return async (url) => {
    let file = null;
    let m = /wizard-animations\/([a-z]+)-(FIRE|WATER|WIND|NEUTRAL)-.+\.json$/.exec(url);
    if (m) file = path.join(RIG_ASSETS, 'fallback', m[2], `${m[1].replace(/^affinitycape(win|lose)$/, '')}.json`);
    m = /wizard-animations\/affinitycape(win|lose)-(FIRE|WATER|WIND)-\d+\.json$/.exec(url);
    if (m) file = path.join(RIG_ASSETS, 'fx', `affinitycape${m[1]}-${m[2]}.json`);
    m = /assets\/rig\/(.+)$/.exec(url);
    if (m) file = path.join(RIG_ASSETS, m[1]);
    try {
      const text = await fs.readFile(file, 'utf8');
      return { ok: true, json: async () => JSON.parse(text) };
    } catch { return { ok: false, status: 404 }; }
  };
}

/** The recoloured layer-tree digest: geometry + the full colour inventory.
 * Two combatants whose digests agree would render identically. */
function layerTreeDigest(animation) {
  return geometryDigest(animation) + '|' + colourInventory(animation).map((c) => c.hex).join(',');
}

test('C7/AC1 distinctness (suite slice): same-element duel, same source shapes — the recoloured layer-tree digests of the two combatants differ for EVERY duel state', async () => {
  const loadout = createRigLoadout({
    p1Character: { id: 'distinct-A', element: 'fire', tier: 0 },
    p2Character: { id: 'distinct-B', element: 'fire', tier: 0 },
    fetchImpl: localFetch(),
    cache: new Map(),
  });
  await loadout.ready;
  for (const state of DUEL_STATES) {
    const a = loadout.get('p1', state);
    const b = loadout.get('p2', state);
    assert.notEqual(layerTreeDigest(a), layerTreeDigest(b),
      `state ${state}: the two combatants' recoloured layer trees must differ (distinctness, §17 AC1)`);
  }
});

test('C7/AC1 distinctness (suite slice): the difference is COLOUR, not geometry — identical source shapes keep identical geometry digests under both recolours', async () => {
  const idA = wizardIdentity({ id: 'distinct-A', element: 'fire', tier: 0 });
  const idB = wizardIdentity({ id: 'distinct-B', element: 'fire', tier: 0 });
  for (const state of DUEL_STATES) {
    const source = JSON.parse(await fs.readFile(path.join(RIG_ASSETS, 'fallback', 'FIRE', `${state}.json`), 'utf8'));
    const a = recolorAnimation(source, idA.palette).animation;
    const b = recolorAnimation(source, idB.palette).animation;
    assert.equal(geometryDigest(a), geometryDigest(b), `state ${state}: geometry must be untouched by recolour`);
    assert.notEqual(JSON.stringify(colourInventory(a)), JSON.stringify(colourInventory(b)),
      `state ${state}: the colour inventories must differ between the two wizards' recolours`);
  }
});

test('C7/AC1 distinctness (suite slice): the same-COMBO worst case — two wizards sharing one shape combo still differ in every state (palette alone carries distinctness)', async () => {
  // find a same-element pair colliding on the shape combo (the parity
  // harness's hardest sampled case, bound here into the suite)
  const base = wizardIdentity({ id: 'distinct-combo-base', element: 'fire', tier: 0 });
  let probe = null;
  for (let i = 0; i < 20000 && !probe; i++) {
    const cand = wizardIdentity({ id: `distinct-combo-${i}`, element: 'fire', tier: 0 });
    if (cand.comboKey === base.comboKey && JSON.stringify(cand.palette) !== JSON.stringify(base.palette)) probe = cand;
  }
  assert.ok(probe, 'a same-combo pair exists within 20000 probes');
  for (const state of DUEL_STATES) {
    const source = JSON.parse(await fs.readFile(path.join(RIG_ASSETS, 'fallback', 'FIRE', `${state}.json`), 'utf8'));
    const a = recolorAnimation(source, base.palette).animation;
    const b = recolorAnimation(source, probe.palette).animation;
    assert.notEqual(layerTreeDigest(a), layerTreeDigest(b),
      `state ${state}: same shape combo, different palette — layer trees must still differ`);
  }
});
