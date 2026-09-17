// tools/parity/check-e-idparity.mjs — CB-BUILD-015, the SAMPLE DRIVER: the
// id-keyed parity harness run over the canonical wizard AND the
// pre-registered seeded random sample of generated wizards, writing
// results/check-e-idparity.json and the human-readable PARITY-REPORT.md.
//
// Everything that decides an outcome is declared in advance in
// PREREGISTRATION.md (committed before this ever ran): the tolerances, the
// per-state pass criteria, the per-state reference constants, the sample
// size, the sampling seed. This script reads them from there.
//
// It also runs a NEGATIVE CONTROL: the same comparison with the WRONG
// wizard's palette on the reference side must FAIL the visual and
// document criteria. A parity harness that cannot fail proves nothing, so
// the proof that it can is part of the run's record.
import fs from 'node:fs';
import path from 'node:path';
import { __dirname, writeJson } from './lib.mjs';
import { loadPreregistration, sampledWizards, frameIndicesFor } from './preregistration.mjs';
import { buildReferenceSlotMap, parsePortraitSlots } from './reference-recolor.mjs';
import { referenceFrames, parseReferencePlayerConfig } from './reference-runner.mjs';
import { engineLoadoutFor, engineStateFrames, parseStagePlayerConfig } from './engine-frames.mjs';
import { compareState } from './compare.mjs';
import { runWizardParity, makeClipFetcher, stepWindows } from './parity-wizard.mjs';
import { canonicalWizard, identityFor } from './identity.mjs';
import { runProvenance } from './provenance.mjs';
import { freshnessBanner, RERUN_COMMAND } from './freshness.mjs';
import { wizardIdentity } from '../../app/engine/wizardRig.js';

const prereg = loadPreregistration();
const portrait = parsePortraitSlots();
const slotMap = buildReferenceSlotMap(portrait);
const referenceConfig = parseReferencePlayerConfig();
const stageConfig = parseStagePlayerConfig();
const windows = stepWindows(prereg);
const provenance = runProvenance();
const counters = { reads: 0, downloadedLive: 0 };
const fetcher = makeClipFetcher({ counters });

console.log('Check E — CB-BUILD-015 parity harness, keyed by wizard id (reference pipeline vs new engine, per duel state)');
console.log(`  pre-registration: ${prereg.sourceFile} (tolerances, pass criteria, sample size and seed declared before this run)`);
console.log(`  visual: >= ${prereg.visual.minMatchPct}% of union-content pixels within ${prereg.visual.pixelChannelTolerance}/255, silhouette IoU >= ${prereg.visual.minSilhouetteIoU}`);
console.log(`  timing: fps ${prereg.timing.fps}, ${prereg.timing.width}x${prereg.timing.height}, per-state reference clip lengths, duration within ${prereg.timing.durationToleranceMs}ms`);
console.log(`  reference player config (parsed from ${referenceConfig.source}): ${JSON.stringify({ renderer: referenceConfig.renderer, autoplay: referenceConfig.autoplay, loop: referenceConfig.loop, progressiveLoad: referenceConfig.progressiveLoad, subframe: referenceConfig.subframe })}`);
console.log(`  stage player config (parsed from ${stageConfig.source}):     ${JSON.stringify({ renderer: stageConfig.renderer, autoplay: stageConfig.autoplay, subframe: stageConfig.subframe, loopClips: stageConfig.loopClips })}`);
console.log(`  portrait colour slots (parsed from ${portrait.files.length} portrait SVGs): ${portrait.slots.join(', ')}`);

// ---- the sample: the canonical wizard + the seeded generated wizards --------
const sample = sampledWizards(prereg);
const canonical = canonicalWizard(prereg);
const canonicalIdentity = identityFor(canonical);
console.log(`\n  sample: canonical (${canonical.id}) + ${sample.wizards.length} generated, seed "${sample.seed}" -> 0x${sample.seed32hex}`);
console.log(`    canonical identity: ${canonicalIdentity.source} — combo ${canonicalIdentity.comboKey} (${prereg.sourceFile} §3, injected into BOTH sides); the engine read path derives ${canonicalIdentity.engineDerived.comboKey} for this id`);
for (const w of sample.wizards) console.log(`    ${w.id} (${w.element} t${w.tier})`);
console.log(`\n  tree under measurement: commit ${provenance.commit || '(not a git work tree)'}${provenance.dirty ? ' — WORKING TREE DIRTY' : ''}${provenance.branch ? ` on ${provenance.branch}` : ''}`);
if (provenance.dirty) console.log(`    ! uncommitted: ${provenance.dirtyFiles.join(', ')} — this run describes a tree that is not any commit`);

