// app/engine/alphaSpending.js
// C10/R21/R28 — Lan-DeMets (1983) error-spending group-sequential design, an
// O'Brien-Fleming-TYPE spending function, one-sided. This replaces the
// pre-f2 "sequential rule" (a single fixed z=1.645 efficacy boundary at
// every look), which spent the SAME nominal alpha on day 1 as on day 50 --
// not a real spending design, just a fixed-threshold rule dressed as one
// (C10's finding: "the pre-registration claims alpha spending that doesn't
// exist").
//
// One-sided analogue of the classic OBF spending function (the two-sided
// form is alpha*(t) = 2 - 2*Phi(z_{a/2}/sqrt(t))):
//
//     alpha*(t) = 1 - Phi( z_a / sqrt(t) ),   z_a = Phi^-1(1 - totalAlpha)
//
// so alpha*(1) = totalAlpha exactly (100% of the pre-registered one-sided
// alpha is spent once information fraction t = n/maxN reaches 1), and
// alpha*(t) -> 0 as t -> 0 (a very high bar to stop early, the whole point
// of a spending design over a fixed-threshold one).
//
// NORMAL-APPROXIMATION, documented per the brief ("a documented
// normal-approximation implementation is acceptable"): the exact recursive
// Lan-DeMets boundary at look k solves a nested multivariate-normal
// integral over every PRIOR look (accounting for the correlation between
// successive interim test statistics on accumulating data) so that the
// FAMILY-WISE probability of ever crossing the boundary equals the
// cumulative alpha spent. That recursive integral is not implemented here.
// Instead, `obrienFlemingBoundaryZ(t)` returns the MARGINAL z that would
// spend exactly alpha*(t) in a single, one-look normal test -- the boundary
// SHAPE this produces (very conservative early, relaxing to the nominal
// bound at t=1) matches the textbook OBF picture and the total alpha spent
// by t=1 is exactly the pre-registered value, but the exact family-wise
// alpha guarantee of the full recursive design is only approximated, not
// proven, by this implementation. Every surface that shows this boundary
// (the console's pre-registration panel, app/ui/console/runPanel.js) states
// this in the same words.
//
// Pocock-style constant boundary (`pocockBoundaryZ`) is also implemented
// below, per the brief's fallback allowance ("If you judge the full spend
// function too heavy, implement Pocock's constant boundary with the
// correct per-look alpha and SAY SO on every surface -- but prefer the
// spending function"). This build's primary choice is the OBF-type
// spending function above (see tunables.json: gate.sequentialRule.
// spendingFunction); Pocock is exposed for comparison/future rounds.

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation
 * (|error| <= 1.5e-7) -- accurate enough for a boundary display/decision
 * rule, not a cryptographic or scientific-publication-grade computation. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

export function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Inverse standard normal CDF via bisection over `normCdf` -- deliberately
 * not a rational-approximation polynomial (fewer constants to get subtly
 * wrong); accurate to ~1e-9 in under 60 iterations over [-10, 10]. */
export function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let lo = -10, hi = 10;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (normCdf(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Cumulative one-sided alpha spent by information fraction t in (0,1]
 * under the O'Brien-Fleming-type Lan-DeMets spending function. */
export function obrienFlemingAlphaSpent(t, totalAlpha = 0.05) {
  if (t <= 0) return 0;
  const clampedT = Math.min(t, 1);
  const zAlpha = normInv(1 - totalAlpha);
  return 1 - normCdf(zAlpha / Math.sqrt(clampedT));
}

/** The (normal-approximation) per-look efficacy z-boundary at information
 * fraction t: monotonically DECREASING as t rises from 0 to 1, landing
 * exactly on normInv(1-totalAlpha) at t=1 -- the classic OBF shape (very
 * hard to stop early, relaxing to the nominal bound at the max look). */
export function obrienFlemingBoundaryZ(t, totalAlpha = 0.05) {
  const spent = obrienFlemingAlphaSpent(t, totalAlpha);
  return normInv(1 - spent);
}

/** Pocock-style constant boundary: a fixed per-look alpha (a simple
 * Bonferroni split of totalAlpha across `totalLooks` planned looks),
 * producing ONE constant z threshold for every look -- simpler and more
 * conservative early than the spending-function boundary above. Exposed
 * per the brief's fallback allowance; not this build's primary rule. */
export function pocockBoundaryZ(totalLooks, totalAlpha = 0.05) {
  const perLookAlpha = totalAlpha / Math.max(1, totalLooks);
  return normInv(1 - perLookAlpha);
}

/** Wilson score 95% confidence interval for a binomial rate (C11/R51/R28) --
 * chosen over the plain normal-approximation interval because it stays
 * inside [0,1] and behaves far better at small/moderate n (exactly the
 * regime this gate reads in: n up to ~50). */
export function wilsonInterval(successes, n, z = 1.959963984540054) { // z for 95% two-sided
  if (n <= 0) return { low: 0, high: 0, center: 0 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const halfWidth = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, center - halfWidth), high: Math.min(1, center + halfWidth), center: p };
}
