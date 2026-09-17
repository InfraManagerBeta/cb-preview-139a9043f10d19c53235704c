// tools/parity/compare.mjs — CB-BUILD-015, the per-state comparer. Takes one
// duel state's reference-side result and new-engine-side result for the SAME
// wizard id and returns an explicit PASS/FAIL per criterion, against the
// tolerances READ FROM PREREGISTRATION.md (never literals here).
//
// Criteria (declared in PREREGISTRATION.md §4-§6):
//   V1 pixel parity     — % of union-content pixels within the declared
//                         per-channel tolerance, >= minMatchPct
//   V2 structural parity— silhouette intersection-over-union, >= minSilhouetteIoU
//   J1 slot-map agree   — portrait-derived routing vs the engine's, 0 disagreements
//   J2 colour parity    — 0 differing static fill/stroke colours, item for item
//   T1 constants        — fps / size / frame count == the reference's constants
//   T2 duration         — |engine clip ms - reference constant ms| <= tolerance
// T3 (step window) is measured and reported without a verdict, as declared.
import { CLASS_TO_SLOT } from '../../app/engine/rigRecolor.js';
import { staticColours } from './reference-recolor.mjs';

const OPAQUE = 128;

/** Pixel + silhouette metrics over two same-size frames. */
export function frameMetrics(a, b, channelTolerance) {
  const n = Math.min(a.data.length, b.data.length);
  let content = 0, matched = 0, inter = 0, union = 0, err = 0, differing = 0, maxDelta = 0;
  for (let i = 0; i < n; i += 4) {
    const aOn = a.data[i + 3] > OPAQUE, bOn = b.data[i + 3] > OPAQUE;
    if (aOn || bOn) union++;
    if (aOn && bOn) inter++;
    if (!aOn && !bOn) continue;
    content++;
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const dm = Math.max(dr, dg, db);
    if (dm > maxDelta) maxDelta = dm;
    err += (dr + dg + db) / 3;
    if (aOn === bOn && dm <= channelTolerance) matched++;
    else differing++;
  }
  return {
    contentPixels: content,
    matchPct: content ? +((matched / content) * 100).toFixed(4) : 100,
    differingPixels: differing,
    silhouetteIoU: union ? +(inter / union).toFixed(4) : 1,
    meanAbsoluteError: content ? +(err / content).toFixed(3) : 0,
    maxChannelDelta: maxDelta,
  };
}

/** Compare the two sides' recoloured documents colour-for-colour (J2) and
 * their class routing (J1). */
export function documentParity(referenceDoc, engineDoc, slotMap, classesSeen) {
  const ref = staticColours(referenceDoc);
  const eng = staticColours(engineDoc);
  const samples = [];
  let differing = 0;
  for (let i = 0; i < Math.min(ref.length, eng.length); i++) {
    if (ref[i].hex !== eng[i].hex || ref[i].cl !== eng[i].cl) {
      differing++;
      if (samples.length < 20) samples.push({ index: i, class: ref[i].cl, reference: ref[i].hex, engine: eng[i].hex });
    }
  }
  const lengthMismatch = ref.length !== eng.length;
  // a document-length mismatch is itself a parity failure: count the gap
  if (lengthMismatch) differing += Math.abs(ref.length - eng.length);
  const disagreements = [];
  for (const cl of Object.keys(classesSeen || {})) {
    const refSlot = slotMap.resolve(cl) || null;
    const engSlot = CLASS_TO_SLOT[cl] || null;
    if (refSlot !== engSlot) disagreements.push({ class: cl, reference: refSlot, engine: engSlot, rule: slotMap.rule(cl) });
  }
  return {
    colourItems: ref.length,
    engineColourItems: eng.length,
    colourDifferences: differing,
    colourDifferenceSamples: samples,
    lengthMismatch,
    slotMapDisagreements: disagreements,
  };
}

/**
 * The full per-state verdict for one wizard.
 * `prereg` is the parsed PREREGISTRATION.md; every threshold comes from it.
 */
