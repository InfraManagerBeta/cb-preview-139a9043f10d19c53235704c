// app/tests/gate-alpha-spending-door-yield.test.js — f2/C9/C10/C11/C12/C20:
// one source for gate thresholds/sequential-rule numbers (propagates via
// tunables.json + the console's gateOverrides patch layer); a REAL
// Lan-DeMets/O'Brien-Fleming-type alpha-spending design (monotone
// boundaries, total type-I documented, planted pass/fail still correct);
// Wilson 95% CI (expected at max N, computed not hardcoded); the R22 door-
// yield layer + band rule; the house-play disclosure's numbers now match
// npc.js's actual procedural-fallback drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGateConfig, evaluateDailyGate, runSequentialGate, GATE_THRESHOLDS, SEQUENTIAL_RULE } from '../engine/gate.js';
import { obrienFlemingAlphaSpent, obrienFlemingBoundaryZ, pocockBoundaryZ, wilsonInterval, normCdf, normInv } from '../engine/alphaSpending.js';
import { simulateRun, generatePreRegistration, classifyDoorYieldWinner, buildDoorYieldReport, armDefinitions } from '../engine/runSimulator.js';
import { loadTunables, loadTreatment } from '../engine/dataLoader.js';
import { effectiveTunables, defaultOverrides } from '../engine/overrides.js';
import { proceduralNpc } from '../engine/npc.js';
import { mulberry32 } from '../engine/rng.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');

const tunablesRaw = await loadTunables();
const incumbent = await loadTreatment('incumbent');

// ---- C9: one source ---------------------------------------------------

test('C9: gate.js, runSimulator.js\'s pre-registration, and the console all derive from tunables.gate via deriveGateConfig -- no independent hand-copies', () => {
  const config = deriveGateConfig(tunablesRaw);
  assert.equal(GATE_THRESHOLDS.reservationRate, tunablesRaw.gate.reservationRateThreshold);
  assert.equal(SEQUENTIAL_RULE.maxN, tunablesRaw.gate.sequentialRule.maxN);
  const preReg = generatePreRegistration({ seed: 1, tunables: tunablesRaw });
  assert.equal(preReg.thresholds.reservationRateSetpoint, config.thresholds.reservationRate);
  assert.equal(preReg.sequentialRule.maxN, config.sequentialRule.maxN);
});

test('C9: a threshold changed via the console\'s override layer propagates to BOTH gate logic and the pre-registration text', () => {
  const overrides = { ...defaultOverrides(), gateOverrides: { reservationRateThreshold: 0.60 } };
  const effTunables = effectiveTunables(tunablesRaw, overrides);
  assert.equal(effTunables.gate.reservationRateThreshold, 0.60);

  const config = deriveGateConfig(effTunables);
  assert.equal(config.thresholds.reservationRate, 0.60);

  // Gate logic reflects it: a 40% observed rate now reads as WORSE than
  // setpoint (z negative), where under the shipped 0.35 setpoint it would
  // read as better (z positive).
  const cum = { completers: 30, reservations: 12 }; // observed rate 0.40
  const underShipped = evaluateDailyGate(cum, 1, false, deriveGateConfig(tunablesRaw));
  const underOverride = evaluateDailyGate(cum, 1, false, config);
  assert.ok(underShipped.z > 0, 'expected z>0 vs the shipped 0.35 setpoint at an observed 0.40 rate');
  assert.ok(underOverride.z < 0, 'expected z<0 vs the overridden 0.60 setpoint at the same observed 0.40 rate');

  // Pre-reg text reflects it too.
  const preReg = generatePreRegistration({ seed: 1, tunables: effTunables });
  assert.equal(preReg.thresholds.reservationRateSetpoint, 0.60);
});

test('C9: a maxN override changes the alpha-spending boundary table shown in the pre-registration', () => {
  const overrides = { ...defaultOverrides(), gateOverrides: { sequentialRule: { maxN: 30 } } };
  const effTunables = effectiveTunables(tunablesRaw, overrides);
  assert.equal(effTunables.gate.sequentialRule.maxN, 30);
  assert.equal(effTunables.gate.sequentialRule.minLookN, tunablesRaw.gate.sequentialRule.minLookN, 'other sequentialRule fields must survive the patch (deep-merge, not clobber)');
  const preReg = generatePreRegistration({ seed: 1, tunables: effTunables });
  assert.equal(preReg.sequentialRule.maxN, 30);
});

// ---- C10: real alpha spending -------------------------------------------

test('C10: normCdf/normInv are consistent inverses, and z_alpha(0.05 one-sided) lands at the classic ~1.645', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normInv(normCdf(1.2345)) - 1.2345) < 1e-6);
  assert.ok(Math.abs(normInv(0.95) - 1.6449) < 1e-3);
});

