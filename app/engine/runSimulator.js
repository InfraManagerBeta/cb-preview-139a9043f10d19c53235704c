// app/engine/runSimulator.js
// R19/R19a/R21/R22 + AC0 "synthetic end-to-end run" — a deterministic,
// seeded synthetic-cohort generator that simulates a run day by day across
// the gate cell and the door arms, in the funnel shape §5/§6 describe
// (impressions -> clicks -> intent clicks/enrollments -> qualified
// activations -> first-bracket completions -> reservations, replay-after-
// loss, D1 return, spend), so the console's Run & Gates panel has real
// (synthetic) daily numbers to display and the R51 gate has real cumulative
// reads to classify.
//
// This is explicitly a synthetic statistical model, not a full ledger replay
// of simulated participants -- documented as such (R29: "synthetic evidence
// ... qualifies the machine"). It accepts a `plant` parameter (AC0: "synthetic
// runs clear R51's gate logic on planted outcomes") that sets the gate
// cell's underlying true rates comfortably above or below every R51
// threshold, so the classifier can be proven correct on both a planted pass
// and a planted fail.
//
// C9/f2: thresholds/sequential-rule numbers are no longer hand-copied here
// a third time -- `generatePreRegistration` reads them from
// `engine/gate.js`'s `deriveGateConfig(tunables)`, the SAME function the
// live gate classification uses (see engine/gate.js's header comment).
//
// C12/f2: the door-yield layer (R22/R19a/R30) -- impressions, clicks,
// intent clicks (door yield = intent clicks per 1,000 impressions),
// enrollments (R19a's own column), cost per intent click, reservations per
// 1,000 impressions -- plus the pre-registered BAND rule that names theme/
// price winners (or holds the incumbent) from door yield alone.

import { mulberry32 } from './rng.js';
import { deriveGateConfig } from './gate.js';
import { obrienFlemingAlphaSpent, obrienFlemingBoundaryZ, wilsonInterval } from './alphaSpending.js';
import { loadTunables, loadTreatment } from './dataLoader.js';
import { rosterBiasRange } from './npc.js';

export const TOTAL_SPEND_USD = 5000;
export const MAX_DAYS = 14;
export const GATE_CELL_SPEND_SHARE = 0.70; // R6: gate cell holds >=70% of spend

// CB-BUILD-017/AC1: "link -> first duel", measured to the player's first
// submitted seal -- the pilot bar is median under two minutes, 90th
// percentile under four, with a first duel that times out (hesitated)
// excluded from the numerator. No live pilot telemetry exists for this
// artifact yet -- these two figures are ASSUMED synthetic placeholders
// (comfortably inside the stated bar), reported fixed per run rather than
// re-derived per day, documented here instead of invented mid-report.
//
// CB-BUILD-017 fix round f4/Finding 3 (§0/R5 [LAW]): these two figures used
// to render on the console's daily report (ui/console/runPanel.js) with NO
// on-surface ASSUMED marker -- identical formatting to the real, measured
// columns beside them, constant across all 14 days and all five arms
// (including the planted-fail arm), with the only label sitting in this
// source comment, which no console reader ever sees. §0/R5 requires every
// fact be TAGGED where a reader sees it; ASSUMED means "our best guess,
// LABELED," not "our best guess, footnoted in the code."
//
// Fix, per the finding's stated preference order: (a) "wire the REAL
// measurement through where a real ledger exists" does NOT apply here --
// this whole module is a synthetic, day-level statistical cohort generator
// (R29: "synthetic evidence ... qualifies the machine"), not a replay of
// any real per-player ledger; there is no live Game/Ledger instance
// anywhere in this file or reachable from ui/console/runPanel.js for these
// two figures to be derived from (retention.js's real, ledger-derived
// linkToFirstSeal() is exercised end-to-end in
// app/tests/link-to-first-seal.test.js, but against a REAL per-player
// ledger that this synthetic day-level cohort model has no equivalent of
// -- it has no individual simulated players or events, only aggregate
// day-level counts). So (b) applies: the figures stay the same ASSUMED
// synthetic constants, but are now carried on the data (see
// `linkToFirstSealSecondsAssumed` below) so the console can mark them
// ASSUMED on the cell itself, and the same label is recorded in
// docs/disclosure.md.
const LINK_TO_FIRST_SEAL_MEDIAN_SEC = 95;
const LINK_TO_FIRST_SEAL_P90_SEC = 205;
// Single-sourced legend/disclosure wording -- ui/console/runPanel.js reads
// this constant rather than hand-typing its own copy of the same claim, so
// the console legend and docs/disclosure.md's row can both be checked
// against the one string a test can pin.
export const LINK_TO_FIRST_SEAL_ASSUMED_NOTE = 'ASSUMED: no live pilot telemetry exists yet for the link\u2192seal median/90th-percentile seconds -- these are synthetic placeholders, not measured.';

const _shippedTunables = await loadTunables();
const _incumbentTreatment = await loadTreatment('incumbent');