export function compareState({ prereg, state, reference, engine, slotMap, stepWindow = null }) {
  const tol = prereg.visual;
  const timing = prereg.timing;
  const perFrame = [];
  let skippedHeadless = 0;
  for (let i = 0; i < Math.min(reference.frames.length, engine.frames.length); i++) {
    const r = reference.frames[i], e = engine.frames[i];
    if (r.img.empty || e.img.empty) { skippedHeadless++; continue; }
    perFrame.push({ frame: r.n, ...frameMetrics(r.img, e.img, tol.pixelChannelTolerance) });
  }
  const mean = (key) => (perFrame.length ? +(perFrame.reduce((s, f) => s + f[key], 0) / perFrame.length).toFixed(4) : null);
  const worst = (key) => (perFrame.length ? perFrame.reduce((w, f) => Math.min(w, f[key]), Infinity) : null);
  // Reported (declared `reportedOnly`): a frame with no content on EITHER
  // side would match vacuously — the count and the floor are on the record
  // so no verdict rests on an empty comparison unnoticed.
  const blankOnBothSides = perFrame.filter((f) => f.contentPixels === 0).length;
  const minContentPixels = perFrame.length ? Math.min(...perFrame.map((f) => f.contentPixels)) : null;

  const doc = documentParity(reference.animation, engine.animation, slotMap, reference.recolourStats.classesSeen);

  const refFrames = timing.referenceFrames[state];
  const engClip = engine.clip;
  const refClip = reference.clip;
  const engDurationMs = (engClip.frames / timing.fps) * 1000;
  const refDurationMs = refFrames === undefined ? null : (refFrames / timing.fps) * 1000;
  const durationDeltaMs = refDurationMs === null ? null : +Math.abs(engDurationMs - refDurationMs).toFixed(2);

  const comparable = perFrame.length;
  const inconclusive = comparable < prereg.minComparableFramesPerState;

  const criteria = {
    V1: {
      name: 'pixel parity',
      tolerance: `mean matched >= ${tol.minMatchPct}% of union-content pixels within ${tol.pixelChannelTolerance}/255`,
      measured: comparable ? `${mean('matchPct')}% (worst frame ${worst('matchPct')}%, max channel delta ${Math.max(...perFrame.map((f) => f.maxChannelDelta))})` : 'no comparable frames',
      value: mean('matchPct'),
      pass: !inconclusive && mean('matchPct') !== null && mean('matchPct') >= tol.minMatchPct,
    },
    V2: {
      name: 'structural parity',
      tolerance: `mean silhouette IoU >= ${tol.minSilhouetteIoU}`,
      measured: comparable ? `${mean('silhouetteIoU')} (worst frame ${worst('silhouetteIoU')})` : 'no comparable frames',
      value: mean('silhouetteIoU'),
      pass: !inconclusive && mean('silhouetteIoU') !== null && mean('silhouetteIoU') >= tol.minSilhouetteIoU,
    },
    J1: {
      name: 'slot-map agreement',
      tolerance: `portrait-derived routing == engine routing for every class present (max ${prereg.recolour.maxSlotMapDisagreements})`,
      measured: `${doc.slotMapDisagreements.length} disagreements over ${Object.keys(reference.recolourStats.classesSeen).length} classes`,
      value: doc.slotMapDisagreements.length,
      pass: doc.slotMapDisagreements.length <= prereg.recolour.maxSlotMapDisagreements,
    },
    J2: {
      name: 'recoloured-document colour parity',
      tolerance: `identical static fill/stroke colours item-for-item (max ${prereg.recolour.maxColourDifferences} differences)`,
      measured: `${doc.colourDifferences} differing of ${doc.colourItems} colour items${doc.lengthMismatch ? ' (DOCUMENT LENGTH MISMATCH)' : ''}`,
      value: doc.colourDifferences,
      pass: !doc.lengthMismatch && doc.colourDifferences <= prereg.recolour.maxColourDifferences,
    },
    T1: {
      name: 'reference constants',
      tolerance: `fps ${timing.fps}, ${timing.width}x${timing.height}, ${refFrames} frames (deviation tolerance ${timing.frameCountTolerance})`,
      measured: `engine ${engClip.fps}fps ${engClip.width}x${engClip.height} ${engClip.frames}f v${engClip.version}; reference-side source ${refClip.frames}f`,
      value: engClip.frames,
      pass: engClip.fps === timing.fps && engClip.width === timing.width && engClip.height === timing.height
        && refFrames !== undefined && Math.abs(engClip.frames - refFrames) <= timing.frameCountTolerance
        && refClip.frames === engClip.frames,
    },
    T2: {
      name: 'clip duration vs the reference constant',
      tolerance: `|engine - reference| <= ${timing.durationToleranceMs}ms`,
      measured: refDurationMs === null ? 'no reference constant for this state' : `engine ${engDurationMs.toFixed(1)}ms vs reference ${refDurationMs.toFixed(1)}ms (delta ${durationDeltaMs}ms)`,
      value: durationDeltaMs,
      pass: durationDeltaMs !== null && durationDeltaMs <= timing.durationToleranceMs,
    },
  };

  const required = prereg.overall.statePassRequires;
  const pass = !inconclusive && required.every((k) => criteria[k] && criteria[k].pass);
  return {
    state,
    verdict: inconclusive ? 'INCONCLUSIVE' : (pass ? 'PASS' : 'FAIL'),
    pass,
    framesCompared: comparable,
    framesSkippedHeadless: skippedHeadless,
    blankOnBothSides,
    minContentPixels,
    perFrame,
    means: { matchPct: mean('matchPct'), silhouetteIoU: mean('silhouetteIoU'), meanAbsoluteError: mean('meanAbsoluteError') },
    criteria,
    document: doc,
    timing: {
      engine: engClip,
      referenceSource: refClip,
      referenceConstantFrames: refFrames ?? null,
      engineDurationMs: +engDurationMs.toFixed(2),
      referenceDurationMs: refDurationMs === null ? null : +refDurationMs.toFixed(2),
      durationDeltaMs,
      stepWindow, // T3, reported only
    },
    recolour: {
      referenceRecoloured: reference.recolourStats.recoloured,
      referenceUnmappedClasses: reference.recolourStats.unmappedClasses,
      classesSeen: reference.recolourStats.classesSeen,
    },
  };
}