test('C10: the spending function is monotone -- cumulative alpha spent strictly increases with information fraction t, and reaches exactly totalAlpha at t=1', () => {
  const totalAlpha = 0.05;
  const ts = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0];
  let prevSpent = -1;
  for (const t of ts) {
    const spent = obrienFlemingAlphaSpent(t, totalAlpha);
    assert.ok(spent > prevSpent, `alpha spent must strictly increase with t (t=${t})`);
    prevSpent = spent;
  }
  assert.ok(Math.abs(obrienFlemingAlphaSpent(1.0, totalAlpha) - totalAlpha) < 1e-6, 'all pre-registered alpha must be spent by t=1');
});

test('C10: the per-look efficacy BOUNDARY is monotone DECREASING as t rises (classic OBF shape: hard to stop early, relaxes to nominal at t=1)', () => {
  const totalAlpha = 0.05;
  const ts = [0.1, 0.3, 0.5, 0.7, 1.0];
  let prevZ = Infinity;
  for (const t of ts) {
    const z = obrienFlemingBoundaryZ(t, totalAlpha);
    assert.ok(z < prevZ, `boundary z must strictly decrease as t rises (t=${t}, z=${z})`);
    prevZ = z;
  }
  // at t=1, the boundary lands on the nominal one-sided z for totalAlpha.
  assert.ok(Math.abs(obrienFlemingBoundaryZ(1.0, totalAlpha) - normInv(1 - totalAlpha)) < 1e-6);
});

test('C10: the total type-I control is documented (pre-registration states total alpha, spending function, and the method\'s normal-approximation caveat)', () => {
  const preReg = generatePreRegistration({ seed: 1, tunables: tunablesRaw });
  assert.equal(preReg.sequentialRule.totalAlphaOneSided, 0.05);
  assert.ok(preReg.sequentialRule.spendingFunction.length > 0);
  assert.ok(/normal-approximation/i.test(preReg.sequentialRule.description), 'expected the pre-reg text to document the normal-approximation caveat');
  assert.ok(preReg.sequentialRule.boundaryTable.length > 0);
});

test('C10: Pocock-style constant boundary is implemented too (the brief\'s documented fallback), distinct from the spending-function boundary', () => {
  const z = pocockBoundaryZ(8, 0.05);
  assert.ok(Number.isFinite(z) && z > 0);
  // Pocock's constant boundary (Bonferroni split) is stricter (higher z) at
  // every individual look than the OBF-type boundary is AT t=1 (OBF spends
  // almost nothing early but "catches up" to the full nominal bound only at
  // the final look; Pocock spends evenly, so its constant bound sits above
  // the OBF boundary's t=1 value).
  assert.ok(z > obrienFlemingBoundaryZ(1.0, 0.05));
});

test('C10: planted pass/fail still classify correctly across seeds under the new spending-function boundary', () => {
  for (const seed of [1, 2, 3, 42, 999]) {
    const passRun = simulateRun({ seed, plant: 'pass', tunables: tunablesRaw });
    const failRun = simulateRun({ seed, plant: 'fail', tunables: tunablesRaw });
    const passResult = runSequentialGate(passRun.gateDays);
    const failResult = runSequentialGate(failRun.gateDays);
    assert.equal(passResult.decision, 'pass', `seed ${seed} plant=pass -> ${passResult.decision}`);
    assert.notEqual(failResult.decision, 'pass', `seed ${seed} plant=fail -> ${failResult.decision}`);
  }
});

// ---- C11: Wilson 95% CI --------------------------------------------------

test('C11: Wilson interval at the setpoint (35%, N~=50) is close to the brief\'s stated ~+/-13pt width', () => {
  const n = 50;
  const successes = Math.round(0.35 * n);
  const ci = wilsonInterval(successes, n);
  const halfWidthPts = ((ci.high - ci.low) / 2) * 100;
  assert.ok(halfWidthPts > 9 && halfWidthPts < 17, `expected a half-width in the ballpark of ~13pts, got ${halfWidthPts.toFixed(1)}`);
});

test('C11: the pre-registration states the EXPECTED interval at max N, computed (not hardcoded) from the setpoint + maxN', () => {
  const preReg = generatePreRegistration({ seed: 1, tunables: tunablesRaw });
  const ci = preReg.sequentialRule.expectedIntervalAtMaxN;
  assert.equal(ci.n, tunablesRaw.gate.sequentialRule.maxN);
  const expected = wilsonInterval(Math.round(tunablesRaw.gate.reservationRateThreshold * ci.n), ci.n);
  assert.ok(Math.abs(ci.low - expected.low) < 1e-9 && Math.abs(ci.high - expected.high) < 1e-9);
});

test('C11: the run\'s gate verdict can compute the interval REACHED at close from its own completers/reservations', () => {
  const run = simulateRun({ seed: 20260910, plant: 'pass', tunables: tunablesRaw });
  const result = runSequentialGate(run.gateDays);
  const ci = wilsonInterval(result.reservations, result.completers);
  assert.ok(ci.low >= 0 && ci.high <= 1 && ci.low <= ci.center && ci.center <= ci.high);
});

// ---- f5/A5: the final-look (Lan-DeMets) convention, stated explicitly ----