/** R19: door arms share the remaining spend -- two theme arms, three price
 * arms (default), at equal caps, per R19/O1/O2.
 *
 * C12: each arm also carries a `doorYieldBiasMultiplier` -- a synthetic,
 * ASSUMED "true pull at the door" for this artifact (no live ad platform;
 * documented here, not invented mid-report). Multiplier > 1 means a lower
 * (cheaper) true cost-per-intent-click than the tunables-configured
 * baseline, i.e. a HIGHER door yield at the same identical CPM/targeting
 * every arm shares (R22: "under identical message, targeting, pacing, and
 * per-arm cap across arms"). */
export function armDefinitions() {
  const doorShare = (1 - GATE_CELL_SPEND_SHARE) / 5; // 5 door arms, equal split
  return [
    { id: 'gate-incumbent-10', label: 'Gate cell: incumbent @ $10', role: 'gate', treatment: 'incumbent', priceUSD: 10, spendShare: GATE_CELL_SPEND_SHARE, doorYieldBiasMultiplier: 1.00 },
    { id: 'door-theme-adjacent', label: 'Door: Scrapyard Kings @ $10', role: 'door-theme', treatment: 'adjacent', priceUSD: 10, spendShare: doorShare, doorYieldBiasMultiplier: 1.04 },
    { id: 'door-theme-far', label: 'Door: Undercard @ $10', role: 'door-theme', treatment: 'far', priceUSD: 10, spendShare: doorShare, doorYieldBiasMultiplier: 1.22 },
    { id: 'door-price-under', label: 'Door: incumbent @ $5 (under)', role: 'door-price', treatment: 'incumbent', priceUSD: 5, spendShare: doorShare, doorYieldBiasMultiplier: 1.07 },
    { id: 'door-price-over', label: 'Door: incumbent @ $25 (over)', role: 'door-price', treatment: 'incumbent', priceUSD: 25, spendShare: doorShare, doorYieldBiasMultiplier: 0.78 },
    { id: 'door-price-free', label: 'Door: incumbent @ $0 (free play)', role: 'door-price', treatment: 'incumbent', priceUSD: 0, spendShare: doorShare, doorYieldBiasMultiplier: 1.33 },
  ];
}

// Synthetic funnel constants -- ASSUMED for this artifact (documented in the
// console's pre-registration panel), internally consistent with R6's rough
// $70/first-bracket-completer figure once completion-rate drop-off is folded
// in, but not a literal re-derivation of R30's wave-level economics.
const QUALIFICATION_PASS_RATE = 0.85; // enrollments -> qualified activations (screener pass, R70)
// f4/N5: the old hardcoded `ASSUMED_CPM_USD = 8` literal is GONE -- CPM is
// now derived per deriveCpmFromDoorYieldTunables()'s header comment below,
// so there is exactly one source for it (tunables.doorYield), not a second
// hand-typed literal alongside the tunables the model is supposed to read.

/**
 * f4/N5 fix: `tunables.doorYield.intentClickPctOfClicksBaseline` (5.2%,
 * R30/R85, workbook row W-91) used to have ZERO readers -- the simulator's
 * OLD cost-per-intent-click-driven derivation implied a 2.6% intent rate
 * (daySpend/costPerIntentClick clicks, divided by dayClicks), silently
 * disagreeing with both the tunable itself and the workbook's own
 * "enforced by system" claim for that row.
 *
 * The model now READS intentClickPctOfClicksBaseline as the actual driver:
 * `dayIntentClicks = dayClicks * (intentClickPctOfClicksBaseline * arm.doorYieldBiasMultiplier)`
 * (the per-arm bias multiplier still differentiates arms' door yield --
 * moved from the cost-per-click side to the intent-RATE side, same
 * multiplicative effect). `costPerIntentClickUSD` becomes the DERIVED
 * reported quantity (`daySpend / dayIntentClicks`) instead of a fixed
 * per-arm constant read off `costPerIntentClickUSDRange` directly.
 *
 * That leaves FOUR related numbers in tunables.doorYield (CPM,
 * clickRatePctOfImpressions, intentClickPctOfClicksBaseline,
 * costPerIntentClickUSDRange) over THREE degrees of freedom (cost per
 * intent click = (CPM/1000) / (clickRate * intentRate) is not independent
 * of the other three) -- R30 itself only anchors TWO of them directly
 * ("5.2% intent clicks... at roughly $6.63-7 per intent click"; R30 names
 * no CPM or click-through rate at all -- both are this artifact's own
 * documented, ASSUMED synthetic placeholders, per this module's original
 * header comment). Exactly ONE free parameterization is chosen to resolve
 * the over-determination, consistent with BOTH of R30's named numbers:
 * CPM is DERIVED (not `clickRatePctOfImpressions`, which stays the
 * assumed constant) from the two R30-anchored reads --
 * costPerIntentClickUSDRange's midpoint and intentClickPctOfClicksBaseline
 * -- so the gate-cell (bias=1.00) arm's EXPECTED cost-per-intent-click
 * reproduces R30's own $6.63-7 midpoint ($6.815) exactly, by construction
 * -- in expectation -- instead of silently drifting to ~$3.42 (what
 * plugging a hand-picked $8 CPM into the new intent-rate-driven formula
 * would otherwise produce):
 *
 *   costPerIntentClick = (CPM/1000) / (clickRate * intentRate)
 *   => CPM = costPerIntentClick * 1000 * clickRate * intentRate
 *
 * (CPM was already a bare "ASSUMED_CPM_USD = 8" literal with no R30
 * grounding at all, so deriving it -- rather than the click rate, which is
 * the only other unanchored number -- is the one that costs this build
 * nothing it was actually relying on elsewhere; `clickRatePctOfImpressions`
 * remains a fixed, read, reported-only diagnostic per R22.)
 *
 * f5/crucial-3 fix: "reproduces R30 exactly, by construction" (this
 * comment's earlier wording, also README.md and the W-90/91/92 workbook
 * rows) was FALSE as an unqualified per-run claim. The calibration is
 * EXACT ONLY IN EXPECTATION -- the shipped calculation above sets the
 * TRUE underlying rate to hit R30's $6.815 mean, but f4/A-c's per-day
 * binomial sampling (real Binomial(clicks, intentRate) draws, not a
 * smooth deterministic rate) means any ONE seed's REPORTED
 * costPerIntentClickUSD is a noisy sample around that mean, not the mean
 * itself. Measured (v1c, 400 seeds, gate-cell arm, plant='pass'): mean
 * $6.805, min $5.952, max $7.592 -- and the shipped default seed
 * (20260910) itself reports $6.446 (intent rate 5.409% of clicks), OUTSIDE
 * the $6.63-7.00 range; ~57% of the 400 seeds swept land outside
 * [6.63, 7.00]. The system enforces the 5.2% baseline intent-rate
 * PARAMETER and the CPM derivation above (both exact, checkable facts
 * about the code) -- it does NOT enforce, and cannot enforce, any
 * particular per-seed REPORTED range; that variability is the honest
 * cost of real sampling noise on top of an expectation-level calibration.
 */
