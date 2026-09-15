// app/tests/gate.test.js — AC0: "synthetic runs clear R51's gate logic on
// planted outcomes" -- the generator accepts plant=pass|fail and the gate
// logic must classify both correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateRun, generatePreRegistration, armDefinitions } from '../engine/runSimulator.js';
import { runSequentialGate, evaluateDailyGate, GATE_THRESHOLDS, SEQUENTIAL_RULE } from '../engine/gate.js';

test('planted pass: the gate cell classifies as pass under the sequential rule', () => {
  const run = simulateRun({ seed: 20260910, plant: 'pass' });
  const result = runSequentialGate(run.gateDays);
  assert.equal(result.decision, 'pass', JSON.stringify(result));
  assert.ok(result.observedRate >= GATE_THRESHOLDS.reservationRate);
  assert.ok(result.secondaryPassCount >= 2);
});

test('planted fail: the gate cell never classifies as pass under the sequential rule', () => {
  const run = simulateRun({ seed: 20260910, plant: 'fail' });
  const result = runSequentialGate(run.gateDays);
  assert.notEqual(result.decision, 'pass', JSON.stringify(result));
  assert.ok(['miss', 'inconclusive'].includes(result.decision));
});

test('planted pass/fail classify correctly across multiple seeds (robustness, not a single lucky draw)', () => {
  for (const seed of [1, 2, 3, 42, 999, 123456, 7777]) {
    const pass = runSequentialGate(simulateRun({ seed, plant: 'pass' }).gateDays);
    const fail = runSequentialGate(simulateRun({ seed, plant: 'fail' }).gateDays);
    assert.equal(pass.decision, 'pass', `seed ${seed} plant=pass -> ${pass.decision}`);
    assert.notEqual(fail.decision, 'pass', `seed ${seed} plant=fail -> ${fail.decision}`);
  }
});

test('the sequential rule does not fire before the minimum look N', () => {
  const result = evaluateDailyGate({ completers: 5, reservations: 4 }, 1);
  assert.equal(result.decision, 'continue');
});

test('f4/N3: a planted borderline max-N read (z modestly above 0 but below the real efficacy boundary at t=1) closes INCONCLUSIVE, never pass -- the deleted z>=0 carve-out regression', () => {
  // The exact repro from the re-probe finding: n=50 (= maxN), observed rate
  // 36.0% (18/50) vs the 35% setpoint -> z ~= 0.148. Comfortably z >= 0, and
  // every secondary signal + cost cap also clears -- so under the OLD (now
  // deleted) "z >= 0" ceiling carve-out this wrongly declared 'pass'. The
  // real efficacy boundary at t=1 (~1.645 for the shipped one-sided 0.05
  // alpha, O'Brien-Fleming-type spending function) is nowhere near crossed,
  // so R6/R19 require this to close INCONCLUSIVE, at its reached Wilson
  // interval, treated as a miss in verdict/report language.
  const result = evaluateDailyGate({
    completers: 50, reservations: 18, // observedRate 0.36
    replayAfterLossRate: 0.55, bracketsPerActivePlayerWithin48h: 2.5, d1ReturnRate: 0.45, firstBracketCompletionRate: 0.55,
    costPerReservationUSD: 50, costCapUSD: 100,
  }, 10, false);
  assert.ok(result.z > 0 && result.z < 0.5, `expected the borderline z near 0.148, got ${result.z}`);
  assert.notEqual(result.decision, 'pass', `borderline max-N read wrongly classified as pass: ${JSON.stringify(result)}`);
  assert.equal(result.decision, 'inconclusive');
  assert.match(result.reason, /INCONCLUSIVE/);
  // R19: an inconclusive close is treated as a miss in verdict/report
  // language -- the runSequentialGate wiring (below) and the console's
  // report copy key off `decision === 'inconclusive'` exactly like 'miss'
  // for "did this pass" purposes; assert the raw decision string itself is
  // never 'pass' so no downstream reader can mistake it.
  assert.notEqual(result.decision, 'pass');

  // Same repro via the sequential-gate walk (a single day at maxN, no
  // atCeiling flag needed -- completers already >= maxN triggers the same
  // ceiling branch).
  const walked = runSequentialGate([{
    day: 1, completers: 50, reservations: 18,
    replayAfterLossRate: 0.55, bracketsPerActivePlayerWithin48h: 2.5, d1ReturnRate: 0.45, firstBracketCompletionRate: 0.55,
    costPerReservationUSD: 50, costCapUSD: 100,
  }]);
  assert.equal(walked.decision, 'inconclusive');
});

