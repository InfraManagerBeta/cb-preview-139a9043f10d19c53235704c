// app/tests/risk-parser.test.js — the console's risk-register sign-off
// panel reads docs/risk-dossier.md families as entries (AC3/console
// actions). Unit-tests the pure parser against the real shipped dossier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFamilyTable, parseFindingHeaders, parseRiskFamilies } from '../ui/console/riskParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const dossierText = await fs.readFile(path.join(REPO_ROOT, 'docs', 'risk-dossier.md'), 'utf8');

test('parseFamilyTable extracts F-1..F-7 from the attack-family table with severity/feasibility', () => {
  const rows = parseFamilyTable(dossierText);
  const ids = rows.map((r) => r.id);
  for (const id of ['F-1', 'F-2', 'F-3', 'F-4', 'F-5', 'F-6', 'F-7']) assert.ok(ids.includes(id), `missing ${id}`);
  const f1 = rows.find((r) => r.id === 'F-1');
  assert.equal(f1.family, 'Sybil');
  assert.ok(f1.severity.length > 0);
});

test('parseFindingHeaders extracts the mechanics findings (F-8..F-11) from their section headers', () => {
  const rows = parseFindingHeaders(dossierText);
  const ids = rows.map((r) => r.id);
  for (const id of ['F-8', 'F-9', 'F-10', 'F-11']) assert.ok(ids.includes(id), `missing ${id}`);
});

test('parseRiskFamilies combines both sources, deduplicated, sorted by family number, all 11 present', () => {
  const rows = parseRiskFamilies(dossierText);
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.map((r) => r.id), ['F-1', 'F-2', 'F-3', 'F-4', 'F-5', 'F-6', 'F-7', 'F-8', 'F-9', 'F-10', 'F-11']);
  for (const r of rows) assert.ok(r.family && r.family.length > 0, `${r.id} has no family label`);
});