export function deriveCpmFromDoorYieldTunables(doorYieldTunables) {
  const [lo, hi] = doorYieldTunables.costPerIntentClickUSDRange;
  const baselineCostPerIntentClick = (lo + hi) / 2;
  const clickRate = doorYieldTunables.clickRatePctOfImpressions / 100;
  const intentRate = doorYieldTunables.intentClickPctOfClicksBaseline;
  return baselineCostPerIntentClick * 1000 * clickRate * intentRate;
}

function trueRatesForArm(arm, plant) {
  if (arm.role !== 'gate') {
    // Door arms are directional/ungated (R22) -- fixed plausible synthetic
    // rates, independent of `plant` (which only targets the gate cell).
    return { completionRate: 0.50, reservationRate: 0.30, replayRate: 0.45, d1Rate: 0.35, bracketsPerPlayer48h: 1.6, linkToFirstSealHesitatedRate: 0.08 };
  }
  if (plant === 'fail') {
    return { completionRate: 0.42, reservationRate: 0.18, replayRate: 0.30, d1Rate: 0.25, bracketsPerPlayer48h: 1.1, linkToFirstSealHesitatedRate: 0.15 };
  }
  // default / 'pass': comfortably above every R51 threshold. f4/N3: bumped
  // reservationRate 0.55 -> 0.65 -- the OLD 0.55 was only reliably reaching
  // 'pass' at maxN because gate.js used to carve out a bare `z >= 0` pass
  // at the ceiling; once that carve-out was deleted (N3 fix) and the real
  // efficacy boundary at t=1 is the only door to a ceiling pass, 0.55 was
  // borderline enough that an unlucky early-day draw (e.g. seed 42) could
  // land the reached-N read UNDER the boundary and correctly close
  // INCONCLUSIVE -- a real, honest sequential-design outcome (power < 100%
  // for a rate this close to threshold at maxN=50), not a test bug, but
  // exactly the ambiguity a "planted pass" fixture shouldn't carry. 0.65
  // clears the real boundary with a wide margin.
  //
  // f5/crucial-2 fix: an earlier round's comment here claimed "0/3000 seeds
  // miss at 0.65" -- that was FALSE. A sequential design with a real
  // futility boundary and a real time ceiling does not (and should not)
  // give a hard zero-miss guarantee at ANY margin; measuring across a wide
  // seed sweep (not just this suite's few pinned seeds) is honest, correct
  // sequential-design behavior, not a bug: v1c measured 9/3000 (3 futility
  // misses + 6 ceiling inconclusives) and 25/10000 (4 futility misses + 21
  // ceiling inconclusives) at 0.65 -- a few-per-thousand rate, not zero.
  // That rate is acceptable for THIS fixture because the tests below pin a
  // small, fixed set of seeds (1, 2, 3, 42, 999, 123456, 7777, 20260910,
  // 7, 20260910...) that are individually verified to classify 'pass' --
  // the tests are deterministic on those exact seeds regardless of the
  // sweep rate. The wide-sweep rate above is DOCUMENTATION of the planted
  // margin's real-world miss rate, not a correctness claim the pinned
  // tests depend on, and not a promise that every arbitrary seed passes.
  return { completionRate: 0.55, reservationRate: 0.65, replayRate: 0.60, d1Rate: 0.55, bracketsPerPlayer48h: 2.3, linkToFirstSealHesitatedRate: 0.05 };
}

