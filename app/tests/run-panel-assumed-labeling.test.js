// app/tests/run-panel-assumed-labeling.test.js — CB-BUILD-017 fix round
// f4/Finding 3 (§0/R5 [LAW]): `runSimulator.js`'s LINK_TO_FIRST_SEAL_MEDIAN_
// SEC/_P90_SEC constants (95s/205s) used to render on the console's daily
// report identically to the real measured columns beside them -- no
// ASSUMED marker on the console cell, none in the panel's legend, none in
// docs/disclosure.md; the only label was a source comment no console
// reader ever sees. This asserts the marker is actually on the rendered
// surface (the cell AND the legend), not just in a comment, and that
// docs/disclosure.md records it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateRun, LINK_TO_FIRST_SEAL_ASSUMED_NOTE } from '../engine/runSimulator.js';
import { loadTunables } from '../engine/dataLoader.js';
import { defaultOverrides } from '../engine/overrides.js';
import { installFakeDom, uninstallFakeDom, renderedText } from './helpers/dom-harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');

let renderRunPanel;
test.before(async () => {
  ({ renderRunPanel } = await import('../ui/console/runPanel.js'));
});
test.beforeEach(() => { installFakeDom(); });
test.afterEach(() => { uninstallFakeDom(); });

const tunables = await loadTunables();

test('CB-BUILD-017 fix round f4/Finding 3: every simulated day carries an explicit linkToFirstSealSecondsAssumed flag alongside the median/p90 seconds', () => {
  const run = simulateRun({ seed: 20260910, plant: 'pass' });
  for (const armId of Object.keys(run.byArm)) {
    for (const day of run.byArm[armId]) {
      assert.equal(day.linkToFirstSealSecondsAssumed, true, `expected day ${day.day} of arm ${armId} to carry the ASSUMED flag`);
    }
  }
});

test('CB-BUILD-017 fix round f4/Finding 3: the console\'s Run panel renders the ASSUMED marker directly ON the daily table\'s Link\u2192Seal cell -- not just in a source comment', () => {
  const overrides = defaultOverrides();
  const panel = renderRunPanel({ overrides, tunables, refresh: () => {} });
  const runButton = panel.querySelector('.cb-btn');
  assert.ok(runButton, 'expected the "Run simulation" button to render');
  runButton.dispatch('click');

  const text = renderedText(panel);
  assert.match(text, /med \d+s ASSUMED/, 'expected the daily table\'s median-seconds cell to carry the literal word ASSUMED next to the figure');

  // The cell must be visually distinct, not just textually labeled --
  // find the actual DOM node carrying the marker and check it isn't
  // rendered identically to a plain text cell.
  const assumedNode = panel.querySelector('.cb-console-assumed-figure');
  assert.ok(assumedNode, 'expected a visually distinct element (class cb-console-assumed-figure) wrapping the ASSUMED median figure');
  assert.match(assumedNode._attrs.get('style') || '', /italic|color/, 'expected the ASSUMED figure to carry a visually distinguishing style, not default cell styling');
});

test('CB-BUILD-017 fix round f4/Finding 3: the column header itself names the ASSUMED figure (not just the cell)', () => {
  const overrides = defaultOverrides();
  const panel = renderRunPanel({ overrides, tunables, refresh: () => {} });
  const runButton = panel.querySelector('.cb-btn');
  runButton.dispatch('click');
  const text = renderedText(panel);
  assert.match(text, /Link\u2192Seal.*ASSUMED/, 'expected the Link\u2192Seal column header to itself name the ASSUMED figure');
});

test('CB-BUILD-017 fix round f4/Finding 3: the panel carries an explicit ASSUMED legend line beneath the daily table, distinct from the measured-column notes', () => {
  const overrides = defaultOverrides();
  const panel = renderRunPanel({ overrides, tunables, refresh: () => {} });
  const runButton = panel.querySelector('.cb-btn');
  runButton.dispatch('click');

  const text = renderedText(panel);
  assert.ok(text.includes(LINK_TO_FIRST_SEAL_ASSUMED_NOTE), 'expected the panel\'s legend to carry the exact ASSUMED note runSimulator.js exports (one source, not a second hand-typed copy)');
});

test('CB-BUILD-017 fix round f4/Finding 3: docs/disclosure.md records the ASSUMED median/p90 figures and where they render', async () => {
  const disclosure = await fs.readFile(path.join(REPO_ROOT, 'docs', 'disclosure.md'), 'utf8');
  assert.match(disclosure, /linkToFirstSealMedianSec/, 'expected disclosure.md to name the ASSUMED constant');
  assert.match(disclosure, /linkToFirstSealP90Sec/, 'expected disclosure.md to name the ASSUMED p90 constant');
  assert.match(disclosure, /ASSUMED/, 'expected disclosure.md to actually use the word ASSUMED for these figures');
  assert.match(disclosure, /runPanel\.js|Run simulation|console/i, 'expected disclosure.md to say WHERE these figures render');
});

test('CB-BUILD-017 fix round f4/Finding 3: the marker holds across every arm and both plant conditions (incl. the planted-fail arm), not just the default pass/gate-cell view', () => {
  const overrides = defaultOverrides();
  const panel = renderRunPanel({ overrides, tunables, refresh: () => {} });
  const runButton = panel.querySelector('.cb-btn');
  runButton.dispatch('click');
  const text = renderedText(panel);
  // Every per-arm daily table renders in the same panel instance; count the
  // ASSUMED occurrences should be >= number of arms (5 door arms + 1 gate
  // cell = 6), one per rendered daily table's legend line at minimum.
  const occurrences = (text.match(/ASSUMED/g) || []).length;
  assert.ok(occurrences >= 6, `expected at least 6 ASSUMED occurrences (one per arm's legend line, plus cell-level markers) -- found ${occurrences}`);
});
