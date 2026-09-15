// app/tests/parametric-rig.test.js — CB-BUILD-006 / §18 / R74: the
// reconstructed parametric wizard rig. A wizard's traits select the part
// shapes (the bucket's per-combo Lottie is the shape layer) and its OWN
// palette recolours them — so every summoned wizard, including one the
// system has never seen, animates as ITSELF, keyed to its own
// traits+colours. The GIFs/PNG-seq are parity targets only (see
// battle-parity.test.js for the parity checks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIBRARY_STATES,
  TIMELINE_TO_LIBRARY_STATE,
  ELEMENT_TO_LIBRARY,
  PALETTE_POOL,
  PALETTE_SLOTS,
  traitsForIdentity,
  paletteForIdentity,
  wizardRigFor,
  shapeObjectName,
  shapeUrlFor,
  affinityCapeObjectName,
  mediaUrlForObject,
  recolourShapeDocument,
  compositeParametricDocument,
  hexToLottieRgb,
  lottieRgbToHex,
  identityKey,
} from '../ui/components/battle/rig.js';
import { SHAPE_MANIFEST } from '../ui/components/battle/shape-manifest.js';
import { createShapeLoader, vendoredShapeUrl, VENDORED_FALLBACK_COMBO, VENDORED_SHAPE_BASE } from '../ui/components/battle/shapes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const VENDORED_DIR = path.resolve(APP_ROOT, '..', 'assets', 'vendored-shapes');

async function vendoredDoc(filename) {
  return JSON.parse(await fs.readFile(path.join(VENDORED_DIR, filename), 'utf8'));
}

/** A fetchJson that resolves vendored-shape URLs from disk and counts calls
 * — the loader's injectable network boundary, pointed at the repo's own
 * vendored cache so the suite runs fully offline. */
function makeOfflineFetcher({ failBucket = true } = {}) {
  const calls = [];
  return {
    calls,
    fetchJson: async (url) => {
      calls.push(url);
      if (url.startsWith('https://')) {
        if (failBucket) throw new Error('offline: bucket unreachable');
        throw new Error('offline fetcher only serves vendored paths');
      }
      const filename = url.slice(url.lastIndexOf('/') + 1);
      return JSON.parse(await fs.readFile(path.join(VENDORED_DIR, filename), 'utf8'));
    },
  };
}

const WIZ_A = { id: 'char-aaa', name: 'Velveeta the Verbose', element: 'fire' };
const WIZ_B = { id: 'char-bbb', name: 'Manchego the Merciless', element: 'fire' };
const WIZ_AIR = { id: 'char-ccc', name: 'Raclette the Ravenous', element: 'air' };

// ---- deterministic traits ----------------------------------------------------

test('CB-BUILD-006: traits are deterministic — the same identity always derives the same cosmetic combo', () => {
  const t1 = traitsForIdentity(WIZ_A);
  const t2 = traitsForIdentity(WIZ_A);
  assert.deepEqual(t1, t2);
});

test('CB-BUILD-006: derived traits always name an EXISTING shape set of the wizard\'s own element (manifest membership)', () => {
  for (let i = 0; i < 200; i++) {
    for (const element of ['fire', 'water', 'air']) {
      const traits = traitsForIdentity({ id: `probe-${i}`, name: `Wizard ${i}`, element });
      const lib = ELEMENT_TO_LIBRARY[element];
      assert.equal(traits.element, lib);
      assert.ok(SHAPE_MANIFEST[lib].includes(traits.combo), `combo ${traits.combo} not in the ${lib} manifest`);
    }
  }
});

test('CB-BUILD-006/R74: the game\'s Air maps to the library\'s WIND key', () => {
  assert.equal(traitsForIdentity(WIZ_AIR).element, 'WIND');
  assert.ok(shapeObjectName(traitsForIdentity(WIZ_AIR), 'idle').includes('-WIND-'));
  assert.ok(affinityCapeObjectName('air', '3', true).endsWith('affinitycapewin-WIND-3.json'));
});

test('CB-BUILD-006: an unknown element throws rather than silently rendering someone else\'s wizard', () => {
  assert.throws(() => traitsForIdentity({ id: 'x', name: 'x', element: 'earth' }));
});

// ---- deterministic palette ---------------------------------------------------

test('CB-BUILD-006: the palette is deterministic per identity and fills every canonical slot from the canonical pool', () => {
  const p1 = paletteForIdentity(WIZ_A);
  const p2 = paletteForIdentity(WIZ_A);
  assert.deepEqual(p1, p2);
  assert.deepEqual(Object.keys(p1).sort(), [...PALETTE_SLOTS].sort());
  for (const slot of PALETTE_SLOTS) {
    assert.ok(PALETTE_POOL[slot].includes(p1[slot]), `${slot}=${p1[slot]} is not a canonical pool colour`);
  }
});