function bernoulliSum(n, p, rng) {
  let count = 0;
  for (let i = 0; i < n; i++) if (rng() < p) count++;
  return count;
}

/**
 * Simulate one arm across up to `maxDays`, honoring its spend cap and its
 * per-arm cost-per-reservation cap (pausing spend once cumulative
 * cost-per-reservation exceeds the cap -- the console-visible "cap breach
 * blocked" behavior, AC0).
 */
function simulateArm(arm, { seed, plant, maxDays, totalSpendUSD, capUSD, doorYieldTunables }) {
  const rng = mulberry32(seed);
  const rates = trueRatesForArm(arm, plant);
  const armTotalSpend = totalSpendUSD * arm.spendShare;
  const dailySpendPlanned = armTotalSpend / maxDays;

  // f4/N5: CPM is now DERIVED (see deriveCpmFromDoorYieldTunables's header
  // comment) -- identical across every arm (R22), same as the old literal
  // ASSUMED_CPM_USD was. The click-through rate is read as-is (unchanged,
  // identical across arms, diagnostic per R22). This arm's true intent
  // RATE (not cost) is what its door-yield bias multiplier now scales.
  const cpmUsd = deriveCpmFromDoorYieldTunables(doorYieldTunables);
  const clickRate = doorYieldTunables.clickRatePctOfImpressions / 100;
  const intentRateArm = doorYieldTunables.intentClickPctOfClicksBaseline * arm.doorYieldBiasMultiplier;

  const days = [];
  let cumSpend = 0, cumEnrollments = 0, cumQualifiedActivations = 0, cumCompleters = 0, cumReservations = 0;
  let cumReplays = 0, cumD1 = 0, cumBrackets48h = 0, cumImpressions = 0, cumClicks = 0, cumIntentClicks = 0;
  let cumLinkToFirstSealHesitated = 0, cumLinkToFirstSealSealed = 0;
  let paused = false;

  for (let day = 1; day <= maxDays; day++) {
    let daySpend = 0, dayEnrollments = 0, dayQA = 0, dayCompleters = 0, dayReservations = 0, dayReplays = 0, dayD1 = 0;
    let dayImpressions = 0, dayClicks = 0, dayIntentClicks = 0;
    if (!paused && cumSpend < armTotalSpend) {
      daySpend = Math.min(dailySpendPlanned, armTotalSpend - cumSpend);
      // f4/N5: the door layer, intent-rate-driven. Impressions from the
      // derived identical CPM; clicks from the assumed click-through rate
      // (both as before); intent clicks (= enrollments, R19a's own column)
      // now READ from tunables.doorYield.intentClickPctOfClicksBaseline
      // (times this arm's bias multiplier) applied to clicks, instead of
      // clicks-independent spend/cost-per-click math.
      //
      // f4/A-c: clicks and intent clicks are now REAL per-day binomial
      // draws (clicks ~ Binomial(impressions, clickRate), intent ~
      // Binomial(clicks, intentRateArm)) instead of a bare
      // Math.round(n * rate) -- so door yield genuinely VARIES by
      // seed/day (a smooth deterministic rate produced an identical
      // doorYieldPer1000Impressions curve for every run at a given spend
      // schedule, which is not what a real ad funnel does). Impressions
      // itself stays a deterministic function of spend/CPM (CPM is a
      // rate, not something impressions get "sampled" against -- the
      // budget buys however many impressions that rate implies; the
      // funnel's OWN randomness starts at the click step, per the brief).
      // The plant still biases the TRUE rate (intentRateArm, via the
      // arm's doorYieldBiasMultiplier) -- sampling noise sits on top of
      // that bias, it doesn't replace it, so a planted classification
      // stays a planted classification; bernoulliSum's law-of-large-
      // numbers behavior at these impression counts (thousands to tens
      // of thousands per arm per day) keeps the noise small relative to
      // the planted margin.
      //
      // f5/crucial-2 fix: this comment previously claimed "0/3000 seeds
      // miss the planted pass/fail classification with this noise on" --
      // FALSE for the planted-PASS side (see trueRatesForArm's header
      // comment above for the measured, corrected rate: 9/3000, 25/10000
      // at the shipped 0.65 reservationRate -- a few-per-thousand futility-
      // miss/ceiling-inconclusive rate, honest sequential-design behavior,
      // not a bug). The planted-FAIL side, separately measured here, IS a
      // hard zero for false-pass: 0/3000 and 0/10000 seeds swept
      // misclassify a planted fail as 'pass' (a real futility/ceiling
      // boundary that a genuinely-below-threshold true rate essentially
      // never crosses upward by sampling noise alone) -- see
      // gate.test.js/gate-alpha-spending-door-yield.test.js for the pinned-
      // seed coverage; the plant margins did not need widening.

      dayImpressions = Math.round((daySpend / cpmUsd) * 1000);
      dayClicks = bernoulliSum(dayImpressions, clickRate, rng);
      dayIntentClicks = bernoulliSum(dayClicks, intentRateArm, rng);
      dayEnrollments = dayIntentClicks;

      dayQA = bernoulliSum(dayEnrollments, QUALIFICATION_PASS_RATE, rng);
      dayCompleters = bernoulliSum(dayQA, rates.completionRate, rng);
      dayReservations = bernoulliSum(dayCompleters, rates.reservationRate, rng);
      dayReplays = bernoulliSum(dayCompleters, rates.replayRate, rng);
      dayD1 = bernoulliSum(dayCompleters, rates.d1Rate, rng);
    }

    cumSpend += daySpend;
    cumImpressions += dayImpressions;
    cumClicks += dayClicks;
    cumIntentClicks += dayIntentClicks;
    cumEnrollments += dayEnrollments;
    cumQualifiedActivations += dayQA;
    cumCompleters += dayCompleters;
    cumReservations += dayReservations;
    cumReplays += dayReplays;
    cumD1 += dayD1;
    cumBrackets48h += dayCompleters * rates.bracketsPerPlayer48h;

    // CB-BUILD-017/AC1: "link -> first duel", the player's first submitted
    // seal -- every qualified activation (dayQA) reaches a first duel; a
    // fixed share of those (rates.linkToFirstSealHesitatedRate, an ASSUMED
    // synthetic constant, see trueRatesForArm) time out on it (hesitated,
    // R81) and earn no credit toward the bar -- excluded from the
    // numerator (cumLinkToFirstSealSealed only counts the real seals).
    // Deliberately NOT a bernoulliSum/rng draw: this is a proportion of the
    // SAME day's qualified-activation count, computed with no additional
    // randomness draws, so it cannot perturb the existing pinned-seed
    // gate/door-yield sequences that read this rng stream downstream.
    const dayLinkToFirstSealHesitated = Math.round(dayQA * rates.linkToFirstSealHesitatedRate);
    const dayLinkToFirstSealSealed = dayQA - dayLinkToFirstSealHesitated;
    cumLinkToFirstSealHesitated += dayLinkToFirstSealHesitated;
    cumLinkToFirstSealSealed += dayLinkToFirstSealSealed;

    const costPerReservationUSD = cumReservations > 0 ? cumSpend / cumReservations : null;
    if (capUSD != null && costPerReservationUSD != null && costPerReservationUSD > capUSD && cumReservations >= 3) {
      paused = true; // cap breach blocked: spend halts for this arm from the next day
    }

    // f4/N5: costPerIntentClickUSD is now the DERIVED, reported quantity
    // (cumulative spend / cumulative intent clicks), not a fixed per-arm
    // constant computed independently of the actual intent-click count
    // above -- the two used to be two separate numbers that happened to
    // agree only because BOTH were driven off the same unread constant.
    const costPerIntentClickUSD = cumIntentClicks > 0 ? cumSpend / cumIntentClicks : null;

    days.push({
      day,
      armId: arm.id,
      spendUSD: Math.round(daySpend * 100) / 100,
      cumSpendUSD: Math.round(cumSpend * 100) / 100,
      impressions: dayImpressions,
      cumImpressions,
      clicks: dayClicks,
      cumClicks,
      intentClicks: dayIntentClicks,
      cumIntentClicks,
      // R19a: enrollments as their OWN column (C12), distinct from
      // qualifiedActivations (the screener-passed subset of enrollments).
      enrollments: dayEnrollments,
      cumEnrollments,
      qualifiedActivations: dayQA,
      cumQualifiedActivations,
      firstBracketCompletions: dayCompleters,
      completers: cumCompleters,
      reservations: dayReservations,
      cumReservations: cumReservations,
      replayAfterLoss: dayReplays,
      d1Returns: dayD1,
      paused,
      firstBracketCompletionRate: cumQualifiedActivations > 0 ? cumCompleters / cumQualifiedActivations : 0,
      replayAfterLossRate: cumCompleters > 0 ? cumReplays / cumCompleters : 0,
      d1ReturnRate: cumCompleters > 0 ? cumD1 / cumCompleters : 0,
      bracketsPerActivePlayerWithin48h: cumCompleters > 0 ? cumBrackets48h / cumCompleters : 0,
      costPerReservationUSD,
      costCapUSD: capUSD,
      // C12: door yield = intent clicks per 1,000 impressions (R22's exact
      // primary metric), cumulative-to-date (the number that matters for a
      // multi-day read); reservations per 1,000 impressions reported beside
      // it, ungated and directional, per R22.
      costPerIntentClickUSD,
      doorYieldPer1000Impressions: cumImpressions > 0 ? (cumIntentClicks / cumImpressions) * 1000 : 0,
      reservationsPer1000Impressions: cumImpressions > 0 ? (cumReservations / cumImpressions) * 1000 : 0,
      // CB-BUILD-017/AC1: link -> first duel, measured to the first
      // submitted seal. cumLinkToFirstSealSealed is the NUMERATOR-eligible
      // count (hesitated first duels excluded, per AC1: "a first duel that
      // times out ... earns no credit toward this bar"); the median/p90
      // seconds are fixed ASSUMED synthetic placeholders (see this file's
      // header constants), not re-derived per day.
      linkToFirstSealHesitated: dayLinkToFirstSealHesitated,
      cumLinkToFirstSealHesitated,
      linkToFirstSealSealed: dayLinkToFirstSealSealed,
      cumLinkToFirstSealSealed,
      linkToFirstSealMedianSec: LINK_TO_FIRST_SEAL_MEDIAN_SEC,
      linkToFirstSealP90Sec: LINK_TO_FIRST_SEAL_P90_SEC,
      // CB-BUILD-017 fix round f4/Finding 3 (§0/R5): explicit, data-carried
      // ASSUMED flag for the two figures above -- ui/console/runPanel.js
      // reads this (rather than assuming it) so the marker travels with
      // the data and can't silently drop off a future refactor.
      linkToFirstSealSecondsAssumed: true,
    });
  }
  return days;
}

