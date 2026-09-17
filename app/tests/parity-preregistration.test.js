// app/tests/parity-preregistration.test.js — CB-BUILD-015: the pre-registered
// contract of the id-keyed parity harness, bound OFFLINE.
//
// What this file guards (no network, no native canvas, no browser):
//  1. tools/parity/PREREGISTRATION.md exists, parses, and declares every
//     tolerance the harness runs on;
//  2. the comparer READS those tolerances from that file — change the file,
//     the verdict changes; the numbers are not literals in the code;
//  3. the pre-registered per-state reference constants are the same
//     constants check-c-timing.mjs and rig-timing.test.js already bind, so
//     the two can never drift apart;
//  4. the shipped run (results/check-e-idparity.json) was produced under the
//     tolerances that are committed NOW — a tolerance edited after the run,
//     without a re-run, fails here;
//  5. the sample the driver would draw from the pre-registered seed is
//     exactly the sample the shipped run recorded (seeded, reproducible);
//  6. the pure half of the harness stays importable without jsdom/canvas
//     (including identity.mjs and provenance.mjs, which the offline suite
//     binds directly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePreregistration, loadPreregistration, sampledWizards, frameIndicesFor, fnv1a32, mulberry32 } from '../../tools/parity/preregistration.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARITY = path.resolve(__dirname, '..', '..', 'tools', 'parity');
const read = (rel) => fs.readFileSync(path.join(PARITY, rel), 'utf8');

test('the pre-registration document exists and declares every tolerance the harness runs on', () => {
  const prereg = loadPreregistration();
  assert.equal(prereg.sourceFile, 'tools/parity/PREREGISTRATION.md');
  // visual
  assert.equal(typeof prereg.visual.pixelChannelTolerance, 'number');
  assert.ok(prereg.visual.minMatchPct > 0 && prereg.visual.minMatchPct <= 100);
  assert.ok(prereg.visual.minSilhouetteIoU > 0 && prereg.visual.minSilhouetteIoU <= 1);
  // recolour — both exact, no tolerance
  assert.equal(prereg.recolour.maxSlotMapDisagreements, 0);
  assert.equal(prereg.recolour.maxColourDifferences, 0);
  // timing
  assert.equal(prereg.timing.fps, 30);
  assert.equal(prereg.timing.width, 1720);
  assert.equal(prereg.timing.height, 1400);
  assert.equal(prereg.timing.frameCountTolerance, 0);
  assert.ok(prereg.timing.durationToleranceMs > 0);
  // sample
  assert.ok(prereg.sampleSize >= 1, 'a random sample of generated wizards is declared');
  assert.ok(typeof prereg.sampleSeed === 'string' && prereg.sampleSeed.length > 0, 'the sampling seed is declared');
  assert.ok(prereg.duelStates.length >= 9, 'the duel states under test are declared');
  assert.ok(prereg.overall.statePassRequires.includes('V1') && prereg.overall.statePassRequires.includes('T1'));
  assert.equal(prereg.overall.inconclusiveCountsAsPass, false);
});

