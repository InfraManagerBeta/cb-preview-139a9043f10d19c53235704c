// tools/parity/check-d-ac1.mjs — C7 (fix round F2): AC1's battle-fidelity
// row, MEASURED. §17 AC1: "distinctness, arena-composite, no-blank,
// FX-fidelity each pass on the diff … visual parity within tolerance;
// timing to the reference's constants." Checks A/B/C cover recolour
// fidelity and the timing constants; THIS check measures the four
// battle-fidelity criteria themselves on RENDERED output, each with a
// declared tolerance and an explicit PASS/FAIL verdict:
//
//  D1 distinctness — both combatants of sampled duels (including same
//     element + same power, and the hardest case: the SAME shape combo,
//     distinct only by palette) rendered with the shipped player and
//     diffed against each other; they must differ beyond tolerance.
//  D2 arena-composite — the arena source rasterized and the stage
//     composited at the shipped stylesheet's own geometry (parsed from
//     battle.css, not assumed); the arena must be present under the
//     combatants, never a bare/white field.
//  D3 no-blank — the state-transition path driven over the REAL worst-case
//     presentation timeline through the REAL step->clip mapping
//     (rigStage.js's exported STEP_TO_CLIP/LOOP_CLIPS) on a REAL loadout
//     with an instrumented fetch: no transition endpoint frame is
//     blank/empty, and zero source fetches happen after preload (mid-duel).
//  D4 FX-fidelity — the affinity-round FX pass (the loadout's recoloured
//     affinitycape overlays) rendered and diffed against the bundle's own
//     FX sources within a stated tolerance, plus a composited FX-over-pose
//     render proving the overlay is visible content, not an empty layer.
//
// Headless residual (stated, mirrored in RESULTS.md): jsdom/node-canvas
// executes no CSS layout, paint, or opacity animation. What is measured
// here is the rendered pixel output of every layer and every transition
// endpoint, composited at the geometry parsed from the shipped CSS; the
// cross-fade's 120ms opacity ramp itself and browser compositing are the
// residual, verifiable only in a real browser (one manual command, see
// RESULTS.md).
import fs from 'node:fs';
import path from 'node:path';
import { makeRenderer, diffImages, writeJson, savePng, REPO, __dirname } from './lib.mjs';
import { createCanvas, loadImage } from 'canvas';
import { wizardIdentity, animationUrl, affinityCapeUrl, elementToken } from '../../app/engine/wizardRig.js';
import { recolorAnimation, geometryDigest, colourInventory, CLASS_TO_SLOT } from '../../app/engine/rigRecolor.js';
import { createRigLoadout, DUEL_STATES } from '../../app/ui/components/battle/rigAssets.js';
import { STEP_TO_CLIP, LOOP_CLIPS } from '../../app/ui/components/battle/rigStage.js';
import { buildDuelTimeline } from '../../app/engine/presentationTimeline.js';
import { runProvenanceFor } from './provenance.mjs';

// The tree this run is being made on, captured BEFORE anything is written
// (fix round g1). app/tests/parity-harness.test.js asserts these digests:
// change a file below without re-running this check and the root suite goes
// red. See tools/parity/freshness.mjs.
const provenance = runProvenanceFor('D');

const CACHE = path.join(__dirname, 'results', 'cache');
fs.mkdirSync(CACHE, { recursive: true });
const W = 430, H = 350;

// ---- declared tolerances (each criterion's verdict binds to these) ----------
export const TOLERANCES = {
  pixel: 48, // per-pixel channel tolerance (0-255) for "same pixel", as check A
  distinctMinPct: 3.0, // D1: content pixels differing beyond `pixel`, per pair/state, must be >= this
  arenaMinInkPct: 90, // D2: the rasterized arena must be >= this % non-white ink
  stageMaxBlankPct: 1.0, // D2: composited stage pixels that are white/empty must be <= this
  underMinArenaPct: 90, // D2: non-combatant pixels inside each wizard box that show arena ink, >= this
  blankFrameMaxInkPct: 1.0, // D3: a frame with < this % ink is BLANK; none allowed
  midDuelFetchMax: 0, // D3: source fetches after preload completes
  fxPixel: 60, // D4: per-pixel tolerance for the FX diff (check B's own)
  fxMaxUnexplainedPct: 5.0, // D4: FX pixels neither identical nor explained as slot recolour, <= this
};