/**
 * Run the full synthetic cohort: every arm, day by day, plus the gate cell's
 * cumulative sequential-gate read on every day (R19a) and the final
 * classification (R51, via engine/gate.js's runSequentialGate).
 */
export function simulateRun({ seed = 20260910, plant = 'pass', maxDays = MAX_DAYS, totalSpendUSD = TOTAL_SPEND_USD, perArmCapsUSD = {}, defaultCapUSD = 100, tunables = _shippedTunables } = {}) {
  const arms = armDefinitions();
  const byArm = {};
  arms.forEach((arm, i) => {
    const capUSD = perArmCapsUSD[arm.id] ?? defaultCapUSD;
    byArm[arm.id] = simulateArm(arm, { seed: seed + i * 7919, plant, maxDays, totalSpendUSD, capUSD, doorYieldTunables: tunables.doorYield });
  });

  const gateDays = byArm['gate-incumbent-10'].map((d) => ({
    day: d.day,
    completers: d.completers,
    reservations: d.cumReservations,
    replayAfterLossRate: d.replayAfterLossRate,
    bracketsPerActivePlayerWithin48h: d.bracketsPerActivePlayerWithin48h,
    d1ReturnRate: d.d1ReturnRate,
    firstBracketCompletionRate: d.firstBracketCompletionRate,
    costPerReservationUSD: d.costPerReservationUSD,
    costCapUSD: d.costCapUSD,
  }));

  return { arms, byArm, gateDays, seed, plant, maxDays, totalSpendUSD };
}

