// app/tests/theme-door-creative.test.js — CB-BUILD-007 track 1/R12/R18/R22:
// "the theme door test can run now: it is a door test (door yield), which
// needs ad + landing creative per treatment, not in-game character art."
// Covers (1) each treatment's adCreative product-data block (fixed
// acquisition message + theme-bound headline/body/CTA + a non-character
// visual composition spec), (2) landing.js carrying that creative in full,
// (3) the alternates' clearly-marked provisional battle-stage label
// (incumbent untouched), and (4) mapping.json's R13 record.
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

async function read(rel) { return fs.readFile(path.join(APP_ROOT, rel), 'utf8'); }

// ---- adCreative: product data, schema parity -----------------------------

test('every treatment carries an adCreative block (product data, not hardcoded UI copy)', () => {
  for (const t of [incumbent, adjacent, far]) {
    assert.ok(t.adCreative, `${t.id} missing adCreative`);
    for (const field of ['fixedMessage', 'headline', 'body', 'cta', 'visual']) {
      assert.ok(t.adCreative[field], `${t.id}.adCreative missing ${field}`);
    }
  }
});

test('R11 [LAW]: adCreative.fixedMessage is the identical "outsmart for real money" string in all three treatments, matching copy.acquisitionMessage', () => {
  for (const t of [incumbent, adjacent, far]) {
    assert.equal(t.adCreative.fixedMessage, t.copy.acquisitionMessage, `${t.id}: adCreative.fixedMessage must match copy.acquisitionMessage exactly`);
  }
  assert.equal(incumbent.adCreative.fixedMessage, adjacent.adCreative.fixedMessage);
  assert.equal(incumbent.adCreative.fixedMessage, far.adCreative.fixedMessage);
  assert.equal(incumbent.adCreative.fixedMessage, 'Outsmart for real money.');
});

test('R12: headline/body/cta are theme-bound -- distinct per treatment, and in the treatment\'s own vocabulary (world noun/working-title register)', () => {
  const headlines = [incumbent, adjacent, far].map((t) => t.adCreative.headline);
  const bodies = [incumbent, adjacent, far].map((t) => t.adCreative.body);
  const ctas = [incumbent, adjacent, far].map((t) => t.adCreative.cta);
  assert.equal(new Set(headlines).size, 3, 'expected three distinct headlines');
  assert.equal(new Set(bodies).size, 3, 'expected three distinct bodies');
  assert.equal(new Set(ctas).size, 3, 'expected three distinct CTAs');
  // Register check: each treatment's body mentions ITS OWN role noun (character/stakeUnit), never another treatment's.
  assert.match(adjacent.adCreative.body, /\bBot\b|\bscrap\b/i);
  assert.match(far.adCreative.body, /\bFighter\b|\bpurse\b/i);
  assert.match(incumbent.adCreative.body, /\bWizard\b|\bpot\b/i);
});

test('R12 boundary: adCreative.visual is a composition spec built from NON-character assets only (color/logoMark/type roles) -- the STRUCTURAL fields carry no character-art reference (documentation "_note" strings are free to explain the boundary in prose and are excluded from this scan)', () => {
  for (const t of [incumbent, adjacent, far]) {
    const visual = t.adCreative.visual;
    assert.ok(visual.backgroundColorRole in t.colors, `${t.id}: visual.backgroundColorRole must name a real color role`);
    assert.ok(visual.accentColorRole in t.colors, `${t.id}: visual.accentColorRole must name a real color role`);
    assert.equal(visual.logoMark, t.logoMark, `${t.id}: visual.logoMark must match the treatment's own logoMark`);
    assert.ok(['display', 'data', 'prose', 'heroFace'].includes(visual.headlineFace));
    assert.ok(['display', 'data', 'prose', 'heroFace'].includes(visual.bodyFace));
    // No character-art STRUCTURAL keys/values (excluding the "_note" doc string, which is free to name the boundary in prose).
    const structural = Object.fromEntries(Object.entries(visual).filter(([k]) => !k.startsWith('_')));
    const keys = JSON.stringify(structural).toLowerCase();
    assert.ok(!keys.includes('character') && !keys.includes('illustrat') && !keys.includes('artwork'), `${t.id}: visual spec's structural fields must not reference character art/illustration`);
  }
});

// ---- landing.js: carries the door creative in full -----------------------

