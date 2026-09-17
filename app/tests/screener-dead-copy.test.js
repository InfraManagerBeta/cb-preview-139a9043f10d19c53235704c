// app/tests/screener-dead-copy.test.js — fix round advisory A1: the dead
// `screenerAgeQuestion`/`screenerJurisdictionQuestion` strings survived in
// all three treatments' copy blocks (plus a `mapping.json` mention) even
// after CB-BUILD-001 stopped reading them -- dead copy carrying exactly the
// self-report-question string R70 outlaws (C1/C2), just unreachable rather
// than rendered. Removed outright (not `_`-prefixed) from all three
// treatments' `copy` blocks and from mapping.json's genericChrome note.
// treatments-schema.test.js's key-set-equality check (all three treatments
// share the exact same copy key set) stays green since all three lost the
// same two keys together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTreatment } from '../engine/dataLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const TREATMENTS = ['incumbent', 'adjacent', 'far'];

for (const id of TREATMENTS) {
  test(`A1: ${id}.json's copy no longer carries the dead screenerAgeQuestion/screenerJurisdictionQuestion self-report strings`, async () => {
    const treatment = await loadTreatment(id);
    assert.ok(!('screenerAgeQuestion' in treatment.copy), `${id}: expected screenerAgeQuestion to be removed`);
    assert.ok(!('screenerJurisdictionQuestion' in treatment.copy), `${id}: expected screenerJurisdictionQuestion to be removed`);
  });
}

test('A1: mapping.json no longer lists screenerAgeQuestion/JurisdictionQuestion as a kept-identical generic-chrome string (they were removed, not carried forward)', async () => {
  const mapping = JSON.parse(await fs.readFile(path.join(APP_ROOT, 'data', 'treatments', 'mapping.json'), 'utf8'));
  assert.ok(!/screenerAgeQuestion\/JurisdictionQuestion/.test(mapping.theme.genericChrome) || /removed/.test(mapping.theme.genericChrome), 'expected the genericChrome note to no longer claim these keys are carried forward unchanged');
});

test('A1: treatments-schema.test.js\'s copy-key-set-equality invariant still holds after removal (all three lost the same two keys)', async () => {
  const incumbent = await loadTreatment('incumbent');
  const adjacent = await loadTreatment('adjacent');
  const far = await loadTreatment('far');
  const incKeys = Object.keys(incumbent.copy).filter((k) => !k.startsWith('_')).sort();
  assert.deepEqual(Object.keys(adjacent.copy).filter((k) => !k.startsWith('_')).sort(), incKeys);
  assert.deepEqual(Object.keys(far.copy).filter((k) => !k.startsWith('_')).sort(), incKeys);
});

test('A1: the outlawed self-report question strings ("Are you 18 or older?" / "Do you currently reside in a permitted region?") are gone from every treatment JSON file byte-for-byte', async () => {
  for (const id of TREATMENTS) {
    const src = await fs.readFile(path.join(APP_ROOT, 'data', 'treatments', `${id}.json`), 'utf8');
    assert.ok(!/Do you currently reside in a permitted region\?/.test(src), `${id}.json: expected the jurisdiction self-report question string to be gone`);
    assert.ok(!/"screenerAgeQuestion"/.test(src), `${id}.json: expected the screenerAgeQuestion key to be gone`);
  }
});