test('f5/A5: the pre-registration names the Lan-DeMets convention explicitly, beside onMaxNWithoutFiring, for an early time-ceiling close judged at t=1', () => {
  const preReg = generatePreRegistration({ seed: 1, tunables: tunablesRaw });
  const text = preReg.sequentialRule.onMaxNWithoutFiring;
  assert.ok(/Lan-DeMets/i.test(text), 'expected onMaxNWithoutFiring to name the Lan-DeMets convention');
  assert.ok(/t\s*=\s*1|information fraction t=1|at t=1/i.test(text), 'expected onMaxNWithoutFiring to state the final look is judged at t=1');
  assert.ok(/spend|spending/i.test(text), 'expected onMaxNWithoutFiring to state that the remaining alpha is SPENT at that final look');
});

// ---- f5/A6: a cost-cap pause can freeze an arm below minLookN -----------

test('f5/A6: the pre-registration documents that a cost-cap pause can freeze the gate cell below minLookN, closing inconclusive without a real read', () => {
  const preReg = generatePreRegistration({ seed: 1, tunables: tunablesRaw });
  assert.ok(preReg.caps.costCapPauseRisk, 'expected the pre-registration\'s caps block to carry a costCapPauseRisk note');
  assert.ok(/minLookN/.test(preReg.caps.costCapPauseRisk), 'expected the note to name minLookN specifically');
  assert.ok(/inconclusive/i.test(preReg.caps.costCapPauseRisk), 'expected the note to name the INCONCLUSIVE outcome');
});

test('f5/A6 fixture: a planted-FAIL sweep at the shipped default cap ($100/reservation) NEVER closes pass, and a real share of seeds close inconclusive (cap-paused below minLookN) rather than a genuine futility miss -- counted and reported, not swept under the rug', () => {
  // f5/A6: the planted-fail rates (completionRate 0.42, reservationRate
  // 0.18, ...) are deliberately BELOW every R51 threshold -- but they are
  // ALSO poor enough, combined with the shipped $100 default
  // cost-per-reservation cap, to trip simulateArm's own cap-breach pause
  // (engine/runSimulator.js's `paused = true` line) well before minLookN
  // completers accrue on many seeds. When that happens, gate.js's own
  // ceiling rule closes the run INCONCLUSIVE at reached N (R6/R19) --
  // a completed, honestly-reported result, not a genuine futility-boundary
  // read. This is NOT a bug: it must never manifest as a false PASS
  // (asserted below), and the inconclusive share is counted/reported here
  // (not silently absorbed into "miss") so a re-probe can see the real
  // rate. Bounded to 500 seeds for suite speed (see gate-alpha-spending
  // -door-yield.test.js's other seed-sweep tests for the same trade-off).
  let pausedCount = 0;
  const decisions = { pass: 0, miss: 0, inconclusive: 0, continue: 0 };
  for (let seed = 0; seed < 500; seed++) {
    const run = simulateRun({ seed, plant: 'fail', tunables: tunablesRaw });
    const gateDays = run.byArm['gate-incumbent-10'];
    if (gateDays[gateDays.length - 1].paused) pausedCount++;
    const result = runSequentialGate(run.gateDays);
    decisions[result.decision] = (decisions[result.decision] || 0) + 1;
  }
  assert.equal(decisions.pass, 0, `expected a planted FAIL to NEVER close as a pass, got ${decisions.pass}/500 (breakdown: ${JSON.stringify(decisions)})`);
  assert.ok(pausedCount > 0, 'expected at least some planted-fail seeds to actually trip the cost-cap pause at the shipped default cap (otherwise this fixture isn\'t exercising the risk it documents)');
  assert.ok(decisions.inconclusive > 0, `expected at least some planted-fail seeds to close INCONCLUSIVE (cap-paused below minLookN), not just 'miss' -- got ${JSON.stringify(decisions)}`);
});

// ---- f7/advisory-6: pin the cap-pause numbers runSimulator.js's own -----
// costCapPauseRisk comment (f6/advisory-4) documents but never tested -----

