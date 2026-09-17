// tools/parity/check-b-wizards.mjs — AC1 battle-fidelity, comparison 2 of 2:
// the NEW engine's output vs the REFERENCE pipeline's own output for a
// sample of ARBITRARY summoned wizards (fresh characterIds the system has
// never seen, exactly what the app summons). Also samples the identity path
// end to end: id -> deterministic traits/palette -> a REAL library shape
// set -> live recolour -> playback by the shipped player.
//
// Per wizard, per state, two layers of comparison:
//  1. STRUCTURAL (exact, no tolerance): the engine's recoloured animation
//     must digest geometry-identical to the library source (colours only),
//     and every colour change must sit on a slot class.
//  2. PIXEL (the reference-output diff): render the library source (the
//     reference pipeline's own output for that combo) and the engine's
//     recoloured output with the SAME shipped player; every differing pixel
//     must be EXPLAINED as "this slot's source colour became this wizard's
//     palette colour" (within tolerance for antialiased edges). Reported:
//     %identical, %explained-recolour, %unexplained per wizard/state.
import fs from 'node:fs';
import path from 'node:path';
import { makeRenderer, writeJson, __dirname } from './lib.mjs';
import { RIG_BUCKET_BASE } from '../../app/data/rigManifest.js';
import { wizardIdentity } from '../../app/engine/wizardRig.js';
import { recolorAnimation, geometryDigest, colourInventory, CLASS_TO_SLOT } from '../../app/engine/rigRecolor.js';

const CACHE = path.join(__dirname, 'results', 'cache');
fs.mkdirSync(CACHE, { recursive: true });
const STATES = ['idle', 'charge', 'win'];
const TOLERANCE = 60;
const W = 430, H = 350;

const WIZARDS = [
  { id: 'parity-wizard-001', element: 'fire', tier: 0 },
  { id: 'parity-wizard-002', element: 'water', tier: 0 },
  { id: 'parity-wizard-003', element: 'air', tier: 1 },
  { id: 'parity-wizard-004', element: 'fire', tier: 3 },
  { id: 'parity-wizard-005', element: 'water', tier: 5 },
  { id: 'parity-wizard-006', element: 'air', tier: 6 },
];