test('f4/N3: a max-N read that GENUINELY crosses the efficacy boundary at t=1 still reports pass (the fix narrows the door, it does not remove it)', () => {
  // n=50, need phat such that z >= ~1.645: successes >= ~35 (70%).
  const result = evaluateDailyGate({
    completers: 50, reservations: 36, // observedRate 0.72
    replayAfterLossRate: 0.55, bracketsPerActivePlayerWithin48h: 2.5, d1ReturnRate: 0.45, firstBracketCompletionRate: 0.55,
    costPerReservationUSD: 50, costCapUSD: 100,
  }, 10, false);
  assert.equal(result.decision, 'pass');
  assert.ok(result.z >= result.efficacyBoundaryZ);
});

test('a run reaching its time ceiling without an earlier fire closes (inconclusive or pass), never left "continue"', () => {
  // Construct a series that never crosses either boundary and never reaches
  // max N, to exercise the R6 time-ceiling closure path explicitly.
  const days = [];
  for (let day = 1; day <= 5; day++) {
    days.push({
      day, completers: 20, reservations: 8, // observedRate 0.40 -- above 0.35 but not enough for the efficacy z given n=20
      replayAfterLossRate: 0.10, bracketsPerActivePlayerWithin48h: 0.5, d1ReturnRate: 0.10, firstBracketCompletionRate: 0.20,
      costPerReservationUSD: 50, costCapUSD: 100,
    });
  }
  const result = runSequentialGate(days);
  assert.notEqual(result.decision, 'continue');
  assert.equal(result.day, 5);
});

test('door arms are simulated alongside the gate cell (R19a: every running arm reports daily)', () => {
  const run = simulateRun({ seed: 5, plant: 'pass' });
  const arms = armDefinitions();
  assert.equal(arms.length, 6); // gate cell + 2 theme + 3 price door arms
  for (const arm of arms) {
    assert.ok(Array.isArray(run.byArm[arm.id]));
    assert.equal(run.byArm[arm.id].length, run.maxDays);
  }
});

test('spend shares sum to the total envelope share (R6: gate cell >=70%, door arms split the remainder)', () => {
  const arms = armDefinitions();
  const total = arms.reduce((sum, a) => sum + a.spendShare, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  const gate = arms.find((a) => a.role === 'gate');
  assert.ok(gate.spendShare >= 0.70 - 1e-9);
});

test('cap breach pauses an arm\'s spend (AC0: "cap breach blocked at both layers")', () => {
  const run = simulateRun({ seed: 20260910, plant: 'pass', perArmCapsUSD: { 'gate-incumbent-10': 1 } });
  const days = run.byArm['gate-incumbent-10'];
  const everPaused = days.some((d) => d.paused);
  assert.ok(everPaused, 'expected the $1 cap to force a pause');
  // once paused, later days show zero incremental spend
  const firstPausedIdx = days.findIndex((d) => d.paused);
  if (firstPausedIdx >= 0 && firstPausedIdx < days.length - 1) {
    assert.equal(days[firstPausedIdx + 1].spendUSD, 0);
  }
});

test('pre-registration carries thresholds, boundaries, max N, caps, contamination method, house-play disclosure (R21)', () => {
  const preReg = generatePreRegistration({ seed: 1 });
  assert.equal(preReg.thresholds.reservationRateSetpoint, 0.35);
  assert.equal(preReg.sequentialRule.maxN, SEQUENTIAL_RULE.maxN);
  assert.ok(preReg.caps.frozenAtPreRegistration);
  assert.ok(preReg.contaminationMethod.length > 0);
  assert.ok(preReg.housePlayPolicy.length > 0);
});