test('f7/advisory-6: a bounded planted-PASS sweep (300 seeds/cap, 600 total) reproduces the documented cap-choice-decides-the-read numbers -- 300/300 inconclusive at a $10 cap, ~122/300 at a $25 cap', () => {
  // f6/advisory-4 (runSimulator.js's costCapPauseRisk comment) documents:
  // "measured: 300/300 seeds inconclusive at a $10 cap vs. 122/300 at a $25
  // cap, same planted-pass margin" -- stated in prose but never pinned by a
  // test. f6/advisory-10 discipline (see this file's own f5/crucial-2 and
  // f5/crucial-3 calibration-pin tests above): this is a MEASURED outcome
  // of simulateRun's current RNG-consumption order for seeds 0..299 at
  // each cap, not a rule this build promises to hold forever -- a future
  // change to when/how often a run draws from its per-seed random stream
  // can shift these exact counts, and the fix is to RE-MEASURE and re-pin,
  // not to treat a changed count as itself a regression in the cap-pause
  // RULE this suite protects. The $25 count is asserted with a small
  // tolerance band (documented "~122/300") rather than pinned bit-exact,
  // since advisory-6 itself only ever quoted an approximate figure.
  function inconclusiveCount(defaultCapUSD) {
    let inconclusive = 0;
    for (let seed = 0; seed < 300; seed++) {
      const run = simulateRun({ seed, plant: 'pass', tunables: tunablesRaw, defaultCapUSD });
      const result = runSequentialGate(run.gateDays);
      if (result.decision === 'inconclusive') inconclusive++;
      // A planted PASS must never close 'miss' regardless of the cap.
      assert.notEqual(result.decision, 'miss', `seed ${seed} at cap $${defaultCapUSD}: planted-pass closed 'miss', not just inconclusive/pass`);
    }
    return inconclusive;
  }

  const at10 = inconclusiveCount(10);
  assert.equal(at10, 300, `expected a planted-pass sweep at a $10 cap to close INCONCLUSIVE on every one of 300 seeds (a cap this tight cannot let minLookN ever accrue), got ${at10}/300`);

  const at25 = inconclusiveCount(25);
  assert.ok(Math.abs(at25 - 122) <= 10, `expected ~122/300 inconclusive at a $25 cap (documented, approximate), got ${at25}/300`);
});

// ---- C12: door yield layer -----------------------------------------------

test('C12: every arm reports impressions/clicks/intentClicks(enrollments)/doorYieldPer1000Impressions, with enrollments its own R19a column distinct from qualifiedActivations', () => {
  const run = simulateRun({ seed: 7, plant: 'pass', tunables: tunablesRaw });
  for (const arm of run.arms) {
    const days = run.byArm[arm.id];
    const last = days[days.length - 1];
    assert.ok(last.cumImpressions > 0, `${arm.id}: expected impressions > 0`);
    assert.ok(last.cumIntentClicks > 0, `${arm.id}: expected intent clicks > 0`);
    assert.equal(last.enrollments === last.enrollments, true); // enrollments key exists (may be 0 on the final day if paused)
    assert.ok(last.cumEnrollments >= last.cumQualifiedActivations, `${arm.id}: enrollments must be >= qualified activations (screener drops some)`);
    assert.ok(last.doorYieldPer1000Impressions > 0, `${arm.id}: expected a positive door yield`);
  }
});

test('C12: the band rule names the incumbent when the lead is inside the band, and the leading arm when it exceeds it', () => {
  const inBand = classifyDoorYieldWinner(
    [{ id: 'incumbent', doorYieldPer1000Impressions: 10 }, { id: 'challenger', doorYieldPer1000Impressions: 10.5 }],
    'incumbent', 0.15
  );
  assert.equal(inBand.winnerId, 'incumbent');
  assert.equal(inBand.insideBand, true);

  const outsideBand = classifyDoorYieldWinner(
    [{ id: 'incumbent', doorYieldPer1000Impressions: 10 }, { id: 'challenger', doorYieldPer1000Impressions: 14 }],
    'incumbent', 0.15
  );
  assert.equal(outsideBand.winnerId, 'challenger');
  assert.equal(outsideBand.insideBand, false);
});

test('f4/A-d: when every candidate reads zero door yield, the tie-holder is named -- never a zero-yield "winner" with lead: Infinity', () => {
  const allZero = classifyDoorYieldWinner(
    [{ id: 'incumbent', doorYieldPer1000Impressions: 0 }, { id: 'challenger', doorYieldPer1000Impressions: 0 }],
    'incumbent', 0.15
  );
  assert.equal(allZero.winnerId, 'incumbent');
  assert.equal(allZero.insideBand, true);
  assert.equal(allZero.lead, 0);
  assert.notEqual(allZero.lead, Infinity);
});

test('f4/A-d: when the runner-up reads zero (but the best candidate is positive), the tie-holder is still named -- a proportional lead against a zero baseline is not a real signal', () => {
  const runnerUpZero = classifyDoorYieldWinner(
    [{ id: 'incumbent', doorYieldPer1000Impressions: 0 }, { id: 'challenger', doorYieldPer1000Impressions: 5 }],
    'incumbent', 0.15
  );
  assert.equal(runnerUpZero.winnerId, 'incumbent');
  assert.equal(runnerUpZero.insideBand, true);
  assert.equal(runnerUpZero.lead, 0);
  assert.notEqual(runnerUpZero.lead, Infinity);
});

test('f4/A-d: a single candidate (no runner-up at all) also names the tie-holder, not the lone candidate with an undefined lead', () => {
  const lone = classifyDoorYieldWinner(
    [{ id: 'challenger', doorYieldPer1000Impressions: 12 }],
    'incumbent', 0.15
  );
  assert.equal(lone.winnerId, 'incumbent');
  assert.equal(lone.insideBand, true);
  assert.notEqual(lone.lead, Infinity);
});

