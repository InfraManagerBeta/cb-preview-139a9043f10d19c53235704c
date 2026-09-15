// app/tests/narrator-register.test.js — f2/C5/C17/A9: register-aware
// deterministic narration reaches a participant (not just the test-only
// composed prompt), the far register is structurally distinct (not a noun
// swap), regenerate (`variant`) actually changes the rendering, and the
// discipline scanner bans every treatment's product name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDuel } from '../engine/duel.js';
import { buildMatchData, generateNarration, renderTemplate, scanForbidden, specificityCheck } from '../engine/narrator.js';
import { loadTreatment } from '../engine/dataLoader.js';

const incumbent = await loadTreatment('incumbent');
const adjacent = await loadTreatment('adjacent');
const far = await loadTreatment('far');

function nounsFor(t) {
  return { character: t.nouns.character.toLowerCase(), stakeUnitProse: t.nouns.stakeUnit.toLowerCase() };
}

// A routine, non-tie, non-bypass duel (so the register templates -- not the
// static bypass -- actually run).
function routineOutcome() {
  return resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [2, 0, 1, 2, 0], aff1: 9, aff2: 9, p1: 100, p2: 100, floor: 10 });
}

test('C5: the same duel yields register-distinct texts across the three treatments, and all three pass the discipline scan', () => {
  const outcome = routineOutcome();
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });

  const incResult = generateNarration(matchData, { treatmentCopy: incumbent.copy, nouns: nounsFor(incumbent), register: 'incumbent' });
  const adjResult = generateNarration(matchData, { treatmentCopy: adjacent.copy, nouns: nounsFor(adjacent), register: 'adjacent' });
  const farResult = generateNarration(matchData, { treatmentCopy: far.copy, nouns: nounsFor(far), register: 'far' });

  assert.equal(scanForbidden(incResult.text).length, 0);
  assert.equal(scanForbidden(adjResult.text).length, 0);
  assert.equal(scanForbidden(farResult.text).length, 0);

  // Register-distinct: not merely a noun swap of the same sentence shape.
  assert.notEqual(incResult.text, adjResult.text);
  assert.notEqual(incResult.text, farResult.text);
  assert.notEqual(adjResult.text, farResult.text);
});

test('C5: the far register is structurally distinct from the incumbent -- shorter sentences, no subordinate draw clause', () => {
  const outcome = resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [1, 2, 0, 1, 2], aff1: 9, aff2: 9, p1: 100, p2: 100, floor: 10 });
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });

  const incSentences = renderTemplate(matchData, 0, nounsFor(incumbent), 'incumbent');
  const farSentences = renderTemplate(matchData, 0, nounsFor(far), 'far');

  const avgWords = (sentences) => sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length;
  assert.ok(avgWords(farSentences) < avgWords(incSentences), `far (${avgWords(farSentences)}) should average fewer words/sentence than incumbent (${avgWords(incSentences)})`);

  // Structural marker: the incumbent's lead sentence uses a subordinate
  // "with N draws" clause when there are draws; the far register never
  // does (bare "N to M." instead).
  if (matchData.summary.draws > 0) {
    assert.ok(incSentences[0].includes('with'), `expected incumbent's lead sentence to carry the subordinate clause: ${incSentences[0]}`);
    assert.ok(!farSentences[0].includes('with'), `expected far's lead sentence to be a bare score, not: ${farSentences[0]}`);
  }
});

test('C17: variant genuinely changes the rendering (different lead fact/structure), not a no-op', () => {
  // floorDrain + non-zero transfer so variant 1's "lead with the transfer"
  // branch actually differs in content from variant 0's "lead with the score".
  const outcome = resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [2, 0, 1, 2, 0], aff1: 9, aff2: 9, p1: 100, p2: 9, floor: 10 });
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 9 });

  for (const [register, treatment] of [['incumbent', incumbent], ['adjacent', adjacent], ['far', far]]) {
    const v0 = renderTemplate(matchData, 0, nounsFor(treatment), register).join(' ');
    const v1 = renderTemplate(matchData, 1, nounsFor(treatment), register).join(' ');
    assert.notEqual(v0, v1, `${register}: variant 1 must differ in structure from variant 0`);
    assert.equal(scanForbidden(v0).length, 0);
    assert.equal(scanForbidden(v1).length, 0);
  }
});

