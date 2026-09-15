// app/engine/gate.js
// R51/R21/R28 — the legs gate, read daily under a pre-registered sequential
// stopping rule. Pure functions over daily cumulative arm metrics (produced
// by engine/runSimulator.js for the synthetic run, or read from the real
// ledger's aggregated daily rollup in a live deployment) so the exact same
// classification logic runs in a unit test, in the console, and in the
// eventual live run.
//
// The rule (documented here AND surfaced verbatim in the console's
// pre-registration panel per R21):
//   - Primary signal: reservation rate among the gate cell's first-bracket
//     completers vs the R51 setpoint (0.35), read as a z-score against the
//     null (rate == threshold) with the normal approximation to the binomial.
//   - Efficacy boundary (C10/f2 -- a REAL alpha-spending design, not a fixed
//     z at every look): a Lan-DeMets/O'Brien-Fleming-type spending function
//     over information fraction t = completers/maxN (app/engine/
//     alphaSpending.js). z >= the boundary AT THE CURRENT t, at n >=
//     MIN_LOOK_N completers, AND at least two of the R51 secondary signals
//     also pass, AND cost per reservation is at/under the console cap ->
//     PASS.
//   - Futility boundary: its own separate, non-spending-derived rule --
//     z <= FUTILITY_Z, at n >= MIN_LOOK_N -> MISS (honest no, R8).
//   - Maximum N (R28, spend-bound ~50 first-bracket completers in the gate
//     cell) OR the time ceiling (whichever arrives first, R6): if neither
//     boundary has fired by then, the run closes at its reached N -- a
//     completed result, reported with its reached Wilson interval, and
//     treated as a miss (R6/R19) in the verdict/report language -- UNLESS
//     the reached-N read itself crosses the real efficacy boundary
//     evaluated at t=1 (the final/end-of-study spending fraction; NOT a
//     bare "z >= 0" shortcut -- f4/N3 fix, R6/R19/R21/R28), in which case
//     it is reported as a pass at that N. There is no other way to close
//     as a pass at a ceiling.
//
// C9/f2 fix: GATE_THRESHOLDS/SEQUENTIAL_RULE below used to be independent
// frozen literals -- a SECOND copy of numbers also hand-duplicated a THIRD
// time in engine/runSimulator.js's generatePreRegistration. Now there is
// ONE source: tunables.json's "gate" key (+ the console's gateOverrides
// patch layer, app/engine/overrides.js). `deriveGateConfig(tunables)` is
// the pure conversion function every surface (this module's own defaults,
// runSimulator.js's pre-registration text, the console's display) calls;
// GATE_THRESHOLDS/SEQUENTIAL_RULE below are just `deriveGateConfig` applied
// to the SHIPPED tunables.json once at import time (via a synchronous
// top-level await of dataLoader.js), so a caller that doesn't need
// override-awareness (most existing tests) still gets numbers that
// literally came from tunables.json, not a hand-copied duplicate of it.

import { loadTunables } from './dataLoader.js';
import { obrienFlemingBoundaryZ } from './alphaSpending.js';

/** Pure: tunables (already override-applied, e.g. via effectiveTunables) ->
 * the shape this module's classification functions consume. The ONE place
 * that maps tunables.json's "gate" key into gate.js's working shape. */
export function deriveGateConfig(tunables) {
  const g = tunables.gate;
  const sr = g.sequentialRule || {};
  return {
    thresholds: {
      reservationRate: g.reservationRateThreshold,
      replayAfterLoss: g.replayAfterLossThreshold,
      bracketsPerActivePlayerWithin48h: g.bracketsPerActivePlayerWithin48h,
      d1Return: g.d1ReturnThreshold,
      firstBracketCompletion: g.firstBracketCompletionThreshold,
    },
    secondaryRequiredCount: g.secondaryRequiredCount ?? 2,
    sequentialRule: {
      minLookN: sr.minLookN,
      maxN: sr.maxN,
      totalAlphaOneSided: sr.totalAlphaOneSided,
      spendingFunction: sr.spendingFunction,
      futilityZ: sr.futilityZ,
      plannedLookNs: sr.plannedLookNs || [],
    },
  };
}

