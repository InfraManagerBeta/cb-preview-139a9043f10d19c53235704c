// app/tests/disabled-button-cue.test.js — CB-BUILD-008/§12/R83: a gated
// control renders a clearly disabled state distinct in FILL and WEIGHT,
// not opacity alone, and never presents as actionable while inert. Static
// CSS-rule scan (no DOM/CSSOM available in this harness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

function parseRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) {
    rules.push({ selector: m[1].trim(), body: m[2] });
  }
  return rules;
}

function disabledRule(rules) {
  return rules.find((r) => {
    const selectors = r.selector.split(',').map((s) => s.trim());
    return selectors.includes('.cb-btn:disabled') || selectors.includes('.cb-btn[aria-disabled="true"]');
  });
}

let baseCss;
let rules;

test.before(async () => {
  baseCss = await fs.readFile(path.join(APP_ROOT, 'styles', 'base.css'), 'utf8');
  rules = parseRules(baseCss);
});

test('CB-BUILD-008/R83 (defect repro): the disabled rule no longer relies on opacity alone', () => {
  const rule = disabledRule(rules);
  assert.ok(rule, 'expected a .cb-btn:disabled / .cb-btn[aria-disabled="true"] rule');
  const opacityMatch = rule.body.match(/opacity\s*:\s*([0-9.]+)/);
  // Either no opacity declaration at all, or explicitly 1 (fully opaque --
  // the cue must come from fill/weight, not a fade).
  if (opacityMatch) {
    assert.equal(parseFloat(opacityMatch[1]), 1, 'expected disabled opacity to be 1 (no fade) -- fill/weight alone carry the cue');
  }
});

test('CB-BUILD-008/R83: the disabled fill (background/color) is distinct from the active button\'s vivid yellow-on-black fill', () => {
  const rule = disabledRule(rules);
  assert.doesNotMatch(rule.body, /background\s*:\s*var\(--cb-yellow\)/, 'expected the disabled background to NOT be the active vivid yellow');
  assert.ok(/background\s*:\s*#[0-9a-fA-F]{3,6}/.test(rule.body), 'expected an explicit muted/desaturated background fill');
  assert.ok(/color\s*:\s*#[0-9a-fA-F]{3,6}/.test(rule.body), 'expected an explicit muted text color distinct from the active black-on-yellow pair');
});

test('CB-BUILD-008/R83: the disabled state carries a WEIGHT cue distinct from the active button (a thinner border than the active 3px)', () => {
  const activeRule = rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes('.cb-btn'));
  const activeBorderWidth = parseFloat((activeRule.body.match(/border\s*:\s*([0-9.]+)px/) || [])[1] || 'NaN');
  const rule = disabledRule(rules);
  const disabledBorderWidth = parseFloat((rule.body.match(/border-width\s*:\s*([0-9.]+)px/) || [])[1] || 'NaN');
  assert.ok(!Number.isNaN(activeBorderWidth) && !Number.isNaN(disabledBorderWidth), 'expected both an active and a disabled border width to compare');
  assert.ok(disabledBorderWidth < activeBorderWidth, `expected the disabled border-width (${disabledBorderWidth}px) to be lighter-weight than the active border (${activeBorderWidth}px)`);
});

test('CB-BUILD-008/R83: the disabled state drops the drop-shadow entirely (not just fades it)', () => {
  const rule = disabledRule(rules);
  assert.ok(/box-shadow\s*:\s*none/.test(rule.body), 'expected box-shadow: none on the disabled state');
});

test('CB-BUILD-008/R83: cursor: not-allowed is preserved', () => {
  const rule = disabledRule(rules);
  assert.ok(/cursor\s*:\s*not-allowed/.test(rule.body));
});

test('CB-BUILD-008: gate logic itself is untouched -- aria-disabled wiring still gates screener Continue and the summon element picker exactly as before', async () => {
  const screenerSrc = await fs.readFile(path.join(APP_ROOT, 'ui', 'screens', 'screener.js'), 'utf8');
  assert.ok(/'aria-disabled':\s*!dobValid \|\| submitting/.test(screenerSrc));
  const summonSrc = await fs.readFile(path.join(APP_ROOT, 'ui', 'screens', 'summon.js'), 'utf8');
  assert.ok(/'aria-disabled':\s*!element/.test(summonSrc));
});