const disk = new Map();
let fetchCount = 0;
async function countingFetch(url) {
  fetchCount++;
  const file = path.join(CACHE, url.replace(/[^a-zA-Z0-9.-]+/g, '_'));
  if (!disk.has(url)) {
    if (!fs.existsSync(file)) {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, status: res.status };
      fs.writeFileSync(file, await res.text());
    }
    disk.set(url, fs.readFileSync(file, 'utf8'));
  }
  return { ok: true, json: async () => JSON.parse(disk.get(url)) };
}

async function fetchRaw(url) {
  const res = await countingFetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

function inkStats(img, whiteTol = 15) {
  const d = img.data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 128 && !(d[i] > 255 - whiteTol && d[i + 1] > 255 - whiteTol && d[i + 2] > 255 - whiteTol)) ink++;
  }
  return { ink, total: d.length / 4, pct: +((ink / (d.length / 4)) * 100).toFixed(2) };
}

const pf = (ok) => (ok ? 'PASS' : 'FAIL');
const verdicts = [];
function verdict(criterion, tolerance, measured, pass) {
  verdicts.push({ criterion, tolerance, measured, pass: !!pass });
  console.log(`  VERDICT ${criterion}: tolerance [${tolerance}] measured [${measured}] -> ${pf(pass)}`);
  return !!pass;
}

console.log('Check D — §17 AC1 battle-fidelity criteria, measured on rendered output');

// =============================================================================
// D1 — DISTINCTNESS
// =============================================================================
console.log(`\nD1 distinctness — sampled duels, both combatants rendered and diffed against EACH OTHER`);
console.log(`   declared tolerance: per pair/state, >= ${TOLERANCES.distinctMinPct}% of content pixels must differ beyond ${TOLERANCES.pixel}/255`);

// find the hardest pair: same element, same power, SAME shape combo — the
// two fighters differ by palette alone.
function findSameComboPair(element, tier) {
  const base = wizardIdentity({ id: 'd1-same-combo-base', element, tier });
  for (let i = 0; i < 20000; i++) {
    const id = `d1-same-combo-probe-${i}`;
    const cand = wizardIdentity({ id, element, tier });
    if (cand.comboKey === base.comboKey && JSON.stringify(cand.palette) !== JSON.stringify(base.palette)) {
      return [{ id: 'd1-same-combo-base', element, tier }, { id, element, tier }];
    }
  }
  throw new Error('no same-combo pair found in 20000 probes');
}

const D1_PAIRS = [
  { label: 'same element+power (fire t0 vs fire t0)', pair: [{ id: 'd1-fire-a', element: 'fire', tier: 0 }, { id: 'd1-fire-b', element: 'fire', tier: 0 }] },
  { label: 'same element+power+COMBO (palette-only)', pair: findSameComboPair('fire', 0) },
  { label: 'same element+power (water t3 vs water t3)', pair: [{ id: 'd1-water-a', element: 'water', tier: 3 }, { id: 'd1-water-b', element: 'water', tier: 3 }] },
  { label: 'cross element (fire t0 vs air t0)', pair: [{ id: 'd1-x-a', element: 'fire', tier: 0 }, { id: 'd1-x-b', element: 'air', tier: 0 }] },
];
const D1_STATES = ['idle', 'attack', 'win'];

const d1Rows = [];
let d1MinDistinct = Infinity;
for (const { label, pair } of D1_PAIRS) {
  const ids = pair.map((c) => wizardIdentity(c));
  for (const state of D1_STATES) {
    const rendered = [];
    for (const identity of ids) {
      const raw = await fetchRaw(animationUrl(state, identity.comboKey));
      const { animation } = recolorAnimation(raw, identity.palette);
      const r = makeRenderer(animation, { width: W, height: H });
      const total = raw.op - raw.ip;
      const frames = [0, Math.floor(total / 3), Math.floor((2 * total) / 3)].map((f) => r.frame(f));
      rendered.push(frames);
      r.destroy();
    }
    let sumDistinct = 0, n = 0;
    for (let f = 0; f < 3; f++) {
      const a = rendered[0][f], b = rendered[1][f];
      if (a.empty || b.empty) continue;
      const d = diffImages(a, b, { tolerance: TOLERANCES.pixel });
      sumDistinct += 100 - d.matchPct; n++;
    }
    const distinctPct = +(sumDistinct / n).toFixed(2);
    d1MinDistinct = Math.min(d1MinDistinct, distinctPct);
    d1Rows.push({ pair: label, sameCombo: ids[0].comboKey === ids[1].comboKey, state, framesCompared: n, distinctPct });
    console.log(`   ${label.padEnd(45)} ${state.padEnd(7)} distinct ${distinctPct}% (combo ${ids[0].comboKey === ids[1].comboKey ? 'SAME' : 'differs'})`);
  }
}
const d1Pass = verdict(
  'distinctness',
  `every pair/state >= ${TOLERANCES.distinctMinPct}% pixels differ beyond ${TOLERANCES.pixel}/255`,
  `min ${d1MinDistinct}% across ${d1Rows.length} pair/state diffs`,
  d1MinDistinct >= TOLERANCES.distinctMinPct,
);

