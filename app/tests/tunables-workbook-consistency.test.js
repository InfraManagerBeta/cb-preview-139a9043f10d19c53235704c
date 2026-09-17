// app/tests/tunables-workbook-consistency.test.js — CB-BUILD-017 fix round
// f4 / Finding 1 (§14/R85 [LAW], AC0): "the workbook reproduces every
// shipped value ... a hand edit propagates to the running system."
// 654/654 passed the round before this fix because NOTHING checked that
// docs/tunables-workbook.csv and docs/tunables-workbook.md actually agree
// with app/data/tunables.json -- they drifted (W-34/O6 kept reading
// default 60, alternatives "30, 120" after tunables.json shipped default
// 30, alternatives [60, 120]) and no test noticed.
//
// This derives the comparison FROM THE FILES, not from a hardcoded pair:
// it walks tunables.json for every leaf tagged `_oItem` (the values the
// workbook itself calls out by O-number), finds the workbook row(s) naming
// that same O-number in `rule_ids`, and cross-checks the numeric figures
// actually written in each file. Any future edit to either file that
// leaves them disagreeing on a numeric O-item row fails this test -- it is
// not scoped to O6, and does not encode 30/60/120 anywhere as expected
// values; those numbers only ever come from reading tunables.json and the
// workbook themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');

// ---- minimal CSV parser (quoted fields, embedded commas; no new runtime
// dependency) -----------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvRowsAsObjects(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// ---- walk tunables.json for every `_oItem`-tagged leaf -----------------
function collectOItems(node, pathParts = []) {
  const out = [];
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    if (Object.prototype.hasOwnProperty.call(node, '_oItem')) {
      out.push({ oItem: node._oItem, node, path: pathParts.join('.') });
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('_')) continue;
      out.push(...collectOItems(v, [...pathParts, k]));
    }
  }
  return out;
}

// ---- normalization: pull comparable numbers out of either side ---------
function isNumericListString(s) {
  return typeof s === 'string' && /^\s*\$?-?\d+(\.\d+)?\s*(,\s*\$?-?\d+(\.\d+)?\s*)*$/.test(s.trim());
}

function extractNumbers(s) {
  return (String(s).match(/-?\d+(?:\.\d+)?/g) || []).map(Number).sort((a, b) => a - b);
}

function flattenNumbers(v) {
  if (typeof v === 'number') return [v];
  if (Array.isArray(v)) return v.flatMap(flattenNumbers);
  if (v && typeof v === 'object') return Object.values(v).flatMap(flattenNumbers);
  return [];
}

const tunablesRaw = JSON.parse(await fs.readFile(path.join(APP_ROOT, 'data', 'tunables.json'), 'utf8'));
const csvText = await fs.readFile(path.join(REPO_ROOT, 'docs', 'tunables-workbook.csv'), 'utf8');
const mdText = await fs.readFile(path.join(REPO_ROOT, 'docs', 'tunables-workbook.md'), 'utf8');
const csvRows = csvRowsAsObjects(csvText);
const oItems = collectOItems(tunablesRaw);

test('CB-BUILD-017 fix round f4/Finding 1 setup sanity: tunables.json actually names at least one O-item, and the workbook CSV parses to real rows', () => {
  assert.ok(oItems.length >= 5, 'expected several _oItem-tagged tunables in app/data/tunables.json');
  assert.ok(csvRows.length >= 80, 'expected docs/tunables-workbook.csv to parse into its full row set');
  assert.ok('rule_ids' in csvRows[0] && 'shipped_value' in csvRows[0] && 'alternatives_built' in csvRows[0]);
});

test('CB-BUILD-017 fix round f4/Finding 1 (§14/R85/AC0): every O-item tunable in tunables.json has a matching workbook CSV row naming it', () => {
  for (const { oItem, path: jsonPath } of oItems) {
    const row = csvRows.find((r) => new RegExp(`\\b${oItem}\\b`).test(r.rule_ids || ''));
    assert.ok(row, `expected docs/tunables-workbook.csv to have a row naming ${oItem} (tunables.json's "${jsonPath}" is tagged _oItem: "${oItem}")`);
  }
});

