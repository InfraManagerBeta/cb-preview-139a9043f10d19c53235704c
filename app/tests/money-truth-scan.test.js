// app/tests/money-truth-scan.test.js — f2/C7/R8a: every screen module that
// renders a money figure (cheddar()/money()) also renders the R8a truth
// line (the full badge or the compact tug-bar-adjacent variant). Static
// source scan, same style as the existing R1/invariant-#8 scans (no DOM
// available in this test harness -- see app/README.md's node:test gotcha).
//
// f5/A7: extended to ui/components/battle/ too (moments.js renders money
// now) -- see that test below for why the check is "the component's host
// screen carries the truth line", not "the component file does".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const SCREEN_FILES = [
  'ui/screens/bracket-board.js',
  'ui/screens/duel.js',
  'ui/screens/lobby-entry.js',
  'ui/screens/pve.js',
  'ui/screens/sitting.js',
  'ui/screens/summon.js',
  'ui/screens/wallet.js',
];

test('C7/R8a: every screen module that calls cheddar(/money( also renders truthBadge(/compactMoneyTruth(', async () => {
  for (const file of SCREEN_FILES) {
    const src = await fs.readFile(path.join(APP_ROOT, file), 'utf8');
    const rendersMoney = /\bcheddar\(|\bmoney\(/.test(src.replace(/^\/\/.*$/gm, ''));
    if (!rendersMoney) continue;
    const rendersTruth = /truthBadge\(|compactMoneyTruth\(/.test(src);
    assert.ok(rendersTruth, `${file} renders a money figure but never truthBadge(/compactMoneyTruth(`);
  }
});

test('C7: the reveal loop (duel.js) renders the compact truth line once per screen build, covering the tug bar and every coverage-gap moment shown alongside it', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/duel.js'), 'utf8');
  assert.ok(src.includes('compactMoneyTruth(ctx)'), 'expected the reveal loop to render compactMoneyTruth(ctx)');
  assert.ok(src.includes('truthBadge(ctx)'), 'expected the result screen to render truthBadge(ctx)');
});

// f5/A7: extend the scan to ui/components/battle/ -- moments.js (and
// rails.js) render money figures (cheddar(/money() too, but they are
// COMPONENTS, not screens: they have no ledger-adjacent "screen build" of
// their own to carry the truth line, and are only ever mounted INSIDE
// duel.js's own reveal, which already renders both truthBadge(ctx) and
// compactMoneyTruth(ctx) (see the C7 test above) alongside every moment
// these components render. So the check here is at the right level: for
// each battle component that renders money, its ONLY host screen(s) (found
// by grepping every screen file's imports) must render the truth line --
// not the component file itself, which would be a redundant/wrong place to
// duplicate it.
const BATTLE_COMPONENT_DIR = 'ui/components/battle';

test('f5/A7: every ui/components/battle/ component that renders a money figure is mounted only inside a screen that itself renders truthBadge(/compactMoneyTruth(', async () => {
  const dirFiles = await fs.readdir(path.join(APP_ROOT, BATTLE_COMPONENT_DIR));
  const jsFiles = dirFiles.filter((f) => f.endsWith('.js'));
  assert.ok(jsFiles.includes('moments.js'), 'expected moments.js to exist in ui/components/battle/');

  const allScreenFiles = await fs.readdir(path.join(APP_ROOT, 'ui/screens'));
  const screenSources = await Promise.all(
    allScreenFiles.filter((f) => f.endsWith('.js')).map(async (f) => ({ file: `ui/screens/${f}`, src: await fs.readFile(path.join(APP_ROOT, 'ui/screens', f), 'utf8') }))
  );

  let checkedAtLeastOneMoneyRenderingComponent = false;
  for (const componentFile of jsFiles) {
    const componentSrc = await fs.readFile(path.join(APP_ROOT, BATTLE_COMPONENT_DIR, componentFile), 'utf8');
    const rendersMoney = /\bcheddar\(|\bmoney\(/.test(componentSrc.replace(/^\/\/.*$/gm, ''));
    if (!rendersMoney) continue;
    checkedAtLeastOneMoneyRenderingComponent = true;

    const importPath = `components/battle/${componentFile}`;
    const hostScreens = screenSources.filter((s) => s.src.includes(importPath));
    assert.ok(hostScreens.length > 0, `expected ${componentFile} (renders money) to be imported by at least one screen`);
    for (const host of hostScreens) {
      const rendersTruth = /truthBadge\(|compactMoneyTruth\(/.test(host.src);
      assert.ok(rendersTruth, `${host.file} mounts ${componentFile} (which renders money) but never renders truthBadge(/compactMoneyTruth(`);
    }
  }
  assert.ok(checkedAtLeastOneMoneyRenderingComponent, 'expected at least one ui/components/battle/ file to render a money figure (sanity: this test should not vacuously pass)');
});
