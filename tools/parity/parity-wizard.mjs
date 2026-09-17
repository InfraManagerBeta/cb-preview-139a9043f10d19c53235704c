// tools/parity/parity-wizard.mjs — CB-BUILD-015: THE ID-KEYED ENTRY POINT.
//
//   node parity-wizard.mjs --id <wizardId> [--element fire|water|air] [--tier N]
//   node parity-wizard.mjs --canonical
//
// Given ANY wizard id it: resolves that wizard once, runs the 2019
// REFERENCE implementation for it (per-combo animation from the public
// bucket + the wizard's recolour from its portrait colour slots + the
// shipped 2019 player at the reference's own configuration), runs the NEW
// ENGINE for the SAME identity (shipped loadout -> the stage's player
// configuration), and diffs the two PER DUEL STATE — visual parity
// within the pre-registered tolerance, timing against the reference
// constants. Tolerances are read from PREREGISTRATION.md, never from
// literals here.
//
// The identity both sides run on comes from identity.mjs: the shipped read
// path's derivation for a generated wizard id, and — for the CANONICAL
// wizard, the one row with a real 2019 ground truth — the identity
// PRE-REGISTERED in PREREGISTRATION.md §3, injected verbatim into both sides.
//
// The sample driver (check-e-idparity.mjs) imports `runWizardParity` from
// this module; the CLI below is the single-wizard entry point.
import fs from 'node:fs';
import path from 'node:path';
import { __dirname, REPO, savePng } from './lib.mjs';
import { loadPreregistration, frameIndicesFor } from './preregistration.mjs';
import { buildReferenceSlotMap, parsePortraitSlots } from './reference-recolor.mjs';
import { referenceFrames, parseReferencePlayerConfig } from './reference-runner.mjs';
import { engineLoadoutFor, engineStateFrames, parseStagePlayerConfig, STEP_TO_CLIP, LOOP_CLIPS } from './engine-frames.mjs';
import { canonicalWizard } from './identity.mjs';
import { compareState } from './compare.mjs';
import { RIG_BUCKET_BASE } from '../../app/data/rigManifest.js';
import { buildDuelTimeline } from '../../app/engine/presentationTimeline.js';

export const CACHE = path.join(__dirname, 'results', 'cache');

// ---- the library, fetched once and cached on disk ---------------------------
export function makeClipFetcher({ counters = null } = {}) {
  fs.mkdirSync(CACHE, { recursive: true });
  const memory = new Map();
  // Honest accounting: `downloaded` counts DISTINCT documents this run pulled
  // from the bucket, `reads` every read either side asked for (both sides
  // read the same bytes, so reads > downloads by design).
  const downloaded = new Set();
  const note = (name, wasLive) => {
    if (!counters) return;
    counters.reads = (counters.reads || 0) + 1;
    if (wasLive) downloaded.add(name);
    counters.downloadedLive = downloaded.size;
  };
  async function download(name, url) {
    const file = path.join(CACHE, name);
    if (fs.existsSync(file)) return { file, live: false };
    const res = await fetch(url);
    if (!res.ok) return { file, live: false, status: res.status, failed: true };
    fs.writeFileSync(file, await res.text());
    return { file, live: true };
  }
  async function fetchClip(state, comboKey) {
    const name = `${state}-${comboKey}.json`;
    const url = `${RIG_BUCKET_BASE}/${name}`;
    if (memory.has(url)) { note(name, false); return memory.get(url); }
    const got = await download(name, url);
    if (got.failed) throw new Error(`${got.status} fetching ${url}`);
    note(name, got.live);
    const json = JSON.parse(fs.readFileSync(got.file, 'utf8'));
    memory.set(url, json);
    return json;
  }
  // the loadout's fetchImpl shape (url -> {ok, json()}), same disk cache, so
  // the engine side pulls the SAME bytes the reference side pulled
  async function fetchImpl(url) {
    const name = url.split('/').pop();
    const got = await download(name, url);
    if (got.failed) return { ok: false, status: got.status };
    note(name, got.live);
    const text = fs.readFileSync(got.file, 'utf8');
    return { ok: true, json: async () => JSON.parse(text) };
  }
  return { fetchClip, fetchImpl, downloaded };
}

