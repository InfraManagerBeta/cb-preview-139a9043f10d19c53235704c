// tools/parity/provenance.mjs — CB-BUILD-015 (fix round): WHICH TREE a
// recorded run was made on.
//
// The defect this exists for: check E's shipped result was produced at a
// commit that predated a change to the engine it measures, and nothing in the
// repository said so — the report read as if it described the delivered head.
// A measured result is only a claim about the tree it ran on, so the run now
// records that tree: the commit, whether the tree was dirty, and a content
// digest of every file that decides the numbers.
//
// Two lists per check, BOTH asserted (fix round g1), for EVERY recorded run
// (A–E, declared in CHECK_RUNS below):
//  * harness — the check's own script plus the harness modules it imports
//    (check E's list also carries the pre-registration it reads).
//  * engine — the shipped inputs the run measures: engine modules, and
//    (fix round g5) the shipped non-JS files a check parses into a recorded
//    number — the stylesheet D2 reads its geometry and its
//    no-background criterion out of, the tunables C/D/E take the O9 cadence
//    from, the bundle renders A and C measure against, the portrait
//    colour-slot SVGs the reference recolour is built from, the arena
//    source D2 rasterizes. The test is "does it decide a recorded number",
//    never the file extension; see the sweep note above CHECK_RUNS.
// Edit a file in either list without re-running that check and
// app/tests/parity-harness.test.js goes red, because the shipped numbers no
// longer describe the shipped code. The engine list used to be recorded and
// NOT asserted — "a reader compares the digests and re-runs deliberately" —
// and that is exactly how check E's run went stale a second time: fix round
// f3 rewrote deriveIdentity, this mechanism detected it, and nothing
// surfaced it, so a report describing 8 wizards the engine no longer
// produces stayed green. The verdict now lives in freshness.mjs and is
// asserted; the cost (a container without bucket access or a native canvas
// build cannot re-run, and so cannot be green) is the honest signal, and is
// stated there.
//
// Pure (fs + crypto + git): no jsdom, no node-canvas — the test suite binds it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { REPO } from './paths.mjs';

export const HARNESS_DIGEST_FILES = Object.freeze([
  'tools/parity/PREREGISTRATION.md',
  'tools/parity/preregistration.mjs',
  'tools/parity/identity.mjs',
  'tools/parity/provenance.mjs',
  'tools/parity/parity-wizard.mjs',
  'tools/parity/check-e-idparity.mjs',
  'tools/parity/compare.mjs',
  'tools/parity/engine-frames.mjs',
  'tools/parity/reference-runner.mjs',
  'tools/parity/reference-recolor.mjs',
  'tools/parity/player-config.mjs',
  'tools/parity/lib.mjs',
  'tools/parity/paths.mjs',
]);

// The 2019 bundle renders check A diffs against and check C reads the frame
// delays out of: their BYTES decide `matchPct` per state and the
// `C-render-rate` verdict, so they are inputs, not decoration (fix round g5).
// Asserted against the directory listing by app/tests/parity-harness.test.js,
// because a list of files cannot notice a file being ADDED to the folder
// check C globs.
export const BUNDLE_GIF_FILES = Object.freeze([
  'assets/cw/renders/gifs/CW_Attack.gif',
  'assets/cw/renders/gifs/CW_Battle Idle.gif',
  'assets/cw/renders/gifs/CW_Charge.gif',
  'assets/cw/renders/gifs/CW_Hit Success.gif',
  'assets/cw/renders/gifs/CW_Hit.gif',
  'assets/cw/renders/gifs/CW_Idle.gif',
  'assets/cw/renders/gifs/CW_Lose.gif',
  'assets/cw/renders/gifs/CW_Power.gif',
  'assets/cw/renders/gifs/CW_Win.gif',
]);

// The 2019 portrait colour-slot system. `reference-recolor.mjs` PARSES these
// into the reference side's class→slot map, so they decide every recolour the
// reference pipeline performs and therefore check E's per-state parity
// numbers (fix round g5). Same directory-listing assertion as the GIFs.
export const PORTRAIT_SVG_FILES = Object.freeze([
  'assets/cw/client-static/img/wizards/empty.svg',
  'assets/cw/client-static/img/wizards/fire.svg',
  'assets/cw/client-static/img/wizards/neutral.svg',
  'assets/cw/client-static/img/wizards/water.svg',
  'assets/cw/client-static/img/wizards/wind.svg',
]);