const opts = { prereg, fetcher, slotMap, referenceConfig, stageConfig, windows };
const wizards = [];
for (const character of [canonical, ...sample.wizards]) {
  wizards.push(await runWizardParity(character, { ...opts, dumpFrames: character.kind === 'canonical' }));
}

// ---- negative control: the harness must be able to FAIL ---------------------
console.log('\n  negative control — the SAME comparison with the wrong wizard\'s palette on the reference side:');
const ncState = 'idle';
const ncA = { id: 'parity015-negative-control-a', element: 'fire', tier: 0 };
const ncB = { id: 'parity015-negative-control-b', element: 'fire', tier: 0 };
const ncIdentityA = wizardIdentity(ncA);
const ncIdentityB = wizardIdentity(ncB);
const ncEngine = await engineLoadoutFor(ncA, { fetchImpl: fetcher.fetchImpl, cache: new Map() });
const ncClip = ncEngine.loadout.get('p1', ncState);
const ncFrames = frameIndicesFor(prereg, ncClip.op - ncClip.ip);
const ncEngineSide = engineStateFrames({ loadout: ncEngine.loadout, state: ncState, frameIndices: ncFrames, width: prereg.renderWidth, height: prereg.renderHeight, config: stageConfig });
const ncReferenceSide = await referenceFrames({
  // wizard A's combo, wizard B's palette: a wizard that is NOT the one the
  // engine rendered — the diff must see it.
  wizard: { id: ncA.id, comboKey: ncIdentityA.comboKey, palette: ncIdentityB.palette },
  state: ncState, frameIndices: ncFrames, fetchClip: fetcher.fetchClip,
  width: prereg.renderWidth, height: prereg.renderHeight, slotMap, config: referenceConfig,
});
const ncResult = compareState({ prereg, state: ncState, reference: ncReferenceSide, engine: ncEngineSide, slotMap });
const negativeControl = {
  description: `same combo (${ncIdentityA.comboKey}), reference side recoloured with a DIFFERENT wizard's palette`,
  state: ncState,
  matchPct: ncResult.means.matchPct,
  silhouetteIoU: ncResult.means.silhouetteIoU,
  meanAbsoluteError: ncResult.means.meanAbsoluteError,
  colourDifferences: ncResult.document.colourDifferences,
  verdict: ncResult.verdict,
  detects: !ncResult.pass,
};
console.log(`    match ${negativeControl.matchPct}% (floor ${prereg.visual.minMatchPct}%), colour differences ${negativeControl.colourDifferences}, verdict ${negativeControl.verdict} -> the harness ${negativeControl.detects ? 'DETECTS the wrong wizard' : 'FAILED TO DETECT the wrong wizard'}`);

// ---- summary ----------------------------------------------------------------
const allStates = wizards.flatMap((w) => w.states.map((s) => ({ wizard: w.wizardId, ...s })));
const summary = {
  wizards: wizards.length,
  statesPerWizard: prereg.duelStates.length,
  perStateComparisons: allStates.length,
  statesPassed: allStates.filter((s) => s.pass).length,
  statesFailed: allStates.filter((s) => s.verdict === 'FAIL').length,
  statesInconclusive: allStates.filter((s) => s.verdict === 'INCONCLUSIVE').length,
  framesCompared: allStates.reduce((a, s) => a + s.framesCompared, 0),
  framesSkippedHeadless: allStates.reduce((a, s) => a + s.framesSkippedHeadless, 0),
  minMatchPct: Math.min(...allStates.map((s) => s.means.matchPct ?? 0)),
  minSilhouetteIoU: Math.min(...allStates.map((s) => s.means.silhouetteIoU ?? 0)),
  maxMeanAbsoluteError: Math.max(...allStates.map((s) => s.means.meanAbsoluteError ?? 0)),
  maxColourDifferences: Math.max(...allStates.map((s) => s.document.colourDifferences)),
  maxSlotMapDisagreements: Math.max(...allStates.map((s) => s.document.slotMapDisagreements.length)),
  maxTimingDeltaMs: Math.max(...allStates.map((s) => s.timing.durationDeltaMs ?? 0)),
  minContentPixels: Math.min(...allStates.map((s) => s.minContentPixels ?? 0)),
  engineFallbackStates: wizards.reduce((a, w) => a + w.engineFallbackStates.length, 0),
  clipDocumentsDownloadedLive: counters.downloadedLive || 0,
  clipReadsTotal: counters.reads || 0,
};
const overall = summary.statesPassed === summary.perStateComparisons && negativeControl.detects;