/** The wizard record for the canonical 2019 demo wizard — the DECLARED combo
 * (round 1's find-canonical.mjs) and the DECLARED palette (fitted from the
 * bundle renders by round-1 check A), injected into both sides. Built by
 * `identity.mjs`, which is canvas-free so the test suite can bind the rule;
 * re-exported here because this module is the CLI (`--canonical`).
 *
 * NOT a wizard record: since CB-BUILD-022/R74/§18 the read path derives
 * identity from the characterId alone and ignores `character.traits` /
 * `character.palette`, so recorded fields would be silently dropped and the
 * run would compare a different wizard than PREREGISTRATION.md §3 declares.
 * (The justification that used to sit here — "the recorded combo is honoured
 * verbatim by wizardIdentity at tier 0" — was true when it was written and is
 * false at this head; see PREREGISTRATION.md, Amendments, amendment 1.) */
export { canonicalWizard };

/** T3 (reported only): the timeline step window the stage gives each state
 * at the shipped default O9 cadence, against the clip's native duration. */
export function stepWindows(prereg) {
  const tunables = JSON.parse(fs.readFileSync(path.join(REPO, 'app', 'data', 'tunables.json'), 'utf8'));
  const cadenceMs = tunables.timers.revealCadenceMs.default;
  const outcome = {
    rounds: [1, 2, 3, 4, 5].map((round) => ({ round, move1: 'fire', move2: 'water', result: round % 2 ? 'WIN' : 'LOSS', p1Affinity: true, p2Affinity: true, tag: 'CRITICAL' })),
    winner: 1, trueTie: false, floorDrain: true,
  };
  const timeline = buildDuelTimeline(outcome, cadenceMs, { bracketComplete: true });
  const byClip = {};
  for (const step of timeline) {
    for (const key of [step.state, step.p1State, step.p2State]) {
      const clip = key ? STEP_TO_CLIP[key] : null;
      if (!clip) continue;
      const nativeMs = Math.round((prereg.timing.referenceFrames[clip] / prereg.timing.fps) * 1000);
      byClip[clip] = byClip[clip] || {
        cadenceMs,
        stepStates: [],
        stepWindowMs: step.ms,
        clipNativeMs: nativeMs,
        stepWindowDeltaMs: step.ms - nativeMs,
        loopPolicy: LOOP_CLIPS.has(clip) ? 'loops while the step holds' : (step.ms >= nativeMs ? 'plays out, holds last frame' : 'window ends first (cut by the cross-fade)'),
      };
      if (!byClip[clip].stepStates.includes(key)) byClip[clip].stepStates.push(key);
    }
  }
  return { cadenceMs, byClip };
}

/**
 * Run the whole per-state parity for ONE wizard id.
 * Returns a result record (also what the sample driver collects).
 */
