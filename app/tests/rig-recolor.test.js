// app/tests/rig-recolor.test.js — CB-BUILD-006 / §18: recolour correctness
// on the REAL vendored shape sets (assets/rig/fallback — byte-identical
// downloads from the production library). Same combo + different palette =>
// different colours, IDENTICAL shapes; slot colours land exactly where the
// slot classes point; fixed classes (outline ink, head skin, wand wood) and
// the element FX never recolour; the source object is never mutated (no
// baked colour anywhere).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recolorAnimation, geometryDigest, colourInventory, CLASS_TO_SLOT, FIXED_CLASSES } from '../engine/rigRecolor.js';
import { derivePalette } from '../engine/wizardRig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RIG_ASSETS = path.resolve(__dirname, '..', '..', 'assets', 'rig');

async function loadState(element, state) {
  return JSON.parse(await fs.readFile(path.join(RIG_ASSETS, 'fallback', element, `${state}.json`), 'utf8'));
}

test('same combo + different palette => different colours, same shapes (geometry digest identical)', async () => {
  const source = await loadState('FIRE', 'idle');
  const pA = derivePalette('wizard-A');
  const pB = derivePalette('wizard-B');
  assert.notDeepEqual(pA, pB, 'the two derived palettes must differ for this test to bite');
  const a = recolorAnimation(source, pA);
  const b = recolorAnimation(source, pB);
  assert.ok(a.stats.recoloured > 5, `expected a real recolour, touched ${a.stats.recoloured} items`);
  assert.equal(geometryDigest(a.animation), geometryDigest(b.animation), 'recolour must change colours and NOTHING else');
  assert.notEqual(JSON.stringify(a.animation), JSON.stringify(b.animation), 'different palettes must produce different composited output');
});

test('slot colours land exactly on their classes; fixed classes and FX stay source-coloured', async () => {
  const source = await loadState('FIRE', 'idle');
  const palette = derivePalette('wizard-slots');
  const { animation } = recolorAnimation(source, palette);
  const before = colourInventory(source);
  const after = colourInventory(animation);
  assert.equal(before.length, after.length, 'no fill/stroke added or removed');
  for (let i = 0; i < before.length; i++) {
    const b = before[i];
    const a = after[i];
    assert.equal(b.cl, a.cl);
    if (b.cl && CLASS_TO_SLOT[b.cl]) {
      const want = palette[CLASS_TO_SLOT[b.cl]];
      if (want) assert.equal(a.hex, want.toUpperCase(), `class ${b.cl} must carry the palette's ${CLASS_TO_SLOT[b.cl]}`);
    } else if (b.cl && FIXED_CLASSES.includes(b.cl)) {
      assert.equal(a.hex, b.hex, `fixed class ${b.cl} must keep its source colour`);
    }
  }
});

test('the charge/attack element-FX layers pass through untouched (FX to source fidelity, not a recoloured or flat fill)', async () => {
  const source = await loadState('FIRE', 'charge');
  const palette = derivePalette('wizard-fx');
  const { animation } = recolorAnimation(source, palette);
  const fxColours = (json) => colourInventory(json).filter((c) => !c.cl || (!CLASS_TO_SLOT[c.cl] && !FIXED_CLASSES.includes(c.cl)));
  // FX fills are unclassed (except leg hoses, which are strokes matched by
  // layer name): every unclassed FILL must be byte-identical to source.
  const beforeAll = colourInventory(source);
  const afterAll = colourInventory(animation);
  for (let i = 0; i < beforeAll.length; i++) {
    if (!beforeAll[i].cl && beforeAll[i].ty === 'fl') {
      assert.equal(afterAll[i].hex, beforeAll[i].hex, 'unclassed FX fill recoloured — FX must keep source fidelity');
    }
  }
  assert.ok(fxColours(source).length > 0, 'charge state must actually carry FX colours');
});

test('recolorAnimation never mutates its source (no baked colour: one cached fetch can serve both combatants)', async () => {
  const source = await loadState('WATER', 'win');
  const pristine = JSON.stringify(source);
  recolorAnimation(source, derivePalette('wizard-C'));
  recolorAnimation(source, derivePalette('wizard-D'));
  assert.equal(JSON.stringify(source), pristine, 'source animation JSON must remain untouched');
});

test('leg hoses recolour with pants-base via their own body-pants class — the portraits route legs to pants the same way', async () => {
  const source = await loadState('WIND', 'idle');
  const palette = { ...derivePalette('wizard-legs'), 'pants-base': '#3DADEA' };
  const { animation, stats } = recolorAnimation(source, palette);
  assert.ok(stats.legHoses > 0, `expected leg hose strokes to recolour, got ${stats.legHoses}`);
  const legs = colourInventory(animation).filter((c) => c.cl === 'body-pants' && c.ty === 'st' && c.hex === '#3DADEA');
  assert.ok(legs.length >= stats.legHoses, 'recoloured hose strokes must carry the pants colour');
});

test('the affinity-cape FX overlays recolour their CAPE-base slot to the wizard cape and keep outline ink', async () => {
  const source = JSON.parse(await fs.readFile(path.join(RIG_ASSETS, 'fx', 'affinitycapewin-FIRE.json'), 'utf8'));
  const palette = { ...derivePalette('wizard-cape'), 'cape-base': '#A66EFF' };
  const { animation } = recolorAnimation(source, palette);
  const inv = colourInventory(animation);
  assert.ok(inv.some((c) => c.cl === 'CAPE-base' && c.hex === '#A66EFF'), 'CAPE-base must carry the wizard cape colour');
  for (const c of inv.filter((x) => x.cl && x.cl.startsWith('black'))) {
    assert.equal(c.hex, '#000000', 'outline ink must stay black');
  }
});