const _shippedTunables = await loadTunables();
const _defaultConfig = deriveGateConfig(_shippedTunables);

// Backward-compatible named exports (many existing tests read these
// directly) -- now DERIVED from tunables.json rather than a hand-typed
// second copy of it.
export const GATE_THRESHOLDS = Object.freeze({ ..._defaultConfig.thresholds });
export const SEQUENTIAL_RULE = Object.freeze({ ..._defaultConfig.sequentialRule });

function zScore(observedRate, threshold, n) {
  if (n <= 0) return 0;
  const se = Math.sqrt((threshold * (1 - threshold)) / n);
  if (se === 0) return 0;
  return (observedRate - threshold) / se;
}

/**
 * Evaluate one day's cumulative gate-cell read against the sequential rule.
 * @param {object} cum cumulative-to-date metrics for the gate cell:
 *   { completers, reservations, replayAfterLossRate, bracketsPerActivePlayerWithin48h,
 *     d1ReturnRate, firstBracketCompletionRate, costPerReservationUSD, costCapUSD }
 * @param {number} day the day index (for the returned record only)
 * @param {boolean} [atCeiling] true when this is the run's last observable
 *   day (R6: the 14-day time ceiling closes the run exactly like reaching
 *   max N does, even if max N itself was not reached).
 * @param {object} [config] C9: defaults to this module's tunables.json-
 *   derived defaults; pass `deriveGateConfig(effectiveTunables(...))` to
 *   honor a live console gate-override patch.
 */
