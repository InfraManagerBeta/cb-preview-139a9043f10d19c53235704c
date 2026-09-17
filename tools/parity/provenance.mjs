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
// Two lists, treated differently and deliberately:
//  * HARNESS_DIGEST_FILES — the harness's own sources plus the declaration.
//    These are ASSERTED by app/tests/parity-harness.test.js: edit one without
//    re-running the harness and the suite goes red, because the shipped
//    numbers no longer describe the shipped harness.
//  * ENGINE_DIGEST_FILES — the shipped modules the run measures. These are
//    RECORDED and printed, not asserted. A change here also makes the run
//    stale, but re-running needs the public bucket and a native canvas build,
//    which a container folding an unrelated engine fix may not have; a reader
//    (or a manager) compares the digests and re-runs deliberately. The report
//    says this in the same words.
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

/** Everything a recorded run says about the tree it measured. */
export function runProvenance(repo = REPO) {
  return {
    ...gitProvenance(repo),
    node: process.version,
    harnessDigests: digestFiles(HARNESS_DIGEST_FILES, repo),
    engineDigests: digestFiles(ENGINE_DIGEST_FILES, repo),
    note: 'harnessDigests are asserted by app/tests/parity-harness.test.js; engineDigests are recorded for a reader to compare against the current tree (a difference means this run is stale and needs re-running with bucket access + a native canvas build).',
  };
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