console.log('\n  summary:', JSON.stringify(summary, null, 2).replace(/\n/g, '\n  '));

const verdicts = [
  { criterion: 'E-visual-parity', tolerance: `every wizard/state: mean matched >= ${prereg.visual.minMatchPct}% within ${prereg.visual.pixelChannelTolerance}/255 AND silhouette IoU >= ${prereg.visual.minSilhouetteIoU}`, measured: `worst matched ${summary.minMatchPct}%, worst IoU ${summary.minSilhouetteIoU}, worst MAE ${summary.maxMeanAbsoluteError}/255 over ${summary.perStateComparisons} per-state comparisons`, pass: summary.minMatchPct >= prereg.visual.minMatchPct && summary.minSilhouetteIoU >= prereg.visual.minSilhouetteIoU },
  { criterion: 'E-recolour-parity', tolerance: `every wizard/state: 0 slot-map disagreements AND 0 differing static colours`, measured: `worst ${summary.maxSlotMapDisagreements} disagreements, worst ${summary.maxColourDifferences} colour differences`, pass: summary.maxSlotMapDisagreements === 0 && summary.maxColourDifferences === 0 },
  { criterion: 'E-timing-constants', tolerance: `every wizard/state: fps ${prereg.timing.fps}, ${prereg.timing.width}x${prereg.timing.height}, the reference clip length (tolerance ${prereg.timing.frameCountTolerance} frames), duration within ${prereg.timing.durationToleranceMs}ms`, measured: `worst duration delta ${summary.maxTimingDeltaMs}ms; T1 failures ${allStates.filter((s) => !s.criteria.T1.pass).length}`, pass: allStates.every((s) => s.criteria.T1.pass && s.criteria.T2.pass) },
  { criterion: 'E-harness-sensitivity (negative control)', tolerance: 'the same comparison with the WRONG wizard\'s palette must FAIL', measured: `match ${negativeControl.matchPct}% -> ${negativeControl.verdict}`, pass: negativeControl.detects },
];
const pf = (ok) => (ok ? 'PASS' : 'FAIL');
console.log('');
for (const v of verdicts) console.log(`VERDICT ${v.criterion}: tolerance [${v.tolerance}] measured [${v.measured}] -> ${pf(v.pass)}`);
console.log(`Check E overall: ${pf(overall)}`);

const record = {
  check: 'E — CB-BUILD-015 id-keyed parity (2019 reference pipeline vs the new engine, per duel state)',
  ranAt: new Date().toISOString(),
  node: process.version,
  provenance,
  preregistration: { file: prereg.sourceFile, tolerances: { visual: prereg.visual, recolour: prereg.recolour, timing: prereg.timing }, overall: prereg.overall, framePositions: prereg.framePositions, render: { width: prereg.renderWidth, height: prereg.renderHeight } },
  sample: {
    seed: sample.seed,
    seed32: sample.seed32,
    seed32hex: sample.seed32hex,
    size: prereg.sampleSize,
    generatedIds: sample.wizards,
    canonical: {
      id: canonical.id,
      comboKey: canonicalIdentity.comboKey,
      palette: canonicalIdentity.palette,
      identitySource: canonicalIdentity.source,
      identityInjection: prereg.canonicalWizard.identityInjection,
      declaredComboKey: prereg.canonicalWizard.comboKey,
      engineDerived: canonicalIdentity.engineDerived,
      provenance: canonical.provenance,
    },
  },
  referencePipeline: {
    playerConfig: referenceConfig,
    portraitSlots: { files: portrait.files, slots: portrait.slots, declaredAliases: { 'collar-button': 'medallion-base' } },
    library: 'https://storage.googleapis.com/cheeze-wizards-production/.../wizard-animations (per-combo JSON)',
  },
  enginePipeline: {
    playerConfig: stageConfig,
    loadout: 'app/ui/components/battle/rigAssets.js createRigLoadout (shipped fetch + live recolour) for a derived identity; tools/parity/identity.mjs createDeclaredIdentityLoadout — the same shipped steps over an injected identity — for the pre-registered canonical wizard',
  },
  stepWindows: windows,
  verdicts,
  overall: pf(overall),
  summary,
  negativeControl,
  wizards,
};
const file = writeJson('results/check-e-idparity.json', record);
console.log('written:', file);

