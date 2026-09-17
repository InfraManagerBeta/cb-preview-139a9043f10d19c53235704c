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
//  * engine — the shipped modules the run measures.
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

export const ENGINE_DIGEST_FILES = Object.freeze([
  'app/engine/wizardRig.js',
  'app/engine/rigRecolor.js',
  'app/data/rigManifest.js',
  'app/data/rigPalette.js',
  'app/ui/components/battle/rigAssets.js',
  'app/ui/components/battle/rigStage.js',
  'app/vendor/lottie.min.js',
  'assets/cw/reference/Animation-index.js',
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
// only (its own script, the harness modules it imports, the engine modules it
// measures). Static assets (the bundle GIFs, the portrait SVGs) and the
// bucket's animation documents are NOT digested — the same convention check E
// has always used, stated here so the lists are not read as more than they
// are. A list that is too narrow makes the gate miss a change; too wide only
// costs an unnecessary re-run. Where in doubt these err wide.
// ---------------------------------------------------------------------------
const HARNESS_CORE = ['tools/parity/lib.mjs', 'tools/parity/paths.mjs'];

export const CHECK_RUNS = Object.freeze({
  A: Object.freeze({
    id: 'A', title: 'check A — recolour identity vs the 2019 bundle GIFs',
    runFile: 'tools/parity/results/check-a-gifs.json', rerun: 'npm run check-a',
    harness: Object.freeze(['tools/parity/check-a-gifs.mjs', ...HARNESS_CORE]),
    engine: Object.freeze(['app/engine/rigRecolor.js', 'app/data/rigPalette.js', 'app/data/rigManifest.js', 'app/vendor/lottie.min.js']),
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
    engine: Object.freeze(['app/data/rigManifest.js', 'app/engine/presentationTimeline.js']),
  }),
  D: Object.freeze({
    id: 'D', title: 'check D — the four AC1 battle-fidelity criteria',
    runFile: 'tools/parity/results/check-d-ac1.json', rerun: 'npm run check-d',
    harness: Object.freeze(['tools/parity/check-d-ac1.mjs', ...HARNESS_CORE]),
    engine: Object.freeze([
      'app/engine/wizardRig.js', 'app/engine/rigRecolor.js', 'app/data/rigManifest.js', 'app/data/rigPalette.js',
      'app/ui/components/battle/rigAssets.js', 'app/ui/components/battle/rigStage.js',
      'app/engine/presentationTimeline.js', 'app/vendor/lottie.min.js',
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