// =============================================================================
// D2 — ARENA-COMPOSITE
// =============================================================================
console.log(`\nD2 arena-composite — the composed stage, at the shipped stylesheet's own geometry`);

// geometry PARSED from the shipped battle.css — never assumed
const css = fs.readFileSync(path.join(REPO, 'app', 'styles', 'battle.css'), 'utf8');
const wizardRule = /\.cb-rig-wizard\s*\{[^}]*bottom:\s*([\d.]+)%[^}]*width:\s*([\d.]+)%[^}]*aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/s.exec(css);
const homeRule = /\.cb-rig-wizard\.home\s*\{\s*left:\s*(-?[\d.]+)%/.exec(css);
const awayRule = /\.cb-rig-wizard\.away\s*\{\s*right:\s*(-?[\d.]+)%.*scaleX\(-1\)/.exec(css);
if (!wizardRule || !homeRule || !awayRule) throw new Error('battle.css stage geometry not found — the composite would not match the shipped layout');
const GEO = { bottomPct: +wizardRule[1], widthPct: +wizardRule[2], aspectW: +wizardRule[3], aspectH: +wizardRule[4], homeLeftPct: +homeRule[1], awayRightPct: +awayRule[1] };
console.log(`   geometry parsed from battle.css: wizard bottom ${GEO.bottomPct}% width ${GEO.widthPct}% aspect ${GEO.aspectW}/${GEO.aspectH}, home left ${GEO.homeLeftPct}%, away right ${GEO.awayRightPct}% (mirrored)`);

// layer-stack facts parsed from the shipped stage source + css
const stageSrc = fs.readFileSync(path.join(REPO, 'app', 'ui', 'components', 'battle', 'rigStage.js'), 'utf8');
const arenaFirst = /el\('img',\s*\{\s*class:\s*'cb-rig-arena'/.test(stageSrc) && stageSrc.indexOf("class: 'cb-rig-arena'") < stageSrc.indexOf('scene,');
const noLayerBackground = !/\.cb-rig-(scene|wizard|anim)[^{]*\{[^}]*background/s.test(css);
console.log(`   layer stack (parsed): arena <img> is the stage's base layer under the scene: ${arenaFirst}; no combatant layer paints its own background: ${noLayerBackground}`);

// rasterize the ACTUAL arena source (viewBox 880x495; width/height injected
// for the rasterizer only — the SVG content is untouched)
const AW = 880, AH = 495;
let svg = fs.readFileSync(path.join(REPO, 'assets', 'cw', 'client-static', 'img', 'fightScene', 'fightBG.svg'), 'utf8');
svg = svg.replace('<svg ', `<svg width="${AW}" height="${AH}" `);
const arenaImg = await loadImage(Buffer.from(svg));
const arenaCanvas = createCanvas(AW, AH);
arenaCanvas.getContext('2d').drawImage(arenaImg, 0, 0, AW, AH);
const arena = arenaCanvas.getContext('2d').getImageData(0, 0, AW, AH);
const arenaInk = inkStats(arena);
console.log(`   arena source rasterized: ${AW}x${AH}, ink ${arenaInk.pct}%`);

// composite both combatants of a same-element duel at the parsed geometry
const boxW = Math.round((GEO.widthPct / 100) * AW);
const boxH = Math.round(boxW * (GEO.aspectH / GEO.aspectW));
const boxY0 = Math.round(AH * (1 - GEO.bottomPct / 100)) - boxH;
const homeX0 = Math.round((GEO.homeLeftPct / 100) * AW);
const awayX0 = AW - Math.round((-GEO.awayRightPct / 100) * AW) - boxW + Math.round((2 * -GEO.awayRightPct / 100) * AW); // right offset
const d2Pair = [wizardIdentity({ id: 'd1-fire-a', element: 'fire', tier: 0 }), wizardIdentity({ id: 'd1-fire-b', element: 'fire', tier: 0 })];
const d2Frames = [];
for (const identity of d2Pair) {
  const raw = await fetchRaw(animationUrl('idle', identity.comboKey));
  const { animation } = recolorAnimation(raw, identity.palette);
  const r = makeRenderer(animation, { width: boxW, height: boxH });
  d2Frames.push(r.frame(0));
  r.destroy();
}
const stage = { data: Uint8ClampedArray.from(arena.data), width: AW, height: AH };
const wizardCover = new Uint8Array(AW * AH);
function compositeWizard(img, x0, y0, mirror) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const sx = mirror ? img.width - 1 - x : x;
      const si = (y * img.width + sx) * 4;
      if (img.data[si + 3] <= 128) continue; // transparent: arena shows through
      const dx = x0 + x, dy = y0 + y;
      if (dx < 0 || dx >= AW || dy < 0 || dy >= AH) continue;
      const di = (dy * AW + dx) * 4;
      wizardCover[dy * AW + dx] = 1;
      stage.data[di] = img.data[si]; stage.data[di + 1] = img.data[si + 1]; stage.data[di + 2] = img.data[si + 2]; stage.data[di + 3] = 255;
    }
  }
}
compositeWizard(d2Frames[0], homeX0, boxY0, false);
compositeWizard(d2Frames[1], awayX0, boxY0, true);
savePng(stage, path.join(__dirname, 'results', 'frames', 'd2-arena-composite.png'));

// measurements on the composed stage: a BARE-FIELD pixel is one that no
// layer paints — the arena contributes nothing (transparent or white) and
// no combatant covers it. (A combatant's own white cloth is content, not a
// bare field.)
let bare = 0;
for (let p = 0; p < AW * AH; p++) {
  if (wizardCover[p]) continue;
  const i = p * 4;
  const arenaWhite = arena.data[i] > 240 && arena.data[i + 1] > 240 && arena.data[i + 2] > 240;
  if (arena.data[i + 3] <= 128 || arenaWhite) bare++;
}
const blankPct = +((bare / (AW * AH)) * 100).toFixed(2);
const stageInk = inkStats(stage);
// under the combatants: inside each wizard box, every pixel NOT covered by
// the wizard silhouette must show arena ink (never white/bare)
let underTotal = 0, underArena = 0;
for (const [frame, x0, mirror] of [[d2Frames[0], homeX0, false], [d2Frames[1], awayX0, true]]) {
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const sx = mirror ? frame.width - 1 - x : x;
      if (frame.data[(y * frame.width + sx) * 4 + 3] > 128) continue; // wizard pixel, not "under"
      const dx = x0 + x, dy = boxY0 + y;
      if (dx < 0 || dx >= AW || dy < 0 || dy >= AH) continue;
      underTotal++;
      const di = (dy * AW + dx) * 4;
      const isWhite = arena.data[di] > 240 && arena.data[di + 1] > 240 && arena.data[di + 2] > 240;
      if (arena.data[di + 3] > 128 && !isWhite) underArena++;
    }
  }
}
const underPct = +((underArena / underTotal) * 100).toFixed(2);
console.log(`   composed stage: ink ${stageInk.pct}%, bare-field (no layer paints) ${blankPct}%; under-combatant field: ${underPct}% arena ink over ${underTotal} px`);
const d2Pass = verdict(
  'arena-composite',
  `arena ink >= ${TOLERANCES.arenaMinInkPct}%; bare-field <= ${TOLERANCES.stageMaxBlankPct}%; under-combatant arena >= ${TOLERANCES.underMinArenaPct}%; layer stack parsed from shipped source`,
  `arena ${arenaInk.pct}%; bare-field ${blankPct}%; under-combatant ${underPct}%; arena-under-scene ${arenaFirst}, no layer background ${noLayerBackground}`,
  arenaInk.pct >= TOLERANCES.arenaMinInkPct && blankPct <= TOLERANCES.stageMaxBlankPct && underPct >= TOLERANCES.underMinArenaPct && arenaFirst && noLayerBackground,
);

