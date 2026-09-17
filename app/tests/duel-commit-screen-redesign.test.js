// app/tests/duel-commit-screen-redesign.test.js — CB-BUILD-011/R11/R79/R83:
// the move-choice (commit) screen craft pass. The mechanical fixes
// (CB-BUILD-004 prose face, CB-BUILD-005/006 rig stage, CB-BUILD-009
// prominent clock, CB-BUILD-010 in-place move tap) already landed; this
// covers the layout/typography restructuring on top of them: the opponent
// tendency card made readable, the five round pickers made roomy and
// card-like, the scouting panel (O3 card 1) given proper room, and a
// single hero moment (R79) with clear visual hierarchy. Static source/CSS
// scan (no DOM available in this harness -- same style as the existing
// structural UI tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

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

function ruleFor(rules, selectorExact) {
  return rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes(selectorExact));
}

function pxValue(body, prop) {
  const re = new RegExp(`(?:^|[^-])\\b${prop}\\s*:\\s*([0-9.]+)px`, 'i');
  const m = body.match(re);
  return m ? parseFloat(m[1]) : null;
}

let duelSrc;
let baseCss;
let rules;

test.before(async () => {
  duelSrc = await read('ui/screens/duel.js');
  baseCss = await read('styles/base.css');
  rules = parseRules(baseCss);
});

// ---- R79: one hero moment, clear hierarchy -------------------------------

