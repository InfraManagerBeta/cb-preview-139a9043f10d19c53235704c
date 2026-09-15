// app/tests/cb-build-007-alternate-treatments.test.js — CB-BUILD-007
// (docs/cb-build-patch-log.md): alternates are tested at the door (ad +
// landing creative, not in-game character art, R12/R18/R22), and behind the
// click they carry a CLEARLY-MARKED provisional stage instead of an
// unlabeled colored box. No character art is originated for either
// alternate. This file asserts all three per the ticket's scope:
//   1. door track -- ad + landing creative data present per treatment;
//   2. behind the click -- the provisional marking is wired into the
//      alternate combatant render, in the treatment's own voice, and never
//      an R1 string;
//   3. no alternate ever references incumbent character art.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTreatment } from '../engine/dataLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const incumbent = await loadTreatment('incumbent');
const adjacent = await loadTreatment('adjacent');
const far = await loadTreatment('far');

const FORBIDDEN = [/cheeze wizards/i, /cheese wizards/i, /\bcw\b/i];

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

// ---- 1. Door track: ad + landing creative present and working as data,
// per treatment (incumbent + both alternates) -- not in-game character art. ----

test('CB-BUILD-007 door track: every treatment carries landing creative as data (workingTitle, fixed acquisitionMessage, treatment-voiced landingSubhead) -- what app/ui/screens/landing.js renders', async () => {
  for (const [name, treatment] of [['incumbent', incumbent], ['adjacent', adjacent], ['far', far]]) {
    assert.ok(treatment.workingTitle && treatment.workingTitle.length > 0, `${name}: missing workingTitle (landing hero)`);
    assert.ok(treatment.logoMark && treatment.logoMark.length > 0, `${name}: missing logoMark (landing topbar)`);
    assert.ok(treatment.copy.acquisitionMessage && treatment.copy.acquisitionMessage.length > 0, `${name}: missing copy.acquisitionMessage (landing subhead line)`);
    assert.ok(treatment.copy.landingSubhead && treatment.copy.landingSubhead.length > 0, `${name}: missing copy.landingSubhead`);
  }
  const landingSrc = await read('ui/screens/landing.js');
  assert.ok(landingSrc.includes('treatment.workingTitle'), 'expected landing.js to render treatment.workingTitle');
  assert.ok(landingSrc.includes('treatment.copy.acquisitionMessage'), 'expected landing.js to render treatment.copy.acquisitionMessage');
  assert.ok(landingSrc.includes('treatment.copy.landingSubhead'), 'expected landing.js to render treatment.copy.landingSubhead');
});

test('CB-BUILD-007 door track: R11 fixes the acquisition message identically across every treatment (the ad\'s fixed message, R22)', () => {
  assert.equal(adjacent.copy.acquisitionMessage, incumbent.copy.acquisitionMessage);
  assert.equal(far.copy.acquisitionMessage, incumbent.copy.acquisitionMessage);
  assert.equal(incumbent.copy.acquisitionMessage, 'Outsmart for real money.');
});

test('CB-BUILD-007 door track: each alternate\'s door creative (working title + landing subhead) is treatment-voiced, not the incumbent\'s, and names no character art requirement', () => {
  for (const [name, treatment] of [['adjacent', adjacent], ['far', far]]) {
    assert.notEqual(treatment.workingTitle, incumbent.workingTitle, `${name}: workingTitle must not be the incumbent's`);
    assert.notEqual(treatment.copy.landingSubhead, incumbent.copy.landingSubhead, `${name}: landingSubhead must not be the incumbent's`);
  }
});

test('CB-BUILD-007 door track: docs/concept-cards.md records an ad-creative concept (headline + sub) for both selected alternates (A1 Scrapyard Kings, F1 Undercard) and the incumbent -- the door test\'s ad surface exists as reviewed brief data, not in-game art', async () => {
  const cards = await fs.readFile(path.join(APP_ROOT, '..', 'docs', 'concept-cards.md'), 'utf8');
  const adjacentSection = cards.slice(cards.indexOf('## A1'), cards.indexOf('## A2'));
  const farSection = cards.slice(cards.indexOf('## F1'), cards.indexOf('## F2'));
  const incumbentSection = cards.slice(cards.indexOf('## I '));
  for (const [name, section] of [['A1/adjacent', adjacentSection], ['F1/far', farSection], ['I/incumbent', incumbentSection]]) {
    assert.match(section, /Ad-creative concept/, `${name}: missing an Ad-creative concept entry`);
    assert.match(section, /outsmart for real money/i, `${name}: ad-creative concept must carry the fixed message (R11/R22)`);
  }
});

// ---- 2. Behind the click: a CLEARLY-MARKED provisional stage, not an ----
// ---- unlabeled colored box; complete skin over fixed mechanics.      ----

test('CB-BUILD-007 provisional stage: both alternates carry a non-empty, distinct, treatment-voiced copy.provisionalStageLabel; the incumbent\'s is unused (empty)', () => {
  assert.ok(adjacent.copy.provisionalStageLabel && adjacent.copy.provisionalStageLabel.length > 0, 'adjacent missing copy.provisionalStageLabel');
  assert.ok(far.copy.provisionalStageLabel && far.copy.provisionalStageLabel.length > 0, 'far missing copy.provisionalStageLabel');
  assert.notEqual(adjacent.copy.provisionalStageLabel, far.copy.provisionalStageLabel, 'provisional labels must be voiced per treatment, not shared verbatim');
  assert.equal(incumbent.copy.provisionalStageLabel, '', 'the incumbent renders shipped character art and should never show a provisional badge');
});