export async function runWizardParity(character, {
  prereg = loadPreregistration(),
  fetcher = makeClipFetcher(),
  slotMap = buildReferenceSlotMap(),
  referenceConfig = parseReferencePlayerConfig(),
  stageConfig = parseStagePlayerConfig(),
  windows = stepWindows(prereg),
  dumpFrames = false,
  log = console.log,
} = {}) {
  const t0 = Date.now();
  const width = prereg.renderWidth, height = prereg.renderHeight;
  const { identity, loadout, report } = await engineLoadoutFor(character, { fetchImpl: fetcher.fetchImpl, cache: new Map() });

  // ONE identity, both sides. The reference side is handed the very identity
  // the run resolved for this wizard — combo key AND portrait colour slots —
  // so any difference downstream is the pipelines', never the wizard's. That
  // identity is the shipped read path's derivation for a generated wizard,
  // and the PRE-REGISTERED declaration for the canonical one (identity.mjs).
  // Residual, stated in the report and in PREREGISTRATION.md §8: because both
  // sides are given it, the id→identity derivation is OUTSIDE this
  // comparison.
  const wizard = { id: character.id, comboKey: identity.comboKey, palette: identity.palette, traits: identity.traits, element: identity.element };

  log(`\n  wizard ${character.id} (${character.element || identity.element} t${character.tier ?? 0}) -> combo ${wizard.comboKey} [identity ${identity.source}]`);
  if (identity.source === 'declared' && !identity.matchesEngineDerivation) {
    log(`    ! declared identity injected into BOTH sides; the engine read path would derive ${identity.engineDerived.comboKey} for this id (recorded, outside the comparison)`);
  }
  if (report.fallbackStates.length) log(`    ! bucket-unreachable fallbacks on the engine side: ${report.fallbackStates.join(', ')}`);

  const states = [];
  for (const state of prereg.duelStates) {
    const engineSide = engineStateFrames({
      loadout, state, width, height, config: stageConfig,
      frameIndices: frameIndicesFor(prereg, (loadout.get('p1', state).op - loadout.get('p1', state).ip)),
    });
    const referenceSide = await referenceFrames({
      wizard, state, width, height, slotMap, config: referenceConfig,
      fetchClip: fetcher.fetchClip,
      frameIndices: engineSide.frames.map((f) => f.n), // the same frames on both sides
    });
    const result = compareState({ prereg, state, reference: referenceSide, engine: engineSide, slotMap, stepWindow: windows.byClip[state] || null });
    if (dumpFrames) {
      const dir = path.join(__dirname, 'results', 'frames', 'parity', character.id);
      const first = referenceSide.frames[0], firstEngine = engineSide.frames[0];
      if (!first.img.empty) savePng(first.img, path.join(dir, `${state}-reference-f${first.n}.png`));
      if (!firstEngine.img.empty) savePng(firstEngine.img, path.join(dir, `${state}-engine-f${firstEngine.n}.png`));
    }
    states.push(result);
    log(`    ${state.padEnd(11)} ${result.verdict.padEnd(12)} match ${String(result.means.matchPct).padEnd(8)}% IoU ${String(result.means.silhouetteIoU).padEnd(7)} MAE ${String(result.means.meanAbsoluteError).padEnd(6)} colourDiffs ${result.document.colourDifferences} slotDisagree ${result.document.slotMapDisagreements.length} timing ${result.timing.engine.frames}f/${result.timing.referenceConstantFrames}f delta ${result.timing.durationDeltaMs}ms`);
  }

  const pass = states.every((s) => s.pass);
  return {
    wizardId: character.id,
    kind: character.kind || 'sampled',
    element: character.element,
    tier: character.tier ?? 0,
    comboKey: wizard.comboKey,
    traits: wizard.traits,
    palette: wizard.palette,
    identitySource: identity.source, // 'declared' (pre-registered, injected) | 'derived' (the shipped read path)
    engineDerived: identity.engineDerived, // what wizardIdentity() gives for this id at this head — recorded either way
    identityMatchesEngineDerivation: identity.source === 'derived' ? true : !!identity.matchesEngineDerivation,
    provenance: character.provenance || null,
    engineFallbackStates: report.fallbackStates,
    engineUnslottedStates: report.unslottedStates,
    referencePlayerConfig: referenceConfig,
    stagePlayerConfig: stageConfig,
    states,
    verdict: pass ? 'PASS' : (states.some((s) => s.verdict === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'FAIL'),
    pass,
    elapsedMs: Date.now() - t0,
  };
}

// ---- CLI --------------------------------------------------------------------
function parseArgs(argv) {
  const args = { element: 'fire', tier: 0, canonical: false, id: null, dumpFrames: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--canonical') args.canonical = true;
    else if (a === '--dump-frames') args.dumpFrames = true;
    else if (a === '--id' || a === '--wizard') args.id = argv[++i];
    else if (a === '--element') args.element = argv[++i];
    else if (a === '--tier') args.tier = Number(argv[++i]);
    else if (!a.startsWith('--') && !args.id) args.id = a;
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const prereg = loadPreregistration();
  if (!args.canonical && !args.id) {
    console.error('usage: node parity-wizard.mjs --id <wizardId> [--element fire|water|air] [--tier N] | --canonical');
    process.exit(2);
  }
  const character = args.canonical ? canonicalWizard(prereg) : { id: args.id, element: args.element, tier: args.tier, kind: 'ad-hoc' };
  const portrait = parsePortraitSlots();
  console.log(`CB-BUILD-015 parity, keyed by wizard id — tolerances from ${prereg.sourceFile}`);
  console.log(`  portrait colour slots parsed from ${portrait.files.length} portraits: ${portrait.slots.join(', ')}`);
  const result = await runWizardParity(character, { prereg, dumpFrames: args.dumpFrames });
  console.log(`\n  ${result.wizardId}: ${result.verdict} (${result.states.filter((s) => s.pass).length}/${result.states.length} states pass, ${result.elapsedMs}ms)`);
  process.exitCode = result.pass ? 0 : 1;
}
