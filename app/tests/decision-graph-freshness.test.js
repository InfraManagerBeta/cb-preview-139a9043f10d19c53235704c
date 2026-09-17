// app/tests/decision-graph-freshness.test.js — round-2 fix round g3: the
// reviewer's CRUCIAL finding was that docs/decision-graph.json and
// docs/decision-graph.md sat untouched at a round-1 commit while round 2
// (CB-BUILD-009r, 014-022) moved ten load-bearing decisions and recorded
// none of them -- a grep for '009r', 'CB-BUILD-014'…'022' turned up zero
// hits. This test makes that failure mode a red CI run instead of a silent
// drift: it reads docs/cb-build-patch-log.md's OWN patch headings and its
// OWN Status-section statement of which numeric range is "this round's"
// scope (parsed, not hardcoded, so a future round's own range statement
// keeps this test correct without an edit here), and asserts that every id
// in that set appears SOMEWHERE in docs/decision-graph.json -- as a node
// id, title, evidence citation, or rationale. It does not require every id
// to have a full decision node with its own evidence/rationale (some
// round-2 ids are reviewed and explicitly NOT load-bearing --
// NOTE-ROUND2-NON-LOAD-BEARING carries the reasoning for those); it only
// requires the graph to acknowledge the id exists, so a ticket cannot be
// delivered and simply never mentioned again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

test(
  "docs/decision-graph.json carries at least one reference to every CB-BUILD id docs/cb-build-patch-log.md lists as this round's scope (its own stated numeric range, plus any lettered revert/revision id like 009r) -- so the graph cannot silently fall behind a round again",
  async () => {
    const patchLog = await fs.readFile(path.join(REPO_ROOT, 'docs', 'cb-build-patch-log.md'), 'utf8');
    const graphText = await fs.readFile(path.join(REPO_ROOT, 'docs', 'decision-graph.json'), 'utf8');

    // Every patch heading the log itself declares, e.g. "### CB-BUILD-017 — ...".
    const headingIds = [...patchLog.matchAll(/^###\s+(CB-BUILD-\d+[a-z]?)\b/gm)].map((m) => m[1]);
    assert.ok(headingIds.length > 0, 'expected to find "### CB-BUILD-NNN" patch headings in docs/cb-build-patch-log.md');

    // The log's own Status section names which numeric range is THIS round's
    // scope ("CB-BUILD-014…022 are round-2 scope"). Parsed rather than
    // hardcoded: a future round rewording this sentence to name its own
    // range keeps this test correct with no edit here.
    const scopeMatch = patchLog.match(/CB-BUILD-(\d+)\s*\u2026\s*(\d+) are round-2 scope/);
    assert.ok(
      scopeMatch,
      'expected the patch log\'s Status section to name the current round\'s scope range ("CB-BUILD-NNN\u2026MMM are round-N scope")',
    );
    const scopeStart = Number(scopeMatch[1]);
    const scopeEnd = Number(scopeMatch[2]);
    assert.ok(scopeStart <= scopeEnd, 'expected the parsed scope range to be non-empty and in order');

    // "This round's ids" = that numeric range, PLUS any heading whose id
    // carries a letter suffix (e.g. "009r"): a lettered id is BY
    // DEFINITION a revision issued after its original numeric ticket
    // already landed, so it always belongs to whichever round revised it
    // -- never to the original delivery round -- without this test needing
    // to know which round that was.
    const thisRoundIds = headingIds.filter((id) => {
      const m = /^CB-BUILD-(\d+)([a-z]?)$/.exec(id);
      if (!m) return false;
      const [, numStr, suffix] = m;
      if (suffix) return true;
      const num = Number(numStr);
      return num >= scopeStart && num <= scopeEnd;
    });
    assert.ok(
      thisRoundIds.length > 0,
      'expected at least one this-round id (the round-2 numeric range, or a lettered revision) among the patch log headings',
    );

    for (const id of thisRoundIds) {
      assert.ok(
        graphText.includes(id),
        `docs/decision-graph.json carries no reference to ${id}, which docs/cb-build-patch-log.md lists as this round's delivered scope -- the graph has fallen behind a round again`,
      );
    }
  },
);