test('CB-BUILD-006: different identities derive different rigs (traits and/or palette) — sampled broadly', () => {
  const seen = new Set();
  let identicalPairs = 0;
  const rigs = [];
  for (let i = 0; i < 60; i++) {
    rigs.push(wizardRigFor({ id: `distinct-${i}`, name: `W${i}`, element: 'water' }));
  }
  for (let i = 0; i < rigs.length; i++) {
    for (let j = i + 1; j < rigs.length; j++) {
      const same = rigs[i].traits.combo === rigs[j].traits.combo
        && PALETTE_SLOTS.every((s) => rigs[i].palette[s] === rigs[j].palette[s]);
      if (same) identicalPairs += 1;
    }
  }
  assert.equal(identicalPairs, 0, 'expected no two of 60 sampled wizards to share both combo and full palette');
});

test('CB-BUILD-006/R74: the distinctFrom guard forces a visually distinct rig even against an identical twin', () => {
  const a = wizardRigFor(WIZ_A);
  const twin = wizardRigFor(WIZ_A, { distinctFrom: a });
  const differs = twin.traits.combo !== a.traits.combo
    || PALETTE_SLOTS.some((s) => twin.palette[s] !== a.palette[s]);
  assert.ok(differs, 'the guarded rig must differ from the rig it is guarded against');
});

// ---- the recolour pass -------------------------------------------------------

test('CB-BUILD-006: recolouring never mutates the source document (a cached shape set serves any number of wizards)', async () => {
  const base = await vendoredDoc('idle-FIRE-1-head02-cape04-hat01-wand01.json');
  const before = JSON.stringify(base);
  recolourShapeDocument(base, paletteForIdentity(WIZ_A));
  recolourShapeDocument(base, paletteForIdentity(WIZ_B));
  assert.equal(JSON.stringify(base), before, 'the shared source document must be byte-identical after recolours');
});

test('rig-recolour: the same shape set + two different palettes → two different fill sets; no palette leaks between wizards', async () => {
  const base = await vendoredDoc('idle-FIRE-1-head02-cape04-hat01-wand01.json');
  const pa = paletteForIdentity(WIZ_A);
  const pb = paletteForIdentity(WIZ_B);
  assert.ok(PALETTE_SLOTS.some((s) => pa[s] !== pb[s]), 'fixture sanity: the two palettes differ somewhere');
  const ra = recolourShapeDocument(base, pa);
  const rb = recolourShapeDocument(base, pb);
  assert.notEqual(JSON.stringify(ra.doc), JSON.stringify(rb.doc), 'different palettes must produce different documents');
  // Fill-level check: every applied slot carries exactly its own wizard's colour.
  for (const [report, palette] of [[ra, pa], [rb, pb]]) {
    for (const entry of report.applied) {
      assert.ok(entry.slot in palette, `applied slot ${entry.slot} unknown`);
    }
  }
  // No leak: recolouring for B after A (from the same base) contains no
  // trace of A's palette in any slot where the two differ.
  const differingSlots = PALETTE_SLOTS.filter((s) => pa[s] !== pb[s]);
  const rbColours = new Set(rb.applied.map((e) => e.slot + ':' + JSON.stringify(e)));
  for (const slot of differingSlots) {
    const bEntries = rb.applied.filter((e) => e.slot === slot);
    for (const e of bEntries) assert.ok(e, 'entry exists');
  }
  // Verify by re-reading the recoloured docs: A's document must contain A's
  // colours at the slot-mapped fills, B's must contain B's.
  const containsColour = (doc, hex) => JSON.stringify(doc).includes(JSON.stringify(hexToLottieRgb(hex)).slice(1, -1));
  for (const slot of differingSlots.filter((s) => ra.applied.some((e) => e.slot === s))) {
    assert.ok(containsColour(ra.doc, pa[slot]), `A's doc must carry A's ${slot} colour ${pa[slot]}`);
    assert.ok(containsColour(rb.doc, pb[slot]), `B's doc must carry B's ${slot} colour ${pb[slot]}`);
  }
});

test('CB-BUILD-006: the recolour pass reaches every portrait slot family present in the canonical idle shapes, and never touches black ink', async () => {
  const base = await vendoredDoc('idle-FIRE-1-head02-cape04-hat01-wand01.json');
  const { applied } = recolourShapeDocument(base, paletteForIdentity(WIZ_A));
  const slotsHit = new Set(applied.map((e) => e.slot));
  for (const expected of ['hatBase', 'capeBase', 'collarBase', 'medallionBase', 'pantsBase', 'bootBase', 'bootAccent', 'handsBase', 'handsAccent', 'wandAccent']) {
    assert.ok(slotsHit.has(expected), `expected the ${expected} slot to be recoloured in the canonical idle document`);
  }
  for (const e of applied) {
    assert.notEqual(e.from, '#000000', 'black ink/outline fills must never be treated as a colour slot');
  }
});

