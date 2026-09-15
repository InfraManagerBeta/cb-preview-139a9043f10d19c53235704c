// app/tests/narrator.test.js — §9/R71-R73: format/voice/content discipline,
// the application layer (scan -> regenerate once -> static fallback,
// specificity check), and the exact R73 static bypass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDuel } from '../engine/duel.js';
import { buildMatchData, toXML, generateNarration, scanForbidden, specificityCheck, STATIC_FALLBACK } from '../engine/narrator.js';
import { loadTreatment, loadNarratorPrompt } from '../engine/dataLoader.js';

const treatment = await loadTreatment('incumbent');

test('narrator-prompt.txt ships the system prompt verbatim, unmodified', async () => {
  const prompt = await loadNarratorPrompt();
  assert.ok(prompt.startsWith('You are the Narrator of Cheddar Battles — an ancient cheese archivist.'));
  assert.ok(prompt.includes('Never attribute outcomes to luck.'));
  assert.ok(prompt.includes('The ledger is permanent. The record travels.'));
});

test('scanForbidden: catches luck words, exclamation points, direct address, and house/product mentions', () => {
  assert.ok(scanForbidden('What a lucky round!').length > 0);
  assert.ok(scanForbidden('Unfortunately, you lost.').length > 0);
  assert.ok(scanForbidden('The house always wins.').length > 0);
  assert.ok(scanForbidden('Three rounds to two. The ledger records it.').length === 0);
});

test('R73 static bypass: identical element committed all five rounds serves one of the two verbatim lines', () => {
  const outcome = resolveDuel({ mv1: [0, 0, 0, 0, 0], mv2: [0, 0, 0, 0, 0], aff1: 1, aff2: 1, p1: 100, p2: 100, floor: 10 });
  assert.equal(outcome.identicalAllFive, true);
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });
  const seenA = generateNarration(matchData, { treatmentCopy: treatment.copy, random: () => 0.1 });
  const seenB = generateNarration(matchData, { treatmentCopy: treatment.copy, random: () => 0.9 });
  assert.equal(seenA.usedBypass, true);
  assert.equal(seenB.usedBypass, true);
  assert.equal(seenA.text, treatment.copy.narratorBypassA.replace('[ELEMENT]', 'Fire'));
  assert.equal(seenB.text, treatment.copy.narratorBypassB.replace(/\[EEEEE\]/g, 'FIRE'));
});

test('generateNarration: 2-5 sentences, passes the discipline scan, on a routine result', () => {
  const outcome = resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [2, 0, 1, 2, 0], aff1: 9, aff2: 9, p1: 100, p2: 100, floor: 10 });
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });
  const result = generateNarration(matchData, { treatmentCopy: treatment.copy });
  assert.equal(scanForbidden(result.text).length, 0);
  const sentenceCount = result.text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  assert.ok(sentenceCount >= 2 && sentenceCount <= 5, `expected 2-5 sentences, got ${sentenceCount}: ${result.text}`);
});

test('generateNarration: specificity check requires a number drawn from this exact match', () => {
  const outcome = resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [2, 0, 1, 2, 0], aff1: 9, aff2: 9, p1: 100, p2: 100, floor: 10 });
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });
  const result = generateNarration(matchData, { treatmentCopy: treatment.copy });
  assert.ok(specificityCheck(result.text, matchData) || result.text === STATIC_FALLBACK);
});

test('toXML: renders the R72 XML-record shape with pre-computed summary/flags', () => {
  const outcome = resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [2, 0, 1, 2, 0], aff1: 0, aff2: 9, p1: 100, p2: 100, floor: 10 });
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });
  const xml = toXML(matchData);
  assert.ok(xml.includes('<round number="1"'));
  assert.ok(xml.includes('<summary '));
  assert.ok(xml.includes('<flags '));
});

test('f5/crucial-4 fix: a true tie (score 0) reached via a MIXED matched sequence (fire,water,air,fire,water both sides — five different elements, never the same one all five rounds) is NOT identicalAllFive, gets NO R73 bypass, and falls through to a truthful register tie line instead', () => {
  // v1c's repro: the OLD identicalAllFive check (`mv1.every((m, i) => m ===
  // mv2[i])`) only tested round-by-round agreement between the two sides,
  // which this sequence satisfies (every round is a mirror-match draw) --
  // but R73's actual bypass condition is "both characters commit the
  // IDENTICAL ELEMENT all five rounds" (the SAME one element, both sides,
  // every round), which this sequence does NOT satisfy (it cycles through
  // fire/water/air). The old code wrongly fired the bypass here, printing a
  // factually false "[ELEMENT] versus [ELEMENT], all five rounds" line for
  // a duel that visited three different elements.
  const outcome = resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [0, 1, 2, 0, 1], aff1: 9, aff2: 9, p1: 100, p2: 100, floor: 10, random: () => 0.2 });
  assert.equal(outcome.trueTie, true, 'expected this mirror-match sequence to still be a true tie (score 0)');
  assert.equal(outcome.identicalAllFive, false, 'expected identicalAllFive to be FALSE for a mixed (non-constant) matched sequence');
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });
  const result = generateNarration(matchData, { treatmentCopy: treatment.copy, random: () => 0.5 });
  assert.equal(result.usedBypass, false, 'expected NO R73 bypass for a mixed matched sequence');
  // The normal tie path (C17's register tie line) serves instead, passes
  // discipline (scanForbidden) and specificity (a real number from THIS
  // match, or the honest fallback).
  assert.equal(scanForbidden(result.text).length, 0);
  assert.ok(specificityCheck(result.text, matchData) || result.text === STATIC_FALLBACK);
  // The tie line leads with the real score breakdown (0 won, 0 lost, 5
  // draws) per C17's fix -- a truthful, match-specific line, not the
  // bypass's canned (and here false) "[ELEMENT] all five rounds" claim.
  assert.ok(!result.text.includes('narratorBypass'), 'sanity: the bypass template key itself should never leak into rendered text');
});

test('f5/crucial-4 regression: a TRUE all-Fire duel (both sides commit the SAME single element all five rounds) still gets the R73 bypass', () => {
  const outcome = resolveDuel({ mv1: [0, 0, 0, 0, 0], mv2: [0, 0, 0, 0, 0], aff1: 9, aff2: 9, p1: 100, p2: 100, floor: 10, random: () => 0.2 });
  assert.equal(outcome.trueTie, true);
  assert.equal(outcome.identicalAllFive, true, 'expected identicalAllFive to be TRUE for a genuine all-one-element-both-sides duel');
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });
  const result = generateNarration(matchData, { treatmentCopy: treatment.copy, random: () => 0.5 });
  assert.equal(result.usedBypass, true, 'expected the R73 bypass to still fire for a true all-Fire duel');
  assert.equal(scanForbidden(result.text).length, 0);
});

test('f5/crucial-4: identicalAllFive is also false when mv1 itself is constant but mv2 differs on any round (not a round-by-round OR an all-same-element match)', () => {
  const outcome = resolveDuel({ mv1: [0, 0, 0, 0, 0], mv2: [0, 0, 1, 0, 0], aff1: 9, aff2: 9, p1: 100, p2: 100, floor: 10 });
  assert.equal(outcome.identicalAllFive, false);
});
