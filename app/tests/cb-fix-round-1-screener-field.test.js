// app/tests/cb-fix-round-1-screener-field.test.js
// CB-BUILD-fix-round-1 #7 (R79, R83/AC1): screener.js referenced
// `.cb-field-row` (and `.cb-location-verdict`) but NO shipped stylesheet
// defined them — the funnel's FIRST input (the DOB date field) rendered
// browser-default, outside the design frame and under the 44px tap bar,
// and the target-size scan skipped it (no declared sizes anywhere).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.join(process.cwd(), 'app');
const stylesheets = ['base.css', 'battle.css', 'console.css']
  .map((f) => fs.readFileSync(path.join(APP_ROOT, 'styles', f), 'utf8'));
const allCss = stylesheets.join('\n');
const screenerSrc = fs.readFileSync(path.join(APP_ROOT, 'ui/screens/screener.js'), 'utf8');

function classesReferenced(src) {
  const out = new Set();
  for (const m of src.matchAll(/class:\s*'([^']+)'/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls.startsWith('cb-')) out.add(cls);
  }
  return out;
}

function classesDefined(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set();
  const re = /([^{}]+)\{[^{}]*\}/g;
  let m;
  while ((m = re.exec(stripped))) {
    for (const cls of m[1].match(/\.[a-zA-Z0-9_-]+/g) || []) out.add(cls.slice(1));
  }
  return out;
}

test('CB-BUILD-fix-round-1 #7: EVERY class screener.js references exists in a shipped stylesheet (no design-frame orphans)', () => {
  const referenced = classesReferenced(screenerSrc);
  const defined = classesDefined(allCss);
  assert.ok(referenced.has('cb-field-row'), 'scan sanity: screener.js references cb-field-row');
  assert.ok(referenced.has('cb-location-verdict'), 'scan sanity: screener.js references cb-location-verdict');
  const orphans = [...referenced].filter((cls) => !defined.has(cls));
  assert.deepEqual(orphans, [], `screener.js references classes no shipped stylesheet defines: ${orphans.join(', ')}`);
});

test('CB-BUILD-fix-round-1 #7: the DOB field\'s input clears the 44px tap bar and sits in the design frame (R79)', () => {
  const baseCss = fs.readFileSync(path.join(APP_ROOT, 'styles', 'base.css'), 'utf8');
  const inputRule = baseCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.cb-field-row input\s*\{([^}]+)\}/s);
  assert.ok(inputRule, 'expected a .cb-field-row input rule in base.css');
  assert.match(inputRule[1], /min-height:\s*var\(--tap-min\)/, 'the input must declare the 44px (--tap-min) minimum (R83/AC1)');
  assert.match(inputRule[1], /font-family:\s*var\(--font-(data|prose)\)/, 'the input must use a design-frame face, not the browser default');
  assert.match(inputRule[1], /background:/, 'the input must be skinned inside the dark frame, not browser-default white');
  assert.match(baseCss, /--tap-min:\s*44px/, 'the --tap-min custom property is 44px');
});

test('CB-BUILD-fix-round-1 #7: .cb-location-verdict is styled intentionally (the detected-verdict status line, CB-BUILD-001/R70)', () => {
  const baseCss = fs.readFileSync(path.join(APP_ROOT, 'styles', 'base.css'), 'utf8');
  const rule = baseCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.cb-location-verdict\s*\{([^}]+)\}/s);
  assert.ok(rule, 'expected a .cb-location-verdict rule in base.css (or the class dropped from screener.js — it is still referenced)');
  assert.ok(rule[1].trim().length > 0, 'the rule must actually declare something');
});
