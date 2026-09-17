// app/tests/target-size-scan.test.js — f2/A10/R83/AC1: an automated
// (static-approximation) scan for interactive controls under the 44px
// touch-target bar, over the shipped stylesheets. The review noted this
// automated check was previously absent (both offenders --
// `.cb-skip-btn` at 32px and `.cb-sound-toggle` at ~22px -- had to be
// caught by hand). This can't replace a real rendered-layout audit (no
// browser/DOM in this harness -- see app/README.md's node:test gotcha),
// but it is exactly the kind of static approximation the brief allows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const TAP_MIN_PX = 44;

// Selectors matching these tokens are treated as "interactive control"
// candidates for the scan. Deliberately narrow (naming-convention based, a
// static approximation): decorative/sub-part classes (icons, portraits,
// checkbox glyphs -- each already sits inside a wrapper whose OWN min-height
// is the real tap target, e.g. .cb-checkbox-row) are excluded by name so
// the scan doesn't false-positive on a 22px checkbox glyph that lives
// inside a 44px-tall clickable row.
const INTERACTIVE_TOKENS = ['btn', 'button', 'toggle', 'tab', 'chip', 'nav-btn'];
const EXCLUDE_TOKENS = ['icon', 'portrait', 'gif', 'fx', 'badge', 'checkbox', 'strobe', 'trophy', 'coin', 'stamp'];

function parseRules(css) {
  // Strip comments, then split into { selector, body } blocks.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) {
    rules.push({ selector: m[1].trim(), body: m[2] });
  }
  return rules;
}

function pxValue(body, prop) {
  const re = new RegExp(`(?:^|[^-])\\b${prop}\\s*:\\s*([0-9.]+)px`, 'i');
  const m = body.match(re);
  return m ? parseFloat(m[1]) : null;
}

function usesTapMinVar(body) {
  return /var\(--tap-min\)/.test(body);
}

async function scanFile(file) {
  const css = await fs.readFile(file, 'utf8');
  const rules = parseRules(css);
  const violations = [];
  for (const { selector, body } of rules) {
    const lowerSel = selector.toLowerCase();
    const isCandidate = INTERACTIVE_TOKENS.some((t) => lowerSel.includes(t));
    const isExcluded = EXCLUDE_TOKENS.some((t) => lowerSel.includes(t));
    if (!isCandidate || isExcluded) continue;
    if (usesTapMinVar(body)) continue; // already ties to the 44px custom property

    const minHeight = pxValue(body, 'min-height');
    const height = pxValue(body, 'height');
    const minWidth = pxValue(body, 'min-width');
    const width = pxValue(body, 'width');

    // The effective tap-target height/width is the LARGEST of (min-)height
    // and (min-)width declared -- if none are declared at all, this static
    // scan can't say anything (padding-driven sizing, browser default,
    // etc.) and skips it rather than false-positive.
    const effectiveHeight = [minHeight, height].filter((v) => v != null);
    const effectiveWidth = [minWidth, width].filter((v) => v != null);
    if (effectiveHeight.length === 0 && effectiveWidth.length === 0) continue;

    const worstHeight = effectiveHeight.length ? Math.max(...effectiveHeight) : Infinity;
    const worstWidth = effectiveWidth.length ? Math.max(...effectiveWidth) : Infinity;
    if (worstHeight < TAP_MIN_PX || worstWidth < TAP_MIN_PX) {
      violations.push({ selector, worstHeight, worstWidth });
    }
  }
  return violations;
}

test('A10/R83/AC1: no interactive control (button/toggle/tab/chip) in the shipped stylesheets sizes under the 44px touch target', async () => {
  const files = ['base.css', 'battle.css', 'console.css'].map((f) => path.join(APP_ROOT, 'styles', f));
  const allViolations = [];
  for (const file of files) {
    const violations = await scanFile(file);
    for (const v of violations) allViolations.push({ file: path.basename(file), ...v });
  }
  assert.deepEqual(allViolations, [], `found interactive controls under 44px: ${JSON.stringify(allViolations)}`);
});

test('A10 regression: the two named offenders (.cb-skip-btn, .cb-sound-toggle) explicitly declare a 44px minimum', async () => {
  const battleCss = await fs.readFile(path.join(APP_ROOT, 'styles', 'battle.css'), 'utf8');
  const rules = parseRules(battleCss);
  for (const cls of ['.cb-skip-btn', '.cb-sound-toggle']) {
    const rule = rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes(cls));
    assert.ok(rule, `expected a rule for ${cls}`);
    const minH = pxValue(rule.body, 'min-height');
    const minW = pxValue(rule.body, 'min-width');
    assert.ok(minH >= 44, `${cls}: min-height ${minH} must be >= 44`);
    assert.ok(minW >= 44, `${cls}: min-width ${minW} must be >= 44`);
  }
});