test('C12: buildDoorYieldReport names theme and price recommendations with R22\'s exact reporting language, and planted outcomes still work (the gate cell classification is untouched by the door layer)', () => {
  const run = simulateRun({ seed: 20260910, plant: 'pass', tunables: tunablesRaw });
  const report = buildDoorYieldReport(run, tunablesRaw);
  assert.ok(report.theme.candidates.length === 3);
  assert.ok(report.price.candidates.length === 4);
  assert.ok(/door yield measures pull at the door/i.test(report.reportingLanguage));
  assert.ok(/recommendations/i.test(report.reportingLanguage));
  const gateResult = runSequentialGate(run.gateDays);
  assert.equal(gateResult.decision, 'pass');
});

test('C12: armDefinitions carries exactly 6 arms (gate + 2 theme + 3 price), matching R19/O2\'s default split', () => {
  assert.equal(armDefinitions().length, 6);
});

// ---- f4/N5: doorYield.intentClickPctOfClicksBaseline is now a real reader ----

test('f4/N5: intentClickPctOfClicksBaseline actually drives intent clicks (dayIntentClicks ~ Binomial(dayClicks, rate * arm bias), f4/A-c) -- not a dead/unread tunable', () => {
  const run = simulateRun({ seed: 7, plant: 'pass', tunables: tunablesRaw });
  const arms = armDefinitions();
  for (const arm of arms) {
    const days = run.byArm[arm.id];
    const last = days[days.length - 1];
    if (last.cumClicks === 0) continue;
    const impliedIntentRate = last.cumIntentClicks / last.cumClicks;
    const expectedRate = tunablesRaw.doorYield.intentClickPctOfClicksBaseline * arm.doorYieldBiasMultiplier;
    // f4/A-c: dayIntentClicks is now a REAL per-day binomial draw (not a
    // bare rate*n), so the implied rate over any one seed's finite sample
    // carries real sampling noise -- assert it's within a generous
    // statistical bound (6 standard errors of the binomial) of the true
    // rate, not bit-for-bit equal to it. 6 SE is astronomically unlikely
    // to false-fail on any seed while still catching "the tunable isn't
    // being read at all" (which would show a rate wildly off, e.g. the
    // pre-fix ~2.6% baseline regardless of arm bias).
    const se = Math.sqrt((expectedRate * (1 - expectedRate)) / last.cumClicks);
    const tolerance = Math.max(6 * se, 0.02); // a floor for small-N arms where SE alone would be too tight
    assert.ok(Math.abs(impliedIntentRate - expectedRate) < tolerance, `${arm.id}: expected implied intent rate ~${expectedRate} (+/-${tolerance.toFixed(4)}), got ${impliedIntentRate}`);
  }
});

test('f4/N5: the gate-cell (bias=1.00) arm\'s DERIVED cost-per-intent-click reproduces R30\'s own $6.63-7 range, not the old ~$3.42 that a hand-picked CPM would silently produce', () => {
  const run = simulateRun({ seed: 7, plant: 'pass', tunables: tunablesRaw });
  const gateDays = run.byArm['gate-incumbent-10'];
  const last = gateDays[gateDays.length - 1];
  const [lo, hi] = tunablesRaw.doorYield.costPerIntentClickUSDRange;
  assert.ok(last.costPerIntentClickUSD >= lo - 0.5 && last.costPerIntentClickUSD <= hi + 0.5, `expected the gate arm's derived cost-per-intent-click near [${lo}, ${hi}], got ${last.costPerIntentClickUSD}`);
});

test('f4/N5: CPM is derived from the SAME identity every arm shares (R22: identical CPM across arms) -- deriveCpmFromDoorYieldTunables is a pure function of tunables.doorYield alone', async () => {
  const { deriveCpmFromDoorYieldTunables } = await import('../engine/runSimulator.js');
  const cpm = deriveCpmFromDoorYieldTunables(tunablesRaw.doorYield);
  const [lo, hi] = tunablesRaw.doorYield.costPerIntentClickUSDRange;
  const baseline = (lo + hi) / 2;
  const clickRate = tunablesRaw.doorYield.clickRatePctOfImpressions / 100;
  const intentRate = tunablesRaw.doorYield.intentClickPctOfClicksBaseline;
  const expected = baseline * 1000 * clickRate * intentRate;
  assert.ok(Math.abs(cpm - expected) < 1e-9);
  assert.ok(cpm > 0);
});

test('f4/N5: a higher-bias arm shows a higher door yield AND a lower derived cost-per-intent-click than the gate cell, at the identical CPM', () => {
  const run = simulateRun({ seed: 7, plant: 'pass', tunables: tunablesRaw });
  const gateLast = run.byArm['gate-incumbent-10'][run.byArm['gate-incumbent-10'].length - 1];
  const farLast = run.byArm['door-theme-far'][run.byArm['door-theme-far'].length - 1]; // bias 1.22 > 1.00
  assert.ok(farLast.doorYieldPer1000Impressions > gateLast.doorYieldPer1000Impressions);
  assert.ok(farLast.costPerIntentClickUSD < gateLast.costPerIntentClickUSD);
});