test('landing.js renders the treatment\'s adCreative headline/body/cta, alongside the still-fixed R11 acquisition message and the R8a truth line', async () => {
  const src = await read('ui/screens/landing.js');
  assert.ok(src.includes('const ad = treatment.adCreative;'), 'expected landing.js to read the treatment\'s adCreative block');
  assert.ok(src.includes('treatment.copy.acquisitionMessage'), 'expected the R11-fixed acquisition message to remain, untouched');
  assert.ok(/ad\s*\?[\s\S]*?ad\.headline/.test(src), 'expected the treatment\'s own headline to render');
  assert.ok(/ad\s*\?\s*ad\.body\s*:\s*treatment\.copy\.landingSubhead/.test(src), 'expected the treatment\'s own body to render (falling back to the pre-existing subhead if adCreative is ever absent)');
  assert.ok(/ad\s*\?\s*ad\.cta\s*:\s*'Play'/.test(src), 'expected the treatment\'s own CTA label to render on the button');
  assert.ok(src.includes('treatment.copy.truthLine'), 'expected the R8a truth line to remain intact');
  assert.ok(src.includes('treatment.workingTitle'), 'expected the working title to remain the hero moment');
});

test('landing.js\'s treatment headline does not introduce a second hero-moment face -- only the working title <h1> carries cb-hero-face', async () => {
  const src = await read('ui/screens/landing.js');
  const heroFaceCount = (src.match(/cb-hero-face/g) || []).length;
  assert.equal(heroFaceCount, 1, `expected exactly one cb-hero-face usage (the workingTitle h1), found ${heroFaceCount}`);
});

// ---- alternates' provisional battle-stage label --------------------------

test('R12: adjacent.json / far.json each carry a provisionalStageLine (treatment-voiced, honest, "final art pending"); incumbent.json carries none (real rig art, never provisional)', () => {
  assert.equal(incumbent.provisionalStageLine, undefined, 'expected the incumbent to have no provisionalStageLine at all');
  for (const t of [adjacent, far]) {
    assert.ok(t.provisionalStageLine && t.provisionalStageLine.length > 0, `${t.id}: missing provisionalStageLine`);
    assert.match(t.provisionalStageLine.toLowerCase(), /provisional/);
    assert.match(t.provisionalStageLine.toLowerCase(), /pending/);
  }
  assert.notEqual(adjacent.provisionalStageLine, far.provisionalStageLine, 'expected the two alternates to voice the line differently (treatment-bound)');
});

test('stage.js exports renderProvisionalStageNotice, returning null for a treatment without the line (the incumbent) and a rendered node otherwise', async () => {
  const src = await read('ui/components/battle/stage.js');
  assert.ok(src.includes('export function renderProvisionalStageNotice(treatment)'));
  const fnBody = src.slice(src.indexOf('export function renderProvisionalStageNotice'));
  assert.ok(/if \(!treatment \|\| !treatment\.provisionalStageLine\) return null;/.test(fnBody), 'expected a defensive null-return for a treatment without the line');
  assert.ok(/treatment\.provisionalStageLine/.test(fnBody), 'expected the rendered node to read the treatment\'s own line');
});

test('duel.js renders the provisional-stage notice ONLY on the alternates\' placeholder stage branch (the final else, non-rig), never inside the useRig&&rigStage branch (the incumbent\'s real art)', async () => {
  const duelSrc = await read('ui/screens/duel.js');
  assert.ok(duelSrc.includes("renderProvisionalStageNotice } from '../components/battle/stage.js';") || /renderProvisionalStageNotice/.test(duelSrc), 'expected duel.js to import renderProvisionalStageNotice');
  const rigBranch = duelSrc.slice(duelSrc.indexOf('} else if (useRig && rigStage) {'), duelSrc.indexOf('} else {\n        const displayStep = step || { state: \'battleIdle\' };'));
  assert.ok(!rigBranch.includes('renderProvisionalStageNotice'), 'expected the incumbent\'s rig-stage branch to NEVER call renderProvisionalStageNotice');
  const placeholderBranch = duelSrc.slice(duelSrc.indexOf('} else {\n        const displayStep = step || { state: \'battleIdle\' };'), duelSrc.indexOf('const skipVisible ='));
  assert.ok(placeholderBranch.includes('renderProvisionalStageNotice(treatment)'), 'expected the alternates\' placeholder-stage branch to call renderProvisionalStageNotice(treatment)');
});

// ---- mapping.json: R13 record ---------------------------------------------

