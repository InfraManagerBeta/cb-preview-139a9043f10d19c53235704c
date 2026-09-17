// tools/parity/check-c-timing.mjs — AC1 timing row: the engine's timing
// checked against the REFERENCE'S CONSTANTS, with real numbers:
//  1. the library's playback constants across a live sample of combos
//     (30fps, 1720×1400, per-state clip lengths — the constants the runtime
//     plays unmodified, asserted per sampled set);
//  2. the bundle renders' own frame timing (GIF delays -> effective fps);
//  3. the presentation timeline the stage drives (R75 order, O9 cadence
//     from the shipped tunables): per-state step window vs the clip's
//     native duration (the stage plays clips at native rate inside the
//     step window — loop or hold; deltas reported), and the whole-duel
//     wall clock vs the R75 45s ceiling.
import fs from 'node:fs';
import path from 'node:path';
import { decodeGif, writeJson, REPO, __dirname } from './lib.mjs';
import { RIG_BUCKET_BASE, RIG_COMBOS } from '../../app/data/rigManifest.js';
import { buildDuelTimeline, totalDurationMs } from '../../app/engine/presentationTimeline.js';
import { runProvenanceFor } from './provenance.mjs';

// The tree this run is being made on, captured BEFORE anything is written
// (fix round g1). app/tests/parity-harness.test.js asserts these digests:
// change a file below without re-running this check and the root suite goes
// red. See tools/parity/freshness.mjs.
const provenance = runProvenanceFor('C');

const CACHE = path.join(__dirname, 'results', 'cache');
fs.mkdirSync(CACHE, { recursive: true });

const REFERENCE_FRAMES = { idle: 34, charge: 42, chargeloop: 18, attack: 32, hit: 60, reset: 60, cancel: 60, win: 112, lose: 112, draw: 112 };
const STATES = Object.keys(REFERENCE_FRAMES);

// deterministic sample of live combos (every ~350th of the manifest)
const SAMPLE = [];
for (let i = 100; i < RIG_COMBOS.length; i += 350) SAMPLE.push(RIG_COMBOS[i]);

async function head(state, combo) {
  const file = path.join(CACHE, `${state}-${combo}.json`);
  if (!fs.existsSync(file)) {
    const res = await fetch(`${RIG_BUCKET_BASE}/${state}-${combo}.json`);
    if (!res.ok) throw new Error(`${res.status} for ${state}-${combo}`);
    fs.writeFileSync(file, await res.text());
  }
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { fr: j.fr, w: j.w, h: j.h, frames: j.op - j.ip, v: j.v };
}

// ---- 1. library constants, live sample --------------------------------------
console.log(`Check C — timing vs the reference constants`);
console.log(`1) library constants over ${SAMPLE.length} live-sampled combos × ${STATES.length} states:`);
const deviations = [];
for (const combo of SAMPLE) {
  for (const state of STATES) {
    const m = await head(state, combo);
    if (m.fr !== 30 || m.w !== 1720 || m.h !== 1400 || m.frames !== REFERENCE_FRAMES[state] || m.v !== '5.5.2') {
      deviations.push({ combo, state, ...m });
    }
  }
  process.stderr.write('.');
}
process.stderr.write('\n');
console.log(`   deviations from {30fps, 1720x1400, v5.5.2, reference clip lengths}: ${deviations.length}`);
for (const d of deviations) console.log('   ', JSON.stringify(d));

// ---- 2. bundle-render frame timing -------------------------------------------
const gifTiming = {};
for (const f of fs.readdirSync(path.join(REPO, 'assets', 'cw', 'renders', 'gifs')).filter((f) => f.endsWith('.gif'))) {
  const gif = decodeGif(path.join(REPO, 'assets', 'cw', 'renders', 'gifs', f));
  const delays = gif.frames.map((fr) => fr.delayCs);
  const meanCs = delays.reduce((a, b) => a + b, 0) / delays.length;
  gifTiming[f] = { frames: gif.frames.length, meanDelayCs: +meanCs.toFixed(2), effectiveFps: +(100 / meanCs).toFixed(1) };
}
console.log('2) bundle GIF timing (target 30fps):');
for (const [f, t] of Object.entries(gifTiming)) console.log(`   ${f.padEnd(22)} ${t.frames}f mean delay ${t.meanDelayCs}cs -> ${t.effectiveFps}fps`);

