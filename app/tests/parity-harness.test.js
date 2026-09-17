// app/tests/parity-harness.test.js — CB-BUILD-015: the id-keyed parity
// harness's CONTRACT, bound OFFLINE (no network, no native canvas, no
// browser). The harness itself renders pixels; what is testable without a
// renderer is the part that decides what the pixels MEAN:
//
//  1. WHICH WIZARD each row compares, and that both sides get that same one:
//     a generated id takes the shipped read path's derivation; the canonical
//     row takes the PRE-REGISTERED identity, injected — and the engine-side
//     loadout built from an injected identity is the shipped loadout's own
//     output for the same identity, byte for byte;
//  2. the reference side's class→slot routing, derived by parsing the
//     PORTRAIT colour-slot system, agrees with the engine's own table over
//     every class the real (vendored, in-repo) shape sets actually carry —
//     the cross-check that makes the pixel diff meaningful;
//  3. the two recolours, written independently, produce the SAME document
//     for the same wizard on a real library file;
//  4. the comparer's verdict math: every criterion passes when it should,
//     FAILS when it should, and is read from PREREGISTRATION.md rather than
//     from literals in the code;
//  5. both player configurations are PARSED from the shipped sources (the
//     2019 factory and the stage), never retyped;
//  6. the SHIPPED RUN describes the tree it was made on — the commit it ran
//     at is recorded, the tree was clean, that commit is an ancestor of HEAD,
//     and every harness source AND every measured engine module still hashes
//     to what the run recorded (fix round g1: the engine list is a GATE now,
//     not a note — move the engine without re-running check E and this file
//     goes red).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wizardIdentity } from '../engine/wizardRig.js';
import { recolorAnimation, CLASS_TO_SLOT } from '../engine/rigRecolor.js';
import { createRigLoadout, DUEL_STATES } from '../ui/components/battle/rigAssets.js';
import { loadPreregistration } from '../../tools/parity/preregistration.mjs';
import { parsePortraitSlots, buildReferenceSlotMap, referenceRecolor, staticColours } from '../../tools/parity/reference-recolor.mjs';
import { parseReferencePlayerConfig, parseStagePlayerConfig } from '../../tools/parity/player-config.mjs';
import { compareState, frameMetrics, documentParity } from '../../tools/parity/compare.mjs';
import { canonicalWizard, identityFor, createDeclaredIdentityLoadout, parseLoadoutFallbackBase, DECLARED_INJECTION } from '../../tools/parity/identity.mjs';
import { HARNESS_DIGEST_FILES, ENGINE_DIGEST_FILES, BUNDLE_GIF_FILES, PORTRAIT_SVG_FILES, CHECK_RUNS, CHECK_IDS, digestFiles, isAncestorOfHead, gitProvenance } from '../../tools/parity/provenance.mjs';
import { shippedRunFreshness, allFreshness, freshnessOf, freshnessOfRecord, freshnessBanner, stalenessMessage } from '../../tools/parity/freshness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const FALLBACK = path.join(REPO, 'assets', 'rig', 'fallback');
const prereg = loadPreregistration();

// A real library document from the repo (byte-identical library download) —
// no network needed to exercise the recolour contract on real shapes.
const realClip = JSON.parse(fs.readFileSync(path.join(FALLBACK, 'FIRE', 'idle.json'), 'utf8'));

// ---------------------------------------------------------------------------
// 1. which wizard each row compares, and that both sides get that same one
// ---------------------------------------------------------------------------

/** The shipped loadout, with the network stubbed out by a real in-repo clip. */
function offlineLoadout(character) {
  const fetchImpl = async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(realClip)) });
  return createRigLoadout({ p1Character: character, p2Character: character, fetchImpl, cache: new Map() });
}

// SMOKE CHECK, and labelled as one. Both sides of the comparison call the
// same `wizardIdentity()` for a generated wizard, so this cannot fail while
// that is true — it guards the wiring (the harness does not accidentally
// derive twice, or feed the loadout a different character), not the identity.
// The assertions with teeth are the ones below it: the DECLARED identity, the
// injected-identity loadout, and the shipped run's provenance.
test('smoke: for a generated wizard, the identity the harness feeds both sides is the one the shipped loadout resolved', async () => {
  const characters = [
    { id: 'parity-contract-1', element: 'fire', tier: 0 },
    { id: 'parity-contract-2', element: 'water', tier: 3 },
    { id: 'parity-contract-3', element: 'air', tier: 6 },
  ];
  for (const character of characters) {
    // the identity the harness resolves (identity.mjs — what parity-wizard.mjs
    // hands to the reference side) …
    const identity = identityFor(character);
    assert.equal(identity.source, 'derived', `${character.id}: a generated wizard takes the shipped read path`);
    // … and the engine side's own, through the shipped loadout
    const loadout = offlineLoadout(character);
    await loadout.ready;
    assert.equal(loadout.identities.p1.comboKey, identity.comboKey, `${character.id}: same shape set on both sides`);
    assert.deepEqual(loadout.identities.p1.palette, identity.palette, `${character.id}: same palette on both sides`);
    assert.deepEqual(loadout.identities.p1.traits, identity.traits, `${character.id}: same parts on both sides`);
    // a DIFFERENT id must not resolve to the same wizard's colours
    const other = wizardIdentity({ ...character, id: `${character.id}-other` });
    assert.notDeepEqual(other.palette, identity.palette, `${character.id}: another id is another wizard`);
  }
});

test('the canonical wizard enters as the PRE-REGISTERED identity, injected — not inferred from a record the read path ignores', () => {
  const canonical = canonicalWizard(prereg);
  const identity = identityFor(canonical);
  const checkA = JSON.parse(fs.readFileSync(path.join(REPO, 'tools', 'parity', 'results', 'check-a-gifs.json'), 'utf8'));

  assert.equal(identity.source, 'declared', 'the canonical row does not take the derivation path');
  assert.equal(identity.comboKey, prereg.canonicalWizard.comboKey, 'the combo compared IS the pre-registered one');
  assert.deepEqual(identity.palette, checkA.paletteFit.palette, "the palette compared IS check A's fitted palette");
  assert.equal(identity.traits.comboKey, prereg.canonicalWizard.comboKey);

  // The point of the injection: the declaration holds whatever the engine's
  // READ path derives for this id — and whether the two agree is recorded,
  // never assumed. (At CB-BUILD-022's head they do not: the read path never
  // consults character.traits/palette, so the recorded-record route would
  // have silently compared a different wizard.)
  const derived = wizardIdentity(canonical);
  assert.equal(identity.engineDerived.comboKey, derived.comboKey, 'what the read path would derive is recorded beside the row');
  assert.equal(identity.matchesEngineDerivation, derived.comboKey === identity.comboKey, 'agreement with the read path is recorded as the fact it is');
  // and the character carries no recorded traits/palette to be misread as the source
  assert.equal(canonical.traits, undefined, 'the canonical character carries no recorded traits — the declaration is the source');
  assert.equal(canonical.palette, undefined, 'the canonical character carries no recorded palette — the declaration is the source');
});