test('CB-BUILD-011/R79: buildCommitScreen renders exactly one display-face hero moment (a single <h2>) -- no second title-weight element added by the redesign', () => {
  const commitScreenBody = duelSrc.slice(duelSrc.indexOf('function buildCommitScreen'), duelSrc.indexOf('// A17: the targeted per-tick update'));
  const h2Count = (commitScreenBody.match(/el\('h2'/g) || []).length;
  assert.equal(h2Count, 1, `expected exactly one h2 (the screen's one hero moment per R79), found ${h2Count}`);
  assert.ok(commitScreenBody.includes("el('h2', {}, `${character.name} vs ${opponentSeat.name}`)"), 'expected the hero moment to remain the character-vs-opponent title');
});

test('CB-BUILD-011/R79: a clear section break (data-face label) separates the opponent-info block from the five move pickers', () => {
  const commitScreenBody = duelSrc.slice(duelSrc.indexOf('function buildCommitScreen'), duelSrc.indexOf('// A17: the targeted per-tick update'));
  assert.ok(/cb-section-label/.test(commitScreenBody), 'expected a cb-section-label element in the mounted screen');
  const labelIdx = commitScreenBody.indexOf('cb-section-label');
  const roundCardsSpreadIdx = commitScreenBody.indexOf('...roundCards,');
  assert.ok(labelIdx > -1 && roundCardsSpreadIdx > -1 && labelIdx < roundCardsSpreadIdx, 'expected the section label to sit between the opponent info and the round pickers');
});

// ---- opponent tendency card: readable ------------------------------------

test('CB-BUILD-011/R11: dominantTendencyPhrase() derives a plain-language PROSE sentence from the SAME opponentSeat.tendency object the data-face figures already use -- no new data, no engine change', () => {
  assert.ok(duelSrc.includes('function dominantTendencyPhrase(tendency)'), 'expected a dominantTendencyPhrase helper');
  const fnBody = duelSrc.slice(duelSrc.indexOf('function dominantTendencyPhrase'), duelSrc.indexOf('function dominantTendencyPhrase') + 700);
  assert.ok(/Object\.entries\(tendency\)\.sort/.test(fnBody), 'expected the helper to derive its answer from the tendency object itself, not fabricate one');
  assert.ok(/Leans \$\{label\}/.test(fnBody), 'expected a plain-language "Leans <Element>" sentence');
});

test('CB-BUILD-011/R11: the tendency card renders the plain-language sentence in the PROSE face, with the raw F/W/A figures still in the DATA face below it (both present, distinct roles)', () => {
  const commitScreenBody = duelSrc.slice(duelSrc.indexOf('function buildCommitScreen'), duelSrc.indexOf('// A17: the targeted per-tick update'));
  const tendencyCardIdx = commitScreenBody.indexOf('cb-tendency-card');
  assert.ok(tendencyCardIdx > -1, 'expected a cb-tendency-card wrapper');
  const cardBody = commitScreenBody.slice(tendencyCardIdx, commitScreenBody.indexOf('renderScoutingAndBrief'));
  assert.ok(/dominantTendencyPhrase\(opponentSeat\.tendency\)/.test(cardBody), 'expected the card to call dominantTendencyPhrase for its prose line');
  assert.ok(/'cb-prose'/.test(cardBody), 'expected the lean sentence to use the prose-face class');
  assert.ok(/F\/W\/A \$\{tendencyLabel\(opponentSeat\.tendency\)\}/.test(cardBody), 'expected the raw data-face F/W/A figure line to remain, unchanged in substance');
});

test('CB-BUILD-011: the tendency card gets a roomier CSS rule than the bare .cb-card default (more padding)', () => {
  const cardRule = ruleFor(rules, '.cb-tendency-card');
  assert.ok(cardRule, 'expected a .cb-tendency-card rule');
  const basePadding = pxValue(ruleFor(rules, '.cb-card').body, 'padding');
  const tendencyPadding = pxValue(cardRule.body, 'padding');
  assert.ok(tendencyPadding !== null && (basePadding === null || tendencyPadding >= basePadding), 'expected the tendency card\'s padding to be at least as roomy as the base card');
});

// ---- five round pickers: roomy and card-like -----------------------------

test('CB-BUILD-011/R83: each round renders as a cb-round-picker card (in addition to cb-card), and roundCardNodes/roundButtonGroups wiring (CB-BUILD-008/010) is untouched', () => {
  const commitScreenBody = duelSrc.slice(duelSrc.indexOf('function buildCommitScreen'), duelSrc.indexOf('// A17: the targeted per-tick update'));
  assert.ok(/const card = el\('div', \{ class: 'cb-card cb-round-picker' \}, \[/.test(commitScreenBody), 'expected each round\'s card to carry the cb-round-picker class alongside cb-card');
  assert.ok(/roundButtonGroups\.push\(group\);/.test(commitScreenBody) && /roundCardNodes\.push\(card\);/.test(commitScreenBody), 'expected the CB-BUILD-008/010 per-round wiring to remain');
});

test('CB-BUILD-011/R83: .cb-round-picker .cb-element-btn declares a roomier explicit min-height, still >=44px, and the shared .cb-element-row keeps >=8pt spacing', () => {
  const scopedRule = rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes('.cb-round-picker .cb-element-btn'));
  assert.ok(scopedRule, 'expected a .cb-round-picker .cb-element-btn rule');
  const minH = pxValue(scopedRule.body, 'min-height');
  assert.ok(minH !== null && minH >= 44, `expected min-height >= 44px, got ${minH}`);
  const baseElementBtnMinH = pxValue(ruleFor(rules, '.cb-element-btn').body, 'min-height');
  assert.ok(minH >= baseElementBtnMinH, 'expected the commit screen\'s move cards to be at least as roomy as the base element button');

  const rowRule = ruleFor(rules, '.cb-element-row');
  const gap = pxValue(rowRule.body, 'gap');
  assert.ok(gap !== null && gap >= 8, `expected .cb-element-row gap >= 8pt, got ${gap}`);
});

test('CB-BUILD-011/R83: the round card itself gets extra padding (roomier container around the "whole card is the target" moves), not just the buttons', () => {
  const roundPickerRule = ruleFor(rules, '.cb-round-picker');
  assert.ok(roundPickerRule, 'expected a .cb-round-picker rule');
  const padding = pxValue(roundPickerRule.body, 'padding');
  assert.ok(padding !== null && padding >= 16, `expected .cb-round-picker padding >= 16px (at least the base card\'s own padding), got ${padding}`);
});

// ---- scouting panel: proper room, not cramped mono -----------------------

test('CB-BUILD-011/R11: renderScoutingAndBrief\'s two descriptive sentences (W-L summary, affinity-play rate) render in the PROSE face, not the cramped data-face mono -- the per-round tag rows and section label stay data-face, unchanged', () => {
  const panelBody = duelSrc.slice(duelSrc.indexOf('function renderScoutingAndBrief'), duelSrc.indexOf('function renderCoinFlipVerification'));
  assert.ok(/el\('p', \{ class: 'cb-prose' \}, `\$\{opponentSeat\.name\}: \$\{summary\.wins\}/.test(panelBody), 'expected the W-L summary sentence to use the prose face');
  assert.ok(/el\('p', \{ class: 'cb-prose' \}, `Affinity-play rate:/.test(panelBody), 'expected the affinity-play-rate sentence to use the prose face');
  // Untouched: the per-round tag rows and the "PER-ROUND" section label stay cb-micro (data face) -- these are tags, not sentences.
  assert.ok(/'PER-ROUND \(most recent first\):'/.test(panelBody));
  assert.ok(panelBody.includes("rows.push(el('div', { class: 'cb-micro' }, line));"), 'expected the compact per-round tag rows to remain data-face');
});

test('CB-BUILD-011: renderScoutingAndBrief wraps its rows in cb-scouting-panel (in addition to cb-card) for real spacing between rows', () => {
  const panelBody = duelSrc.slice(duelSrc.indexOf('function renderScoutingAndBrief'), duelSrc.indexOf('function renderCoinFlipVerification'));
  assert.ok(/return el\('div', \{ class: 'cb-card cb-scouting-panel' \}, rows\);/.test(panelBody), 'expected the panel wrapper to carry cb-scouting-panel');
});

test('CB-BUILD-011: .cb-scouting-panel declares a real gap between rows (flex column + gap), not a flush zero-margin stack', () => {
  const rule = ruleFor(rules, '.cb-scouting-panel');
  assert.ok(rule, 'expected a .cb-scouting-panel rule');
  assert.match(rule.body, /display:\s*flex/);
  assert.match(rule.body, /flex-direction:\s*column/);
  const gapMatch = rule.body.match(/gap\s*:\s*([0-9.]+)px/);
  assert.ok(gapMatch && parseFloat(gapMatch[1]) >= 6, 'expected a real (>=6px) gap between the panel\'s rows');
});

// ---- absolute boundary: no new match-history depth -----------------------

test('boundary: the scouting panel still calls opponentDuelHistory with the SAME cap (10) and still slices to at most 5 rows for display -- the redesign did not add match-history depth', () => {
  const panelBody = duelSrc.slice(duelSrc.indexOf('function renderScoutingAndBrief'), duelSrc.indexOf('function renderCoinFlipVerification'));
  assert.ok(panelBody.includes('opponentDuelHistory(ledgerEvents, opponentSeat.characterId, 10)'), 'expected the same 10-event ledger lookup cap as before');
  assert.ok(panelBody.includes('history.slice(0, 5)'), 'expected the same 5-row display cap as before');
});

test('boundary: no new import was added that would pull in deeper opponent match-history/scouting machinery', () => {
  const importBlock = duelSrc.slice(0, duelSrc.indexOf('const COMMIT_CLOCK_DANGER_MS'));
  assert.ok(importBlock.includes("import { opponentDuelHistory, summarizeOpponentHistory, hypothesisCard } from '../../engine/hypotheses.js';"), 'expected the same hypotheses.js import surface as before, nothing added');
});