// =============================================================================
// D3 — NO-BLANK (the preload + cross-fade transition path, instrumented)
// =============================================================================
console.log(`\nD3 no-blank — the REAL worst-case timeline driven through the REAL step->clip mapping on a REAL loadout`);

fetchCount = 0;
const loadout = createRigLoadout({
  p1Character: { id: 'd3-p1', element: 'fire', tier: 0 },
  p2Character: { id: 'd3-p2', element: 'fire', tier: 0 },
  fetchImpl: countingFetch,
  cache: new Map(),
});
await loadout.ready;
const fetchesAtReady = fetchCount;
const fallbacks = { p1: loadout.report.p1.fallbackStates.length, p2: loadout.report.p2.fallbackStates.length };
console.log(`   preload complete: ${fetchesAtReady} source fetches (fallbacks p1=${fallbacks.p1} p2=${fallbacks.p2})`);

const tunables = JSON.parse(fs.readFileSync(path.join(REPO, 'app', 'data', 'tunables.json'), 'utf8'));
const cadenceMs = tunables.timers.revealCadenceMs.default;
const worstOutcome = {
  rounds: [1, 2, 3, 4, 5].map((round) => ({ round, move1: 'fire', move2: 'water', result: round % 2 ? 'WIN' : 'LOSS', p1Affinity: true, p2Affinity: true, tag: 'CRITICAL' })),
  winner: 1, trueTie: false, floorDrain: true,
};
const timeline = buildDuelTimeline(worstOutcome, cadenceMs, { bracketComplete: true });