// ---- the human-readable report ----------------------------------------------
function reportMarkdown() {
  const L = [];
  L.push('# CB-BUILD-015 — parity report (keyed by wizard id)');
  L.push('');
  L.push(freshnessBanner(provenance));
  L.push('');
  L.push('**Generated by `tools/parity/check-e-idparity.mjs`. Every number below is');
  L.push('MEASURED by the run recorded in `results/check-e-idparity.json` — none is');
  L.push('estimated.** The tolerances and pass criteria were pre-registered in');
  L.push('[`PREREGISTRATION.md`](PREREGISTRATION.md) in a commit that precedes this');
  L.push('run\'s commit; the comparer reads them from that file.');
  L.push('');
  L.push(`- run: \`${record.ranAt}\`, Node \`${record.node}\``);
  L.push(`- tree measured: commit \`${provenance.commit || 'unknown (not a git work tree)'}\`${provenance.branch ? ` (\`${provenance.branch}\`)` : ''}, working tree ${provenance.dirty ? `**DIRTY** — ${provenance.dirtyFiles.join(', ')}` : 'clean'}. Every number below is a claim about THAT tree and no other; \`results/check-e-idparity.json\` carries a content digest of the harness sources and of the engine modules the run measures, and both lists are asserted by the offline suite (see the gate above).`);
  L.push(`- sample: the canonical wizard + ${prereg.sampleSize} generated wizards, seed \`${sample.seed}\` (FNV-1a → \`0x${sample.seed32hex}\`, mulberry32 stream)`);
  L.push(`- ${summary.perStateComparisons} per-state comparisons, ${summary.framesCompared} frame pairs compared (${summary.framesSkippedHeadless} skipped headless), ${summary.clipDocumentsDownloadedLive} distinct animation documents downloaded live from the public bucket during this run (${summary.clipReadsTotal} reads in total — both sides read the same bytes)`);
  L.push(`- overall: **${pf(overall)}**`);
  L.push('');
  L.push('## What each side is');
  L.push('');
  L.push('| Side | Source | Recolour | Player |');
  L.push('|---|---|---|---|');
  L.push(`| **Reference (2019)** | per-combo animation JSON from the public production bucket | portrait colour-slot system, parsed live from ${portrait.files.length} portrait SVGs (\`assets/cw/client-static/img/wizards/\`) — independent of \`app/engine/rigRecolor.js\` | shipped \`app/vendor/lottie.min.js\` at the reference's own configuration, parsed from \`${referenceConfig.source}\`: \`${JSON.stringify({ renderer: referenceConfig.renderer, autoplay: referenceConfig.autoplay, loop: referenceConfig.loop, progressiveLoad: referenceConfig.progressiveLoad, subframe: referenceConfig.subframe })}\` |`);
  L.push(`| **New engine** | the row's identity (see below) through the shipped \`rigAssets.js\` loadout — fetch + live recolour | \`app/engine/rigRecolor.js\`, live, per wizard | the stage's configuration, parsed from \`${stageConfig.source}\`: \`${JSON.stringify({ renderer: stageConfig.renderer, autoplay: stageConfig.autoplay, subframe: stageConfig.subframe, loopClips: stageConfig.loopClips })}\` |`);
  L.push('');
  L.push('## Which wizard each row compares');
  L.push('');
  L.push('One identity — combo key + palette — is resolved per row and handed to');
  L.push('BOTH sides, so a difference downstream is the pipelines\' and never the');
  L.push('wizard\'s. Where that identity comes from differs by row, and is recorded:');
  L.push('');
  L.push('| Row | Identity | Source | Engine read path would derive |');
  L.push('|---|---|---|---|');
  for (const w of wizards) {
    L.push(`| ${w.wizardId} | \`${w.comboKey}\` | ${w.identitySource === 'declared' ? `**declared** — \`${prereg.sourceFile}\` §3, injected into both sides` : 'derived — `wizardRig.js` `wizardIdentity()` for this id'} | \`${w.engineDerived ? w.engineDerived.comboKey : '—'}\`${w.identityMatchesEngineDerivation ? ' (same)' : ' (**differs** — see the residuals)'} |`);
  }
  L.push('');
  L.push(`The canonical wizard is the only row with a real 2019 ground truth (the nine bundle GIFs: its combo identified by round-1 \`find-canonical.mjs\`, its palette FITTED from those renders by round-1 check A), so its identity is PRE-REGISTERED and injected verbatim — not read off a wizard record. Since CB-BUILD-022/R74/§18 the engine's read path derives identity from the characterId alone and ignores \`character.traits\`/\`character.palette\`, so a recorded combo would be silently dropped and this row would compare \`${canonicalIdentity.engineDerived.comboKey}\` — a different wizard from the one the renders show. See \`PREREGISTRATION.md\` §3 and its amendment 1.`);
  L.push('');
  L.push('## Verdicts');
  L.push('');
  L.push('| Criterion | Declared tolerance | Measured | Verdict |');
  L.push('|---|---|---|---|');
  for (const v of verdicts) L.push(`| ${v.criterion} | ${v.tolerance} | ${v.measured} | **${pf(v.pass)}** |`);
  L.push('');
  L.push('## Per wizard, per duel state');
  L.push('');
  L.push('`match%` = union-content pixels within the declared 8/255 channel tolerance;');
  L.push('`IoU` = silhouette intersection-over-union; `MAE` = mean absolute error per');
  L.push('content pixel; `colourΔ` = differing static fill/stroke colours between the');
  L.push('two recoloured documents; `frames` = engine clip length vs the reference');
  L.push('constant; `Δms` = clip duration difference.');
  L.push('');
  for (const w of wizards) {
    L.push(`### ${w.wizardId} — ${w.kind}${w.kind === 'canonical' ? ' (the 2019 demo wizard: combo identified in round 1, palette fitted from the bundle renders, identity DECLARED and injected into both sides)' : ` (${w.element}, tier ${w.tier})`}`);
    L.push('');
    L.push(`combo \`${w.comboKey}\` · palette \`${Object.entries(w.palette).map(([k, v]) => `${k}:${v}`).join(' ')}\``);
    L.push('');
    L.push('| Duel state | match% | IoU | MAE | colourΔ | slot-map Δ | frames (engine/reference) | Δms | frames compared | Verdict |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const s of w.states) {
      L.push(`| ${s.state} | ${s.means.matchPct} | ${s.means.silhouetteIoU} | ${s.means.meanAbsoluteError} | ${s.document.colourDifferences} | ${s.document.slotMapDisagreements.length} | ${s.timing.engine.frames}/${s.timing.referenceConstantFrames} | ${s.timing.durationDeltaMs} | ${s.framesCompared}${s.framesSkippedHeadless ? ` (+${s.framesSkippedHeadless} skipped)` : ''} | **${s.verdict}** |`);
    }
    L.push('');
  }
  L.push('## Negative control — the harness can fail');
  L.push('');
  L.push(`Same combo (\`${ncIdentityA.comboKey}\`), same everything, except the reference`);
  L.push('side is recoloured with a DIFFERENT wizard\'s palette. If the comparison could');
  L.push('not see that, every PASS above would be worthless:');
  L.push('');
  L.push('| Measure | Pre-registered floor | Wrong-wizard measurement | Detected |');
  L.push('|---|---|---|---|');
  L.push(`| pixel match | ≥ ${prereg.visual.minMatchPct}% | **${negativeControl.matchPct}%** | ${negativeControl.detects ? 'yes' : 'NO'} |`);
  L.push(`| colour differences | ${prereg.recolour.maxColourDifferences} | **${negativeControl.colourDifferences}** | ${negativeControl.detects ? 'yes' : 'NO'} |`);
  L.push(`| verdict | PASS required | **${negativeControl.verdict}** | ${negativeControl.detects ? 'yes' : 'NO'} |`);
  L.push('');
  L.push('## T3 — step window vs the clip\'s native duration (reported, no verdict)');
  L.push('');
  L.push(`At the shipped default O9 cadence (${windows.cadenceMs}ms). The stage windows a step by cadence and loops or holds — the shipped design (R75), not a parity defect.`);
  L.push('');
  L.push('| Clip | Timeline states | Step window | Clip native | Δ | Policy |');
  L.push('|---|---|---|---|---|---|');
  for (const [clip, w] of Object.entries(windows.byClip)) {
    L.push(`| ${clip} | ${w.stepStates.join(', ')} | ${w.stepWindowMs}ms | ${w.clipNativeMs}ms | ${w.stepWindowDeltaMs}ms | ${w.loopPolicy} |`);
  }
  L.push('');
  L.push('## What was measured live, what came from the repo, what is residual');
  L.push('');
  L.push(`- **Live in this container:** ${summary.clipDocumentsDownloadedLive} distinct per-combo animation documents downloaded from the public production bucket during this run (${summary.clipReadsTotal} reads in total — the reference side and the engine side read the same downloaded bytes), every frame above rendered here by the shipped 2019 player (\`app/vendor/lottie.min.js\`), and every metric computed on those rendered pixels.`);
  L.push('- **What "headless" means here, exactly:** `lib.mjs` installs jsdom\'s `window`/`document`/`navigator` globals so the vendored 2019 player loads under Node at all — but NEITHER side mounts into a DOM container. Each player instance is handed a **node-canvas 2D context** through `rendererSettings.context` + `clearCanvas` in place of the container (`reference-runner.mjs`, `engine-frames.mjs`), and frames are read back with `getImageData`. No DOM layout, CSS, or browser compositing takes part in any number above; the substitution is the same one on both sides.');
  L.push('- **From in-repo reference assets:** the player configuration (parsed from `assets/cw/reference/Animation-index.js`), the portrait colour-slot system (parsed from `assets/cw/client-static/img/wizards/*.svg`), the canonical wizard\'s combo and fitted palette (round 1\'s `results/canonical-combo.json` and `results/check-a-gifs.json`), and the per-state reference clip lengths (pre-registered, and bound to `check-c-timing.mjs` by `app/tests/parity-preregistration.test.js`).');
  L.push(`- **Residual — the id→identity derivation is OUTSIDE this comparison.** The reference side is handed the engine-resolved \`comboKey\` AND \`palette\` (that is what makes a difference downstream attributable to the pipelines), so what this check measures is everything *after* the identity: library addressing, recolour routing, document colours, player configuration, rendered pixels, clip timing. Which combo and which palette a characterId maps to is NOT measured here — \`app/tests/rig-identity.test.js\` and \`app/tests/identity-read-time.test.js\` cover that. For the ${wizards.filter((w) => w.identitySource === 'derived').length} generated rows the injected identity IS the shipped derivation; for the canonical row it is the pre-registered declaration, and the engine read path would derive \`${canonicalIdentity.engineDerived.comboKey}\` for that id instead (recorded above, never implied to match).`);
  L.push(`- **Residual, not claimed:** no CSS layout, paint or opacity animation runs headlessly, so the stage's cross-fade ramp and browser compositing are not pixel-measured (round 1's residual, unchanged). The 2019 React \`DuelPlayer\` component tree is not executed — it cannot run without its build and its chain data; what is executed is its player factory's configuration over its own per-combo sources. Frames are compared at ${prereg.renderWidth}×${prereg.renderHeight}, not at the library's native ${prereg.timing.width}×${prereg.timing.height}, for run time — identically on both sides.`);
  L.push(`- **Freshness (gated, not merely disclosed):** these numbers describe commit \`${provenance.shortCommit || 'unknown'}\`${provenance.dirty ? ' plus uncommitted changes' : ''}. \`results/check-e-idparity.json\` records a sha256 of every harness source AND of every engine module this run measures (\`app/engine/wizardRig.js\`, \`rigRecolor.js\`, \`rigManifest.js\`, \`rigPalette.js\`, \`rigAssets.js\`, \`rigStage.js\`, the vendored player, the reference factory). **Both lists are asserted** by \`app/tests/parity-harness.test.js\` through \`tools/parity/freshness.mjs\`: move any of them without re-running check E and \`node --test app/tests/*.test.js\` fails from the repo root, naming the files. The engine list was previously recorded and NOT asserted, on the argument that a re-run needs bucket access and a native canvas build — and the run duly went stale a second time (fix round f3's \`deriveIdentity\` rewrite) with the suite still green. The re-run cost is real and is now paid deliberately: a container that cannot re-run check E cannot make the suite green, and must say so (\`${RERUN_COMMAND}\`; verify freshness alone, offline, with \`node tools/parity/freshness.mjs\`).`);
  L.push(`- **Engine-side bucket fallbacks during this run:** ${summary.engineFallbackStates} (a non-zero count would mean the loadout substituted a vendored shape set for an unreachable state; those states are named per wizard in the JSON).`);
  L.push('');
  L.push('Full per-frame numbers: [`results/check-e-idparity.json`](results/check-e-idparity.json).');
  L.push(`Sample frames dumped for the canonical wizard: \`results/frames/parity/${canonical.id}/\` (gitignored; re-create with \`npm run parity -- --canonical --dump-frames\`).`);
  L.push('');
  return L.join('\n');
}

const reportFile = path.join(__dirname, 'PARITY-REPORT.md');
fs.writeFileSync(reportFile, reportMarkdown());
console.log('written:', reportFile);

process.exitCode = overall ? 0 : 1;