// ---- 3. the presentation timeline vs clip native durations -------------------
const tunables = JSON.parse(fs.readFileSync(path.join(REPO, 'app', 'data', 'tunables.json'), 'utf8'));
const cadenceMs = tunables.timers.revealCadenceMs.default;
const STEP_TO_CLIP = { battleIdle: 'idle', charge: 'charge', chargeLoop: 'chargeloop', attack: 'attack', hit: 'hit', hitSuccess: 'reset', reset: 'reset', draw: 'idle', win: 'win', lose: 'lose' };
const LOOP = new Set(['idle', 'chargeloop']);
const worstOutcome = {
  rounds: [1, 2, 3, 4, 5].map((round) => ({ round, move1: 'fire', move2: 'water', result: 'WIN', p1Affinity: true, p2Affinity: true, tag: 'CRITICAL' })),
  winner: 1, trueTie: false, floorDrain: true,
};
const timeline = buildDuelTimeline(worstOutcome, cadenceMs, { bracketComplete: true });
const stepStats = {};
for (const step of timeline) {
  const clip = STEP_TO_CLIP[step.state];
  if (!clip) continue;
  const clipMs = Math.round((REFERENCE_FRAMES[clip] / 30) * 1000);
  const key = `${step.state}->${clip}`;
  stepStats[key] = stepStats[key] || { stepMs: step.ms, clipNativeMs: clipMs, deltaMs: step.ms - clipMs, policy: LOOP.has(clip) ? 'loops' : (step.ms >= clipMs ? 'plays out, holds last frame' : 'window ends first (cut by cross-fade)') };
}
console.log(`3) timeline (O9 cadence ${cadenceMs}ms) step window vs native clip duration @30fps:`);
for (const [k, v] of Object.entries(stepStats)) console.log(`   ${k.padEnd(24)} step=${v.stepMs}ms clip=${v.clipNativeMs}ms delta=${v.deltaMs}ms (${v.policy})`);
const worstTotal = totalDurationMs(timeline, cadenceMs);
console.log(`   worst-case duel wall clock (5×CRITICAL + floorDrain + prizeAward, incl. pre-round hold): ${worstTotal}ms (R75 ceiling 45000ms) -> ${worstTotal < 45000 ? 'UNDER' : 'OVER'}`);

// A-O9 (fix round F2, R75): the O9 cadence is console-switchable — the
// recorded ceiling evidence must cover EVERY switchable arm (default +
// alternatives from the shipped tunables), not just the default.
const O9_ARMS = [tunables.timers.revealCadenceMs.default, ...tunables.timers.revealCadenceMs.alternatives].sort((a, b) => a - b);
const ceilingByArm = {};
console.log(`   R75 ceiling at every switchable O9 arm (${O9_ARMS.join('/')}ms):`);
for (const arm of O9_ARMS) {
  const armTimeline = buildDuelTimeline(worstOutcome, arm, { bracketComplete: true });
  const total = totalDurationMs(armTimeline, arm);
  ceilingByArm[arm] = { worstCaseTotalMs: total, ceilingMs: 45000, under: total < 45000, isDefault: arm === cadenceMs };
  console.log(`     cadence ${String(arm).padEnd(5)} => ${total}ms ${total < 45000 ? 'UNDER' : 'OVER'}${arm === cadenceMs ? ' (default)' : ''}`);
}

// ---- verdict (C7): declared tolerances + explicit PASS/FAIL -----------------
const C_TOLERANCES = {
  libraryDeviationsMax: 0, // exact: constants match the reference or they don't
  gifFpsTarget: 30, gifFpsTolerance: 0.5, // the renders' own rate, ±
  ceilingMs: 45000, // R75, at EVERY switchable O9 arm (A-O9)
};
const pf = (ok) => (ok ? 'PASS' : 'FAIL');
const fpsValues = Object.values(gifTiming).map((t) => t.effectiveFps);
const fpsWorst = Math.max(...fpsValues.map((f) => Math.abs(f - C_TOLERANCES.gifFpsTarget)));
const verdicts = [
  { criterion: 'C-library-constants', tolerance: `deviations from {30fps, 1720x1400, v5.5.2, reference clip lengths} <= ${C_TOLERANCES.libraryDeviationsMax} (exact)`, measured: `${deviations.length} deviations over ${SAMPLE.length * STATES.length} live-sampled files`, pass: deviations.length <= C_TOLERANCES.libraryDeviationsMax },
  { criterion: 'C-render-rate', tolerance: `every bundle GIF effective fps within ${C_TOLERANCES.gifFpsTarget} ± ${C_TOLERANCES.gifFpsTolerance}`, measured: `worst |fps-30| = ${fpsWorst.toFixed(1)}`, pass: fpsWorst <= C_TOLERANCES.gifFpsTolerance },
  { criterion: 'C-duel-ceiling', tolerance: `worst-case duel < ${C_TOLERANCES.ceilingMs}ms (R75) at EVERY switchable O9 arm (${O9_ARMS.join('/')}ms)`, measured: O9_ARMS.map((a) => `${a}ms -> ${ceilingByArm[a].worstCaseTotalMs}ms`).join('; '), pass: O9_ARMS.every((a) => ceilingByArm[a].under) },
];
for (const v of verdicts) console.log(`VERDICT ${v.criterion}: tolerance [${v.tolerance}] measured [${v.measured}] -> ${pf(v.pass)}`);
const cPass = verdicts.every((v) => v.pass);
console.log(`Check C overall: ${pf(cPass)}`);

const file = writeJson('results/check-c-timing.json', {
  ranAt: new Date().toISOString(),
  node: process.version,
  provenance,
  tolerances: C_TOLERANCES,
  verdicts,
  overall: pf(cPass),
  librarySample: { combos: SAMPLE, deviations },
  gifTiming,
  timeline: { cadenceMs, stepStats, worstCaseTotalMs: worstTotal, ceilingMs: 45000, ceilingByO9Arm: ceilingByArm },
});
console.log('written:', file);
process.exitCode = cPass ? 0 : 1;