async function fetchClip(state, combo) {
  const file = path.join(CACHE, `${state}-${combo}.json`);
  if (!fs.existsSync(file)) {
    const res = await fetch(`${RIG_BUCKET_BASE}/${state}-${combo}.json`);
    if (!res.ok) throw new Error(`${res.status} for ${state}-${combo}`);
    fs.writeFileSync(file, await res.text());
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

function pixelCompare(orig, eng, slotPairs) {
  let content = 0, identical = 0, explained = 0, unexplained = 0;
  for (let i = 0; i < orig.data.length; i += 4) {
    const aOn = orig.data[i + 3] > 128, bOn = eng.data[i + 3] > 128;
    if (!aOn && !bOn) continue;
    content++;
    const a = [orig.data[i], orig.data[i + 1], orig.data[i + 2]];
    const b = [eng.data[i], eng.data[i + 1], eng.data[i + 2]];
    if (aOn === bOn && near(a, b, TOLERANCE)) { identical++; continue; }
    let ok = false;
    for (const { src, dst } of slotPairs) {
      if (near(a, src, 90) && near(b, dst, 90)) { ok = true; break; }
    }
    if (ok) explained++; else unexplained++;
  }
  return { content, identical, explained, unexplained };
}

console.log(`Check B — ${WIZARDS.length} arbitrary summoned wizards × ${STATES.join('/')} vs the reference pipeline's own output (tolerance ${TOLERANCE}/255)`);
const results = [];
for (const w of WIZARDS) {
  const identity = wizardIdentity(w);
  const row = { wizard: w, comboKey: identity.comboKey, palette: identity.palette, states: {} };
  for (const state of STATES) {
    const source = await fetchClip(state, identity.comboKey);
    const { animation, stats } = recolorAnimation(source, identity.palette);

    // 1. structural — exact
    const structural = {
      geometryIdentical: geometryDigest(source) === geometryDigest(animation),
      slottedFillsRecoloured: stats.recoloured,
      changesOffSlotClasses: 0,
    };
    const before = colourInventory(source);
    const after = colourInventory(animation);
    const slotPairs = [];
    for (let i = 0; i < before.length; i++) {
      if (before[i].hex !== after[i].hex) {
        if (!before[i].cl || !CLASS_TO_SLOT[before[i].cl]) structural.changesOffSlotClasses++;
        else slotPairs.push({ src: rgb(before[i].hex), dst: rgb(after[i].hex) });
      }
    }

    // 2. pixel — reference output vs engine output, three frames
    const total = source.op - source.ip;
    const frames = [0, Math.floor(total / 3), Math.floor((2 * total) / 3)];
    const rOrig = makeRenderer(source, { width: W, height: H });
    const rEng = makeRenderer(animation, { width: W, height: H });
    let acc = { content: 0, identical: 0, explained: 0, unexplained: 0 }, skipped = 0;
    for (const f of frames) {
      const a = rOrig.frame(f), b = rEng.frame(f);
      if (a.empty || b.empty) { skipped++; continue; }
      const c = pixelCompare(a, b, slotPairs);
      for (const k of Object.keys(acc)) acc[k] += c[k];
    }
    rOrig.destroy(); rEng.destroy();
    const pct = (n) => acc.content ? +((n / acc.content) * 100).toFixed(2) : null;
    row.states[state] = {
      ...structural,
      framesCompared: frames.length - skipped,
      framesSkippedHeadless: skipped,
      identicalPct: pct(acc.identical),
      explainedRecolourPct: pct(acc.explained),
      unexplainedPct: pct(acc.unexplained),
    };
  }
  results.push(row);
  const idle = row.states.idle;
  console.log(`${w.id} (${w.element} t${w.tier}) -> ${identity.comboKey}: geometry=${idle.geometryIdentical} offSlot=${idle.changesOffSlotClasses} idle: id=${idle.identicalPct}% rec=${idle.explainedRecolourPct}% unexp=${idle.unexplainedPct}%`);
}

// summary
const flat = results.flatMap((r) => Object.values(r.states));
const summary = {
  wizards: WIZARDS.length,
  statesPerWizard: STATES.length,
  geometryIdenticalAll: flat.every((s) => s.geometryIdentical),
  changesOffSlotClassesTotal: flat.reduce((a, s) => a + s.changesOffSlotClasses, 0),
  meanIdenticalPct: +(flat.reduce((a, s) => a + (s.identicalPct || 0), 0) / flat.length).toFixed(2),
  meanExplainedRecolourPct: +(flat.reduce((a, s) => a + (s.explainedRecolourPct || 0), 0) / flat.length).toFixed(2),
  meanUnexplainedPct: +(flat.reduce((a, s) => a + (s.unexplainedPct || 0), 0) / flat.length).toFixed(2),
  maxUnexplainedPct: Math.max(...flat.map((s) => s.unexplainedPct || 0)),
};
console.log('summary:', summary);

// ---- verdict (C7): declared tolerances + explicit PASS/FAIL -----------------
const B_TOLERANCES = {
  pixel: TOLERANCE, // per-pixel tolerance for "identical"/"explained"
  geometryIdentical: true, // exact: recolour must change colours and NOTHING else
  changesOffSlotClassesMax: 0, // exact: every colour change sits on a slot class
  meanUnexplainedMaxPct: 3.0, // antialiased slot edges only
  maxUnexplainedMaxPct: 5.0,
};
const pf = (ok) => (ok ? 'PASS' : 'FAIL');
const verdicts = [
  { criterion: 'B-structural', tolerance: 'geometry digest identical AND 0 colour changes off slot classes (exact, no tolerance)', measured: `geometry identical ${flat.filter((s) => s.geometryIdentical).length}/${flat.length}, off-slot changes ${summary.changesOffSlotClassesTotal}`, pass: summary.geometryIdenticalAll && summary.changesOffSlotClassesTotal === 0 },
  { criterion: 'B-recolour-explained', tolerance: `unexplained pixels mean <= ${B_TOLERANCES.meanUnexplainedMaxPct}% and worst <= ${B_TOLERANCES.maxUnexplainedMaxPct}% at ${TOLERANCE}/255`, measured: `mean ${summary.meanUnexplainedPct}%, worst ${summary.maxUnexplainedPct}%`, pass: summary.meanUnexplainedPct <= B_TOLERANCES.meanUnexplainedMaxPct && summary.maxUnexplainedPct <= B_TOLERANCES.maxUnexplainedMaxPct },
];
for (const v of verdicts) console.log(`VERDICT ${v.criterion}: tolerance [${v.tolerance}] measured [${v.measured}] -> ${pf(v.pass)}`);
const bPass = verdicts.every((v) => v.pass);
console.log(`Check B overall: ${pf(bPass)}`);

const file = writeJson('results/check-b-wizards.json', { tolerance: TOLERANCE, tolerances: B_TOLERANCES, verdicts, overall: pf(bPass), wizards: results, summary });
console.log('written:', file);
process.exitCode = bPass ? 0 : 1;