test('CB-BUILD-017 fix round f4/Finding 1 (§14/R85/AC0): the workbook CSV\'s numeric shipped_value/alternatives_built for every O-item row match tunables.json\'s actual default/alternatives -- this is exactly the defect class Finding 1 reported (W-34/O6 read default 60/"30, 120" while tunables.json shipped default 30/[60, 120])', () => {
  let numericRowsChecked = 0;
  for (const row of csvRows) {
    const m = (row.rule_ids || '').match(/\bO\d+\b/);
    if (!m) continue;
    const oItem = m[0];
    if (!isNumericListString(row.shipped_value) || !isNumericListString(row.alternatives_built)) continue;
    const jsonEntry = oItems.find((e) => e.oItem === oItem);
    assert.ok(jsonEntry, `workbook row ${row.id} names ${oItem} with a bare-numeric shipped_value/alternatives_built but tunables.json has no _oItem: "${oItem}" leaf to check it against`);
    numericRowsChecked++;
    const csvDefault = extractNumbers(row.shipped_value);
    const csvAlternatives = extractNumbers(row.alternatives_built);
    const jsonDefault = flattenNumbers(jsonEntry.node.default).sort((a, b) => a - b);
    const jsonAlternatives = flattenNumbers(jsonEntry.node.alternatives).sort((a, b) => a - b);
    assert.deepEqual(csvDefault, jsonDefault, `${row.id} (${oItem}): workbook shipped_value "${row.shipped_value}" disagrees with tunables.json default ${JSON.stringify(jsonEntry.node.default)} at "${jsonEntry.path}"`);
    assert.deepEqual(csvAlternatives, jsonAlternatives, `${row.id} (${oItem}): workbook alternatives_built "${row.alternatives_built}" disagrees with tunables.json alternatives ${JSON.stringify(jsonEntry.node.alternatives)} at "${jsonEntry.path}"`);
  }
  assert.ok(numericRowsChecked >= 3, `expected at least the O5/O6/O9 numeric timer rows to be checked (checked ${numericRowsChecked})`);
});

test('CB-BUILD-017 fix round f4/Finding 1 (§14/R85/AC0): docs/tunables-workbook.md\'s "values, grouped" table for every O-item row it lists matches tunables.json\'s actual default/alternatives', () => {
  const tableRows = mdText.split('\n').filter((l) => /^\|.*\(O\d+\).*\|/.test(l));
  assert.ok(tableRows.length >= 3, 'expected the markdown summary table to carry at least the O5/O6/O9 rows');
  let checked = 0;
  for (const line of tableRows) {
    // rawCells[0] = "Lobby human wait (O6)", rawCells[1] = "**30s**", rawCells[2] = "60s, 120s"
    const rawCells = line.split('|').slice(1, -1).map((c) => c.trim());
    const nameMatch = rawCells[0].match(/\(O(\d+)\)/);
    if (!nameMatch) continue;
    const oItem = `O${nameMatch[1]}`;
    const jsonEntry = oItems.find((e) => e.oItem === oItem);
    assert.ok(jsonEntry, `markdown row "${rawCells[0]}" names ${oItem} but tunables.json has no _oItem: "${oItem}" leaf`);
    checked++;
    const mdDefault = extractNumbers(rawCells[1]);
    const mdAlternatives = extractNumbers(rawCells[2]);
    const jsonDefault = flattenNumbers(jsonEntry.node.default).sort((a, b) => a - b);
    const jsonAlternatives = flattenNumbers(jsonEntry.node.alternatives).sort((a, b) => a - b);
    assert.deepEqual(mdDefault, jsonDefault, `markdown row "${rawCells[0]}" default "${rawCells[1]}" disagrees with tunables.json default ${JSON.stringify(jsonEntry.node.default)}`);
    assert.deepEqual(mdAlternatives, jsonAlternatives, `markdown row "${rawCells[0]}" alternatives "${rawCells[2]}" disagrees with tunables.json alternatives ${JSON.stringify(jsonEntry.node.alternatives)}`);
  }
  assert.ok(checked >= 3, `expected at least 3 O-item rows checked in the markdown table (checked ${checked})`);
});

test('CB-BUILD-017 fix round f4/Finding 1: the specific O6 row this finding reported now reads default 30, alternatives 60/120 in both workbook files, matching app/data/tunables.json', () => {
  assert.equal(tunablesRaw.timers.lobbyHumanWaitSec.default, 30);
  assert.deepEqual(tunablesRaw.timers.lobbyHumanWaitSec.alternatives, [60, 120]);
  const csvRow = csvRows.find((r) => r.id === 'W-34');
  assert.ok(csvRow, 'expected docs/tunables-workbook.csv row W-34 to exist');
  assert.equal(csvRow.shipped_value.trim(), '30');
  assert.deepEqual(extractNumbers(csvRow.alternatives_built), [60, 120]);
  const mdLine = mdText.split('\n').find((l) => l.includes('Lobby human wait (O6)'));
  assert.ok(mdLine, 'expected docs/tunables-workbook.md to carry the Lobby human wait (O6) row');
  assert.match(mdLine, /\*\*30s\*\*/);
  assert.deepEqual(extractNumbers(mdLine.split('|')[3]), [60, 120]);
});