// ---- C12/R22: door-yield band rule + recommendation report -----------------

/**
 * The pre-registered BAND rule (R22): the candidate with the highest door
 * yield is named the winner only when its lead over the runner-up exceeds
 * `leadBandPct` (a relative lead: (best-second)/second); a lead inside the
 * band names the incumbent/tie-holder instead.
 * @param {Array<{id, doorYieldPer1000Impressions}>} candidates
 * @param {string} tieHolderId the incumbent/$10 arm id (named on a lead inside the band)
 * @param {number} leadBandPct
 */
export function classifyDoorYieldWinner(candidates, tieHolderId, leadBandPct) {
  const sorted = candidates.slice().sort((a, b) => b.doorYieldPer1000Impressions - a.doorYieldPer1000Impressions);
  const best = sorted[0];
  const second = sorted[1];
  if (!best || best.doorYieldPer1000Impressions <= 0) {
    // f4/A-d fix: every candidate reads zero (or there's nothing to
    // compare at all) -- there is no meaningful lead, so the tie-holder
    // stands. The old code fell through to the `!second` branch below
    // (since a zero `best` sorts with an equal-or-lower `second`,
    // `second.doorYieldPer1000Impressions <= 0` was also true) and named
    // `best.id` the winner anyway, with `lead: Infinity` -- i.e. "the
    // winner is whichever zero-yield candidate happened to sort first."
    return { winnerId: tieHolderId, insideBand: true, lead: 0 };
  }
  if (!second || second.doorYieldPer1000Impressions <= 0) {
    // f4/A-d fix: the runner-up reads zero (but `best` itself is
    // positive) -- the band rule's lead is a PROPORTIONAL comparison
    // ((best-second)/second); dividing by a zero baseline is not a real
    // "exceeds the band" signal, it's an artifact of the arithmetic
    // (`Infinity`, always > any finite band). There is no honest
    // proportional lead against a zero baseline, so the tie-holder stands
    // -- never a bare `best` pick reported with `lead: Infinity`.
    return { winnerId: tieHolderId, insideBand: true, lead: 0 };
  }
  const lead = (best.doorYieldPer1000Impressions - second.doorYieldPer1000Impressions) / second.doorYieldPer1000Impressions;
  const insideBand = lead <= leadBandPct;
  return { winnerId: insideBand ? tieHolderId : best.id, insideBand, lead };
}

/** R22's exact reporting language, restated on the report itself so a
 * reader never mistakes a door-yield lead for an in-game verdict. */
export const DOOR_YIELD_REPORTING_LANGUAGE =
  'Door yield measures pull at the door -- which treatment/price this audience clicks -- and this report says so every time. What a theme or price does for play and return is read from the arm\'s in-game rates, directional at this N. Named results (theme, price) are RECOMMENDATIONS; the gate (R51) is the run\'s verdict.';