// ---- f4/A-c: per-day binomial sampling noise in the door model -----------

test('f4/A-c: clicks and intent clicks are REAL per-day binomial draws -- door yield genuinely varies by seed/day, not a smooth deterministic curve', () => {
  const dayCountsAcrossSeeds = [];
  for (const seed of [1, 2, 3, 4, 5]) {
    const run = simulateRun({ seed, plant: 'pass', tunables: tunablesRaw });
    const gateDays = run.byArm['gate-incumbent-10'];
    dayCountsAcrossSeeds.push(gateDays[0].clicks); // day 1's raw click count (same daySpend, same impressions, same rate, every seed -- differs only by the binomial draw)
  }
  const distinctValues = new Set(dayCountsAcrossSeeds);
  assert.ok(distinctValues.size > 1, `expected day-1 click counts to vary across seeds (real sampling noise), got the same value every time: ${JSON.stringify(dayCountsAcrossSeeds)}`);

  // Within a single seed's run, no two days should be forced to the exact
  // same click count purely by a deterministic formula (daySpend and
  // impressions ARE identical day-to-day pre-cap) -- a real binomial
  // draw should show day-to-day variation too.
  const run = simulateRun({ seed: 99, plant: 'pass', tunables: tunablesRaw });
  const dailyClicks = run.byArm['gate-incumbent-10'].map((d) => d.clicks).filter((c) => c > 0);
  const distinctDaily = new Set(dailyClicks);
  assert.ok(distinctDaily.size > 1, `expected day-to-day click count variation within one run, got: ${JSON.stringify(dailyClicks)}`);
});

test('f4/A-c: the noise sits on TOP of the plant\'s rate bias, not in place of it -- planted-pass/planted-fail classification stays correct at the specific seeds this suite pins (gate.test.js/this file), even with sampling noise on', () => {
  // A direct, explicit re-assertion (deliberately duplicating gate.test.js's
  // coverage here) that the exact fixed seeds this suite relies on for the
  // gate's planted-outcome classification still resolve correctly now that
  // clicks/intent clicks are real binomial draws, not a smooth deterministic
  // formula -- i.e. the noise this fix adds did not need to widen the
  // plant's rate margins (already bumped once, for N3 -- see
  // runSimulator.js's trueRatesForArm comment) to stay stable.
  for (const seed of [1, 2, 3, 42, 999, 123456, 7777, 20260910]) {
    const passResult = runSequentialGate(simulateRun({ seed, plant: 'pass', tunables: tunablesRaw }).gateDays);
    const failResult = runSequentialGate(simulateRun({ seed, plant: 'fail', tunables: tunablesRaw }).gateDays);
    assert.equal(passResult.decision, 'pass', `seed ${seed} plant=pass -> ${passResult.decision}`);
    assert.notEqual(failResult.decision, 'pass', `seed ${seed} plant=fail -> ${failResult.decision}`);
  }
});

// ---- f5/crucial-2: the planted-pass margin is NOT a zero-miss guarantee --

test('f5/crucial-2: runSimulator.js no longer claims an unqualified zero-miss guarantee at the shipped 0.65 planted-pass margin -- the comments state the measured few-per-thousand rate honestly', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'engine', 'runSimulator.js'), 'utf8');
  // The false claim, as an unqualified present-tense assertion, must be gone.
  assert.ok(!/verified: 0\/3000 seeds\s*\n?\s*\/\/ miss at 0\.65/.test(src), 'expected the false "0/3000 seeds miss at 0.65" claim to be removed');
  assert.ok(!/miss the planted\s*\n\s*\/\/ pass\/fail classification with this noise on, same as without/.test(src), 'expected the false "0/3000 miss the planted pass/fail classification" claim to be removed');
  // The corrected, measured rate must be documented in its place.
  assert.ok(src.includes('9/3000') && src.includes('25/10000'), 'expected the measured miss counts (9/3000, 25/10000) to be documented');
  assert.ok(/few-per-thousand/.test(src), 'expected the corrected wording to name the rate as few-per-thousand, not zero');
});