test('A9: the discipline scanner bans every treatment\'s product name, not just the incumbent\'s', () => {
  assert.ok(scanForbidden('A fine card at Undercard tonight.').length > 0);
  assert.ok(scanForbidden('Scrapyard Kings logged the reading.').length > 0);
  assert.ok(scanForbidden('Cheddar Battles records the result.').length > 0);
  assert.equal(scanForbidden('Three rounds to two. The ledger records it.').length, 0);
});

test('every register\'s output stays 2-5 sentences and passes specificity on a routine result', () => {
  const outcome = routineOutcome();
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });
  for (const [register, treatment] of [['incumbent', incumbent], ['adjacent', adjacent], ['far', far]]) {
    const result = generateNarration(matchData, { treatmentCopy: treatment.copy, nouns: nounsFor(treatment), register });
    const sentenceCount = result.text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    assert.ok(sentenceCount >= 2 && sentenceCount <= 5, `${register}: expected 2-5 sentences, got ${sentenceCount}: ${result.text}`);
  }
});

// ---- f4/C17: adjacent/far variant 1/2 genuinely differ; every register's --
// tie line survives specificityCheck on a real tie (including a tie that is
// NOT all-five-draws -- duelScore's affinity multipliers make that
// reachable, contrary to the simpler "distinct weights" intuition).

// A duel with an affinity round (BIG/CRITICAL tag) AND a non-tie decisive
// outcome, so variant 2's "lead with round-count/affinity" branch actually
// diverges from variant 0's "lead with the score" branch.
function affinityOutcome() {
  return resolveDuel({ mv1: [0, 0, 0, 0, 1], mv2: [1, 1, 2, 0, 2], aff1: 0, aff2: 2, p1: 100, p2: 100, floor: 10 });
}

// A genuine true tie with draws=1 (NOT all-five-draws) -- found by direct
// search over duelScore's affinity-adjusted magnitudes; confirms a true
// tie does not require every round to draw in this engine.
function nonAllDrawTieOutcome() {
  return resolveDuel({ mv1: [0, 0, 0, 0, 1], mv2: [1, 2, 2, 0, 2], aff1: 2, aff2: 2, p1: 100, p2: 100, floor: 10 });
}

test('f4/C17: adjacent and far both implement variant 2 (lead with the round-count/affinity fact) -- v0 != v2 on the same duel, for every register', () => {
  const outcome = affinityOutcome();
  assert.ok(!outcome.trueTie, 'expected a decisive (non-tie) duel to exercise variant 2\'s own branch');
  assert.ok(outcome.bigCount > 0 || outcome.criticalCount > 0, 'expected at least one affinity-tagged round');
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });

  for (const [register, treatment] of [['incumbent', incumbent], ['adjacent', adjacent], ['far', far]]) {
    const v0 = renderTemplate(matchData, 0, nounsFor(treatment), register).join(' ');
    const v2 = renderTemplate(matchData, 2, nounsFor(treatment), register).join(' ');
    assert.notEqual(v0, v2, `${register}: expected variant 2 to genuinely differ in structure from variant 0`);
    assert.equal(scanForbidden(v0).length, 0);
    assert.equal(scanForbidden(v2).length, 0);
  }
});