test('the harness refuses to run the canonical row unless the declaration declares the injection', () => {
  const without = { ...prereg, canonicalWizard: { ...prereg.canonicalWizard, identityInjection: undefined } };
  assert.throws(() => canonicalWizard(without), /identityInjection/, 'an undeclared canonical row stops the harness');
  const wrong = { ...prereg, canonicalWizard: { ...prereg.canonicalWizard, identityInjection: 'whatever' } };
  assert.throws(() => canonicalWizard(wrong), /identityInjection/);
  assert.equal(prereg.canonicalWizard.identityInjection, DECLARED_INJECTION, 'the committed declaration declares it');
  const badCombo = { ...prereg, canonicalWizard: { ...prereg.canonicalWizard, comboKey: 'not-a-combo' } };
  assert.throws(() => canonicalWizard(badCombo), /is not a combo key/);
});

test('the injected-identity loadout is the SHIPPED loadout: same documents, same degradation report, for the same identity', async () => {
  const character = { id: 'parity-contract-injected', element: 'fire', tier: 0 };
  const identity = identityFor(character); // a DERIVED identity, so the shipped loadout can be asked for the same one
  const clip = () => JSON.parse(JSON.stringify(realClip));

  const online = async () => ({ ok: true, json: async () => clip() });
  const shipped = createRigLoadout({ p1Character: character, p2Character: character, fetchImpl: online, cache: new Map() });
  const injected = createDeclaredIdentityLoadout({ identity, fetchImpl: online, cache: new Map() });
  await Promise.all([shipped.ready, injected.ready]);
  for (const state of DUEL_STATES) {
    assert.deepEqual(injected.get('p1', state), shipped.get('p1', state), `'${state}': the injected-identity loadout produces the shipped document`);
  }
  for (const kind of ['win', 'lose']) {
    assert.deepEqual(injected.getCape('p1', kind), shipped.getCape('p1', kind), `cape '${kind}': same document`);
  }
  assert.deepEqual(injected.report.p1, shipped.report.p1, 'same degradation report');

  // the same when the bucket is unreachable: both fall back to the vendored
  // shape set for the wizard's element, and both RECORD it
  const fallbackBase = parseLoadoutFallbackBase().base;
  const offline = async (url) => (url.startsWith(fallbackBase) ? { ok: true, json: async () => clip() } : { ok: false, status: 503 });
  const shippedOff = createRigLoadout({ p1Character: character, p2Character: character, fetchImpl: offline, cache: new Map() });
  const injectedOff = createDeclaredIdentityLoadout({ identity, fetchImpl: offline, cache: new Map() });
  await Promise.all([shippedOff.ready, injectedOff.ready]);
  assert.deepEqual(injectedOff.report.p1.fallbackStates.slice().sort(), DUEL_STATES.slice().sort(), 'every state fell back');
  assert.deepEqual(injectedOff.report.p1.fallbackStates.slice().sort(), shippedOff.report.p1.fallbackStates.slice().sort());
  assert.deepEqual(injectedOff.report.p1.fallbackCapes.slice().sort(), shippedOff.report.p1.fallbackCapes.slice().sort());
  for (const state of DUEL_STATES) {
    assert.deepEqual(injectedOff.get('p1', state), shippedOff.get('p1', state), `'${state}': same fallback document`);
  }

  // and it is not a no-op wrapper: hand it a DIFFERENT identity and the
  // documents differ from the shipped loadout's
  const otherIdentity = identityFor({ id: 'parity-contract-injected-other', element: 'fire', tier: 0 });
  const otherLoadout = createDeclaredIdentityLoadout({ identity: otherIdentity, fetchImpl: online, cache: new Map() });
  await otherLoadout.ready;
  assert.notDeepEqual(otherLoadout.get('p1', 'idle'), shipped.get('p1', 'idle'), 'a different identity paints a different document');
});

test('the id-keyed entry point hands the ENGINE-resolved identity to the reference side (one wizard, two pipelines)', () => {
  const src = fs.readFileSync(path.join(REPO, 'tools', 'parity', 'parity-wizard.mjs'), 'utf8');
  assert.match(src, /const wizard = \{[^}]*comboKey: identity\.comboKey[^}]*palette: identity\.palette/s,
    'the reference side is fed the identity the engine resolved, not a second derivation');
  assert.match(src, /engineLoadoutFor\(character/,
    'that identity comes from the engine side (identity.mjs, via engine-frames.mjs), resolved once per wizard');
  assert.match(src, /frameIndices: engineSide\.frames\.map\(\(f\) => f\.n\)/,
    'both sides are sampled at the SAME frame indices');
  assert.match(src, /for \(const state of prereg\.duelStates\)/,
    'the diff runs per duel state, over the pre-registered state list');
});

test('the harness covers every duel state the stage actually plays', () => {
  for (const state of DUEL_STATES) {
    assert.ok(prereg.duelStates.includes(state), `the pre-registered state list covers the loadout's '${state}'`);
  }
});

// ---------------------------------------------------------------------------
// 2-3. the two recolours, written independently, agree
// ---------------------------------------------------------------------------