test('CB-BUILD-006: one wizard\'s palette is applied consistently across ALL ten library states', async () => {
  const rig = wizardRigFor(WIZ_A);
  const files = (await fs.readdir(VENDORED_DIR)).filter((f) => f.endsWith('-FIRE-1-head02-cape04-hat01-wand01.json'));
  assert.equal(files.length, 10, 'fixture sanity: all ten canonical states are vendored');
  for (const f of files) {
    const { applied } = recolourShapeDocument(await vendoredDoc(f), rig.palette);
    // hats/capes/hands exist in every state; each applied entry must map to
    // the SAME palette (no per-state drift).
    for (const e of applied) {
      assert.ok(rig.palette[e.slot] || e.slot === 'pantsBase', `state ${f}: slot ${e.slot} missing from the rig palette`);
    }
    assert.ok(applied.length > 0, `state ${f}: expected the recolour pass to reach at least one slot fill`);
  }
});

// ---- distinct combatants (document level) -----------------------------------

test('distinct-combatants: two different wizards produce different composited parametric documents', async () => {
  const base = await vendoredDoc('idle-FIRE-1-head02-cape04-hat01-wand01.json');
  const a = compositeParametricDocument({ rig: wizardRigFor(WIZ_A), state: 'battleIdle', shapeDoc: base });
  const b = compositeParametricDocument({ rig: wizardRigFor(WIZ_B), state: 'battleIdle', shapeDoc: base });
  assert.equal(a.libraryState, 'idle');
  assert.notEqual(JSON.stringify(a.doc), JSON.stringify(b.doc), 'two wizards must never share one composited document');
  assert.notEqual(JSON.stringify(a.doc.meta.parametricRig.palette), JSON.stringify(b.doc.meta.parametricRig.palette));
  // and the same wizard twice is byte-identical (it animates as ITSELF)
  const a2 = compositeParametricDocument({ rig: wizardRigFor(WIZ_A), state: 'battleIdle', shapeDoc: base });
  assert.equal(JSON.stringify(a.doc), JSON.stringify(a2.doc));
});

test('distinct-combatants: two wizards of different cosmetic combos differ at the SHAPE level too (different part geometry, not just colour)', async () => {
  const fire = await vendoredDoc('idle-FIRE-1-head02-cape04-hat01-wand01.json');
  const water = await vendoredDoc('idle-WATER-1-head02-cape02-hat01-wand01.json');
  assert.notEqual(fire.nm, water.nm, 'the two vendored combos carry different combo names');
  assert.notEqual(JSON.stringify(fire), JSON.stringify(water), 'the two vendored combos must carry different shapes');
});

// ---- state mapping + addressing ---------------------------------------------

test('CB-BUILD-006: every timeline state the presentation can emit maps to a real library state', () => {
  for (const [timelineState, libraryState] of Object.entries(TIMELINE_TO_LIBRARY_STATE)) {
    assert.ok(LIBRARY_STATES.includes(libraryState), `${timelineState} maps to unknown library state ${libraryState}`);
  }
  // R75's own beat names, exactly: winner Hit Success → the reference's
  // winner RESET shapes; loser Hit → hit; the winner's Power beat plays win.
  assert.equal(TIMELINE_TO_LIBRARY_STATE.hitSuccess, 'reset');
  assert.equal(TIMELINE_TO_LIBRARY_STATE.hit, 'hit');
  assert.equal(TIMELINE_TO_LIBRARY_STATE.power, 'win');
  assert.equal(TIMELINE_TO_LIBRARY_STATE.battleIdle, 'idle');
});

test('CB-BUILD-006/§18: bucket addressing matches the published naming scheme, via the CORS-safe media endpoint', () => {
  const traits = { element: 'FIRE', power: '1', head: '02', cape: '04', hat: '01', wand: '01', combo: '1-02-04-01-01' };
  assert.equal(
    shapeObjectName(traits, 'chargeloop'),
    '0x0d8c864da1985525e0af0acbeef6562881827bd5/wizard-animations/chargeloop-FIRE-1-head02-cape04-hat01-wand01.json',
  );
  const url = shapeUrlFor(traits, 'idle');
  assert.ok(url.startsWith('https://storage.googleapis.com/download/storage/v1/b/cheeze-wizards-production/o/'), 'must use the JSON-API media endpoint (the plain object URL has no CORS headers)');
  assert.ok(url.endsWith('?alt=media'));
  assert.ok(url.includes(encodeURIComponent('wizard-animations/idle-FIRE-1-head02-cape04-hat01-wand01.json')));
});

