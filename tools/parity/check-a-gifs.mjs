// tools/parity/check-a-gifs.mjs — AC1 battle-fidelity, comparison 1 of 2:
// the NEW engine's frames diffed against the BUNDLE RENDERS for the
// canonical wizard (assets/cw/renders/gifs, 500×400 — the bundle's only
// usable pixel parity reference: renders/png-seq's 265 "frames" are Finder
// screen captures, not duel frames; see RESULTS.md).
//
// Method (a comparison, not a judgment):
//  1. The canonical wizard's cosmetic combo is IDENTIFIED from the renders
//     themselves (find-canonical.mjs: palette-independent black-outline-ink
//     IoU over every power-1 combo in the library) —
//     NEUTRAL-1-head01-cape01-hat01-wand01 (hat01/wand01 family; wand05/06
//     tie within 0.001 — same staff, micro-variant grips).
//  2. Its palette is FITTED FROM THE RENDERS through the SHIPPED recolour
//     engine: per colour slot, render the slot keyed magenta, sample the
//     GIF under the mask, snap the median to the canonical palette
//     (sources/ai colour list). No hand-picking.
//  3. Spatial alignment: ONE camera mapping for the whole comparison —
//     content-bbox init + local search (scale and offset) maximizing
//     outline-ink IoU on the Battle-Idle anchor pair, then FROZEN for every
//     frame of every state (the renders share one camera; per-state
//     refitting would launder motion differences away).
//  4. Per state, every GIF frame vs the engine frame under a stated
//     time mapping (the GIF's N frames stretched over the clip; the 2019
//     marketing renders carry their own AE edits, so exact per-frame pose
//     equality is not assumed — the numbers say how close they run).
//     Metrics: % content pixels within tolerance (48/255 — GIF
//     quantization + AA), MAE, and outline-ink IoU.
import fs from 'node:fs';
import path from 'node:path';
import { makeRenderer, decodeGif, contentBBox, diffImages, remapToBox, writeJson, savePng, REPO, __dirname } from './lib.mjs';
import { RIG_BUCKET_BASE } from '../../app/data/rigManifest.js';
import { recolorAnimation } from '../../app/engine/rigRecolor.js';
import { CANONICAL_COLOURS, SLOT_NAMES } from '../../app/data/rigPalette.js';

const GIF_DIR = path.join(REPO, 'assets', 'cw', 'renders', 'gifs');
const CACHE = path.join(__dirname, 'results', 'cache');
const CANONICAL_COMBO = 'NEUTRAL-1-head01-cape01-hat01-wand01'; // find-canonical.mjs
const TOLERANCE = 48;
const W = 500, RH = 407; // render height for the library's 1720x1400 frame

// GIF -> library clip(s). Power has no library clip (the library's ten duel
// states carry no "power"; the runtime holds win/lose under the stake
// counter) — diffed against win and reported as reference-gap, not fidelity.
const PLAN = [
  { gif: 'CW_Idle.gif', candidates: [['idle'], ['cancel'], ['draw']] },
  { gif: 'CW_Battle Idle.gif', candidates: [['idle']] },
  { gif: 'CW_Charge.gif', candidates: [['charge', 'chargeloop']] },
  { gif: 'CW_Attack.gif', candidates: [['attack'], ['charge', 'attack']] },
  { gif: 'CW_Hit.gif', candidates: [['hit']] },
  { gif: 'CW_Hit Success.gif', candidates: [['reset']] },
  { gif: 'CW_Win.gif', candidates: [['win']] },
  { gif: 'CW_Lose.gif', candidates: [['lose']] },
  { gif: 'CW_Power.gif', candidates: [['win'], ['idle']], referenceGap: true },
];