test('the reference slot map (parsed from the portraits) agrees with the engine table on every class the real shape sets carry', () => {
  const portrait = parsePortraitSlots();
  assert.ok(portrait.slots.length >= 12, 'the portrait colour-slot vocabulary was parsed');
  assert.ok(portrait.files.length >= 1);
  const map = buildReferenceSlotMap(portrait);
  const classes = new Set();
  for (const element of ['FIRE', 'WATER', 'WIND']) {
    for (const state of ['idle', 'attack', 'win']) {
      const clip = JSON.parse(fs.readFileSync(path.join(FALLBACK, element, `${state}.json`), 'utf8'));
      (function walk(o) {
        if (Array.isArray(o)) { o.forEach(walk); return; }
        if (o && typeof o === 'object') {
          if ((o.ty === 'fl' || o.ty === 'st') && o.cl) classes.add(o.cl);
          for (const k in o) walk(o[k]);
        }
      })(clip);
    }
  }
  assert.ok(classes.size >= 10, `real shape sets carry classes to check (${classes.size})`);
  for (const cl of classes) {
    assert.equal(map.resolve(cl) || null, CLASS_TO_SLOT[cl] || null,
      `class '${cl}': the portrait-derived routing and the engine's table must agree (rule: ${map.rule(cl)})`);
  }
  // the outlines / head skin / wand wood are left alone by BOTH sides
  for (const fixed of ['black', 'black-str-4x', 'head-base', 'head-accent', 'wand-base']) {
    assert.equal(map.resolve(fixed), null, `'${fixed}' never recolours on the reference side`);
    assert.equal(CLASS_TO_SLOT[fixed], undefined, `'${fixed}' never recolours on the engine side`);
  }
});

test('the reference recolour and the engine recolour produce the same document for the same wizard (real library file)', () => {
  const identity = wizardIdentity({ id: 'parity-contract-recolour', element: 'fire', tier: 0 });
  const engineDoc = recolorAnimation(realClip, identity.palette).animation;
  const referenceDoc = referenceRecolor(realClip, identity.palette).animation;
  const engineColours = staticColours(engineDoc);
  const referenceColours = staticColours(referenceDoc);
  assert.equal(referenceColours.length, engineColours.length, 'same number of static colour items');
  const diff = documentParity(referenceDoc, engineDoc, buildReferenceSlotMap(), {});
  assert.equal(diff.colourDifferences, 0, 'colour-for-colour identical');
  assert.equal(diff.lengthMismatch, false);
  // and neither side mutated the source
  assert.deepEqual(staticColours(realClip).length, engineColours.length);
  assert.notDeepEqual(staticColours(realClip), engineColours, 'the recolour actually changed colours');
  // a DIFFERENT palette must produce a different document (the check has teeth)
  const otherPalette = wizardIdentity({ id: 'parity-contract-recolour-other', element: 'fire', tier: 0 }).palette;
  const otherDoc = referenceRecolor(realClip, otherPalette).animation;
  assert.ok(documentParity(otherDoc, engineDoc, buildReferenceSlotMap(), {}).colourDifferences > 0,
    'another wizard\'s palette is visible as a document difference');
});

test('a class the portrait system does not know keeps its source colour on the reference side, and is reported', () => {
  const doc = {
    v: '5.5.2', fr: 30, ip: 0, op: 10, w: 1720, h: 1400,
    layers: [{ shapes: [{ ty: 'fl', cl: 'not-a-portrait-slot', c: { a: 0, k: [0.1, 0.2, 0.3, 1] } }, { ty: 'fl', cl: 'hat-base', c: { a: 0, k: [0, 0, 0, 1] } }] }],
  };
  const { animation, stats } = referenceRecolor(doc, { 'hat-base': '#FF0000' });
  assert.deepEqual(animation.layers[0].shapes[0].c.k, [0.1, 0.2, 0.3, 1], 'unknown class untouched');
  assert.equal(staticColours(animation)[1].hex, '#FF0000', 'a known slot recolours');
  assert.deepEqual(stats.unmappedClasses, ['not-a-portrait-slot'], 'the unmapped class is reported, not hidden');
  assert.equal(stats.recoloured, 1);
});

test('an animated colour is never substituted on either side (source fidelity)', () => {
  const animatedFill = { ty: 'fl', cl: 'cape-base', c: { a: 1, k: [{ t: 0, s: [1, 0, 0, 1] }] } };
  const doc = { v: '5.5.2', fr: 30, ip: 0, op: 10, w: 1720, h: 1400, layers: [{ shapes: [animatedFill] }] };
  const palette = { 'cape-base': '#00FF00' };
  assert.equal(referenceRecolor(doc, palette).animation.layers[0].shapes[0].c.a, 1);
  assert.deepEqual(referenceRecolor(doc, palette).animation.layers[0].shapes[0].c.k, animatedFill.c.k);
  assert.deepEqual(recolorAnimation(doc, palette).animation.layers[0].shapes[0].c.k, animatedFill.c.k);
});

// ---------------------------------------------------------------------------
// 4. the comparer's verdict math
// ---------------------------------------------------------------------------

const W = 4, H = 4;
function solidFrame(rgb, { alpha = 255, pixels = W * H } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    const on = p < pixels;
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = on ? alpha : 0;
  }
  return { data, width: W, height: H };
}

function sides({ referenceFrame, engineFrame, state = 'idle', engineClipFrames = null, referenceClipFrames = null, classesSeen = { 'hat-base': 1 }, referenceDoc = null, engineDoc = null, frames = 3 }) {
  const refFrames = prereg.timing.referenceFrames[state];
  const doc = { v: '5.5.2', fr: 30, ip: 0, op: 10, w: 1720, h: 1400, layers: [{ shapes: [{ ty: 'fl', cl: 'hat-base', c: { a: 0, k: [0, 0, 0, 1] } }] }] };
  const mk = (img, n) => ({ n, img });
  return {
    reference: {
      animation: referenceDoc || doc,
      recolourStats: { recoloured: 1, unmappedClasses: [], classesSeen },
      clip: { fps: 30, width: 1720, height: 1400, frames: referenceClipFrames ?? engineClipFrames ?? refFrames, version: '5.5.2' },
      frames: Array.from({ length: frames }, (_, i) => mk(referenceFrame, i)),
    },
    engine: {
      animation: engineDoc || doc,
      clip: { fps: 30, width: 1720, height: 1400, frames: engineClipFrames ?? refFrames, version: '5.5.2' },
      frames: Array.from({ length: frames }, (_, i) => mk(engineFrame, i)),
    },
    slotMap: buildReferenceSlotMap(),
  };
}

test('the comparer PASSES a state only when every pre-registered criterion passes', () => {
  const same = solidFrame([120, 130, 140]);
  const r = compareState({ prereg, state: 'idle', ...sides({ referenceFrame: same, engineFrame: same }) });
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.means.matchPct, 100);
  assert.equal(r.means.silhouetteIoU, 1);
  assert.equal(r.criteria.V1.pass && r.criteria.V2.pass && r.criteria.J1.pass && r.criteria.J2.pass && r.criteria.T1.pass && r.criteria.T2.pass, true);
  assert.equal(r.framesCompared, 3);
});