// walk the timeline exactly as rigStage.setStep does: sticky steps keep the
// clip; a change is a transition whose endpoints we render and measure.
const sideStateFor = (step, side) => step[side === 'p1' ? 'p1State' : 'p2State'] || step.state;
const clipLen = (side, clip) => { const a = loadout.get(side, clip); return a.op - a.ip; };
const renderers = { p1: new Map(), p2: new Map() };
function frameOf(side, clip, n) {
  if (!renderers[side].has(clip)) renderers[side].set(clip, makeRenderer(loadout.get(side, clip), { width: W, height: H }));
  return renderers[side].get(clip).frame(n);
}
const transitions = [];
let blankFrames = 0, minInkPct = Infinity, framesMeasured = 0, skippedHeadless = 0;
const current = { p1: null, p2: null };
const heldMs = { p1: 0, p2: 0 };
for (const step of timeline) {
  for (const side of ['p1', 'p2']) {
    const clip = STEP_TO_CLIP[sideStateFor(step, side)];
    if (!clip || clip === current[side]) { heldMs[side] += step.ms; continue; }
    if (current[side]) {
      // outgoing endpoint: the frame the stage is holding at the switch
      const prevLen = clipLen(side, current[side]);
      const shown = Math.floor((heldMs[side] / 1000) * 30);
      const outFrame = LOOP_CLIPS.has(current[side]) ? shown % prevLen : Math.min(shown, prevLen - 1);
      const out = frameOf(side, current[side], outFrame);
      // incoming endpoint: frame 0 (setClip's goToAndStop(0) before the fade)
      const inn = frameOf(side, clip, 0);
      for (const [img, which, f] of [[out, `${current[side]}@${outFrame}`, outFrame], [inn, `${clip}@0`, 0]]) {
        if (img.empty) { skippedHeadless++; continue; }
        const s = inkStats(img);
        framesMeasured++;
        minInkPct = Math.min(minInkPct, s.pct);
        if (s.pct < TOLERANCES.blankFrameMaxInkPct) { blankFrames++; console.log(`   BLANK: ${side} ${which} ink ${s.pct}%`); }
      }
      transitions.push({ side, from: current[side], to: clip, atStep: step.state });
    }
    current[side] = clip;
    heldMs[side] = step.ms;
  }
}
for (const side of ['p1', 'p2']) for (const r of renderers[side].values()) r.destroy();
const midDuelFetches = fetchCount - fetchesAtReady;
console.log(`   ${transitions.length} side-transitions over ${timeline.length} steps; ${framesMeasured} endpoint frames measured (${skippedHeadless} skipped headless); min ink ${minInkPct.toFixed(2)}%; blank ${blankFrames}; mid-duel fetches ${midDuelFetches}`);
const d3Pass = verdict(
  'no-blank',
  `every transition endpoint frame >= ${TOLERANCES.blankFrameMaxInkPct}% ink; mid-duel fetches <= ${TOLERANCES.midDuelFetchMax}`,
  `${framesMeasured} frames, min ink ${minInkPct.toFixed(2)}%, blank ${blankFrames}; mid-duel fetches ${midDuelFetches}`,
  blankFrames === 0 && midDuelFetches <= TOLERANCES.midDuelFetchMax && framesMeasured > 0,
);