export const ENGINE_DIGEST_FILES = Object.freeze([
  'app/engine/wizardRig.js',
  'app/engine/rigRecolor.js',
  'app/engine/presentationTimeline.js',
  'app/data/rigManifest.js',
  'app/data/rigPalette.js',
  'app/data/tunables.json',
  'app/ui/components/battle/rigAssets.js',
  'app/ui/components/battle/rigStage.js',
  'app/ui/components/dom.js',
  'app/vendor/lottie.min.js',
  'assets/cw/reference/Animation-index.js',
  ...PORTRAIT_SVG_FILES,
]);

// ---------------------------------------------------------------------------
// EVERY recorded run, not just check E (fix round g1).
//
// Why this grew: re-running check E at the integrated head turned up the same
// defect one file over. Checks B and D also derive wizard identities from ids
// (`wizardIdentity()`), so f3's `deriveIdentity` rewrite moved THEIR sampled
// combos too — B's recorded "unexplained mean 1.95%" was measured on wizards
// the engine no longer produces (re-measured here: 2.03%), and D's per-pair
// distinctness rows likewise. Their verdicts still pass, but check D IS the
// AC1 four-criteria deliverable, so "a stale AC1 deliverable must fail
// something" applies to it exactly as it applies to E. A gate that covered
// only E would have left the identical failure mode in place next door.
//
// Each check declares the files that decide ITS numbers — code-level inputs
// only (its own script, the harness modules it imports, the shipped modules
// and shipped DATA it measures). A list that is too narrow makes the gate
// miss a change; too wide only costs an unnecessary re-run. Where in doubt
// these err wide.
//
// A FILE IS NOT EXEMPT BECAUSE IT IS NOT JAVASCRIPT (fix round g5). The
// lists first read "code-level inputs … static assets are NOT digested",
// which let two files decide recorded verdicts undigested, and the final
// gate reviewer demonstrated both by attack on `32d7952`:
//  * `app/styles/battle.css` — check D REGEX-PARSES it for D2's stage
//    geometry and for D2's `noLayerBackground` criterion. Making the
//    combatant layer paint its own white field (the exact R74 violation D2
//    exists to catch) and moving `homeLeftPct` from -1.4% to -9.9% left the
//    gate FRESH and the root suite green over a record still asserting
//    `noLayerBackground: true` / `homeLeftPct: -1.4`.
//  * `app/data/tunables.json` — checks C, D and E read the O9 reveal
//    cadence out of it. An O9 retune is explicitly sanctioned (R85/§14,
//    AC0), and the honest retune (tunables + both workbook mirrors) was
//    fully green while C/D/E silently stopped describing the shipped
//    cadence.
// A CSS rule parsed into a PASS/FAIL boolean is a code-level input; so is a
// JSON tunable parsed into a recorded millisecond number. The test is not
// the file extension, it is: DOES THIS FILE DECIDE A RECORDED NUMBER? The
// same sweep added the 2019 bundle GIFs (check A's per-state `matchPct`,
// check C's effective-fps verdict), the portrait colour-slot SVGs (the
// reference side's class→slot map, check E), the arena source SVG (D2's
// arena-ink verdict), the vendored FX capes check D4 falls back to when the
// bucket is unreachable, and two undeclared .js inputs the sweep turned up
// next door: `app/engine/presentationTimeline.js` (check E records
// `stepWindows` from it) and `app/ui/components/dom.js` (a transitive import
// of the stage source checks D and E measure — no measured number was shown
// to depend on it; it is here because these lists err wide).
//
// What is deliberately NOT digested, and why:
//  * the bucket's animation documents — they are not in this tree at all;
//    every run records the bucket address instead, and a run made when the
//    bucket is unreachable is a failed run, not a stale one.
//  * `tools/parity/results/*.json` read by a LATER check (check E takes the
//    canonical wizard's fitted palette from check A's record). Declaring a
//    record would make the documented re-run self-invalidating: `npm run
//    all` rewrites check A's record before check E runs, so check E's
//    `dirtySources` would be non-empty by construction and the gate would
//    fail the very re-run it demands. Check A's own inputs ARE gated, so a
//    change that MOVES that palette makes check A stale; the residual is an
//    edit to the record itself, which is a recorded result and not a source.
//  * `assets/rig/fallback/**` — the loadout reaches for them only when a
//    fetch fails, and the recorded runs report zero fallback states, so they
//    decide nothing that was recorded.
//  * `tools/parity/provenance.mjs` in checks A–D's harness lists (it is in
//    check E's), and `tools/parity/freshness.mjs` anywhere. They decide the
//    recorded provenance block and the report's banner, not the measured
//    numbers, and both are self-detecting: `digestFiles` hashes at record
//    time AND at verify time, so any change to how a digest is computed
//    makes every recorded digest mismatch and every check STALE without
//    being declared anywhere, and the banner is re-generated and compared by
//    app/tests/parity-harness.test.js on every run of the suite.
// ---------------------------------------------------------------------------
const HARNESS_CORE = ['tools/parity/lib.mjs', 'tools/parity/paths.mjs'];