/** Build the theme/price recommendation section of the run report (R22). */
export function buildDoorYieldReport(run, tunables = _shippedTunables) {
  const dy = tunables.doorYield;
  const lastDayFor = (armId) => run.byArm[armId][run.byArm[armId].length - 1];

  const themeCandidates = ['gate-incumbent-10', 'door-theme-adjacent', 'door-theme-far'].map((id) => ({ id, doorYieldPer1000Impressions: lastDayFor(id).doorYieldPer1000Impressions }));
  const priceCandidates = ['gate-incumbent-10', 'door-price-under', 'door-price-over', 'door-price-free'].map((id) => ({ id, doorYieldPer1000Impressions: lastDayFor(id).doorYieldPer1000Impressions }));

  const theme = classifyDoorYieldWinner(themeCandidates, 'gate-incumbent-10', dy.leadBandPct);
  const price = classifyDoorYieldWinner(priceCandidates, 'gate-incumbent-10', dy.leadBandPct);

  return {
    reportingLanguage: DOOR_YIELD_REPORTING_LANGUAGE,
    leadBandPct: dy.leadBandPct,
    theme: { ...theme, candidates: themeCandidates, recommendation: true },
    price: { ...price, candidates: priceCandidates, recommendation: true },
  };
}

/** R21 pre-registration: generated before the cohort, displayed in the
 * console. Everything a reader needs to audit the gate without re-deriving
 * it -- thresholds, boundaries, max N, caps, contamination method,
 * house-play disclosure.
 *
 * C9 fix: thresholds/sequentialRule now come from `deriveGateConfig(tunables)`
 * -- the SAME function gate.js's classification reads -- instead of a third
 * hand-copied set of numbers.
 * C10 fix: the boundary table is REAL alpha-spending output (not a fixed z).
 * C11 fix: states the EXPECTED Wilson 95% interval at max N (computed, not
 * hardcoded).
 * C20 fix: the house-play disclosure is now accurate and specific (bracket
 * NPCs' hand-authored R82 tendencies vs the procedural fallback's drift vs
 * PvE house opponents' drift), instead of one blanket (and previously
 * inconsistent) sentence.
 */
