// app/tests/screener-region-copy.test.js — CB-BUILD-001/R70 fix round (C1):
// "never as a question the player answers; no screen asks the player to
// declare a region." `screenerBody` (all three treatments) used to read "A
// couple of quick questions — age and location — ..." -- literally framing
// the location check as one of two questions the player answers, alongside
// the actual question (DOB). Fixed: rewritten per-treatment so age is named
// as the player's own entry while location is named as checked/detected
// automatically, never a question. This reads the RENDERED screener copy
// (through the real `el()`/`mountScreen()`, via the shared fake-DOM
// harness) for question-framing about location, not just the source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTreatment } from '../engine/dataLoader.js';
import { installFakeDom, uninstallFakeDom, renderedText } from './helpers/dom-harness.js';

let mountScreener;

test.before(async () => {
  installFakeDom();
  ({ mountScreener } = await import('../ui/screens/screener.js'));
});
test.after(() => { uninstallFakeDom(); });

const TREATMENTS = ['incumbent', 'adjacent', 'far'];

// A location-as-question framing looks like "location —" immediately
// followed by a question mark somewhere nearby, or the word "question"/
// "questions" anywhere near "location", or "declare"/"tell us"/"which
// region" phrasing. Broad enough to catch the exact defect shape and its
// straightforward rephrasings, narrow enough not to trip on "location is
// checked automatically" (the fixed copy).
const LOCATION_AS_QUESTION_RE = /location[^.]*\?|questions?\b[^.]*\blocation\b|\blocation\b[^.]*\bquestions?\b|declare (your |a )?region|which region|tell us (your |where)/i;

for (const id of TREATMENTS) {
  test(`C1/R70: ${id}.json's RENDERED screenerBody never frames location as a question the player answers`, async () => {
    const treatment = await loadTreatment(id);
    mountScreener({ treatment });
    const text = renderedText(document.getElementById('app'));
    assert.ok(text.includes(treatment.copy.screenerBody), 'expected screenerBody to actually render on the screener');
    assert.ok(!LOCATION_AS_QUESTION_RE.test(text), `expected no question-framing about location in the rendered screener copy, got: "${text}"`);
  });

  test(`C1/R70: ${id}.json's screenerBody affirmatively states location is checked/detected automatically (not silently dropped, actually re-framed)`, async () => {
    const treatment = await loadTreatment(id);
    assert.match(treatment.copy.screenerBody.toLowerCase(), /location (is )?(checked|detected)/, `${id}: expected screenerBody to name location as checked/detected automatically`);
  });

  test(`C1/R70: ${id}.json's screenerBody still names age as the player's own entry (the DOB field), not silently dropped`, async () => {
    const treatment = await loadTreatment(id);
    assert.match(treatment.copy.screenerBody.toLowerCase(), /date of birth|\bage\b/, `${id}: expected screenerBody to still mention the age/DOB entry`);
  });
}

test('C1/R70: sanity -- the OLD defect shape ("A couple of quick questions — age and location") would have failed this test\'s regex', () => {
  const old = 'A couple of quick questions — age and location — before we let you into the arena.';
  assert.ok(LOCATION_AS_QUESTION_RE.test(old), 'expected the scanner to actually catch the shipped defect shape');
});