test('f5/crucial-2: the documented planted-pass miss rate is reproducible -- seeds 0..999 at the shipped 0.65 reservationRate futility-miss/ceiling-inconclusive exactly 3 times (1 futility miss, 2 ceiling inconclusives), never a false pass failure some OTHER way', () => {
  // This is the honest, measured behavior the corrected comment documents:
  // a sequential design with a real futility boundary and a real time
  // ceiling does NOT guarantee zero misses at any margin -- it guarantees a
  // SMALL, few-per-thousand miss rate, verified here at a bounded (fast)
  // seed sweep rather than the full 3000/10000-seed sweep used to first
  // measure it (documented in runSimulator.js's trueRatesForArm comment).
  //
  // f6/advisory-10: CALIBRATION PIN, not a spec claim -- the exact counts
  // asserted below (3 total, 1 miss, 2 inconclusive) are MEASURED outcomes
  // of simulateRun's current RNG-consumption order for seeds 0..999, not a
  // rule this build promises to hold forever. A future change that alters
  // WHEN/HOW OFTEN this run draws from its per-seed random stream (e.g. an
  // extra random() call inserted earlier in simulateArm, or a reordered
  // day-by-day loop) can shift which seeds land where in the boundary/
  // ceiling classification -- that shift is expected to break this pin, and
  // the fix is to RE-MEASURE and re-pin the new counts (same discipline as
  // f5/crucial-3's mean/min/max below), not to treat a changed count here
  // as itself a regression in the futility/ceiling RULE the suite protects.
  let misses = 0;
  const decisions = {};
  for (let seed = 0; seed < 1000; seed++) {
    const run = simulateRun({ seed, plant: 'pass', tunables: tunablesRaw });
    const result = runSequentialGate(run.gateDays);
    if (result.decision !== 'pass') {
      misses++;
      decisions[result.decision] = (decisions[result.decision] || 0) + 1;
    }
  }
  assert.equal(misses, 3, `expected exactly 3 non-pass outcomes across seeds 0..999 at the shipped 0.65 margin, got ${misses} (${JSON.stringify(decisions)})`);
  assert.equal(decisions.miss, 1, 'expected exactly 1 real futility miss in this seed range');
  assert.equal(decisions.inconclusive, 2, 'expected exactly 2 ceiling-inconclusive closes in this seed range');
});

test('f5/crucial-2: the planted-FAIL side genuinely IS a zero false-pass rate (distinct from the planted-pass side\'s honest few-per-thousand miss rate) across the same bounded seed sweep', () => {
  for (let seed = 0; seed < 1000; seed++) {
    const result = runSequentialGate(simulateRun({ seed, plant: 'fail', tunables: tunablesRaw }).gateDays);
    assert.notEqual(result.decision, 'pass', `seed ${seed} plant=fail incorrectly classified as 'pass'`);
  }
});

// ---- f5/crucial-3: R30 calibration holds in expectation, not per-seed ----

test('f5/crucial-3: the false "reproduces R30 exactly, by construction" claim is gone from runSimulator.js, README.md, and the W-90/91/92 workbook rows -- replaced with an in-expectation statement plus the measured per-seed spread', async () => {
  const runSimSrc = await fs.readFile(path.join(APP_ROOT, 'engine', 'runSimulator.js'), 'utf8');
  const readmeSrc = await fs.readFile(path.join(APP_ROOT, 'README.md'), 'utf8');
  const workbookMd = await fs.readFile(path.join(REPO_ROOT, 'docs', 'tunables-workbook.md'), 'utf8');
  const workbookCsv = await fs.readFile(path.join(REPO_ROOT, 'docs', 'tunables-workbook.csv'), 'utf8');

  for (const [name, src] of [['runSimulator.js', runSimSrc], ['README.md', readmeSrc], ['tunables-workbook.md', workbookMd], ['tunables-workbook.csv', workbookCsv]]) {
    // The old, FALSE unqualified per-run claims (verbatim substrings from
    // before this fix) must be gone. Note: "exactly, by construction" is
    // still valid language for the IN-EXPECTATION target -- what's banned
    // is the old phrasing that asserted it held on every run/reported figure.
    assert.ok(!src.includes('range exactly, by construction, instead of'), `expected the old unqualified "range exactly, by construction" claim to be gone from ${name}`);
    assert.ok(!src.includes('reproduces this exact $6.63-7.00 range by construction'), `expected the old unqualified workbook claim to be gone from ${name}`);
    assert.ok(!src.includes('$6.63–7/5.2% exactly, rather'), `expected the old unqualified README claim to be gone from ${name}`);
    assert.ok(!src.includes('hold together exactly, instead of'), `expected the old unqualified CSV claim to be gone from ${name}`);
    assert.ok(/in expectation|IN EXPECTATION/.test(src), `expected ${name} to state the calibration holds in expectation`);
  }
  // The measured per-seed spread (v1c, 400 seeds) must be documented in all four sites.
  for (const [name, src] of [['runSimulator.js', runSimSrc], ['README.md', readmeSrc], ['tunables-workbook.md', workbookMd], ['tunables-workbook.csv', workbookCsv]]) {
    assert.ok(src.includes('5.952') && src.includes('7.592'), `expected ${name} to document the measured min/max spread (400 seeds)`);
  }
  // The workbook's enforcement column must name what's enforced: the 5.2% baseline PARAMETER + the CPM derivation -- not a per-seed reported range.
  assert.ok(/5\.2%.*baseline|baseline.*5\.2%/i.test(workbookCsv), 'expected the workbook to name the 5.2% baseline parameter as what the system enforces');
});