test('the pre-registration refuses to load undeclared: a missing file, a malformed block, or a missing tolerance all throw', () => {
  assert.throws(() => loadPreregistration(path.join(PARITY, 'NO-SUCH-PREREGISTRATION.md')), /missing/);
  assert.throws(() => parsePreregistration('# no blocks here'), /no ```prereg JSON blocks/);
  assert.throws(() => parsePreregistration('```prereg\n{not json}\n```'), /not valid JSON/);
  const stripped = read('PREREGISTRATION.md').replace(/"minMatchPct":\s*[\d.]+,?/, '');
  const tmp = path.join(PARITY, 'results', '.tmp-prereg-missing-tolerance.md');
  fs.writeFileSync(tmp, stripped);
  try {
    assert.throws(() => loadPreregistration(tmp), /'visual' is missing or malformed/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("the pre-registered per-state reference constants ARE check-c-timing.mjs's constants (the two can never drift)", () => {
  const prereg = loadPreregistration();
  const checkC = read('check-c-timing.mjs');
  const m = /const REFERENCE_FRAMES = \{([^}]*)\}/.exec(checkC);
  assert.ok(m, 'check-c-timing.mjs still declares REFERENCE_FRAMES');
  const fromCheckC = Object.fromEntries(
    m[1].split(',').map((pair) => pair.split(':').map((s) => s.trim())).filter((p) => p.length === 2).map(([k, v]) => [k, Number(v)]),
  );
  assert.deepEqual(prereg.timing.referenceFrames, fromCheckC);
  // …and the same table the app-side timing test binds against the vendored sets
  const rigTiming = fs.readFileSync(path.join(__dirname, 'rig-timing.test.js'), 'utf8');
  for (const [state, frames] of Object.entries(fromCheckC)) {
    assert.ok(new RegExp(`${state}:\\s*${frames}\\b`).test(rigTiming), `rig-timing.test.js carries ${state}: ${frames}`);
  }
});

test('the shipped parity run was produced under the tolerances committed now (edit a tolerance without re-running and this fails)', () => {
  const prereg = loadPreregistration();
  const run = JSON.parse(read(path.join('results', 'check-e-idparity.json')));
  assert.deepEqual(run.preregistration.tolerances.visual, prereg.visual, 'the run\'s visual tolerances are the committed ones');
  assert.deepEqual(run.preregistration.tolerances.recolour, prereg.recolour, 'the run\'s recolour tolerances are the committed ones');
  assert.deepEqual(run.preregistration.tolerances.timing, prereg.timing, 'the run\'s timing tolerances and reference constants are the committed ones');
  assert.deepEqual(run.preregistration.framePositions, prereg.framePositions);
  assert.equal(run.preregistration.render.width, prereg.renderWidth);
  assert.equal(run.preregistration.render.height, prereg.renderHeight);
  assert.equal(run.sample.seed, prereg.sampleSeed);
  assert.equal(run.sample.size, prereg.sampleSize);
});

test('the sample is reproducible from the pre-registered seed alone — the same ids the shipped run recorded', () => {
  const prereg = loadPreregistration();
  const drawn = sampledWizards(prereg);
  const run = JSON.parse(read(path.join('results', 'check-e-idparity.json')));
  assert.equal(drawn.seed32, run.sample.seed32, 'the seed hashes the same');
  assert.deepEqual(
    drawn.wizards.map((w) => ({ id: w.id, element: w.element, tier: w.tier })),
    run.sample.generatedIds.map((w) => ({ id: w.id, element: w.element, tier: w.tier })),
    'the seeded draw reproduces the run\'s sample id for id',
  );
  // and the draw is a pure function of the seed, not of call order
  assert.deepEqual(sampledWizards(prereg).wizards, drawn.wizards);
  assert.notDeepEqual(sampledWizards({ ...prereg, sampleSeed: 'a different seed' }).wizards, drawn.wizards);
});

test('the harness PRNG and frame-position maths are deterministic and stay inside the clip', () => {
  assert.equal(fnv1a32('CB-BUILD-015'), fnv1a32('CB-BUILD-015'));
  assert.notEqual(fnv1a32('a'), fnv1a32('b'));
  const a = mulberry32(12345), b = mulberry32(12345);
  for (let i = 0; i < 5; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  const prereg = loadPreregistration();
  for (const clipFrames of [18, 34, 112]) {
    for (const n of frameIndicesFor(prereg, clipFrames)) {
      assert.ok(Number.isInteger(n) && n >= 0 && n < clipFrames, `frame ${n} inside a ${clipFrames}-frame clip`);
    }
  }
  assert.equal(frameIndicesFor(prereg, 34).length, prereg.framePositions.length);
});

test('the pure half of the harness imports with no jsdom, no canvas, no lib.mjs in its graph', () => {
  for (const file of ['preregistration.mjs', 'paths.mjs', 'player-config.mjs', 'reference-recolor.mjs', 'compare.mjs', 'identity.mjs', 'provenance.mjs']) {
    const src = read(file);
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(!/(^|\/)(canvas|jsdom|omggif)$/.test(spec), `${file} must not import ${spec} (the root suite runs offline, without the harness's native deps)`);
      assert.ok(!/lib\.mjs$/.test(spec), `${file} must not import lib.mjs (it pulls jsdom + node-canvas)`);
    }
  }
});

test('the report and the pre-registration are discoverable from the harness README (RESULTS.md links both)', () => {
  const results = read('RESULTS.md');
  assert.match(results, /PARITY-REPORT\.md/, 'RESULTS.md links the id-keyed parity report');
  assert.match(results, /PREREGISTRATION\.md/, 'RESULTS.md links the pre-registration');
  const report = read('PARITY-REPORT.md');
  assert.match(report, /PREREGISTRATION\.md/, 'the report points back at the declaration it was judged against');
  assert.match(report, /MEASURED/, 'the report states that its numbers are measured');
});

test('npm run all runs the id-keyed parity check alongside checks A-D (which keep their own entries)', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const script of ['check-a', 'check-b', 'check-c', 'check-d', 'check-e', 'parity']) {
    assert.ok(pkg.scripts[script], `package.json keeps a '${script}' script`);
  }
  assert.match(pkg.scripts.all, /check-a-gifs\.mjs/);
  assert.match(pkg.scripts.all, /check-d-ac1\.mjs/);
  assert.match(pkg.scripts.all, /check-e-idparity\.mjs/, 'the id-keyed runner is wired into `npm run all`');
  assert.match(pkg.scripts.parity, /parity-wizard\.mjs/, 'the id-keyed entry point is runnable on its own');
});