export const CHECK_RUNS = Object.freeze({
  A: Object.freeze({
    id: 'A', title: 'check A — recolour identity vs the 2019 bundle GIFs',
    runFile: 'tools/parity/results/check-a-gifs.json', rerun: 'npm run check-a',
    harness: Object.freeze(['tools/parity/check-a-gifs.mjs', ...HARNESS_CORE]),
    engine: Object.freeze([
      'app/engine/rigRecolor.js', 'app/data/rigPalette.js', 'app/data/rigManifest.js', 'app/vendor/lottie.min.js',
      ...BUNDLE_GIF_FILES, // the renders every matchPct in this record is measured against
    ]),
  }),
  B: Object.freeze({
    id: 'B', title: 'check B — reference-pipeline recolour fidelity for arbitrary summoned wizards',
    runFile: 'tools/parity/results/check-b-wizards.json', rerun: 'npm run check-b',
    harness: Object.freeze(['tools/parity/check-b-wizards.mjs', ...HARNESS_CORE]),
    engine: Object.freeze(['app/engine/wizardRig.js', 'app/engine/rigRecolor.js', 'app/data/rigManifest.js', 'app/data/rigPalette.js', 'app/vendor/lottie.min.js']),
  }),
  C: Object.freeze({
    id: 'C', title: 'check C — timing vs the reference constants',
    runFile: 'tools/parity/results/check-c-timing.json', rerun: 'npm run check-c',
    harness: Object.freeze(['tools/parity/check-c-timing.mjs', ...HARNESS_CORE]),
    engine: Object.freeze([
      'app/data/rigManifest.js', 'app/engine/presentationTimeline.js',
      'app/data/tunables.json', // the O9 cadence every timeline number here is computed at
      'app/vendor/lottie.min.js', // loaded by lib.mjs, which this check imports
      ...BUNDLE_GIF_FILES, // the renders the effective-fps verdict is measured on
    ]),
  }),
  D: Object.freeze({
    id: 'D', title: 'check D — the four AC1 battle-fidelity criteria',
    runFile: 'tools/parity/results/check-d-ac1.json', rerun: 'npm run check-d',
    harness: Object.freeze(['tools/parity/check-d-ac1.mjs', ...HARNESS_CORE]),
    engine: Object.freeze([
      'app/engine/wizardRig.js', 'app/engine/rigRecolor.js', 'app/data/rigManifest.js', 'app/data/rigPalette.js',
      'app/ui/components/battle/rigAssets.js', 'app/ui/components/battle/rigStage.js', 'app/ui/components/dom.js',
      'app/engine/presentationTimeline.js', 'app/vendor/lottie.min.js',
      'app/styles/battle.css', // D2 parses stage geometry AND noLayerBackground out of it
      'app/data/tunables.json', // the O9 cadence D3 drives the timeline at
      'assets/cw/client-static/img/fightScene/fightBG.svg', // the arena D2 rasterizes and measures ink on
      'assets/rig/fx/affinitycapewin-FIRE.json', // D4's source when the bucket is unreachable
      'assets/rig/fx/affinitycapelose-FIRE.json',
    ]),
  }),
  E: Object.freeze({
    id: 'E', title: 'check E — id-keyed parity (2019 reference pipeline vs the new engine, per duel state)',
    runFile: 'tools/parity/results/check-e-idparity.json', rerun: 'npm run check-e',
    harness: HARNESS_DIGEST_FILES,
    engine: ENGINE_DIGEST_FILES,
  }),
});

