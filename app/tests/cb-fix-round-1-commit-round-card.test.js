// app/tests/cb-fix-round-1-commit-round-card.test.js
// CB-BUILD-fix-round-1 #2: the commit screen's five round cards must not
// share a class with the reveal side's `.cb-round-card` (battle.css) —
// battle.css loads AFTER base.css (index.html), so a shared class let the
// reveal's mono flex row (6px padding, 12px mono face) silently re-cramp
// the commit screen and defeat CB-BUILD-011's breathing room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const duelSrc = fs.readFileSync(path.join(process.cwd(), 'app/ui/screens/duel.js'), 'utf8');
const baseCss = fs.readFileSync(path.join(process.cwd(), 'app/styles/base.css'), 'utf8');
const battleCss = fs.readFileSync(path.join(process.cwd(), 'app/styles/battle.css'), 'utf8');
const railsSrc = fs.readFileSync(path.join(process.cwd(), 'app/ui/components/battle/rails.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(process.cwd(), 'app/index.html'), 'utf8');

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

test('CB-BUILD-fix-round-1 #2: the commit screen uses its own round-card class, not the reveal\'s .cb-round-card', () => {
  const buildBody = duelSrc.slice(duelSrc.indexOf('function buildCommitScreen'), duelSrc.indexOf('function selectMove'));
  assert.ok(buildBody.includes("class: 'cb-card cb-commit-round-card'"), 'expected the commit screen\'s five cards to use cb-commit-round-card');
  assert.ok(!/class:\s*'[^']*\bcb-round-card\b/.test(buildBody), 'the commit screen must not use the reveal side\'s cb-round-card class');
});

test('CB-BUILD-fix-round-1 #2: no cross-stylesheet collision — the commit card class is defined only in base.css, the reveal card class only in battle.css', () => {
  const baseClasses = classesDefined(baseCss);
  const battleClasses = classesDefined(battleCss);
  assert.ok(baseClasses.has('cb-commit-round-card'), 'base.css must style .cb-commit-round-card');
  assert.ok(!battleClasses.has('cb-commit-round-card'), 'battle.css must NOT style .cb-commit-round-card (that would recreate the collision)');
  assert.ok(!baseClasses.has('cb-round-card'), 'base.css must NOT style .cb-round-card (the reveal-side class belongs to battle.css alone)');
  assert.ok(battleClasses.has('cb-round-card'), 'battle.css keeps the reveal side\'s .cb-round-card');
});

test('CB-BUILD-fix-round-1 #2: the reveal side (rails.js) still uses .cb-round-card, and battle.css still loads after base.css (the collision-order precondition this fix defuses)', () => {
  assert.ok(railsSrc.includes('cb-round-card'), 'rails.js keeps the reveal-side round cards untouched');
  const baseIdx = indexHtml.indexOf('styles/base.css');
  const battleIdx = indexHtml.indexOf('styles/battle.css');
  assert.ok(baseIdx > -1 && battleIdx > baseIdx, 'index.html loads base.css before battle.css');
});

test('CB-BUILD-fix-round-1 #2: CB-BUILD-011\'s breathing room is live again — the commit card rule keeps its padding and the rounds section its gap', () => {
  const cardRule = baseCss.match(/\.cb-commit-round-card\s*\{([^}]+)\}/s);
  assert.ok(cardRule, 'expected a .cb-commit-round-card rule in base.css');
  assert.match(cardRule[1], /padding-bottom:\s*18px/, 'expected the 18px breathing-room padding CB-BUILD-011 added');
  const roundsRule = baseCss.match(/\.cb-commit-rounds\s*\{([^}]+)\}/s);
  assert.ok(roundsRule && /gap:\s*\d+px/.test(roundsRule[1]), 'expected the rounds section gap to survive');
});
