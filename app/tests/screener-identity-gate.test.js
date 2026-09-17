// app/tests/screener-identity-gate.test.js — CB-BUILD-001/R70: the screener
// no longer asks jurisdiction as a self-report checkbox and no longer asks
// age as a raw checkbox. This reproduces the defect first (structural scan:
// no jurisdiction question, no age checkbox survive), then verifies the two
// pure decision functions the fix introduces (computeAge18, from a date of
// birth; simulateLocationVerdict, a DETECTED verdict, never a question) plus
// end-to-end behavior through Game#submitScreener, whose idempotency-key
// scheme (game.js) is untouched by this patch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAge18, simulateLocationVerdict } from '../ui/screens/screener.js';
import { Game } from '../engine/game.js';
import { Ledger, createMemoryStorage } from '../engine/ledger.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

async function read(rel) {
  return fs.readFile(path.join(APP_ROOT, rel), 'utf8');
}

const tunables = await loadTunables();
const treatment = await loadTreatment('incumbent');
function freshGame(seed = 1) {
  const ledger = new Ledger(createMemoryStorage());
  return new Game({ ledger, tunables, treatment, playerId: 'p1', seed });
}

// ---- defect reproduction: structural scan over the shipped source --------

test('CB-BUILD-001/R70 (defect repro): the screener source no longer asks a jurisdiction self-report question', async () => {
  const src = await read('ui/screens/screener.js');
  assert.ok(!/jurisdictionOk\s*=\s*e\.target\.checked/.test(src), 'expected no jurisdiction checkbox wiring');
  assert.ok(!/screenerJurisdictionQuestion/.test(src), 'expected the screener to never render the jurisdiction self-report copy (R70: never a question the player answers)');
});

test('CB-BUILD-001/R70 (defect repro): the screener source no longer has an age self-report checkbox -- age comes from a DOB entry', async () => {
  const src = await read('ui/screens/screener.js');
  assert.ok(!/age18\s*=\s*e\.target\.checked/.test(src), 'expected no age checkbox wiring');
  assert.ok(!/screenerAgeQuestion/.test(src), 'expected the screener to never render the age self-report checkbox copy');
  assert.ok(/type:\s*'date'/.test(src), 'expected a date-of-birth <input type="date"> entry');
});

test('CB-BUILD-001/R70: submitScreener keeps its idempotency key scheme untouched (game.js unmodified by this patch)', async () => {
  const src = await read('engine/game.js');
  assert.ok(/actionKey\('screener', this\.playerId, attempt\)/.test(src), 'expected the exact pre-existing per-attempt idempotency key to survive');
});

// ---- computeAge18: DOB attestation, not a checkbox ------------------------

test('CB-BUILD-001/R70: computeAge18 attests age from date of birth (exact boundary: birthday today counts, one day early does not)', () => {
  const now = Date.UTC(2026, 8, 14); // 2026-09-14
  assert.equal(computeAge18('2008-09-14', now), true, 'turns 18 today -> 18+');
  assert.equal(computeAge18('2008-09-15', now), false, 'turns 18 tomorrow -> not yet 18');
  assert.equal(computeAge18('2000-01-01', now), true, 'well over 18');
  assert.equal(computeAge18('2015-01-01', now), false, 'well under 18');
});

test('CB-BUILD-001/R70: computeAge18 is false for an empty or unparseable DOB (never defaults to passing)', () => {
  assert.equal(computeAge18(''), false);
  assert.equal(computeAge18(null), false);
  assert.equal(computeAge18('not-a-date'), false);
});

// ---- simulateLocationVerdict: DETECTED, never a question ------------------

test('CB-BUILD-001/R70: simulateLocationVerdict presents a DETECTED verdict by default (the play-money build has no permitted-set data to reject against)', () => {
  const verdict = simulateLocationVerdict({});
  assert.equal(verdict.permitted, true);
  assert.ok(verdict.region, 'expected a detected-region label, presented, not asked');
});

test('CB-BUILD-001/R70: simulateLocationVerdict supports the shipped "not available in your region" outcome via an injected detector (never rendered as a question)', () => {
  const verdict = simulateLocationVerdict({ detectLocation: () => ({ permitted: false, region: 'XX' }) });
  assert.equal(verdict.permitted, false);
});

// ---- end to end through Game#submitScreener --------------------------------

test('CB-BUILD-001/R70: a detected-permitted verdict + an 18+ DOB passes the screener exactly as the old both-checkboxes-true path did', () => {
  const game = freshGame();
  const verdict = simulateLocationVerdict({});
  const age18 = computeAge18('1990-01-01', 1_800_000_000_000);
  const result = game.submitScreener({ age18, jurisdictionOk: verdict.permitted }, 1000);
  assert.equal(result.passed, true);
});

test('CB-BUILD-001/R70: a not-permitted detected verdict fails the screener even with a valid 18+ DOB (the "not available in your region" outcome)', () => {
  const game = freshGame();
  const verdict = simulateLocationVerdict({ detectLocation: () => ({ permitted: false, region: 'XX' }) });
  const age18 = computeAge18('1990-01-01', 1_800_000_000_000);
  const result = game.submitScreener({ age18, jurisdictionOk: verdict.permitted }, 1000);
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes('jurisdiction_restricted'));
});

test('CB-BUILD-001/R70: an under-18 DOB fails the screener even with a permitted jurisdiction verdict', () => {
  const game = freshGame();
  const verdict = simulateLocationVerdict({});
  const age18 = computeAge18('2020-01-01', 1_800_000_000_000);
  const result = game.submitScreener({ age18, jurisdictionOk: verdict.permitted }, 1000);
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes('under_18'));
});