test('V1 fails when the pixels differ beyond the declared channel tolerance, and passes inside it', () => {
  const base = solidFrame([100, 100, 100]);
  const inside = solidFrame([100 + prereg.visual.pixelChannelTolerance, 100, 100]);
  const outside = solidFrame([100 + prereg.visual.pixelChannelTolerance + 1, 100, 100]);
  assert.equal(compareState({ prereg, state: 'idle', ...sides({ referenceFrame: base, engineFrame: inside }) }).criteria.V1.pass, true);
  const bad = compareState({ prereg, state: 'idle', ...sides({ referenceFrame: base, engineFrame: outside }) });
  assert.equal(bad.criteria.V1.pass, false);
  assert.equal(bad.verdict, 'FAIL');
  assert.equal(bad.means.matchPct, 0);
});

test('V2 fails when the silhouettes disagree (same colours, different shape)', () => {
  const full = solidFrame([10, 20, 30]);
  const half = solidFrame([10, 20, 30], { pixels: W * H / 2 });
  const r = compareState({ prereg, state: 'idle', ...sides({ referenceFrame: full, engineFrame: half }) });
  assert.equal(r.means.silhouetteIoU, 0.5);
  assert.equal(r.criteria.V2.pass, false);
  assert.equal(r.verdict, 'FAIL');
});

test('J1 fails on a slot-map disagreement; J2 fails on a colour difference between the two documents', () => {
  const same = solidFrame([5, 5, 5]);
  // a class the portrait does not route but the engine's table does would be
  // a real disagreement; simulate by asking about a class the engine maps
  const disagreeing = compareState({ prereg, state: 'idle', ...sides({ referenceFrame: same, engineFrame: same, classesSeen: { 'hat-base': 1, 'invented-class': 2 } }) });
  assert.equal(disagreeing.criteria.J1.pass, true, 'a class neither side routes is not a disagreement');

  const refDoc = { v: '5.5.2', fr: 30, ip: 0, op: 10, w: 1720, h: 1400, layers: [{ shapes: [{ ty: 'fl', cl: 'hat-base', c: { a: 0, k: [1, 0, 0, 1] } }] }] };
  const engDoc = { v: '5.5.2', fr: 30, ip: 0, op: 10, w: 1720, h: 1400, layers: [{ shapes: [{ ty: 'fl', cl: 'hat-base', c: { a: 0, k: [0, 0, 1, 1] } }] }] };
  const j2 = compareState({ prereg, state: 'idle', ...sides({ referenceFrame: same, engineFrame: same, referenceDoc: refDoc, engineDoc: engDoc }) });
  assert.equal(j2.criteria.J2.pass, false, 'the two documents carry different colours');
  assert.equal(j2.document.colourDifferences, 1);
  assert.equal(j2.verdict, 'FAIL');

  const lengthMismatch = compareState({
    prereg, state: 'idle',
    ...sides({ referenceFrame: same, engineFrame: same, referenceDoc: refDoc, engineDoc: { ...engDoc, layers: [] } }),
  });
  assert.equal(lengthMismatch.document.lengthMismatch, true);
  assert.equal(lengthMismatch.criteria.J2.pass, false);
});

test('T1/T2 fail when the clip drifts off the reference constants', () => {
  const same = solidFrame([9, 9, 9]);
  const shortByOne = compareState({ prereg, state: 'idle', ...sides({ referenceFrame: same, engineFrame: same, engineClipFrames: prereg.timing.referenceFrames.idle - 1 }) });
  assert.equal(shortByOne.criteria.T1.pass, false, 'a one-frame drift breaks the exact frame-count criterion');
  assert.equal(shortByOne.criteria.T2.pass, true, 'one frame is inside the declared duration tolerance');
  const wayOff = compareState({ prereg, state: 'idle', ...sides({ referenceFrame: same, engineFrame: same, engineClipFrames: prereg.timing.referenceFrames.idle + 4 }) });
  assert.equal(wayOff.criteria.T2.pass, false, '4 frames (133ms) is outside the declared duration tolerance');
  assert.equal(wayOff.verdict, 'FAIL');
  // the sides must also agree with each other on the source they played
  const sideDrift = compareState({ prereg, state: 'idle', ...sides({ referenceFrame: same, engineFrame: same, referenceClipFrames: prereg.timing.referenceFrames.idle + 1 }) });
  assert.equal(sideDrift.criteria.T1.pass, false, 'the two sides played different-length sources');
});

test('a state with too few comparable frames is INCONCLUSIVE, never a quiet pass', () => {
  const same = solidFrame([3, 3, 3]);
  const empty = { ...solidFrame([0, 0, 0]), empty: true };
  const s = sides({ referenceFrame: same, engineFrame: same });
  s.reference.frames = [{ n: 0, img: empty }, { n: 1, img: empty }, { n: 2, img: same }];
  const r = compareState({ prereg, state: 'idle', ...s });
  assert.equal(r.framesSkippedHeadless, 2);
  assert.equal(r.framesCompared, 1);
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.equal(r.pass, false, 'inconclusive is not a pass (PREREGISTRATION.md §7)');
});

test('the verdicts follow PREREGISTRATION.md, not literals in the comparer', () => {
  const base = solidFrame([100, 100, 100]);
  const off = solidFrame([115, 100, 100]); // 15/255 away
  const asShipped = compareState({ prereg, state: 'idle', ...sides({ referenceFrame: base, engineFrame: off }) });
  assert.equal(asShipped.criteria.V1.pass, false, 'fails under the committed 8/255 tolerance');
  const looser = { ...prereg, visual: { ...prereg.visual, pixelChannelTolerance: 20 } };
  assert.equal(compareState({ prereg: looser, state: 'idle', ...sides({ referenceFrame: base, engineFrame: off }) }).criteria.V1.pass, true,
    'the SAME pixels pass under a looser declared tolerance — the number comes from the declaration');
  const stricterIoU = { ...prereg, visual: { ...prereg.visual, minSilhouetteIoU: 1.01 } };
  assert.equal(compareState({ prereg: stricterIoU, state: 'idle', ...sides({ referenceFrame: base, engineFrame: base }) }).criteria.V2.pass, false);
  const requireNothing = { ...prereg, overall: { ...prereg.overall, statePassRequires: ['J1'] } };
  assert.equal(compareState({ prereg: requireNothing, state: 'idle', ...sides({ referenceFrame: base, engineFrame: off }) }).verdict, 'PASS',
    'which criteria bind is itself read from the declaration');
  // and the tolerance strings the report prints are the declared numbers
  assert.match(asShipped.criteria.V1.tolerance, new RegExp(`${prereg.visual.minMatchPct}%`));
  assert.match(asShipped.criteria.V1.tolerance, new RegExp(`${prereg.visual.pixelChannelTolerance}/255`));
});