// =============================================================================
// D4 — FX-FIDELITY (the affinitycape overlays vs the bundle's FX source)
// =============================================================================
console.log(`\nD4 FX-fidelity — the loadout's recoloured affinitycape overlays diffed against the bundle's FX sources`);
console.log(`   declared tolerance: geometry digest identical (exact); non-identical pixels explained as slot recolour, unexplained <= ${TOLERANCES.fxMaxUnexplainedPct}% at ${TOLERANCES.fxPixel}/255`);

const rgbOf = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
const d4Rows = [];
let d4MaxUnexplained = 0, d4AllGeometry = true;
const d4Identity = wizardIdentity({ id: 'd3-p1', element: 'fire', tier: 0 });
for (const kind of ['win', 'lose']) {
  // the bundle's FX source for this wizard's element/power (vendored copy
  // is byte-identical; the bucket is the canonical address)
  let source;
  let origin = 'bucket';
  try {
    source = await fetchRaw(affinityCapeUrl(kind, d4Identity.element, d4Identity.traits.power));
  } catch {
    origin = 'vendored';
    source = JSON.parse(fs.readFileSync(path.join(REPO, 'assets', 'rig', 'fx', `affinitycape${kind}-${elementToken(d4Identity.element)}.json`), 'utf8'));
  }
  const engine = loadout.getCape('p1', kind); // exactly what the stage plays
  const geomIdentical = geometryDigest(source) === geometryDigest(engine);
  d4AllGeometry = d4AllGeometry && geomIdentical;
  // slot pairs: which colour moves are legitimate recolours
  const before = colourInventory(source), after = colourInventory(engine);
  const slotPairs = [];
  let offSlot = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i].hex !== after[i].hex) {
      if (!before[i].cl || !CLASS_TO_SLOT[before[i].cl]) offSlot++;
      else slotPairs.push({ src: rgbOf(before[i].hex), dst: rgbOf(after[i].hex) });
    }
  }
  const total = source.op - source.ip;
  const rSrc = makeRenderer(source, { width: W, height: H });
  const rEng = makeRenderer(engine, { width: W, height: H });
  // the cape overlay fades in (first ~20 frames are genuinely empty by
  // design) — sample the visible act of the clip
  let content = 0, identical = 0, explained = 0, unexplained = 0, frames = 0, fxCoverageMax = 0;
  for (const f of [Math.floor(total / 3), Math.floor(total / 2), Math.floor((2 * total) / 3)]) {
    const a = rSrc.frame(f), b = rEng.frame(f);
    if (a.empty || b.empty) continue;
    frames++;
    let opaque = 0;
    for (let i = 3; i < b.data.length; i += 4) if (b.data[i] > 128) opaque++;
    fxCoverageMax = Math.max(fxCoverageMax, +((opaque / (W * H)) * 100).toFixed(2));
    for (let i = 0; i < a.data.length; i += 4) {
      const aOn = a.data[i + 3] > 128, bOn = b.data[i + 3] > 128;
      if (!aOn && !bOn) continue;
      content++;
      const pa = [a.data[i], a.data[i + 1], a.data[i + 2]], pb = [b.data[i], b.data[i + 1], b.data[i + 2]];
      if (aOn === bOn && near(pa, pb, TOLERANCES.fxPixel)) { identical++; continue; }
      let ok = false;
      for (const { src, dst } of slotPairs) if (near(pa, src, 90) && near(pb, dst, 90)) { ok = true; break; }
      if (ok) explained++; else unexplained++;
    }
  }
  rSrc.destroy(); rEng.destroy();
  const pct = (n) => +((n / Math.max(1, content)) * 100).toFixed(2);
  d4MaxUnexplained = Math.max(d4MaxUnexplained, pct(unexplained));
  d4Rows.push({ kind, origin, geomIdentical, offSlotChanges: offSlot, framesCompared: frames, identicalPct: pct(identical), explainedRecolourPct: pct(explained), unexplainedPct: pct(unexplained), overlayCoverageMaxPct: fxCoverageMax });
  console.log(`   affinitycape${kind} (${origin}): geometry=${geomIdentical} identical ${pct(identical)}% explained ${pct(explained)}% unexplained ${pct(unexplained)}% (overlay coverage up to ${fxCoverageMax}%)`);
}
// the FX pass composited over the round pose: the overlay is visible content
// (sampled mid-clip, inside the overlay's visible act)
const capeTotal = loadout.getCape('p1', 'win').op - loadout.getCape('p1', 'win').ip;
const poseR = makeRenderer(loadout.get('p1', 'win'), { width: W, height: H });
const capeR = makeRenderer(loadout.getCape('p1', 'win'), { width: W, height: H });
const pose = poseR.frame(10), cape = capeR.frame(Math.floor(capeTotal / 2));
const fxComposite = { data: Uint8ClampedArray.from(pose.data), width: W, height: H };
let fxOverlayPx = 0;
for (let i = 0; i < cape.data.length; i += 4) {
  if (cape.data[i + 3] > 128) { fxOverlayPx++; fxComposite.data[i] = cape.data[i]; fxComposite.data[i + 1] = cape.data[i + 1]; fxComposite.data[i + 2] = cape.data[i + 2]; fxComposite.data[i + 3] = 255; }
}
poseR.destroy(); capeR.destroy();
savePng(fxComposite, path.join(__dirname, 'results', 'frames', 'd4-fx-over-pose.png'));
const fxOverlayPct = +((fxOverlayPx / (W * H)) * 100).toFixed(2);
console.log(`   FX pass composited over the win pose: overlay covers ${fxOverlayPct}% of the frame (results/frames/d4-fx-over-pose.png)`);
const d4Pass = verdict(
  'FX-fidelity',
  `geometry identical; unexplained <= ${TOLERANCES.fxMaxUnexplainedPct}% at ${TOLERANCES.fxPixel}/255; overlay non-empty`,
  `geometry ${d4AllGeometry}; max unexplained ${d4MaxUnexplained}%; overlay ${fxOverlayPct}% of frame`,
  d4AllGeometry && d4MaxUnexplained <= TOLERANCES.fxMaxUnexplainedPct && fxOverlayPct > 0.5,
);