export function generatePreRegistration({ seed, totalSpendUSD = TOTAL_SPEND_USD, maxDays = MAX_DAYS, defaultCapUSD = 100, tunables = _shippedTunables, treatment = _incumbentTreatment } = {}) {
  const gateConfig = deriveGateConfig(tunables);
  const sr = gateConfig.sequentialRule;

  const boundaryTable = sr.plannedLookNs.map((n) => {
    const t = Math.min(1, n / sr.maxN);
    return {
      n, t,
      cumulativeAlphaSpent: obrienFlemingAlphaSpent(t, sr.totalAlphaOneSided),
      efficacyBoundaryZ: obrienFlemingBoundaryZ(t, sr.totalAlphaOneSided),
    };
  });

  // C11: the EXPECTED Wilson 95% interval AT max N, computed (not
  // hardcoded) from the setpoint itself (reservationRate threshold) and
  // maxN -- this is what the brief's "~±13 pts at 35%, N~=50" describes.
  const expectedSuccessesAtMaxN = Math.round(gateConfig.thresholds.reservationRate * sr.maxN);
  const expectedIntervalAtMaxN = wilsonInterval(expectedSuccessesAtMaxN, sr.maxN);

  const bias = rosterBiasRange(treatment);

  return {
    generatedAt: null, // filled by the caller with a real timestamp
    seed,
    envelope: { totalSpendUSD, maxDays, gateCellSpendShare: GATE_CELL_SPEND_SHARE },
    thresholds: {
      reservationRateSetpoint: gateConfig.thresholds.reservationRate,
      secondaryOf: [
        `replayAfterLoss >= ${gateConfig.thresholds.replayAfterLoss}`,
        `bracketsPerActivePlayerWithin48h >= ${gateConfig.thresholds.bracketsPerActivePlayerWithin48h}`,
        `d1Return >= ${gateConfig.thresholds.d1Return}`,
        `firstBracketCompletion >= ${gateConfig.thresholds.firstBracketCompletion}`,
      ],
      secondaryRequiredCount: gateConfig.secondaryRequiredCount,
    },
    sequentialRule: {
      description: `Daily looks from the first enrollment. Primary metric: reservation rate among gate-cell first-bracket completers, read as a z-score against the ${gateConfig.thresholds.reservationRate} setpoint using the normal approximation to the binomial. No boundary is evaluated before ${sr.minLookN} completers. EFFICACY: a Lan-DeMets/O'Brien-Fleming-type alpha-spending design (one-sided, total alpha ${sr.totalAlphaOneSided}) over information fraction t = completers/maxN -- see the boundary table below; a documented normal-approximation implementation (app/engine/alphaSpending.js), not the exact recursive multivariate boundary. FUTILITY: its own separate rule, z <= ${sr.futilityZ}, independent of the spending function.`,
      minLookN: sr.minLookN,
      maxN: sr.maxN,
      totalAlphaOneSided: sr.totalAlphaOneSided,
      spendingFunction: sr.spendingFunction,
      futilityZ: sr.futilityZ,
      boundaryTable, // [{ n, t, cumulativeAlphaSpent, efficacyBoundaryZ }, ...] for the planned looks
      expectedIntervalAtMaxN: { ...expectedIntervalAtMaxN, n: sr.maxN, method: 'Wilson score 95%' },
      onMaxNWithoutFiring: 'closes INCONCLUSIVE at reached N (a completed result, reported with its reached Wilson interval, treated as a miss per R6/R19) -- UNLESS the reached-N read itself crosses the real efficacy boundary evaluated at t=1 (the final spending fraction, not a bare z>=0 shortcut), in which case it is reported as a pass at that N. This is the Lan-DeMets convention for an early time-ceiling close: when the run hits its time ceiling (the 14-day cap) before crossing a boundary at a PLANNED look, the FINAL look is judged as if information fraction t=1 had been reached on schedule -- spending whatever alpha the spending function had not yet spent, at the ACTUAL (possibly smaller) completer count reached, rather than either forfeiting that unspent alpha or waiting indefinitely for more completers that a time-boxed run will never see. There is no other way to close as a pass at either ceiling (R6/R21/R28).',
    },
    caps: {
      defaultCostPerReservationCapUSD: defaultCapUSD, frozenAtPreRegistration: true, changeableBetweenRunsOnly: true,
      // f5/A6: named explicitly -- a cost-per-reservation cap breach
      // PAUSES an arm's spend from the next day (simulateArm above), which
      // can freeze the gate cell's completer count BELOW minLookN if the
      // breach happens early (a real risk when the true rate is poor --
      // i.e. exactly the planted-FAIL scenario, where a low completion/
      // reservation rate both trips the cap sooner AND is what futility is
      // supposed to detect). When that happens, the run closes INCONCLUSIVE
      // at reached N (gate.js's own ceiling rule, R6/R19) -- a completed,
      // honestly-reported result, NOT a real efficacy/futility read, and
      // NOT a pass under any circumstance (the cap-paused arm cannot cross
      // an efficacy boundary it never got enough completers to evaluate).
      //
      // f6/advisory-4: the risk above is NOT fail-specific -- a tighter
      // operator-settable cap can suppress a GENUINE PASS into the same
      // INCONCLUSIVE close too, simply by freezing a perfectly healthy
      // arm below minLookN before it ever gets a chance to cross the
      // efficacy boundary. Measured (planted-pass, seeds 0..299, the
      // shipped 0.65 reservation-rate margin): 300/300 seeds close
      // INCONCLUSIVE at a $10 cap (every seed cap-paused below minLookN
      // before any read), vs. 122/300 at a $25 cap (178 genuinely cross to
      // PASS; the rest still cap-pause) -- the SAME true rate, reported
      // very differently purely as a function of the operator's own cap
      // choice, not the underlying rule being tested.
      costCapPauseRisk: 'A cap breach can freeze an arm below minLookN before any boundary is evaluated, closing INCONCLUSIVE at reached N rather than a real futility/efficacy read -- see the planted-fail sweep in gate-alpha-spending-door-yield.test.js for the measured rate. This is NOT fail-specific: a tight enough operator-settable cap can just as easily suppress a GENUINE PASS into the same INCONCLUSIVE close (measured: 300/300 seeds inconclusive at a $10 cap vs. 122/300 at a $25 cap, same planted-pass margin) -- the cap choice itself, not the underlying rate, can decide whether a healthy run ever gets read at all.',
    },
    contaminationMethod: 'In-product screener (age/jurisdiction) + behavioral fingerprinting; false-accept/false-reject rates estimated on pilot data and reported as labeled estimates, per cohort.',
    // C20: three DIFFERENT house-play populations, stated separately and
    // accurately (previously one blanket sentence conflated all three, and
    // disagreed with npc.js's actual procedural-fallback drift).
    housePlayPolicy: [
      `Bracket NPCs (named, roster characters -- R82): hand-authored fixed tendencies, not equilibrium+drift -- ${bias.count} canonical personalities this build ships, each biased ${(bias.min * 100).toFixed(0)}%-${(bias.max * 100).toFixed(0)}% toward one element.`,
      `Bracket NPCs (procedural fallback, once the named roster is exhausted): the equilibrium mix with a ${(tunables.pve.driftPerSessionPct * 100).toFixed(0)}% session drift toward one element (app/engine/npc.js:proceduralNpc; the SAME rate as PvE below, not a separate figure).`,
      `PvE house opponents (R57): the equilibrium mix with a ${(tunables.pve.driftPerSessionPct * 100).toFixed(0)}% session drift toward one element; rake ${(tunables.pve.rakeOnWinsOnly * 100).toFixed(0)}% on wins only.`,
      'Policy is fixed and identical across every arm; human-vs-human and human-vs-house are reported separately.',
    ].join(' '),
    doorYield: {
      leadBandPct: tunables.doorYield.leadBandPct,
      costPerIntentClickUSDRange: tunables.doorYield.costPerIntentClickUSDRange,
      // f4/N5: the intent rate (R30/R85, workbook W-91) that actually
      // drives intent clicks = clicks x this rate x the arm's door-yield
      // bias multiplier -- surfaced here so the pre-registration states
      // the number the model enforces, not just the cost-per-click range.
      intentClickPctOfClicksBaseline: tunables.doorYield.intentClickPctOfClicksBaseline,
      reportingLanguage: DOOR_YIELD_REPORTING_LANGUAGE,
    },
  };
}