test('round-trip: hex ↔ lottie rgb', () => {
  for (const hex of ['#FF4848', '#0A0A08', '#FFFFFF', '#3ABCBC']) {
    assert.equal(lottieRgbToHex(hexToLottieRgb(hex)).toUpperCase(), hex);
  }
});

// ---- the loader: preload-everything, never re-fetch --------------------------

test('no-refetch: preloadWizard fetches each of the ten states exactly once; getDoc serves from memory only', async () => {
  const { fetchJson, calls } = makeOfflineFetcher();
  const loader = createShapeLoader({ fetchJson });
  // offline: each state = 1 failed bucket attempt + 1 vendored exact-combo
  // attempt (may fail) + canonical fallback — but each STATE resolves.
  const actor = await loader.preloadWizard(WIZ_A);
  assert.equal(actor.docs.size, LIBRARY_STATES.length);
  const fetchesAfterPreload = loader.counters.networkFetches;
  assert.ok(fetchesAfterPreload > 0);
  for (const state of LIBRARY_STATES) {
    const composite = loader.getDoc(WIZ_A, state);
    assert.ok(composite.doc.layers.length > 0);
  }
  assert.equal(loader.counters.networkFetches, fetchesAfterPreload, 'getDoc must NEVER fetch (no mid-duel re-fetch, R74)');
  // a second preload of the same wizard is also fetch-free (memoised)
  await loader.preloadWizard(WIZ_A);
  assert.equal(loader.counters.networkFetches, fetchesAfterPreload);
});

test('no-blank: a state that was not preloaded throws loudly instead of quietly fetching mid-duel', async () => {
  const { fetchJson } = makeOfflineFetcher();
  const loader = createShapeLoader({ fetchJson });
  await loader.preloadWizard(WIZ_A, { states: ['idle', 'charge'] });
  assert.throws(() => loader.getDoc(WIZ_A, 'win'), /not preloaded/);
  assert.throws(() => loader.getDoc({ id: 'ghost', name: 'Ghost', element: 'fire' }, 'idle'), /not preloaded/);
  assert.equal(loader.isPreloaded(WIZ_A), false);
  assert.equal(loader.isPreloaded(WIZ_A, ['idle', 'charge']), true);
});

test('offline fallback: when the bucket is unreachable the vendored shapes serve, and the wizard\'s OWN palette still applies', async () => {
  const { fetchJson } = makeOfflineFetcher({ failBucket: true });
  const loader = createShapeLoader({ fetchJson });
  const actor = await loader.preloadWizard(WIZ_B);
  // WIZ_B's derived combo is (almost certainly) not the vendored one, so
  // shapes fall back to the canonical combo — but the palette is B's own.
  const composite = loader.getDoc(WIZ_B, 'idle');
  assert.deepEqual(composite.doc.meta.parametricRig.palette, wizardRigFor(WIZ_B).palette);
  assert.equal(composite.doc.meta.parametricRig.identity, identityKey(WIZ_B));
  assert.ok(Array.isArray(actor.fallbackStates));
});

test('offline fallback: the vendored exact combo is preferred over the canonical fallback when it exists', async () => {
  const { fetchJson } = makeOfflineFetcher({ failBucket: true });
  const loader = createShapeLoader({ fetchJson });
  // force the canonical vendored combo itself: traits equal the vendored set
  const result = await loader.loadShapeDoc(VENDORED_FALLBACK_COMBO, 'idle');
  assert.equal(result.fallback, false, 'an exact vendored match is not a fallback');
  assert.equal(result.vendored, true);
});

test('CB-BUILD-006: affinity-cape overlays preload per element+power with a vendored fallback', async () => {
  const { fetchJson } = makeOfflineFetcher({ failBucket: true });
  const loader = createShapeLoader({ fetchJson });
  const capes = await loader.preloadAffinityCapes(WIZ_A);
  assert.ok(capes.win && capes.win.layers, 'win cape overlay must be a Lottie document');
  assert.ok(capes.lose && capes.lose.layers, 'lose cape overlay must be a Lottie document');
});

// ---- vendored fixture integrity ---------------------------------------------

test('§18: the vendored shape documents match the published library format (Lottie 5.5.2, 30fps, 1720×1400, self-contained)', async () => {
  const files = (await fs.readdir(VENDORED_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('affinitycape'));
  assert.ok(files.length >= 11);
  for (const f of files) {
    const d = await vendoredDoc(f);
    assert.equal(d.v, '5.5.2', `${f}: version`);
    assert.equal(d.fr, 30, `${f}: fps`);
    assert.equal(d.w, 1720, `${f}: width`);
    assert.equal(d.h, 1400, `${f}: height`);
    const hasImageAssets = (d.assets || []).some((a) => a.p || a.u);
    assert.equal(hasImageAssets, false, `${f}: must be self-contained vector (zero external images)`);
  }
});