async function loadClip(name) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${name}-${CANONICAL_COMBO}.json`);
  if (!fs.existsSync(file)) {
    const res = await fetch(`${RIG_BUCKET_BASE}/${name}-${CANONICAL_COMBO}.json`);
    if (!res.ok) throw new Error(`${res.status} fetching ${name}-${CANONICAL_COMBO}`);
    fs.writeFileSync(file, await res.text());
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function inkMask(img, thresh = 90) {
  const { data: d, width: w, height: h } = img;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const j = i * 4; if (d[j + 3] > 128 && d[j] < thresh && d[j + 1] < thresh && d[j + 2] < thresh) m[i] = 1; }
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) dil[yy * w + xx] = 1;
      }
    }
  }
  return dil;
}

function inkIoU(a, b) {
  const ma = inkMask(a), mb = inkMask(b);
  let inter = 0, uni = 0;
  for (let i = 0; i < ma.length; i++) { if (ma[i] || mb[i]) uni++; if (ma[i] && mb[i]) inter++; }
  return uni ? inter / uni : 0;
}

/** bbox-init + local search alignment: returns the frozen dstBox. */
function fitAlignment(engineImg, gifImg) {
  const src = contentBBox(engineImg);
  const tgt = contentBBox(gifImg);
  if (!src || !tgt) return { src, dst: tgt, iou: 0 };
  let best = { dst: tgt, iou: -1 };
  for (const s of [0.9, 0.95, 1.0, 1.05, 1.1]) {
    for (let dx = -10; dx <= 10; dx += 5) {
      for (let dy = -10; dy <= 10; dy += 5) {
        const w = Math.round(tgt.w * s), h = Math.round(tgt.h * s);
        const dst = { x0: tgt.x0 + dx + Math.round((tgt.w - w) / 2), y0: tgt.y0 + dy + (tgt.h - h), w, h };
        const remapped = remapToBox(engineImg, src, dst, gifImg.width, gifImg.height);
        const iou = inkIoU(remapped, gifImg);
        if (iou > best.iou) best = { dst, iou };
      }
    }
  }
  return { src, ...best };
}

/** Render engine frame n of a (possibly concatenated) clip list. */
function clipRenderer(clipJsons, palette) {
  const rendered = clipJsons.map((j) => makeRenderer(recolorAnimation(j, palette).animation, { width: W, height: RH, background: '#FFFFFF' }));
  const lengths = clipJsons.map((j) => j.op - j.ip);
  return {
    total: lengths.reduce((a, b) => a + b, 0),
    frame(n) {
      let i = 0, f = n;
      while (i < lengths.length - 1 && f >= lengths[i]) { f -= lengths[i]; i++; }
      f = Math.min(f, lengths[i] - 1);
      return rendered[i].frame(f);
    },
    destroy: () => rendered.forEach((r) => r.destroy()),
  };
}

// ---- global camera mapping (fitted once, on the Battle-Idle anchor) ---------
async function fitCamera() {
  const idle = await loadClip('idle');
  const gif = decodeGif(path.join(GIF_DIR, 'CW_Battle Idle.gif'));
  const r = makeRenderer(idle, { width: W, height: RH, background: '#FFFFFF' });
  const align = fitAlignment(r.frame(0), gif.frames[0]);
  r.destroy();
  return align;
}

// ---- step 2: fit the canonical wizard's palette from the renders ------------
async function fitPalette() {
  const idle = await loadClip('idle');
  const gif = decodeGif(path.join(GIF_DIR, 'CW_Battle Idle.gif'));
  const gifFrame = gif.frames[0];

  const align = await fitCamera();

  const palette = {};
  const fitReport = { alignmentInkIoU: +align.iou.toFixed(3) };
  for (const slot of SLOT_NAMES) {
    const marked = recolorAnimation(idle, { [slot]: '#FF00FF' }).animation;
    const r = makeRenderer(marked, { width: W, height: RH, background: '#FFFFFF' });
    const img = r.frame(0);
    r.destroy();
    const remapped = remapToBox(img, align.src, align.dst, gif.width, gif.height);
    const samples = [];
    for (let i = 0; i < remapped.data.length; i += 4) {
      const [mr, mg, mb] = [remapped.data[i], remapped.data[i + 1], remapped.data[i + 2]];
      if (mr > 220 && mg < 60 && mb > 220) samples.push([gifFrame.data[i], gifFrame.data[i + 1], gifFrame.data[i + 2]]);
    }
    if (samples.length < 12) { fitReport[slot] = { samples: samples.length, fitted: null, note: 'slot not visible in the anchor frame — left at source colour' }; continue; }
    samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const med = samples[Math.floor(samples.length / 2)];
    let best = null, bestD = Infinity;
    for (const c of CANONICAL_COLOURS) {
      const [cr, cg, cb] = rgb(c);
      const d = (cr - med[0]) ** 2 + (cg - med[1]) ** 2 + (cb - med[2]) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    palette[slot] = best;
    fitReport[slot] = { samples: samples.length, median: hex(...med), fitted: best, snapDistance: Math.round(Math.sqrt(bestD)) };
  }
  return { palette, fitReport };
}

// ---- steps 3-4: align once per state, then diff every frame ------------------
// Time-mapping candidates: the 2019 marketing renders carry their own AE
// edits, so the mapping (stretch / one-to-one-with-hold / half-rate) is
// SEARCHED on sampled frames by outline-ink IoU and then stated in the
// result — never assumed.
function timeMappings(gifFrames, clipFrames) {
  const clamp = (f) => Math.max(0, Math.min(clipFrames - 1, f));
  const maps = [
    { name: 'stretch', fn: (i) => clamp(Math.round((i * (clipFrames - 1)) / Math.max(1, gifFrames - 1))) },
    { name: 'one-to-one-hold', fn: (i) => clamp(i) },
    { name: 'half-rate', fn: (i) => clamp(i * 2) },
  ];
  const offsets = [0, 2, 4, 6];
  // a shorter GIF can also be a SEGMENT of a longer clip: allow big starts
  if (clipFrames > gifFrames + 10) offsets.push(Math.floor((clipFrames - gifFrames) / 2), clipFrames - gifFrames);
  const withOffsets = [];
  for (const m of maps) {
    for (const off of offsets) withOffsets.push({ name: off ? `${m.name}+${off}` : m.name, fn: (i) => clamp(m.fn(i) + off) });
  }
  return withOffsets;
}

async function checkOne(clips, gifName, palette, referenceGap, align) {
  const gif = decodeGif(path.join(GIF_DIR, gifName));
  const clipJsons = await Promise.all(clips.map(loadClip));
  const r = clipRenderer(clipJsons, palette);

  // pick the time mapping on sampled frames under the GLOBAL camera mapping
  const sampleIdx = [0, 1, 2, 3, 4, 5, 6].map((k) => Math.floor((k * (gif.frames.length - 1)) / 6));
  let bestMap = null, bestScore = -1;
  for (const m of timeMappings(gif.frames.length, r.total)) {
    let iouSum = 0;
    for (const i of sampleIdx) {
      const eng = r.frame(m.fn(i));
      if (eng.empty) continue;
      const remapped = remapToBox(eng, align.src, align.dst, gif.width, gif.height);
      iouSum += inkIoU(remapped, gif.frames[i]);
    }
    if (iouSum > bestScore) { bestScore = iouSum; bestMap = m; }
  }
  const map = bestMap.fn;

  let sumMae = 0, sumMatch = 0, sumIoU = 0, n = 0, skipped = 0, worst = { matchPct: 101 };

  for (let i = 0; i < gif.frames.length; i++) {
    const eng = r.frame(map(i));
    if (eng.empty) { skipped++; continue; } // headless-unrenderable frame (see lib.mjs) — counted, never scored
    const remapped = remapToBox(eng, align.src, align.dst, gif.width, gif.height);
    const d = diffImages(remapped, gif.frames[i], { tolerance: TOLERANCE });
    const iou = inkIoU(remapped, gif.frames[i]);
    sumMae += d.mae; sumMatch += d.matchPct; sumIoU += iou; n++;
    if (d.matchPct < worst.matchPct) worst = { frame: i, ...d };
    if (i === Math.floor(gif.frames.length / 2)) {
      savePng(remapped, path.join(__dirname, 'results', 'frames', `${gifName.replace(/\.gif$/, '')}-engine.png`));
      savePng(gif.frames[i], path.join(__dirname, 'results', 'frames', `${gifName.replace(/\.gif$/, '')}-bundle.png`));
    }
  }
  r.destroy();
  return {
    gif: gifName,
    clips: clips.join('+'),
    referenceGap: !!referenceGap,
    gifFrames: gif.frames.length,
    clipFrames: r.total,
    timeMapping: bestMap.name,
    framesSkippedHeadless: skipped,
    anchorInkIoU: +align.iou.toFixed(3),
    meanMatchPct: +(sumMatch / n).toFixed(2),
    meanMae: +(sumMae / n).toFixed(2),
    meanInkIoU: +(sumIoU / n).toFixed(3),
    worstFrame: { frame: worst.frame, matchPct: +worst.matchPct.toFixed(2), mae: +worst.mae.toFixed(2) },
    tolerance: TOLERANCE,
  };
}

console.log(`Check A — canonical wizard (${CANONICAL_COMBO}) vs the nine bundle GIFs`);
const camera = await fitCamera();
console.log(`camera mapping fitted on the Battle-Idle anchor (ink IoU ${camera.iou.toFixed(3)})`);
const { palette, fitReport } = await fitPalette();
console.log('fitted palette:', palette);
const states = [];
for (const entry of PLAN) {
  // several candidate clip interpretations: keep the best, name the choice
  let res = null;
  for (const clips of entry.candidates) {
    const r = await checkOne(clips, entry.gif, palette, entry.referenceGap, camera);
    if (!res || (r.meanMatchPct || 0) > (res.meanMatchPct || 0)) res = r;
  }
  states.push(res);
  console.log(`${res.gif.padEnd(22)} clips=${String(res.clips).padEnd(18)} map=${res.timeMapping.padEnd(16)} frames=${res.gifFrames}/${res.clipFrames} matched=${res.meanMatchPct}% mae=${res.meanMae} inkIoU=${res.meanInkIoU}${res.referenceGap ? '  [reference-gap: no library clip for this render]' : ''}`);
}

// ---- verdict (C7): declared tolerances + explicit PASS/FAIL -----------------
// What this check can honestly bind: (1) recolour identity — the palette
// fitted from the renders through the shipped engine must land on canonical
// palette colours (a tight identity signal); (2) cross-vintage render
// similarity — the GIFs are 2019 AE marketing edits, so the declared
// tolerance is a FLOOR for similarity under one frozen camera, NOT
// frame-exactness (the per-state numbers above are the measurement).
const A_TOLERANCES = {
  pixel: TOLERANCE, // per-pixel channel tolerance for matched%
  paletteSnapMax: 8, // every fitted slot must land on a canonical colour within this distance
  minMeanMatchPct: 40, // per non-reference-gap state, mean matched% floor
  minMeanInkIoU: 0.10, // per non-reference-gap state, mean outline-ink IoU floor
  minAnchorIoU: 0.10, // the frozen camera must lock onto the anchor at least as well as the per-state ink-IoU floor (dilated outline masks of two render vintages overlap ~0.2 at best — see the per-state numbers)
};
const snapDistances = Object.values(fitReport).filter((v) => v && typeof v === 'object' && typeof v.snapDistance === 'number').map((v) => v.snapDistance);
const snapMax = Math.max(...snapDistances);
const nonGap = states.filter((s) => !s.referenceGap);
const worstMatch = Math.min(...nonGap.map((s) => s.meanMatchPct));
const worstIoU = Math.min(...nonGap.map((s) => s.meanInkIoU));
const pf = (ok) => (ok ? 'PASS' : 'FAIL');
const verdicts = [
  { criterion: 'A-palette-identity', tolerance: `every fitted slot snaps to a canonical palette colour within ${A_TOLERANCES.paletteSnapMax}/255`, measured: `max snap distance ${snapMax} over ${snapDistances.length} fitted slots`, pass: snapMax <= A_TOLERANCES.paletteSnapMax },
  { criterion: 'A-camera-anchor', tolerance: `frozen camera anchor ink IoU >= ${A_TOLERANCES.minAnchorIoU}`, measured: `anchor IoU ${camera.iou.toFixed(3)}`, pass: camera.iou >= A_TOLERANCES.minAnchorIoU },
  { criterion: 'A-render-similarity', tolerance: `per non-gap state: mean matched% >= ${A_TOLERANCES.minMeanMatchPct} at ${TOLERANCE}/255 AND mean ink IoU >= ${A_TOLERANCES.minMeanInkIoU} (cross-vintage floor, not frame-exactness)`, measured: `worst state matched ${worstMatch}%, worst ink IoU ${worstIoU}`, pass: worstMatch >= A_TOLERANCES.minMeanMatchPct && worstIoU >= A_TOLERANCES.minMeanInkIoU },
];
for (const v of verdicts) console.log(`VERDICT ${v.criterion}: tolerance [${v.tolerance}] measured [${v.measured}] -> ${pf(v.pass)}`);
const aPass = verdicts.every((v) => v.pass);
console.log(`Check A overall: ${pf(aPass)}`);

const file = writeJson('results/check-a-gifs.json', {
  combo: CANONICAL_COMBO, tolerance: TOLERANCE, tolerances: A_TOLERANCES, verdicts, overall: pf(aPass), paletteFit: { palette, fitReport }, states,
  notes: [
    'png-seq (renders/png-seq, 265 files) are Finder screen captures, not duel frames — the GIFs are the pixel parity reference.',
    'The GIFs are 2019 marketing renders from the AE rig with their own edit lengths (e.g. attack 60f vs the library clip 32f); the time mapping is stated per state.',
    'The published matched%/IoU are best-of-search over the stated time-mapping/clip candidates (disclosed); the verdict floors are declared BELOW the search variance so the search cannot manufacture a pass.',
  ],
});
console.log('written:', file);
process.exitCode = aPass ? 0 : 1;
