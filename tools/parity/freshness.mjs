// tools/parity/freshness.mjs — CB-BUILD-015 (fix round g1): the GATE.
//
// The defect this exists for, in three steps:
//
//  1. check E's shipped result was produced at a commit that predated a
//     change to the engine it measures, and nothing said so. The answer was
//     `provenance.mjs`: every run records the tree it ran on and a sha256 of
//     every file that decides its numbers.
//  2. That was still not enough. The ENGINE digests were RECORDED and
//     printed — and nothing asserted them. The next engine change (fix round
//     f3's rewrite of `deriveIdentity`) made the shipped run stale again,
//     the mechanism detected it correctly, and the repository stayed green:
//     a report that reads as the head's with the correction living only
//     where nobody looks. A recorded-but-silent mechanism is not a gate.
//  3. Re-running check E at the integrated head then showed the same thing
//     one file over: checks B and D also resolve wizard identities from ids,
//     so their recorded numbers were measured on wizards the engine no
//     longer produces either. So the gate covers EVERY recorded run, per
//     `CHECK_RUNS` in `provenance.mjs`, and check D is the AC1 four-criteria
//     deliverable — exactly the kind of thing that must not read as the
//     head's while describing another tree.
//
// So this module turns the recorded digests into a VERDICT, and
// `app/tests/parity-harness.test.js` asserts that verdict for every declared
// check and BOTH of its lists — harness sources AND the engine modules the
// run measures. Move either without re-running that check and
// `node --test app/tests/*.test.js` goes RED. That is deliberate and it is
// the point: the AC1 deliverable is the RUN, so an engine change that
// invalidates a run is an incomplete change, and the suite says so instead
// of a paragraph saying so.
//
// The cost is named, not hidden: a container that folds an engine change
// without bucket access or a native canvas build cannot re-run the checks,
// so it cannot make the suite green. It must say "these checks need
// re-running and I cannot do it here" — an honest red — instead of shipping
// numbers that describe a tree that no longer exists. There is no
// environment-variable opt-out, because an opt-out is how the silent version
// happened.
//
// Pure (fs + crypto): no jsdom, no node-canvas, no network — the offline
// test suite and a reader with a checkout run exactly the same check, and
// `node tools/parity/freshness.mjs` (`npm run freshness`) prints it in one
// command.
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './paths.mjs';
import { CHECK_RUNS, CHECK_IDS, digestFiles } from './provenance.mjs';

export const RERUN_ALL = 'cd tools/parity && npm install && npm run all';

/** Check E's run file — the AC1 parity deliverable this began with. */
export const RUN_FILE = CHECK_RUNS.E.runFile;

export function loadRun(checkId, repo = REPO) {
  return JSON.parse(fs.readFileSync(path.join(repo, CHECK_RUNS[checkId].runFile), 'utf8'));
}

export function loadShippedRun(repo = REPO) {
  return loadRun('E', repo);
}

/** One digest list, compared against the tree as it is now. */
function compareList(group, declared, recorded, repo) {
  const keys = Array.from(new Set([...declared, ...Object.keys(recorded || {})])).sort();
  const now = digestFiles(keys, repo);
  return keys.map((file) => {
    const rec = (recorded || {})[file];
    return {
      group,
      file,
      recorded: rec ?? null,
      now: now[file] ?? null,
      declared: declared.includes(file),
      inRecord: Object.prototype.hasOwnProperty.call(recorded || {}, file),
      fresh: rec != null && rec === now[file],
    };
  });
}

/**
 * Is `record` still a description of THIS tree?
 *
 * `fresh` is true only when every declared harness source and every declared
 * engine module hashes to exactly what the run recorded, and the record
 * covers exactly the declared sets (a file added to either list without a
 * re-run is stale too — the run never measured it, so a missing digest is
 * staleness and never a pass).
 */
export function freshnessOfRecord(record, spec = CHECK_RUNS.E, repo = REPO) {
  const provenance = (record && record.provenance) || {};
  const rows = [
    ...compareList('harness', spec.harness.slice(), provenance.harnessDigests || {}, repo),
    ...compareList('engine', spec.engine.slice(), provenance.engineDigests || {}, repo),
  ];
  const staleIn = (group) => rows.filter((r) => r.group === group && !r.fresh).map((r) => r.file);
  const staleHarness = staleIn('harness');
  const staleEngine = staleIn('engine');
  return {
    check: spec.id,
    title: spec.title,
    runFile: spec.runFile,
    rerun: spec.rerun,
    commit: provenance.commit || null,
    shortCommit: provenance.shortCommit || (provenance.commit ? provenance.commit.slice(0, 7) : null),
    ranAt: record ? record.ranAt || null : null,
    dirty: provenance.dirty ?? null,
    rows,
    staleHarness,
    staleEngine,
    stale: [...staleHarness, ...staleEngine],
    fresh: staleHarness.length === 0 && staleEngine.length === 0,
  };
}

/** Back-compatible alias: check E's record. */
export const freshnessOf = (record, repo = REPO) => freshnessOfRecord(record, CHECK_RUNS.E, repo);