test('mapping.json records the adCreative mapping (fixedMessage/headline/cta/provisionalStageLine per treatment), matching each treatment.json byte-for-byte', async () => {
  const mapping = JSON.parse(await fs.readFile(path.join(APP_ROOT, 'data', 'treatments', 'mapping.json'), 'utf8'));
  assert.ok(mapping.theme.adCreative, 'expected mapping.json theme.adCreative to exist');
  assert.equal(mapping.theme.adCreative.headline.incumbent, incumbent.adCreative.headline);
  assert.equal(mapping.theme.adCreative.headline.adjacent, adjacent.adCreative.headline);
  assert.equal(mapping.theme.adCreative.headline.far, far.adCreative.headline);
  assert.equal(mapping.theme.adCreative.cta.incumbent, incumbent.adCreative.cta);
  assert.equal(mapping.theme.adCreative.cta.adjacent, adjacent.adCreative.cta);
  assert.equal(mapping.theme.adCreative.cta.far, far.adCreative.cta);
  assert.equal(mapping.theme.adCreative.provisionalStageLine.adjacent, adjacent.provisionalStageLine);
  assert.equal(mapping.theme.adCreative.provisionalStageLine.far, far.provisionalStageLine);
  assert.equal(mapping.theme.adCreative.provisionalStageLine.incumbent, null);
});

// N-A2 fold (R13): screenerNotAvailableMessage and stageDegradedNotice are
// two more theme-voiced copy strings (each substitutes only the role
// noun/workingTitle through an otherwise-fixed sentence shape, same as
// provisionalStageLine above) -- recorded here in the same
// one-screen-comparison shape mapping.json already established for
// provisionalStageLine, matching each treatment.json's `copy.*` value
// byte-for-byte.
test('mapping.json records screenerNotAvailableMessage and stageDegradedNotice per treatment (R13 fold), matching each treatment.json\'s copy.* byte-for-byte, same shape as provisionalStageLine', async () => {
  const mapping = JSON.parse(await fs.readFile(path.join(APP_ROOT, 'data', 'treatments', 'mapping.json'), 'utf8'));
  const notices = mapping.theme.otherThemeVoicedNotices;
  assert.ok(notices, 'expected mapping.json theme.otherThemeVoicedNotices to exist');

  for (const [field, treatment] of [
    ['screenerNotAvailableMessage', incumbent], ['screenerNotAvailableMessage', adjacent], ['screenerNotAvailableMessage', far],
    ['stageDegradedNotice', incumbent], ['stageDegradedNotice', adjacent], ['stageDegradedNotice', far],
  ]) {
    assert.ok(notices[field], `expected mapping.json theme.otherThemeVoicedNotices.${field} to exist`);
    assert.equal(notices[field][treatment.id], treatment.copy[field], `expected mapping.json's recorded ${field}.${treatment.id} to match ${treatment.id}.json's copy.${field} exactly`);
  }

  // Same "one substituted noun, otherwise fixed shape" property
  // provisionalStageLine already demonstrates: the three treatments'
  // values must differ (theme-bound) yet share the fixed sentence tail.
  assert.notEqual(incumbent.copy.screenerNotAvailableMessage, adjacent.copy.screenerNotAvailableMessage);
  assert.notEqual(adjacent.copy.screenerNotAvailableMessage, far.copy.screenerNotAvailableMessage);
  for (const t of [incumbent, adjacent, far]) {
    assert.match(t.copy.screenerNotAvailableMessage, /Nothing was charged and nothing was saved beyond this screening result\.$/);
  }
  assert.notEqual(incumbent.copy.stageDegradedNotice, adjacent.copy.stageDegradedNotice);
  assert.notEqual(adjacent.copy.stageDegradedNotice, far.copy.stageDegradedNotice);
  for (const t of [incumbent, adjacent, far]) {
    assert.match(t.copy.stageDegradedNotice, /still plays out right here, blow by blow\.$/);
  }
});

// ---- absolute boundary: no character art introduced -----------------------

test('boundary: neither adCreative nor provisionalStageLine references character art, illustration, or AI-generated art anywhere in any treatment file', async () => {
  for (const [name, file] of [['incumbent', 'incumbent.json'], ['adjacent', 'adjacent.json'], ['far', 'far.json']]) {
    const raw = await read(path.join('data', 'treatments', file));
    const parsed = JSON.parse(raw);
    const blob = JSON.stringify({ adCreative: parsed.adCreative || null, provisionalStageLine: parsed.provisionalStageLine || null }).toLowerCase();
    assert.ok(!blob.includes('illustrat'), `${name}: adCreative/provisionalStageLine must not reference illustration`);
    assert.ok(!blob.includes('ai-generated') && !blob.includes('ai generated') && !blob.includes('ai art'), `${name}: must not reference AI-generated art`);
  }
});