export function evaluateDailyGate(cum, day, atCeiling = false, config = _defaultConfig) {
  const {
    completers = 0, reservations = 0,
    replayAfterLossRate = 0, bracketsPerActivePlayerWithin48h = 0,
    d1ReturnRate = 0, firstBracketCompletionRate = 0,
    costPerReservationUSD = null, costCapUSD = null,
  } = cum;

  const { thresholds, sequentialRule, secondaryRequiredCount } = config;

  const observedRate = completers > 0 ? reservations / completers : 0;
  const z = zScore(observedRate, thresholds.reservationRate, completers || 1);
  const secondaryChecks = {
    replayAfterLoss: replayAfterLossRate >= thresholds.replayAfterLoss,
    bracketsPerActivePlayerWithin48h: bracketsPerActivePlayerWithin48h >= thresholds.bracketsPerActivePlayerWithin48h,
    d1Return: d1ReturnRate >= thresholds.d1Return,
    firstBracketCompletion: firstBracketCompletionRate >= thresholds.firstBracketCompletion,
  };
  const secondaryPassCount = Object.values(secondaryChecks).filter(Boolean).length;
  const costOk = costCapUSD == null || costPerReservationUSD == null || costPerReservationUSD <= costCapUSD;

  // C10: the REAL alpha-spending efficacy boundary at THIS look's
  // information fraction (t = completers / maxN, capped at 1).
  const t = Math.min(1, completers / sequentialRule.maxN);
  const efficacyZ = obrienFlemingBoundaryZ(t, sequentialRule.totalAlphaOneSided);

  const base = { day, completers, reservations, observedRate, z, secondaryChecks, secondaryPassCount, costOk, informationFraction: t, efficacyBoundaryZ: efficacyZ };

  if (completers < sequentialRule.minLookN) {
    if (atCeiling) return { ...base, decision: 'inconclusive', reason: `run reached its time ceiling with n=${completers}, below the minimum look N (${sequentialRule.minLookN}) -- inconclusive at reached N (R6/R19)` };
    return { ...base, decision: 'continue', reason: `n=${completers} below the minimum look N (${sequentialRule.minLookN})` };
  }
  if (z >= efficacyZ && secondaryPassCount >= secondaryRequiredCount && costOk) {
    return { ...base, decision: 'pass', reason: `efficacy boundary crossed (z=${z.toFixed(3)} >= ${efficacyZ.toFixed(3)} at t=${t.toFixed(2)}); >=${secondaryRequiredCount} secondary signals passed; cost within cap` };
  }
  if (z <= sequentialRule.futilityZ) {
    return { ...base, decision: 'miss', reason: 'futility boundary crossed' };
  }
  if (completers >= sequentialRule.maxN || atCeiling) {
    // f4/N3 fix: a run that reaches either ceiling (max N OR the time
    // ceiling) without an earlier boundary fire closes INCONCLUSIVE at its
    // reached N, full stop -- R6 verbatim: "a run reaching either ceiling
    // closes as inconclusive at its reached N -- a completed result,
    // reported with its interval, and treated as a miss (R19)." There is
    // NO alternate "z >= 0" carve-out that declares a pass here: the ONLY
    // way to close as a pass at a ceiling is for the REAL efficacy boundary,
    // evaluated at t=1 (the final/end-of-study spending fraction -- the
    // most lenient point on an O'Brien-Fleming-type boundary, and the
    // correct one to test against once this is the run's last look,
    // whether that's because max N was reached [t is already 1, see line
    // above] or because the time ceiling arrived first [t was < 1 at the
    // interim look above but the FINAL boundary is still the right bar for
    // a last-look decision]), to be crossed -- i.e. exactly the same
    // efficacy test as the earlier z >= efficacyZ branch above, just
    // re-evaluated at the final t. Since that branch already returned
    // whenever it held, reaching this line means it did NOT hold at this
    // day's t; recomputing at t=1 only matters for the early-time-ceiling
    // case (t < 1 above) and is a no-op restatement for the max-N case
    // (t was already 1). Either way: no pass without a real boundary
    // crossing at the final fraction.
    const finalEfficacyZ = obrienFlemingBoundaryZ(1, sequentialRule.totalAlphaOneSided);
    const clears = z >= finalEfficacyZ && secondaryPassCount >= secondaryRequiredCount && costOk;
    const reasonPrefix = completers >= sequentialRule.maxN
      ? 'maximum N reached without an earlier boundary fire'
      : 'time ceiling reached without an earlier boundary fire or max N';
    if (clears) {
      return { ...base, decision: 'pass', reason: `${reasonPrefix}; the reached-N read itself crosses the efficacy boundary at t=1 (z=${z.toFixed(3)} >= ${finalEfficacyZ.toFixed(3)}), >=${secondaryRequiredCount} secondary signals passed, cost within cap -- reported as a pass at that N (R6)` };
    }
    return { ...base, decision: 'inconclusive', reason: `${reasonPrefix} -- closes INCONCLUSIVE at reached N (R6/R19: a completed result, reported with its reached Wilson interval, treated as a miss in verdict/report language); efficacy boundary at t=1 not crossed (z=${z.toFixed(3)} < ${finalEfficacyZ.toFixed(3)})` };
  }
  return { ...base, decision: 'continue', reason: 'no boundary crossed yet' };
}

/**
 * Walk a daily series of cumulative gate-cell snapshots (each already
 * accumulated through that day, oldest first) and return the record for the
 * day the sequential rule fires -- or the final day's read (forced to a
 * closing decision by the R6 time ceiling) if it never fires earlier.
 */
export function runSequentialGate(dailySeries, config = _defaultConfig) {
  for (let i = 0; i < dailySeries.length; i++) {
    const day = dailySeries[i];
    const atCeiling = i === dailySeries.length - 1;
    const result = evaluateDailyGate(day, day.day, atCeiling, config);
    if (result.decision !== 'continue') return result;
  }
  return null;
}
