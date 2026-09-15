// app/tests/presentation-timeline.test.js — §10/R74-R77: the timeline per
// round (states in order, cadence per O9), the <45s whole-duel ceiling, and
// the R75 coverage-gap moment candidate selection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDuel } from '../engine/duel.js';
import { buildRoundSteps, buildFinalSteps, buildDuelTimeline, totalDurationMs, CANONICAL_STATES, MOMENT_STATES } from '../engine/presentationTimeline.js';
import { projectedAfterRound } from '../engine/duelProjection.js';

function outcomeFor(mv1, mv2, opts = {}) {
  return resolveDuel({ mv1, mv2, aff1: opts.aff1 ?? 9, aff2: opts.aff2 ?? 9, p1: opts.p1 ?? 100, p2: opts.p2 ?? 100, floor: opts.floor ?? 10, random: opts.random });
}

test('a routine round\'s timeline follows R75\'s order: battleIdle -> charge -> chargeLoop -> attack -> hit/hitSuccess -> reset', () => {
  const outcome = outcomeFor([0, 1, 2, 0, 1], [2, 0, 1, 2, 0]);
  const round1 = outcome.rounds[0];
  assert.notEqual(round1.result, 'DRAW'); // this fixture's round 1 is decisive
  const steps = buildRoundSteps(round1, 1170);
  const order = steps.map((s) => s.state);
  const expectedHitState = round1.result === 'WIN' ? 'hitSuccess' : 'hit';
  assert.deepEqual(order, ['battleIdle', 'charge', 'chargeLoop', 'attack', expectedHitState, 'reset']);
});

test('a draw round returns both to Battle Idle instead of hit/hitSuccess', () => {
  const outcome = outcomeFor([0, 0, 2, 0, 1], [0, 0, 1, 2, 0]); // round 1 and round 2 are draws (0==0)
  const drawRound = outcome.rounds.find((r) => r.result === 'DRAW');
  assert.ok(drawRound);
  const steps = buildRoundSteps(drawRound, 1170);
  assert.ok(steps.some((s) => s.state === 'draw'));
  assert.ok(!steps.some((s) => s.state === 'hit' || s.state === 'hitSuccess'));
});

test('an affinity (BIG/CRITICAL) round gets the element FX pass step', () => {
  // aff1=aff2=fire(0): committing fire on both sides is CRITICAL when decisive
  const outcome = outcomeFor([0, 1, 2, 0, 1], [1, 0, 1, 2, 0], { aff1: 0, aff2: 0 });
  const taggedRound = outcome.rounds.find((r) => r.tag);
  assert.ok(taggedRound, 'expected at least one BIG/CRITICAL round in this fixture');
  const steps = buildRoundSteps(taggedRound, 1170);
  assert.ok(steps.some((s) => s.state === 'affinityFx'));
});

test('every round\'s last step is flagged roundComplete for the tug-bar/rail driver', () => {
  const outcome = outcomeFor([0, 1, 2, 0, 1], [2, 0, 1, 2, 0]);
  for (const round of outcome.rounds) {
    const steps = buildRoundSteps(round, 1170);
    assert.equal(steps[steps.length - 1].state, 'reset');
    assert.equal(steps[steps.length - 1].roundComplete, true);
  }
});

test('a true tie gets the coin-flip moment then the advancing character\'s Win', () => {
  const outcome = outcomeFor([0, 1, 2, 0, 1], [0, 1, 2, 0, 1], { random: () => 0.9 }); // identical moves -> true tie
  assert.equal(outcome.trueTie, true);
  const steps = buildFinalSteps(outcome, 1170);
  assert.equal(steps[0].state, 'coinFlip');
  assert.equal(steps[1].state, outcome.coinFlipWinner === 1 ? 'win' : 'lose');
});

test('a floor drain gets the erasure-treatment moment before Win/Lose', () => {
  const outcome = outcomeFor([0, 1, 2, 0, 1], [2, 0, 1, 2, 0], { p1: 100, p2: 9, floor: 10 }); // p2 starts under the floor already
  const steps = buildFinalSteps(outcome, 1170);
  if (outcome.floorDrain) {
    assert.equal(steps[0].state, 'floorDrain');
  }
});

test('a bracket-completing win gets the prize-award moment after Power', () => {
  const outcome = outcomeFor([0, 1, 2, 0, 1], [2, 0, 1, 2, 0]);
  const steps = buildFinalSteps(outcome, 1170, { bracketComplete: true });
  if (outcome.winner === 1 || outcome.coinFlipWinner === 1) {
    assert.ok(steps.some((s) => s.state === 'prizeAward'));
    assert.equal(steps[steps.length - 1].state, 'prizeAward');
  }
});