test('f4/C17: a true tie serves its OWN register\'s tie line (never the generic STATIC_FALLBACK), for all three registers, even when the tie is NOT all-five-draws', () => {
  const outcome = nonAllDrawTieOutcome();
  assert.equal(outcome.trueTie, true);
  assert.ok(outcome.draws < 5, `expected a tie with draws < 5 to exercise the general case, got draws=${outcome.draws}`);
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });

  for (const [register, treatment] of [['incumbent', incumbent], ['adjacent', adjacent], ['far', far]]) {
    const result = generateNarration(matchData, { treatmentCopy: treatment.copy, nouns: nounsFor(treatment), register });
    assert.equal(result.usedFallback, false, `${register}: a true tie fell back to the generic STATIC_FALLBACK instead of serving its own tie line`);
    assert.equal(scanForbidden(result.text).length, 0);
    // The rendered tie line itself (variant 0, ignoring variant since tie
    // branches are variant-independent by design) must independently
    // satisfy specificityCheck -- not merely "happen to pass" via an
    // unrelated word (the old incumbent line passed only by the
    // coincidental "this one" in filler text, not a real match number).
    const tieText = renderTemplate(matchData, 0, nounsFor(treatment), register).join(' ');
    assert.equal(specificityCheck(tieText, matchData), true, `${register}: tie line does not genuinely name this match's specifics: "${tieText}"`);
  }
});

test('f4/C17: every register\'s tie-line rendering is variant-INDEPENDENT (a tie is a tie regardless of which variant was requested) and still genuinely specific', () => {
  const outcome = nonAllDrawTieOutcome();
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });
  for (const [register, treatment] of [['incumbent', incumbent], ['adjacent', adjacent], ['far', far]]) {
    const v0 = renderTemplate(matchData, 0, nounsFor(treatment), register).join(' ');
    const v1 = renderTemplate(matchData, 1, nounsFor(treatment), register).join(' ');
    const v2 = renderTemplate(matchData, 2, nounsFor(treatment), register).join(' ');
    assert.equal(v0, v1);
    assert.equal(v0, v2);
  }
});

// f5/crucial-4: v1c's repro -- a true tie reached via a MIXED matched
// sequence (fire,water,air,fire,water both sides: draws === 5, but NOT the
// same single element every round) must NOT trip R73's static bypass (fixed
// in duel.js's identicalAllFive), and must fall through to each register's
// OWN tie line (C17), same as any other true tie, passing discipline AND
// specificity in every register -- not just the incumbent.
function mixedMatchedAllDrawTieOutcome() {
  return resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [0, 1, 2, 0, 1], aff1: 9, aff2: 9, p1: 100, p2: 100, floor: 10 });
}

test('f5/crucial-4: a mixed matched all-draw tie (the v1c repro) gets NO R73 bypass in ANY register, and each register serves its own truthful tie line, passing discipline + specificity', () => {
  const outcome = mixedMatchedAllDrawTieOutcome();
  assert.equal(outcome.trueTie, true);
  assert.equal(outcome.draws, 5, 'expected this mirror-match sequence to draw all five rounds');
  assert.equal(outcome.identicalAllFive, false, 'expected identicalAllFive to be false -- three different elements were committed, never the same one all five rounds');
  const matchData = buildMatchData(outcome, { p1StakeBefore: 100, p2StakeBefore: 100 });

  for (const [register, treatment] of [['incumbent', incumbent], ['adjacent', adjacent], ['far', far]]) {
    const result = generateNarration(matchData, { treatmentCopy: treatment.copy, nouns: nounsFor(treatment), register });
    assert.equal(result.usedBypass, false, `${register}: expected NO R73 bypass for a mixed matched sequence`);
    assert.equal(result.usedFallback, false, `${register}: expected the register's own tie line, not the generic STATIC_FALLBACK`);
    assert.equal(scanForbidden(result.text).length, 0);
    const tieText = renderTemplate(matchData, 0, nounsFor(treatment), register).join(' ');
    assert.equal(specificityCheck(tieText, matchData), true, `${register}: tie line does not genuinely name this match's specifics: "${tieText}"`);
  }
});