test('frameMetrics counts only content pixels, and reports the empty comparison instead of scoring it 100%', () => {
  const blank = solidFrame([0, 0, 0], { pixels: 0 });
  const m = frameMetrics(blank, blank, 8);
  assert.equal(m.contentPixels, 0);
  const s = sides({ referenceFrame: blank, engineFrame: blank });
  const r = compareState({ prereg, state: 'idle', ...s });
  assert.equal(r.minContentPixels, 0);
  assert.equal(r.blankOnBothSides, 3, 'a vacuous comparison is counted and visible in the record');
});

// ---------------------------------------------------------------------------
// 5. both player configurations are parsed from the shipped sources
// ---------------------------------------------------------------------------

test("the reference player configuration is parsed from the 2019 factory, not retyped", () => {
  const config = parseReferencePlayerConfig();
  assert.equal(config.source, 'assets/cw/reference/Animation-index.js');
  assert.equal(config.renderer, 'canvas');
  assert.equal(config.autoplay, false);
  assert.equal(config.loop, false);
  assert.equal(config.progressiveLoad, true);
  assert.equal(config.subframe, false, 'setSubframe(false): the reference runs on the frames the clips are authored at');
  assert.equal(config.setSpeed, false, 'the 2019 setSpeed line is commented out — no playback-rate tampering');
  // a factory that no longer declares the reference configuration must stop the harness
  const tmp = path.join(REPO, 'tools', 'parity', 'results', '.tmp-reference-factory.js');
  fs.writeFileSync(tmp, 'function animationInstance(container, path) {\n  const config = { renderer: \'svg\', autoplay: true, loop: true };\n  return config;\n}\n');
  try {
    assert.throws(() => parseReferencePlayerConfig(tmp), /no longer declares the 2019 player configuration/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('the engine-side player configuration is parsed from the shipped stage (R78: the 2019 player stays)', () => {
  const config = parseStagePlayerConfig();
  assert.equal(config.source, 'app/ui/components/battle/rigStage.js');
  assert.equal(config.renderer, 'canvas');
  assert.equal(config.autoplay, false);
  assert.equal(config.subframe, false);
  assert.equal(config.setSpeed, false);
  assert.deepEqual(config.loopClips, ['chargeloop', 'idle'], "the stage's own loop policy, read from the stage");
  // both sides therefore agree on the two settings that decide WHICH pixels
  // a frame index produces
  const reference = parseReferencePlayerConfig();
  assert.equal(config.renderer, reference.renderer, 'same renderer on both sides');
  assert.equal(config.subframe, reference.subframe, 'same subframe policy on both sides');
});

// ---------------------------------------------------------------------------
// 6. the shipped run describes the tree it was made on
//
// The defect these exist for: check E's first shipped result was produced
// before CB-BUILD-022 changed the identity layer it measures, and nothing in
// the repository said so — the report read as though it described the head it
// shipped on. A measured result is a claim about ONE tree; the run now records
// which, and these bind that record.
// ---------------------------------------------------------------------------

const shippedRun = JSON.parse(fs.readFileSync(path.join(REPO, 'tools', 'parity', 'results', 'check-e-idparity.json'), 'utf8'));

test('the shipped parity run records the commit it ran at, and that nothing it measures was uncommitted', () => {
  const p = shippedRun.provenance;
  assert.ok(p, 'results/check-e-idparity.json records its provenance');
  assert.equal(p.available, true, 'the run was made inside a git work tree');
  assert.match(p.commit, /^[0-9a-f]{40}$/, 'the commit the run was made at is recorded in full');
  assert.equal(typeof p.dirty, 'boolean', 'whether the work tree carried uncommitted changes is recorded either way');
  // The rule with teeth is about the files the numbers depend on, not about
  // the work tree as a whole: `npm run all` writes results/*.json as it goes,
  // so a later check legitimately sees a dirty tree containing nothing it
  // measures. An uncommitted SOURCE is still refused — that run describes no
  // commit at all.
  assert.deepEqual(p.dirtySources, [], `no file this run measures may be uncommitted at run time (dirty: ${JSON.stringify(p.dirtyFiles)})`);
  assert.equal(p.node, shippedRun.node, 'the Node version is recorded once and agrees');
});

test('the commit the shipped parity run was made at is an ancestor of HEAD', (t) => {
  const p = shippedRun.provenance;
  if (!gitProvenance().available) return t.skip('not a git work tree — ancestry cannot be checked here');
  const ancestor = isAncestorOfHead(p.commit);
  if (ancestor === null) return t.skip(`commit ${p.commit} is not present in this clone (shallow?) — ancestry cannot be checked here`);
  assert.equal(ancestor, true, `the shipped run's commit ${p.commit} must be reachable from HEAD — a result from a tree this branch never had describes nothing`);
});

test('every harness source still hashes to what the shipped run recorded (edit the harness without re-running and this fails)', () => {
  const recorded = shippedRun.provenance.harnessDigests;
  assert.ok(recorded && Object.keys(recorded).length >= 10, 'the run recorded a digest per harness source');
  assert.deepEqual(Object.keys(recorded).sort(), HARNESS_DIGEST_FILES.slice().sort(), 'the recorded set is the declared set');
  const now = digestFiles(HARNESS_DIGEST_FILES);
  const stale = HARNESS_DIGEST_FILES.filter((rel) => now[rel] !== recorded[rel]);
  assert.deepEqual(stale, [], `these harness sources changed after the shipped run — re-run \`cd tools/parity && npm run check-e\`: ${stale.join(', ')}`);
  // the engine modules the run measures are recorded too, and asserted by
  // the gate below (fix round g1) — recording them without asserting them is
  // precisely how the shipped run went stale a second time.
  assert.ok(shippedRun.provenance.engineDigests['app/engine/wizardRig.js'], 'the identity layer the run measures is digested in the record');
  assert.ok(shippedRun.provenance.engineDigests['app/ui/components/battle/rigAssets.js'], 'the loadout the run measures is digested in the record');
});

// ---------------------------------------------------------------------------
// 6b. THE GATE (fix round g1)
//
// The defect these exist for: the digests above were RECORDED and printed,
// and the engine list was deliberately not asserted — "a reader compares
// them and re-runs deliberately". Fix round f3 then rewrote `deriveIdentity`
// in app/engine/wizardRig.js, the shipped run's 8 generated rows started
// describing combos the engine no longer produces for those ids, the
// mechanism detected it exactly as designed — and the suite stayed green,
// because nothing asserted it. A mechanism that records staleness and
// surfaces it nowhere is the original defect wearing a hat.
//
// So: BOTH digest lists are asserted, for EVERY recorded run (A–E), because
// re-running check E at the integrated head turned up the same defect one
// file over — checks B and D resolve wizard identities from ids too, so f3
// moved their sampled combos as well, and check D IS the AC1 four-criteria
// deliverable. An engine change that invalidates any of those runs now FAILS
// `node --test app/tests/*.test.js` from the repo root until that check is
// re-run. The cost is real and deliberate — a container without bucket
// access or a native canvas build cannot re-run the checks and therefore
// cannot be green; the honest report of that is the signal, and a green
// suite over numbers from a tree that no longer exists is what we are
// refusing.
// ---------------------------------------------------------------------------

test('THE GATE: every engine module the shipped run MEASURES still hashes to what the run recorded (move the engine without re-running check E and this fails)', () => {
  const f = shippedRunFreshness();
  const recorded = shippedRun.provenance.engineDigests;
  assert.ok(recorded && Object.keys(recorded).length > 0, 'the run recorded a digest per engine module it measures');
  assert.deepEqual(Object.keys(recorded).sort(), ENGINE_DIGEST_FILES.slice().sort(),
    'the recorded engine set is the declared engine set — a module added to the list without a re-run was never measured by the shipped run');
  assert.deepEqual(f.staleEngine, [], stalenessMessage(f));
  // and the whole verdict, both lists, one place
  assert.equal(f.fresh, true, stalenessMessage(f));
  assert.equal(f.commit, shippedRun.provenance.commit, 'the gate reports the commit the run was made at');
});

test('THE GATE covers EVERY recorded run, not just check E — checks A, B, C and D too', () => {
  const all = allFreshness();
  assert.deepEqual(all.checks.map((c) => c.check), CHECK_IDS, 'every declared check is gated');
  assert.ok(CHECK_IDS.length >= 5, 'A–E are declared');
  for (const id of CHECK_IDS) {
    const spec = CHECK_RUNS[id];
    const record = JSON.parse(fs.readFileSync(path.join(REPO, spec.runFile), 'utf8'));
    const p = record.provenance;
    assert.ok(p, `${spec.runFile} records the tree it was made on`);
    assert.equal(p.check, id, `${spec.runFile} names which check's declared file lists its digests belong to`);
    assert.match(p.commit, /^[0-9a-f]{40}$/, `${spec.runFile} records the commit it ran at in full`);
    assert.deepEqual(p.dirtySources, [], `${spec.runFile}: no file this run measures may be uncommitted at run time (dirty: ${JSON.stringify(p.dirtyFiles)})`);
    assert.deepEqual(Object.keys(p.harnessDigests).sort(), spec.harness.slice().sort(), `${spec.runFile}: the recorded harness set is the declared one`);
    assert.deepEqual(Object.keys(p.engineDigests).sort(), spec.engine.slice().sort(), `${spec.runFile}: the recorded engine set is the declared one`);
  }
  for (const c of all.checks) assert.equal(c.fresh, true, stalenessMessage(c));
  assert.equal(all.fresh, true, () => all.stale.map(stalenessMessage).join('\n'));
});

test('THE GATE can fail: a single changed byte in a measured engine module is reported STALE, and the file is named', () => {
  // The negative control for the gate itself — a gate that cannot fail
  // proves nothing, which is the same argument check E's own negative
  // control makes about the pixel comparison. Built from a record that is
  // fresh BY CONSTRUCTION (the tree as it is right now), so this exercises
  // the gate's logic whatever state the shipped runs happen to be in.
  const freshRecord = {
    ranAt: 'synthetic',
    provenance: {
      commit: 'f'.repeat(40),
      harnessDigests: digestFiles(HARNESS_DIGEST_FILES),
      engineDigests: digestFiles(ENGINE_DIGEST_FILES),
    },
  };
  assert.equal(freshnessOf(freshRecord).fresh, true, 'a record of the tree as it is now is fresh');

  const doctored = JSON.parse(JSON.stringify(freshRecord));
  doctored.provenance.engineDigests['app/engine/wizardRig.js'] = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  const f = freshnessOf(doctored);
  assert.equal(f.fresh, false, 'a changed engine module makes the run stale');
  assert.deepEqual(f.staleEngine, ['app/engine/wizardRig.js'], 'the gate names the module that moved');
  assert.deepEqual(f.staleHarness, [], 'and nothing else');
  assert.match(stalenessMessage(f), /engine modules the run MEASURES changed since the run: app\/engine\/wizardRig\.js/);
  assert.match(stalenessMessage(f), /npm run check-e/, 'the failure says how to fix it');

  // the same for a harness source …
  const doctoredHarness = JSON.parse(JSON.stringify(freshRecord));
  doctoredHarness.provenance.harnessDigests['tools/parity/compare.mjs'] = 'sha256:dead';
  assert.deepEqual(freshnessOf(doctoredHarness).staleHarness, ['tools/parity/compare.mjs']);

  // … and for a module DROPPED from the record entirely: absence is staleness,
  // not a pass (the run cannot have measured what it never recorded).
  const dropped = JSON.parse(JSON.stringify(freshRecord));
  delete dropped.provenance.engineDigests['app/engine/rigRecolor.js'];
  assert.equal(freshnessOf(dropped).fresh, false, 'a missing digest is stale, never fresh');
  assert.ok(freshnessOf(dropped).staleEngine.includes('app/engine/rigRecolor.js'));
  assert.equal(freshnessOf({ ranAt: 'never', provenance: {} }).fresh, false, 'a record with no digests at all is stale, never fresh');

  // … and per check: every declared check's own lists can go stale on their
  // own terms (check C measures the timeline, check D the stage, and so on).
  for (const id of CHECK_IDS) {
    const spec = CHECK_RUNS[id];
    const synthetic = { ranAt: 'synthetic', provenance: { commit: 'f'.repeat(40), harnessDigests: digestFiles(spec.harness), engineDigests: digestFiles(spec.engine) } };
    assert.equal(freshnessOfRecord(synthetic, spec).fresh, true, `check ${id}: a record of this tree is fresh`);
    const moved = JSON.parse(JSON.stringify(synthetic));
    const victim = spec.engine[0];
    moved.provenance.engineDigests[victim] = 'sha256:0';
    const v = freshnessOfRecord(moved, spec);
    assert.equal(v.fresh, false, `check ${id}: a moved engine module is stale`);
    assert.deepEqual(v.staleEngine, [victim], `check ${id}: the gate names ${victim}`);
    assert.match(stalenessMessage(v), new RegExp(spec.rerun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `check ${id}: the failure names its own re-run command`);
  }
});

// ---------------------------------------------------------------------------
// 6c. THE SCOPE OF THE GATE (fix round g5)
//
// The defect these exist for: the declared lists said "code-level inputs
// only … static assets are NOT digested", and two files that are neither
// slipped between the words. `check-d-ac1.mjs` REGEX-PARSES
// `app/styles/battle.css` into D2's stage geometry AND into its
// `noLayerBackground` PASS/FAIL, and `check-c-timing.mjs`,
// `check-d-ac1.mjs` and `parity-wizard.mjs` read the O9 reveal cadence out
// of `app/data/tunables.json`. Neither was digested, so the final-gate
// reviewer could paint the combatant layer white (the exact R74 violation
// D2 exists to catch), move `homeLeftPct` from -1.4% to -9.9%, and retune
// O9 the sanctioned way — and `node tools/parity/freshness.mjs` still said
// FRESH over records asserting the old values.
//
// A gate whose scope is a hand-written list needs its scope asserted, not
// just its digests. So: every repo file a check reads BY LITERAL PATH is
// declared by that check, and the two directories a check GLOBS are
// declared file-by-file and compared with the directory listing (a list of
// files cannot notice a file being added to the folder).
// ---------------------------------------------------------------------------

/** `path.join(REPO, 'a', 'b', …)` with string literals only — the reads a
 * static scan can be sure about. Template literals (the per-combo cache,
 * the element-keyed FX file) are deliberately out of scope here; those
 * paths are declared by hand and asserted by the digest sets above. */
function literalRepoReads(relFile) {
  const src = fs.readFileSync(path.join(REPO, relFile), 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/path\.join\(\s*REPO\s*,\s*((?:'[^']*'\s*,\s*)*'[^']*')\s*\)/g)) {
    const parts = m[1].split(',').map((p) => p.trim().replace(/^'|'$/g, ''));
    out.add(parts.join('/'));
  }
  return [...out];
}

/** A declared path may be a file; a globbed directory expands to its files. */
function expandRepoPath(rel) {
  const abs = path.join(REPO, rel);
  if (!fs.existsSync(abs)) return [];
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs.readdirSync(abs).filter((f) => !f.startsWith('.')).sort().map((f) => `${rel}/${f}`);
}

test('THE SCOPE: every repo file a check reads by literal path is in THAT check\'s declared lists (the scan that would have caught battle.css and tunables.json)', () => {
  // Read by a harness module but deliberately NOT declared, each with the
  // reason stated in provenance.mjs's sweep note. Keeping them here rather
  // than in the scan's silence is the point: a waiver is a decision, and it
  // is written down.
  const WAIVED = new Map([
    // check E takes the canonical wizard's fitted palette from check A's
    // RECORD (identity.mjs, via __dirname). Declaring a results file would
    // make `npm run all` self-invalidating: check A rewrites it before
    // check E runs, so check E's dirtySources could never be empty.
    ['tools/parity/results/check-a-gifs.json', 'a recorded result, not a source — declaring it makes the documented re-run self-invalidating'],
  ]);
  const missing = [];
  for (const id of CHECK_IDS) {
    const spec = CHECK_RUNS[id];
    const declared = new Set([...spec.harness, ...spec.engine]);
    // scan the check's own script and every harness module it declares
    for (const mod of spec.harness.filter((f) => f.endsWith('.mjs'))) {
      for (const read of literalRepoReads(mod)) {
        for (const file of expandRepoPath(read)) {
          if (declared.has(file) || WAIVED.has(file)) continue;
          missing.push(`check ${id}: ${mod} reads ${file} and check ${id} does not declare it`);
        }
      }
    }
  }
  assert.deepEqual(missing, [], `these files decide a recorded number and are not digested — add them to CHECK_RUNS and re-run that check:\n  ${missing.join('\n  ')}`);
});

test('THE SCOPE: the non-JS inputs that decide a recorded verdict are declared — battle.css by D, tunables.json by C, D and E (fix round g5)', () => {
  const declaredBy = (id) => new Set([...CHECK_RUNS[id].harness, ...CHECK_RUNS[id].engine]);
  // D2 parses BOTH its stage geometry and its `noLayerBackground` criterion
  // out of this stylesheet: a rule change moves a recorded PASS/FAIL.
  assert.ok(declaredBy('D').has('app/styles/battle.css'),
    'check D parses app/styles/battle.css into D2 geometry and into the no-layer-background criterion — it must be digested');
  // the O9 reveal cadence: a sanctioned retune (R85/§14, AC0) that leaves
  // these records describing the old cadence is the attack that was shown.
  for (const id of ['C', 'D', 'E']) {
    assert.ok(declaredBy(id).has('app/data/tunables.json'),
      `check ${id} reads the O9 cadence out of app/data/tunables.json — it must be digested`);
  }
  // check E records `stepWindows`, computed by the timeline module …
  assert.ok(declaredBy('E').has('app/engine/presentationTimeline.js'),
    'check E records stepWindows computed by app/engine/presentationTimeline.js');
  // … and D2's arena-ink verdict is measured on the arena source itself.
  assert.ok(declaredBy('D').has('assets/cw/client-static/img/fightScene/fightBG.svg'),
    "check D rasterizes the arena source and measures its ink — a blank arena must not leave D2's verdict standing");
});

test('THE SCOPE: the globbed asset folders are declared file-by-file AND match the directory listing (a new file in the folder is staleness too)', () => {
  const listing = (dir, ext) => fs.readdirSync(path.join(REPO, dir)).filter((f) => f.endsWith(ext)).sort().map((f) => `${dir}/${f}`);
  assert.deepEqual(
    BUNDLE_GIF_FILES.slice().sort(),
    listing('assets/cw/renders/gifs', '.gif'),
    'the declared bundle renders ARE the folder check A diffs against and check C globs for frame delays — add a GIF and checks A and C must be re-run',
  );
  assert.deepEqual(
    PORTRAIT_SVG_FILES.slice().sort(),
    listing('assets/cw/client-static/img/wizards', '.svg'),
    "the declared portrait SVGs ARE the folder the reference side's colour-slot map is parsed from — add one and check E must be re-run",
  );
  for (const gif of BUNDLE_GIF_FILES) {
    for (const id of ['A', 'C']) {
      assert.ok(CHECK_RUNS[id].engine.includes(gif), `check ${id} measures ${gif}`);
    }
  }
  for (const svg of PORTRAIT_SVG_FILES) assert.ok(CHECK_RUNS.E.engine.includes(svg), `check E's reference recolour is parsed from ${svg}`);
});

test('THE SCOPE can fail: the gate reports a changed stylesheet or tunable exactly as it reports a changed module, and names the file', () => {
  // the negative control for the widening — same shape as the gate's own.
  for (const [id, victim] of [['D', 'app/styles/battle.css'], ['C', 'app/data/tunables.json'], ['D', 'app/data/tunables.json'], ['E', 'app/data/tunables.json'], ['A', BUNDLE_GIF_FILES[0]], ['E', PORTRAIT_SVG_FILES[1]]]) {
    const spec = CHECK_RUNS[id];
    const synthetic = { ranAt: 'synthetic', provenance: { commit: 'f'.repeat(40), harnessDigests: digestFiles(spec.harness), engineDigests: digestFiles(spec.engine) } };
    assert.equal(freshnessOfRecord(synthetic, spec).fresh, true, `check ${id}: a record of this tree is fresh`);
    const moved = JSON.parse(JSON.stringify(synthetic));
    moved.provenance.engineDigests[victim] = 'sha256:0';
    const v = freshnessOfRecord(moved, spec);
    assert.equal(v.fresh, false, `check ${id}: an edited ${victim} makes the record stale`);
    assert.deepEqual(v.staleEngine, [victim], `check ${id}: the gate NAMES ${victim}`);
    assert.match(stalenessMessage(v), new RegExp(victim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `check ${id}: the failure message names ${victim}`);
  }
});

test('THE GATE is reachable in one offline command, and the report OPENS with it (a reader meets the rule before the numbers)', () => {
  // the whole point of the banner: the correction cannot live only where
  // nobody looks. It is the first thing after the title.
  const report = fs.readFileSync(path.join(REPO, 'tools', 'parity', 'PARITY-REPORT.md'), 'utf8');
  // the banner is the opening block: title, blank line, then the banner
  // itself (fix round g5 added the shallow-clone sentence, so the window is
  // the banner's own length plus the title, not a magic 30).
  const head = report.split('\n').slice(0, freshnessBanner(shippedRun.provenance).split('\n').length + 4).join('\n');
  assert.match(head, /FRESHNESS GATE/, 'the report opens with the freshness gate banner');
  assert.match(head, new RegExp(shippedRun.provenance.commit.slice(0, 7)), 'the banner names the commit this report describes');
  assert.match(head, /node tools\/parity\/freshness\.mjs/, 'the banner names the one-command check');
  assert.match(head, /asserts both lists/i, 'the banner states that the digests are asserted, not merely recorded');
  assert.match(head, /SHALLOW clone/, 'the banner states where the ancestry assertion degrades to a skip, beside the numbers it qualifies');
  assert.equal(head.includes(freshnessBanner(shippedRun.provenance)), true,
    'the banner in the report is the one the generator emits for this run (regenerate the report: npm run check-e)');

  // the freshness CLI is wired up as a script, so "check it yourself" is true
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'tools', 'parity', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.freshness, 'node freshness.mjs', 'npm run freshness exists');

  // RESULTS.md is the other document a reader reads as "the results"; it must
  // not be left quoting an older run's commit than the one that shipped.
  const results = fs.readFileSync(path.join(REPO, 'tools', 'parity', 'RESULTS.md'), 'utf8');
  assert.match(results, new RegExp(shippedRun.provenance.commit.slice(0, 7)),
    'RESULTS.md names the commit the shipped check-E run was made at');
});

test("the shipped run's canonical row is the PRE-REGISTERED wizard, and says where its identity came from", () => {
  const checkA = JSON.parse(fs.readFileSync(path.join(REPO, 'tools', 'parity', 'results', 'check-a-gifs.json'), 'utf8'));
  const row = shippedRun.wizards.find((w) => w.kind === 'canonical');
  assert.ok(row, 'the run carries a canonical row');
  assert.equal(row.identitySource, 'declared', 'the canonical row ran on the declared identity, not on a derivation');
  assert.equal(row.comboKey, prereg.canonicalWizard.comboKey, 'the combo it compared IS the pre-registered one');
  assert.deepEqual(row.palette, checkA.paletteFit.palette, "the palette it compared IS check A's fitted palette");
  assert.ok(row.engineDerived && row.engineDerived.comboKey, "what the read path derives for that id is recorded beside the row");
  assert.equal(row.identityMatchesEngineDerivation, row.engineDerived.comboKey === row.comboKey,
    'whether the declaration and the read path agree is recorded as the fact it is');
  assert.equal(shippedRun.sample.canonical.identityInjection, DECLARED_INJECTION);
  // the report a reader reads must carry the residual this implies
  const report = fs.readFileSync(path.join(REPO, 'tools', 'parity', 'PARITY-REPORT.md'), 'utf8');
  assert.match(report, /id→identity derivation is OUTSIDE this comparison/i,
    'the report states the load-bearing residual: both sides are handed the identity, so its derivation is not under test');
  assert.match(report, /node-canvas 2D context/,
    'the report states what actually renders the frames, not "jsdom + node-canvas" alone');
  assert.match(report, new RegExp(shippedRun.provenance.commit.slice(0, 7)), 'the report names the commit the run was made at');
});