test('CB-BUILD-007 provisional stage: the label is plain, honest, and short (no apology, no exclamation, reads as a status not a wall of text)', () => {
  for (const [name, treatment] of [['adjacent', adjacent], ['far', far]]) {
    const label = treatment.copy.provisionalStageLabel;
    assert.ok(label.length <= 80, `${name}: provisionalStageLabel too long for a stage badge (${label.length} chars)`);
    assert.equal(label.includes('!'), false, `${name}: provisionalStageLabel should not read as an exclamation`);
    assert.equal(/sorry|apolog/i.test(label), false, `${name}: provisionalStageLabel should not apologize`);
    assert.match(label, /provisional|pending/i, `${name}: provisionalStageLabel must clearly mark itself as provisional/pending`);
  }
});

test('CB-BUILD-007 provisional stage: app/ui/components/battle/stage.js renders the badge on the non-incumbent placeholder path only (never on the incumbent\'s <img> art)', async () => {
  const src = await read('ui/components/battle/stage.js');
  assert.ok(src.includes('provisionalStageLabel'), 'expected stage.js to reference treatment.copy.provisionalStageLabel');
  assert.ok(src.includes('cb-provisional-stage') && src.includes('cb-provisional-badge'), 'expected stage.js to render a distinctly-classed provisional badge element');
  // The badge markup must live in the placeholder (non-incumbent) branch of
  // the isIncumbent ternary, not the incumbent's el('img', {...}) call.
  const imgCallStart = src.indexOf("el('img', {");
  const imgCallEnd = src.indexOf('})', imgCallStart) + 2;
  const imgCall = src.slice(imgCallStart, imgCallEnd);
  const placeholderStart = src.indexOf('cb-combatant-placeholder');
  const placeholderBranchEnd = src.indexOf(']);', placeholderStart) + 3;
  const placeholderBranch = src.slice(placeholderStart, placeholderBranchEnd);
  assert.ok(imgCallStart > -1 && imgCallEnd > imgCallStart, 'expected to find the incumbent el(\'img\', {...}) call');
  assert.equal(imgCall.includes('provisionalStageLabel'), false, 'the incumbent <img> call must not render the provisional badge');
  assert.ok(placeholderBranch.includes('provisionalStageLabel'), 'the placeholder branch must render the provisional badge');
});

test('CB-BUILD-007 provisional stage: styles/battle.css gives the badge a visibly distinct treatment (dashed border tag), confined to .cb-provisional-stage/.cb-provisional-badge (not applied to .cb-combatant-gif)', async () => {
  const css = await read('styles/battle.css');
  assert.ok(css.includes('.cb-provisional-badge'), 'expected a .cb-provisional-badge rule');
  assert.ok(css.includes('.cb-combatant-placeholder.cb-provisional-stage'), 'expected the provisional layout rule scoped to the placeholder + provisional-stage classes');
  assert.equal(/\.cb-combatant-gif[^{]*\.cb-provisional/.test(css), false, 'the provisional styling must not touch the incumbent gif element');
});

test('CB-BUILD-007 provisional stage: the mapping.json narrative for the alternates\' fiction still matches (placeholder-art, no bundled renders) -- R13 mapping stays honest about what CB-BUILD-007 changed (labeling, not the art situation)', async () => {
  const mapping = JSON.parse(await fs.readFile(path.join(APP_ROOT, 'data', 'treatments', 'mapping.json'), 'utf8'));
  assert.match(mapping.theme.fiction.adjacent, /placeholder-art/i);
  assert.match(mapping.theme.fiction.far, /placeholder-art/i);
});

// ---- 3. No alternate ever references incumbent character art; no ----
// ---- character art is originated for either alternate.            ----

test('CB-BUILD-007: neither adjacent.json nor far.json references the incumbent\'s bundled art path or gif assets', () => {
  const serialized = { adjacent: JSON.stringify(adjacent), far: JSON.stringify(far) };
  for (const [name, text] of Object.entries(serialized)) {
    assert.equal(/cw-asset-bundle/i.test(text), false, `${name}.json must not reference the incumbent's asset bundle path`);
    assert.equal(/\.gif/i.test(text), false, `${name}.json must not reference a gif asset (incumbent-only art format)`);
  }
});

test('CB-BUILD-007: the placeholder combatant render path never calls incumbentGifUrl/incumbentPortraitUrl (no character art originated or borrowed for the alternates)', async () => {
  const stageSrc = await read('ui/components/battle/stage.js');
  const placeholderBranch = stageSrc.slice(stageSrc.indexOf('cb-combatant-placeholder'));
  assert.equal(placeholderBranch.includes('incumbentGifUrl'), false);
  assert.equal(placeholderBranch.includes('incumbentPortraitUrl'), false);
});

// ---- 4. R1 scan still clean (provisional-stage strings are new ----
// ---- participant-facing render, so they must be scanned too).    ----

test('CB-BUILD-007: R1 scan stays clean over the new provisional-stage copy and the touched stage.js/battle.css files', async () => {
  const files = [
    ['adjacent.copy.provisionalStageLabel', adjacent.copy.provisionalStageLabel],
    ['far.copy.provisionalStageLabel', far.copy.provisionalStageLabel],
    ['incumbent.copy.provisionalStageLabel', incumbent.copy.provisionalStageLabel],
  ];
  for (const [label, value] of files) {
    for (const re of FORBIDDEN) assert.equal(re.test(value), false, `${label} matched forbidden pattern ${re}`);
  }
  const stageSrc = await read('ui/components/battle/stage.js');
  const cssSrc = await read('styles/battle.css');
  for (const [label, text] of [['stage.js', stageSrc], ['battle.css', cssSrc]]) {
    for (const re of FORBIDDEN) assert.equal(re.test(text), false, `${label} matched forbidden pattern ${re}`);
  }
});