/** The verdict for one shipped run, read off disk. */
export function freshnessOfCheck(checkId, repo = REPO) {
  const spec = CHECK_RUNS[checkId];
  if (!spec) throw new Error(`freshnessOfCheck: unknown check "${checkId}" (declared: ${CHECK_IDS.join(', ')})`);
  return freshnessOfRecord(loadRun(checkId, repo), spec, repo);
}

/** Check E's verdict — the one the report's banner is about. */
export function shippedRunFreshness(repo = REPO) {
  return freshnessOfCheck('E', repo);
}

/** Every declared check, in declaration order. */
export function allFreshness(repo = REPO) {
  const checks = CHECK_IDS.map((id) => freshnessOfCheck(id, repo));
  return { checks, fresh: checks.every((c) => c.fresh), stale: checks.filter((c) => !c.fresh) };
}

export const RERUN_COMMAND = CHECK_RUNS.E.rerun ? `cd tools/parity && npm install && ${CHECK_RUNS.E.rerun}` : RERUN_ALL;

/** What a failing gate tells the person who broke it. */
export function stalenessMessage(f) {
  const lines = [
    `The shipped ${f.title || `check ${f.check}`} run (${f.runFile}, made at ${f.shortCommit || 'an unrecorded commit'}) no longer describes this tree.`,
  ];
  if (f.staleHarness.length) lines.push(`  harness sources changed since the run: ${f.staleHarness.join(', ')}`);
  if (f.staleEngine.length) lines.push(`  engine modules the run MEASURES changed since the run: ${f.staleEngine.join(', ')}`);
  lines.push(`  The run is an AC1 deliverable, so it has to be re-made on this tree: cd tools/parity && npm install && ${f.rerun || 'npm run all'}`);
  lines.push('  (needs the public animation bucket and a native canvas build. If this container has neither, the honest');
  lines.push('   result is "the check must be re-run and I cannot do it here" — not a green suite over numbers from another tree.)');
  return lines.join('\n');
}

/**
 * The banner check E's report opens with. Generated into `PARITY-REPORT.md`
 * by the run and asserted by `app/tests/parity-harness.test.js`, so a reader
 * meets the freshness rule in the first paragraph rather than in a residual
 * at the bottom.
 */
export function freshnessBanner({ commit, shortCommit, ranAt }) {
  const full = commit || 'unknown';
  const short = shortCommit || (commit ? commit.slice(0, 7) : 'unknown');
  return [
    `> ### ⚠ FRESHNESS GATE — this report describes commit \`${short}\` and no other`,
    '>',
    `> Measured at \`${full}\`${ranAt ? ` (\`${ranAt}\`)` : ''}. A parity run is a claim about ONE tree: if the`,
    '> harness or any engine module it measures moves, these numbers stop being',
    '> about the code you are reading.',
    '>',
    `> **That is now enforced, not merely disclosed.** \`results/check-e-idparity.json\``,
    '> records a sha256 of every harness source AND of every engine module this run',
    '> measures, and `app/tests/parity-harness.test.js` **asserts both lists** — for',
    '> this run and for every other recorded run in `results/`: change one without',
    '> re-running that check and `node --test app/tests/*.test.js` FAILS from the repo',
    '> root. Check it yourself in one command, offline, no bucket and no canvas build',
    '> needed:',
    '>',
    '> ```',
    '> node tools/parity/freshness.mjs',
    '> ```',
    '>',
    '> (In a SHALLOW clone the companion assertion — that the commit above is an',
    '> ancestor of HEAD — degrades to a skip, since the object is not there to',
    '> compare; the digests still bind, being hashes of the files in front of you.)',
    '>',
    `> Re-make the run with \`${RERUN_COMMAND}\`.`,
  ].join('\n');
}

/** Human-readable verdict, for the CLI. */
export function freshnessReport(all) {
  const L = [];
  L.push('check-A..E freshness — is each recorded run still a description of THIS tree?');
  L.push('');
  for (const f of all.checks) {
    L.push(`${f.fresh ? 'FRESH' : 'STALE'}  ${f.title}`);
    L.push(`       ${f.runFile} — run at ${f.commit || '(no commit recorded)'}${f.dirty ? ' (DIRTY TREE)' : ''}${f.ranAt ? `, ${f.ranAt}` : ''}`);
    const w = Math.max(...f.rows.map((r) => r.file.length));
    for (const r of f.rows) {
      L.push(`       [${r.fresh ? 'fresh' : 'STALE'}] ${r.group.padEnd(7)} ${r.file.padEnd(w)}  ${r.fresh ? r.recorded.slice(7, 19) : `recorded ${(r.recorded || 'NOT RECORDED').slice(0, 19)} -> now ${(r.now || 'missing').slice(0, 19)}`}`);
    }
    L.push('');
  }
  if (all.fresh) {
    L.push(`VERDICT: FRESH — all ${all.checks.length} recorded runs describe this tree.`);
  } else {
    L.push(`VERDICT: STALE — ${all.stale.length} of ${all.checks.length} recorded runs no longer describe this tree.`);
    for (const f of all.stale) L.push(stalenessMessage(f));
  }
  return L.join('\n');
}

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  const all = allFreshness();
  console.log(freshnessReport(all));
  process.exitCode = all.fresh ? 0 : 1;
}
