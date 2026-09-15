// app/tests/decision-graph-schema.test.js — f8/advisory-9: reads
// docs/decision-graph.json directly (the machine-readable twin AC2 calls
// authoritative) and asserts its own documented shape in one small test,
// so a future edit that breaks the schema, or quietly reintroduces a stale
// claim like H-R26-1's "not per-round" (fixed this round -- see
// docs/decision-graph.md and docs/retention-manifest.md's matching
// restatements), fails CI instead of drifting silently again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const VALID_STATUSES = new Set(['proposed', 'accepted', 'superseded']);
// AC2 (docs/decision-graph.json's own "scope" field): every node's required
// fields, and evidence's own required sub-fields.
const REQUIRED_NODE_FIELDS = ['id', 'title', 'authority', 'evidence', 'status', 'rationale'];
const REQUIRED_EVIDENCE_FIELDS = ['tier', 'kind', 'source'];

test('docs/decision-graph.json: parses, every node has AC2\'s required fields with a valid status, and H-R26-1.rationale is no longer stale ("not per-round")', async () => {
  const graphText = await fs.readFile(path.join(REPO_ROOT, 'docs', 'decision-graph.json'), 'utf8');

  let graph;
  assert.doesNotThrow(() => { graph = JSON.parse(graphText); }, 'expected docs/decision-graph.json to parse cleanly');
  assert.ok(Array.isArray(graph.nodes) && graph.nodes.length > 0, 'expected a non-empty nodes array');

  for (const node of graph.nodes) {
    for (const field of REQUIRED_NODE_FIELDS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(node, field) && node[field] != null,
        `node ${node.id || '(no id)'} is missing required AC2 field "${field}"`,
      );
    }
    assert.ok(node.evidence && typeof node.evidence === 'object', `node ${node.id}'s evidence must be an object`);
    for (const field of REQUIRED_EVIDENCE_FIELDS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(node.evidence, field) && node.evidence[field] != null,
        `node ${node.id}'s evidence is missing required AC2 field "${field}"`,
      );
    }
    assert.ok(
      VALID_STATUSES.has(node.status),
      `node ${node.id} has status "${node.status}", expected one of ${[...VALID_STATUSES].join('/')}`,
    );
  }

  // f8/crucial: guards against H-R26-1's scouting-panel doc going stale
  // again the way it did between f7's code fix and this round's doc fix.
  const hR26_1 = graph.nodes.find((n) => n.id === 'H-R26-1');
  assert.ok(hR26_1, 'expected an H-R26-1 node in docs/decision-graph.json');
  assert.doesNotMatch(
    hR26_1.rationale,
    /not per-round/,
    'H-R26-1.rationale must not claim the scouting panel derives from summary fields "not per-round" -- resolved at f7',
  );
});