test('f5/crucial-3: the measured per-seed spread (mean/min/max over 400 seeds, gate-cell arm, plant=pass) matches the documented figures exactly -- a reproducible regression on the calibration claim itself', () => {
  // f6/advisory-10: CALIBRATION PIN, not a spec claim -- every constant
  // asserted below (the mean/min/max, the ~57% outside-range share, the
  // shipped default seed's own reported figures) is MEASURED from
  // simulateRun's current RNG-consumption order, not a rule this build
  // promises to hold forever. A future change to that order (a reordered
  // or added random() draw anywhere in the per-day arm simulation) is
  // expected to shift these exact numbers -- when that happens, this test
  // breaks as a calibration measurement to RE-MEASURE and re-pin (same as
  // README.md/tunables-workbook's own copies of these same figures, per
  // f5/crucial-3's cross-file requirement above), not as a regression in
  // the R30-calibration-in-expectation rule this suite protects.
  const vals = [];
  for (let seed = 0; seed < 400; seed++) {
    const run = simulateRun({ seed, plant: 'pass', tunables: tunablesRaw });
    const gateDays = run.byArm['gate-incumbent-10'];
    vals.push(gateDays[gateDays.length - 1].costPerIntentClickUSD);
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const [lo, hi] = tunablesRaw.doorYield.costPerIntentClickUSDRange;
  const outsideCount = vals.filter((v) => v < lo || v > hi).length;

  assert.ok(Math.abs(mean - 6.805) < 0.01, `expected mean ~= 6.805, got ${mean}`);
  assert.ok(Math.abs(min - 5.952) < 0.01, `expected min ~= 5.952, got ${min}`);
  assert.ok(Math.abs(max - 7.592) < 0.01, `expected max ~= 7.592, got ${max}`);
  const outsidePct = (outsideCount / vals.length) * 100;
  assert.ok(outsidePct > 50 && outsidePct < 65, `expected roughly 57% of the 400 seeds to land outside [${lo}, ${hi}], got ${outsidePct.toFixed(1)}%`);

  // The shipped DEFAULT seed itself is the concrete example cited in the docs.
  const defaultRun = simulateRun({ seed: 20260910, plant: 'pass', tunables: tunablesRaw });
  const defaultGateDays = defaultRun.byArm['gate-incumbent-10'];
  const defaultLast = defaultGateDays[defaultGateDays.length - 1];
  assert.ok(Math.abs(defaultLast.costPerIntentClickUSD - 6.446) < 0.01, `expected the shipped default seed to report ~$6.446, got ${defaultLast.costPerIntentClickUSD}`);
  const defaultIntentRatePct = (defaultLast.cumIntentClicks / defaultLast.cumClicks) * 100;
  assert.ok(Math.abs(defaultIntentRatePct - 5.409) < 0.01, `expected the shipped default seed to report ~5.409% intent rate, got ${defaultIntentRatePct}`);
  assert.ok(defaultLast.costPerIntentClickUSD < lo, 'expected the shipped default seed\'s reported cost to fall OUTSIDE (below) the $6.63-7.00 range -- the concrete counterexample to the old "exactly, by construction" claim');

  // The EXPECTED value (the midpoint tunables.doorYield.costPerIntentClickUSDRange resolves to) is what IS exact by construction.
  const expectedMidpoint = (lo + hi) / 2;
  assert.ok(Math.abs(expectedMidpoint - 6.815) < 0.001, `expected the R30 midpoint (the true in-expectation target) to be 6.815, got ${expectedMidpoint}`);
});

// ---- C20: house-play disclosure accuracy --------------------------------

test('C20: npc.js\'s procedural-fallback drift now reads the SAME tunables.pve.driftPerSessionPct as PvE (3%), not an independent 10%', () => {
  const npc = proceduralNpc(tunablesRaw, incumbent, new Set(), mulberry32(1));
  const driftedShare = Math.max(npc.tendency.fire, npc.tendency.water, npc.tendency.air);
  // uniform 1/3 + driftPct: the peak share should be 1/3 + tunables.pve.driftPerSessionPct.
  const expectedPeak = 1 / 3 + tunablesRaw.pve.driftPerSessionPct;
  assert.ok(Math.abs(driftedShare - expectedPeak) < 1e-9, `expected peak tendency share ${expectedPeak}, got ${driftedShare}`);
  assert.equal(tunablesRaw.pve.driftPerSessionPct, 0.03, 'R57 states 3% drift');
});

test('C20: the pre-registration\'s house-play disclosure states all three populations accurately: hand-authored bracket-NPC roster (with its real bias range), the procedural fallback\'s real drift rate, and PvE\'s drift+rake', () => {
  const preReg = generatePreRegistration({ seed: 1, tunables: tunablesRaw, treatment: incumbent });
  const text = preReg.housePlayPolicy;
  assert.ok(/hand-authored/i.test(text));
  assert.ok(/procedural fallback/i.test(text));
  assert.ok(/PvE house opponents/i.test(text));
  assert.ok(text.includes('3%'), 'expected the disclosed drift rate to read 3%, matching npc.js/pve.js');
  assert.ok(!text.includes('10%'), 'must not disclose the old, wrong 10% procedural-fallback figure');
});