// =============================================================================
const allPass = d1Pass && d2Pass && d3Pass && d4Pass;
console.log(`\nCheck D overall: ${pf(allPass)} (distinctness ${pf(d1Pass)}, arena-composite ${pf(d2Pass)}, no-blank ${pf(d3Pass)}, FX-fidelity ${pf(d4Pass)})`);
const file = writeJson('results/check-d-ac1.json', {
  ranAt: new Date().toISOString(),
  node: process.version,
  provenance,
  tolerances: TOLERANCES,
  verdicts,
  d1: { pairs: d1Rows, minDistinctPct: d1MinDistinct },
  d2: { geometryFromCss: GEO, arenaInkPct: arenaInk.pct, stageInkPct: stageInk.pct, bareFieldPct: blankPct, underCombatantArenaPct: underPct, arenaUnderScene: arenaFirst, noLayerBackground },
  d3: { cadenceMs, steps: timeline.length, transitions: transitions.length, framesMeasured, skippedHeadless, minInkPct: +minInkPct.toFixed(2), blankFrames, fetchesAtReady, midDuelFetches, fallbacks },
  d4: { capes: d4Rows, fxOverPoseCoveragePct: fxOverlayPct },
  headlessResidual: 'no CSS layout/paint/opacity animation executes headlessly: the cross-fade ramp itself and browser compositing are verified structurally (stacked preloaded canvases, opacity transition, no src swap — app/tests/rig-stage.test.js) and manually in a browser; every number above is measured on rendered pixel output.',
  overall: pf(allPass),
});
console.log('written:', file);
process.exitCode = allPass ? 0 : 1;