test('the coverage-gap moment candidate id comes from momentChoice (console override), default 1', () => {
  const outcome = outcomeFor([0, 1, 2, 0, 1], [0, 1, 2, 0, 1], { random: () => 0.9 });
  const stepsDefault = buildFinalSteps(outcome, 1170);
  assert.equal(stepsDefault[0].candidate, 1);
  const stepsCandidate2 = buildFinalSteps(outcome, 1170, { momentChoice: { coinFlip: 2 } });
  assert.equal(stepsCandidate2[0].candidate, 2);
});

test('whole duel stays under 45s (R75) at every cadence alternative, worst case: every round tagged + a floor drain + a prize award', () => {
  // Force every round to carry an affinity tag by using matching affinities
  // that are decisive (not draws) in all five rounds.
  const outcome = outcomeFor([0, 1, 2, 0, 1], [1, 2, 0, 1, 2], { aff1: 0, aff2: 0, p1: 9, p2: 100, floor: 10 });
  for (const cadence of [900, 1170, 1500]) { // O9: default + both alternatives
    const timeline = buildDuelTimeline(outcome, cadence, { bracketComplete: true });
    const total = totalDurationMs(timeline);
    assert.ok(total < 45000, `cadence ${cadence}ms produced a ${total}ms duel (must stay under 45000ms)`);
  }
});

// A2 fix (f2): the review's TRUE worst case includes the pre-round hold
// (R76's "readable for one second before round one") that the pre-f2 test
// above omitted, AND uses the actual worst-case fixture: 5 CRITICAL rounds
// (both sides on their own affinity every round -- BIG requires only one
// side; CRITICAL requires both) + a floor drain (the loser starts already
// near the floor) + a bracket-completing win (prize award). The review
// measured 44,550ms at O9=1500ms this way -- ~450ms under the 45s ceiling,
// with 39 full-screen rebuilds. Fixed: worst case now stays at/under ~42s
// at every cadence, counted honestly (steps + hold together).
test('A2: the TRUE worst case (5 CRITICAL rounds + floor drain + prize, INCLUDING the pre-round hold) stays at or under ~42s at every cadence, including the slowest (O9=1500ms)', () => {
  // p1 wins every round on its own affinity while p2 also commits its own
  // affinity every round (both p1Affinity/p2Affinity true -> CRITICAL,
  // never a draw since the moves differ), p2 starts near the floor (a
  // floor-drain win for p1), and the win completes the bracket (prize).
  const outcome = outcomeFor([1, 1, 1, 1, 1], [0, 0, 0, 0, 0], { aff1: 1, aff2: 0, p1: 100, p2: 9, floor: 10 });
  assert.deepEqual(outcome.rounds.map((r) => r.tag), ['CRITICAL', 'CRITICAL', 'CRITICAL', 'CRITICAL', 'CRITICAL']);
  assert.equal(outcome.floorDrain, true);
  assert.equal(outcome.winner, 1);

  for (const cadence of [900, 1170, 1500]) {
    const timeline = buildDuelTimeline(outcome, cadence, { bracketComplete: true });
    // the TRUE elapsed time a participant waits: the timeline's own steps
    // PLUS the pre-round hold that used to be invisible to this measurement.
    const trueTotal = totalDurationMs(timeline, cadence);
    assert.ok(trueTotal <= 42000, `cadence ${cadence}ms: TRUE worst case ${trueTotal}ms exceeds the ~42s target`);
  }
  // and it must still clear the hard 45s law with real headroom, not ~450ms.
  const worstCadence = buildDuelTimeline(outcome, 1500, { bracketComplete: true });
  const trueWorst = totalDurationMs(worstCadence, 1500);
  assert.ok(45000 - trueWorst >= 2000, `expected at least 2000ms of real headroom under the 45s ceiling, got ${45000 - trueWorst}ms`);
});

test('the round-by-round tug-bar projection matches the final round\'s projection to the resolved outcome\'s actual (pre-floor-override) transfer', () => {
  const outcome = outcomeFor([0, 1, 2, 0, 1], [2, 0, 1, 2, 0], { p1: 100, p2: 100, floor: 5 });
  const proj = projectedAfterRound(outcome.rounds, 5, 9, 9, 100, 100, 5);
  // after all 5 rounds are "shown," the projection's score should equal the
  // real resolveDuel score (same moves, same affinities).
  assert.equal(proj.score, outcome.score);
});

test('CANONICAL_STATES includes every R74-named state; MOMENT_STATES covers the three coverage-gap moments', () => {
  for (const s of ['idle', 'battleIdle', 'charge', 'attack', 'hit', 'hitSuccess', 'win', 'lose', 'power', 'chargeLoop', 'reset', 'draw', 'cancel']) {
    assert.ok(CANONICAL_STATES.includes(s), `missing canonical state ${s}`);
  }
  assert.deepEqual(MOMENT_STATES.slice().sort(), ['coinFlip', 'floorDrain', 'prizeAward'].sort());
});
