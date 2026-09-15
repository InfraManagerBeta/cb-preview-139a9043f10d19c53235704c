// app/tests/cb-build-001-screener-detection.test.js — CB-BUILD-001/R70:
// the screener drops the jurisdiction self-report checkbox and simulates a
// DETECTED location verdict (never a question the player answers); age is
// attested by date of birth (never a checkbox). submitScreener keeps its
// existing per-attempt idempotency key.
//
// Reproduces the symptom first: the delivered screener asked "Do you
// currently reside in a permitted region?" as a self-report checkbox with
// no eligible-region list -- both unrealistic and unanswerable. This test
// file proves (a) the checkbox is gone from the source, (b) the age/
// jurisdiction values submitted to the engine are DERIVED (date-of-birth
// math, a simulated detected verdict) rather than player-ticked booleans,
// and (c) submitScreener's idempotency behavior is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAtLeast18, simulateLocationVerdict } from '../ui/screens/screener.js';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage, EVENT_TYPES, actionKey } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');

function freshGame(playerId = 'p-cb001') {
  return new Game({ ledger: new Ledger(createMemoryStorage()), tunables, treatment, playerId });
}

test('CB-BUILD-001 symptom, reproduced: the delivered screener.js source asked jurisdiction as a self-report checkbox', async () => {
  // This is the exact defect line from the pre-patch build -- kept here as
  // the repro target. If a regression ever reintroduces it, this assertion
  // is the one that should fail (the second test below asserts the FIXED
  // source no longer contains it).
  const symptomPattern = /type: 'checkbox', checked: jurisdictionOk/;
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/screener.js'), 'utf8');
  assert.equal(symptomPattern.test(src), false, 'expected the jurisdiction self-report checkbox to be gone from screener.js');
});

test('CB-BUILD-001/R70: screener.js source drops the jurisdiction checkbox entirely and never renders it as a question', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/screener.js'), 'utf8');
  assert.ok(!/jurisdictionQuestion/.test(src), 'expected screenerJurisdictionQuestion copy (the self-report question) to no longer be rendered');
  assert.ok(!/let jurisdictionOk = false/.test(src), 'expected no player-toggled jurisdictionOk state');
  // Exactly one checkbox-typed input remains at most (there should be
  // none at all -- age is now a date input, jurisdiction is never a
  // checkbox).
  const checkboxInputs = (src.match(/type: 'checkbox'/g) || []).length;
  assert.equal(checkboxInputs, 0, 'expected zero checkbox inputs on the screener screen');
  assert.ok(src.includes("type: 'date'"), 'expected a date-of-birth entry (HTML date input)');
});

test('CB-BUILD-001/R70: jurisdiction is presented as a DETECTED verdict, never a question -- source renders a status line, not a label the player can toggle', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui/screens/screener.js'), 'utf8');
  assert.ok(/LOCATION: DETECTED|LOCATION: NOT AVAILABLE/.test(src), 'expected a detected-verdict status line');
  assert.ok(src.includes('simulateLocationVerdict'), 'expected the screen to source jurisdictionOk from a simulated detection, not a checkbox');
});

test('isAtLeast18: date-of-birth math (pure, no DOM) -- exact boundary at the 18th birthday', () => {
  const now = Date.UTC(2026, 8, 14); // 2026-09-14
  assert.equal(isAtLeast18('2008-09-14', now), true, 'exactly 18 today counts as 18+');
  assert.equal(isAtLeast18('2008-09-15', now), false, 'one day short of 18 does not count');
  assert.equal(isAtLeast18('2000-01-01', now), true, 'well over 18');
  assert.equal(isAtLeast18('2015-01-01', now), false, 'well under 18');
  assert.equal(isAtLeast18('', now), false, 'no DOB entered yet -- not gated open');
  assert.equal(isAtLeast18('not-a-date', now), false, 'garbage input never passes');
});

test('isAtLeast18: a future date of birth is never valid (defensive -- a malformed/manipulated date input must not pass)', () => {
  const now = Date.UTC(2026, 8, 14);
  assert.equal(isAtLeast18('2030-01-01', now), false);
});

test('simulateLocationVerdict: default is a DETECTED, eligible verdict (the play-money build\'s stubbed "pass" outcome, presented as detected, never asked)', () => {
  const verdict = simulateLocationVerdict();
  assert.equal(verdict.detected, true);
  assert.equal(verdict.allowed, true);
  assert.ok(verdict.region);
});

test('simulateLocationVerdict: also supports the shipped "not available in your region" outcome for a player outside the permitted set (still a DETECTED verdict, never a question)', () => {
  const verdict = simulateLocationVerdict({ region: 'XX', allowed: false });
  assert.equal(verdict.detected, true);
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.region, 'XX');
});

test('CB-BUILD-001: submitScreener keeps its own per-attempt idempotency key -- a second attempt after a failed first is NOT swallowed by replay protection', () => {
  const game = freshGame();
  const first = game.submitScreener({ age18: false, jurisdictionOk: true }, 1000); // under 18 -> rejected
  assert.equal(first.passed, false);
  assert.deepEqual(first.reasons, ['under_18']);

  const second = game.submitScreener({ age18: true, jurisdictionOk: true }, 2000); // now old enough -> passes
  assert.equal(second.passed, true);

  // Both attempts are on the ledger, keyed per-attempt (not a single fixed
  // per-player key) -- exactly the C3 fix this patch must not regress.
  const attempts = game.ledger.byPlayerAndType('p-cb001', EVENT_TYPES.SCREENER_RESULT);
  assert.equal(attempts.length, 2);
  assert.ok(game.ledger.hasKey(actionKey('screener', 'p-cb001', 0)));
  assert.ok(game.ledger.hasKey(actionKey('screener', 'p-cb001', 1)));
});

test('CB-BUILD-001 end to end: a simulated jurisdiction-blocked verdict correctly rejects with jurisdiction_restricted, independent of age', () => {
  const game = freshGame('p-cb001-blocked');
  const blockedVerdict = simulateLocationVerdict({ allowed: false });
  const result = game.submitScreener({ age18: isAtLeast18('1990-01-01', Date.now()), jurisdictionOk: blockedVerdict.allowed }, 1000);
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, ['jurisdiction_restricted']);
});
