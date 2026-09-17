// tools/parity/preregistration.mjs — CB-BUILD-015: the harness's tolerances
// are not literals in the code. They live in PREREGISTRATION.md, committed
// BEFORE the run, and this module parses them out of it. Every number the
// comparer compares against — pixel tolerance, match floor, silhouette IoU
// floor, the per-state reference frame counts, the timing tolerances, the
// sample size and the sampling seed — is read from that file, so a tolerance
// cannot silently drift between the declaration and the report.
//
// Format: the declaration document carries fenced ```prereg blocks of JSON;
// they are merged, in order, into one object. Prose around them is the
// reasoning; the JSON is the contract.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PREREG_PATH = path.join(HERE, 'PREREGISTRATION.md');

/** Parse the fenced `prereg` JSON blocks out of a pre-registration document. */
export function parsePreregistration(markdown) {
  const blocks = [...markdown.matchAll(/```prereg\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length === 0) throw new Error('preregistration: no ```prereg JSON blocks found');
  const merged = {};
  blocks.forEach((raw, i) => {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`preregistration: block ${i + 1} is not valid JSON — ${err.message}`);
    }
    Object.assign(merged, parsed);
  });
  return merged;
}

const REQUIRED = [
  ['duelStates', (v) => Array.isArray(v) && v.length > 0],
  ['framePositions', (v) => Array.isArray(v) && v.length > 0],
  ['minComparableFramesPerState', (v) => Number.isInteger(v) && v > 0],
  ['renderWidth', (v) => Number.isInteger(v) && v > 0],
  ['renderHeight', (v) => Number.isInteger(v) && v > 0],
  ['canonicalWizard', (v) => v && typeof v.id === 'string' && typeof v.comboKey === 'string'],
  ['sampleSeed', (v) => typeof v === 'string' && v.length > 0],
  ['sampleSize', (v) => Number.isInteger(v) && v >= 0],
  ['visual', (v) => v && typeof v.pixelChannelTolerance === 'number' && typeof v.minMatchPct === 'number' && typeof v.minSilhouetteIoU === 'number'],
  ['recolour', (v) => v && v.maxSlotMapDisagreements === 0 && v.maxColourDifferences === 0],
  ['timing', (v) => v && typeof v.fps === 'number' && v.referenceFrames && typeof v.durationToleranceMs === 'number'],
  ['overall', (v) => v && Array.isArray(v.statePassRequires)],
];

/** Read + validate the committed pre-registration. Throws if a required
 * declaration is missing — the harness refuses to run undeclared. */
export function loadPreregistration(file = PREREG_PATH) {
  if (!fs.existsSync(file)) throw new Error(`preregistration: ${file} is missing — the harness will not run undeclared`);
  const text = fs.readFileSync(file, 'utf8');
  const prereg = parsePreregistration(text);
  for (const [key, ok] of REQUIRED) {
    if (!ok(prereg[key])) throw new Error(`preregistration: '${key}' is missing or malformed in ${path.basename(file)}`);
  }
  prereg.sourceFile = path.relative(path.resolve(HERE, '..', '..'), file);
  return prereg;
}

/** FNV-1a 32-bit — the harness's own hash for its own seed (deliberately
 * not imported from the engine: the sampling stream is the harness's). */
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — a small, stable, seeded PRNG for the wizard sample. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The sampled wizards, derived ONLY from the pre-registered seed and sample
 * size — same seed in, same ids out, on any machine. Returns the character
 * records the harness feeds to BOTH sides.
 */
export function sampledWizards(prereg) {
  const seed32 = fnv1a32(prereg.sampleSeed);
  const rand = mulberry32(seed32);
  const elements = prereg.sampleElements || ['fire', 'water', 'air'];
  const [tierLo, tierHi] = prereg.sampleTierRange || [0, 0];
  const hex = seed32.toString(16).padStart(8, '0');
  const out = [];
  for (let n = 1; n <= prereg.sampleSize; n++) {
    const element = elements[Math.floor(rand() * elements.length) % elements.length];
    const tier = tierLo + Math.floor(rand() * (tierHi - tierLo + 1));
    out.push({ id: `parity015-${hex}-${n}`, element, tier, kind: 'sampled' });
  }
  return { seed: prereg.sampleSeed, seed32, seed32hex: hex, wizards: out };
}

/** The per-state frame indices this run compares, from the declared
 * positions and the clip's own length. */
export function frameIndicesFor(prereg, clipFrames) {
  return prereg.framePositions.map((p) => Math.max(0, Math.min(clipFrames - 1, Math.floor(p * clipFrames))));
}