export const CHECK_IDS = Object.freeze(Object.keys(CHECK_RUNS));

/** sha256 of each file's bytes, keyed by repo-relative path. */
export function digestFiles(files, repo = REPO) {
  const out = {};
  for (const rel of files) {
    const file = path.join(repo, rel);
    out[rel] = fs.existsSync(file)
      ? `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`
      : null;
  }
  return out;
}

function git(args, repo = REPO) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * The tree this run is being made on. `available:false` (never a throw) when
 * the harness is run outside a git work tree — the run still records what it
 * can, and says what it could not.
 */
export function gitProvenance(repo = REPO) {
  try {
    const commit = git(['rev-parse', 'HEAD'], repo);
    const status = git(['status', '--porcelain'], repo);
    const dirtyFiles = status ? status.split('\n').map((l) => l.slice(3)).filter(Boolean) : [];
    let branch = null;
    try { branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo); } catch { branch = null; }
    return { available: true, commit, shortCommit: commit.slice(0, 7), branch, dirty: dirtyFiles.length > 0, dirtyFiles };
  } catch {
    return { available: false, commit: null, shortCommit: null, branch: null, dirty: null, dirtyFiles: [] };
  }
}

/**
 * Everything a recorded run says about the tree it measured, for ONE check.
 * `check` is recorded so a reader (and the gate) knows which declared file
 * lists the digests below belong to.
 */
export function runProvenanceFor(checkId, repo = REPO) {
  const spec = CHECK_RUNS[checkId];
  if (!spec) throw new Error(`runProvenanceFor: unknown check "${checkId}" (declared: ${CHECK_IDS.join(', ')})`);
  const git = gitProvenance(repo);
  const declared = new Set([...spec.harness, ...spec.engine]);
  // `dirty` is every uncommitted path in the work tree; `dirtySources` is the
  // subset that this run's own numbers depend on. The distinction matters
  // because `npm run all` writes results/*.json as it goes, so the run after
  // the first one sees a dirty tree that contains nothing it measures — the
  // gate asserts dirtySources, so the documented re-run path is not
  // self-invalidating, and a genuinely uncommitted SOURCE is still refused.
  return {
    check: spec.id,
    ...git,
    dirtySources: (git.dirtyFiles || []).filter((p) => declared.has(p)),
    node: process.version,
    harnessDigests: digestFiles(spec.harness, repo),
    engineDigests: digestFiles(spec.engine, repo),
    note: `harnessDigests AND engineDigests are both asserted by app/tests/parity-harness.test.js (tools/parity/freshness.mjs holds the verdict): if any of these files changes without check ${spec.id} being re-run, the root suite fails. Verify in one command: node tools/parity/freshness.mjs.`,
  };
}

/** Check E's provenance — the original caller, unchanged in shape. */
export function runProvenance(repo = REPO) {
  return runProvenanceFor('E', repo);
}

/** Which of `digests` no longer match the working tree (empty = still fresh). */
export function staleAgainst(digests, repo = REPO) {
  const now = digestFiles(Object.keys(digests || {}), repo);
  return Object.keys(digests || {}).filter((rel) => now[rel] !== digests[rel]);
}

/** Is `sha` an ancestor of (or equal to) HEAD? `null` when it cannot be told
 * — no git, or a shallow clone without that object. */
export function isAncestorOfHead(sha, repo = REPO) {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`], repo);
  } catch {
    return null;
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: repo, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
