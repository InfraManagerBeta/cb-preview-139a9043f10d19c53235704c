// app/ui/console/runPanel.js — R19a/R21/R51/AC0: run simulation + gates.
import { el } from '../components/dom.js';
import { simulateRun, generatePreRegistration, armDefinitions, buildDoorYieldReport, DOOR_YIELD_REPORTING_LANGUAGE } from '../../engine/runSimulator.js';
import { runSequentialGate, evaluateDailyGate, deriveGateConfig } from '../../engine/gate.js';
import { wilsonInterval } from '../../engine/alphaSpending.js';
import { patchOverrides } from '../../engine/overrides.js';

function renderPreRegistration(preReg) {
  const sr = preReg.sequentialRule;
  const ci = sr.expectedIntervalAtMaxN;
  return el('div', { class: 'cb-card' }, [
    el('h3', {}, 'Pre-registration (R21) \u2014 generated before the cohort'),
    el('table', { class: 'cb-console-table' }, [
      el('tbody', {}, [
        tr('Seed', preReg.seed),
        tr('Envelope', `$${preReg.envelope.totalSpendUSD} total, ${preReg.envelope.maxDays}-day ceiling, gate cell \u2265${Math.round(preReg.envelope.gateCellSpendShare * 100)}% of spend`),
        tr('Primary threshold', `reservation rate \u2265 ${preReg.thresholds.reservationRateSetpoint}`),
        tr(`Secondary (\u2265${preReg.thresholds.secondaryRequiredCount} of)`, preReg.thresholds.secondaryOf.join('; ')),
        tr('Sequential rule', sr.description),
        tr('Looks', 'Daily, from the first enrollment (R19: "the run computes every metric and gate every day").'),
        tr('Spending function', `${sr.spendingFunction} (one-sided, total alpha ${sr.totalAlphaOneSided})`),
        tr('Total alpha (one-sided)', sr.totalAlphaOneSided),
        tr('Max N', sr.maxN),
        tr('Futility boundary (own rule)', `z \u2264 ${sr.futilityZ}`),
        tr('Expected 95% interval at max N', `${(ci.low * 100).toFixed(1)}\u2013${(ci.high * 100).toFixed(1)} pts (center ${(ci.center * 100).toFixed(1)}%, n=${ci.n}, ${ci.method})`),
        tr('On max N / ceiling without firing', sr.onMaxNWithoutFiring),
        tr('Caps', `$${preReg.caps.defaultCostPerReservationCapUSD}/reservation default, frozen at pre-registration, changeable only between runs`),
        tr('Contamination method', preReg.contaminationMethod),
        tr('House-play policy disclosure', preReg.housePlayPolicy),
        tr('Door yield (theme/price primary metric, R22)', `band \u00b1${(preReg.doorYield.leadBandPct * 100).toFixed(0)}%; baseline intent rate ${(preReg.doorYield.intentClickPctOfClicksBaseline * 100).toFixed(1)}% of clicks (W-91); cost/intent click $${preReg.doorYield.costPerIntentClickUSDRange[0].toFixed(2)}\u2013$${preReg.doorYield.costPerIntentClickUSDRange[1].toFixed(2)}. ${preReg.doorYield.reportingLanguage}`),
      ]),
    ]),
    el('h4', {}, 'Boundary table (planned looks)'),
    el('table', { class: 'cb-console-table cb-console-table-compact' }, [
      el('thead', {}, [el('tr', {}, ['N', 'Info. fraction t', 'Cumulative \u03b1 spent', 'Efficacy z\u2265'].map((h) => el('th', {}, h)))]),
      el('tbody', {}, sr.boundaryTable.map((row) => el('tr', {}, [
        el('td', {}, String(row.n)),
        el('td', {}, row.t.toFixed(2)),
        el('td', {}, row.cumulativeAlphaSpent.toFixed(4)),
        el('td', {}, row.efficacyBoundaryZ.toFixed(3)),
      ]))),
    ]),
  ]);
}

function tr(label, value) {
  return el('tr', {}, [el('td', { class: 'cb-console-table-label' }, label), el('td', {}, String(value))]);
}

function renderDailyTable(armId, days) {
  return el('div', { class: 'cb-card' }, [
    el('h4', {}, armId),
    el('div', { style: 'overflow-x:auto;' }, [
      el('table', { class: 'cb-console-table cb-console-table-compact' }, [
        el('thead', {}, [el('tr', {}, ['Day', 'Spend', 'Impr.', 'Enroll.', 'QA', 'Completers', 'Reservations', 'Door yield/1k', 'Replay', 'D1', 'CPR', 'Paused'].map((h) => el('th', {}, h)))]),
        el('tbody', {}, days.map((d) => el('tr', {}, [
          el('td', {}, String(d.day)),
          el('td', {}, `$${d.cumSpendUSD.toFixed(0)}`),
          el('td', {}, String(d.cumImpressions)),
          el('td', {}, String(d.cumEnrollments)),
          el('td', {}, String(d.cumQualifiedActivations)),
          el('td', {}, String(d.completers)),
          el('td', {}, String(d.cumReservations)),
          el('td', {}, d.doorYieldPer1000Impressions.toFixed(1)),
          el('td', {}, `${(d.replayAfterLossRate * 100).toFixed(0)}%`),
          el('td', {}, `${(d.d1ReturnRate * 100).toFixed(0)}%`),
          el('td', {}, d.costPerReservationUSD != null ? `$${d.costPerReservationUSD.toFixed(0)}` : '\u2014'),
          el('td', {}, d.paused ? 'PAUSED' : ''),
        ]))),
      ]),
    ]),
  ]);
}

function renderGateVerdict(result, secondaryRequiredCount, maxN) {
  const cls = result.decision === 'pass' ? 'win' : result.decision === 'miss' ? 'loss' : 'draw';
  // C11: the interval REACHED at close (not just the pre-reg's EXPECTED one).
  const ci = wilsonInterval(result.reservations, result.completers);
  return el('div', { class: `cb-card cb-console-verdict ${cls}` }, [
    el('h3', {}, `Gate verdict: ${result.decision.toUpperCase()} (day ${result.day})`),
    el('p', { class: 'cb-micro' }, result.reason),
    el('table', { class: 'cb-console-table' }, [
      el('tbody', {}, [
        tr('Completers / reservations', `${result.completers} / ${result.reservations}`),
        tr('Observed reservation rate', `${(result.observedRate * 100).toFixed(1)}%`),
        tr('95% interval REACHED at close', `${(ci.low * 100).toFixed(1)}\u2013${(ci.high * 100).toFixed(1)} pts (Wilson score)`),
        tr('z-score vs setpoint', result.z.toFixed(3)),
        tr('Efficacy boundary at this look', `${result.efficacyBoundaryZ.toFixed(3)} (t=${result.informationFraction.toFixed(2)})`),
        tr('Secondary signals passing', `${result.secondaryPassCount} of ${secondaryRequiredCount} required`),
        tr('Cost within cap', result.costOk ? 'yes' : 'no'),
      ]),
    ]),
    // f5/A11: looks are batched daily (R19: "the run computes every metric
    // and gate every day"), not evaluated continuously completer-by-
    // completer -- so the day that finally crosses a boundary can add a
    // whole day's worth of completers at once, landing the CLOSING
    // completers count ABOVE the planned N=${maxN} ceiling rather than
    // exactly at it. The reached-N interval above (not the
    // pre-registration's expected-at-max-N interval) is what actually
    // governs this verdict.
    el('p', { class: 'cb-micro' }, `Note: daily batching means the gate cell can close above N=${maxN} -- the reached-N completers count and its interval above govern, not the planned ceiling.`),
  ]);
}

function renderDoorYieldReport(report, arms) {
  const label = (id) => (arms.find((a) => a.id === id) || { label: id }).label;
  function recommendationRow(name, rec) {
    return el('div', { class: 'cb-card' }, [
      el('h4', {}, `${name}: recommendation`),
      el('p', { class: 'cb-micro' }, rec.reportingLanguage || DOOR_YIELD_REPORTING_LANGUAGE),
      el('table', { class: 'cb-console-table cb-console-table-compact' }, [
        el('thead', {}, [el('tr', {}, ['Arm', 'Door yield / 1k impr.'].map((h) => el('th', {}, h)))]),
        el('tbody', {}, rec.candidates.slice().sort((a, b) => b.doorYieldPer1000Impressions - a.doorYieldPer1000Impressions).map((c) => el('tr', {}, [
          el('td', {}, label(c.id)),
          el('td', {}, c.doorYieldPer1000Impressions.toFixed(2)),
        ]))),
      ]),
      el('p', { class: 'cb-micro' }, `Named: ${label(rec.winnerId)} (${rec.insideBand ? 'lead inside the band -- incumbent/tie-holder holds' : `lead ${(rec.lead * 100).toFixed(0)}% exceeds the band`}).`),
    ]);
  }
  return el('div', { class: 'cb-card' }, [
    el('h3', {}, 'Door yield report (R22) \u2014 recommendations, not a verdict'),
    el('p', { class: 'cb-micro' }, report.reportingLanguage),
    recommendationRow('Theme', report.theme),
    recommendationRow('Price', report.price),
  ]);
}

export function renderRunPanel({ overrides, tunables, refresh }) {
  let lastRun = null;
  let lastPlant = 'pass';
  let lastSeed = overrides.runSeed || 20260910;
  const gateConfig = deriveGateConfig(tunables);

  const resultsContainer = el('div', { id: 'cb-console-run-results' });

  function runNow() {
    lastRun = simulateRun({ seed: lastSeed, plant: lastPlant, perArmCapsUSD: overrides.perArmCapsUSD, tunables });
    const gateResult = runSequentialGate(lastRun.gateDays, gateConfig);
    const doorReport = buildDoorYieldReport(lastRun, tunables);
    // C13/O3 card 6 ("Theme change"): persist the theme door-yield winner's
    // treatment id so effectiveTreatmentId() (app/engine/overrides.js) can
    // apply it to the retention configuration when that hypothesis is
    // active -- "the named theme (R22) applied to the retention
    // configuration," wired through O1's own mechanism.
    const winnerArm = lastRun.arms.find((a) => a.id === doorReport.theme.winnerId);
    if (winnerArm) patchOverrides({ lastDoorYieldThemeWinnerId: winnerArm.treatment });
    resultsContainer.innerHTML = '';
    resultsContainer.appendChild(el('div', {}, [
      renderGateVerdict(gateResult, gateConfig.secondaryRequiredCount, gateConfig.sequentialRule.maxN),
      renderDoorYieldReport(doorReport, lastRun.arms),
      ...lastRun.arms.map((arm) => renderDailyTable(arm.label, lastRun.byArm[arm.id])),
    ]));
  }

  const preReg = generatePreRegistration({ seed: lastSeed, tunables });
  preReg.generatedAt = new Date().toISOString();

  const seedInput = el('input', { type: 'number', value: lastSeed, class: 'cb-console-input', onChange: (e) => { lastSeed = Number(e.target.value); } });
  const plantSelect = el('select', { class: 'cb-console-input', onChange: (e) => { lastPlant = e.target.value; } }, [
    el('option', { value: 'pass' }, 'plant = pass'),
    el('option', { value: 'fail' }, 'plant = fail'),
    el('option', { value: 'none' }, 'no plant (baseline synthetic rates)'),
  ]);

  // C9: a live demonstration of the gate-override channel (AC0 workbook
  // row) -- editing this re-derives BOTH the pre-registration text above
  // (on next render) and the gate classification (runNow reads
  // deriveGateConfig(tunables) fresh, and `tunables` itself already carries
  // any gateOverrides patch via effectiveTunables, applied by console/
  // main.js before this panel is built).
  const gateOverrideInput = el('input', {
    type: 'number', step: '0.01', min: '0', max: '1',
    value: overrides.gateOverrides && overrides.gateOverrides.reservationRateThreshold != null ? overrides.gateOverrides.reservationRateThreshold : '',
    class: 'cb-console-input',
    onChange: (e) => {
      const v = e.target.value === '' ? undefined : Number(e.target.value);
      const patch = { ...(overrides.gateOverrides || {}) };
      if (v == null || Number.isNaN(v)) delete patch.reservationRateThreshold; else patch.reservationRateThreshold = v;
      patchOverrides({ gateOverrides: patch });
      refresh();
    },
  });

  return el('section', { class: 'cb-console-section' }, [
    el('h2', {}, 'Run simulation + gates'),
    renderPreRegistration(preReg),
    el('div', { class: 'cb-card' }, [
      el('h3', {}, 'Synthetic run generator (AC0: "synthetic runs clear R51\u2019s gate logic on planted outcomes")'),
      el('div', { class: 'cb-tag-row' }, [
        el('label', { class: 'cb-micro' }, ['Seed ', seedInput]),
        el('label', { class: 'cb-micro' }, ['Plant ', plantSelect]),
        el('button', { class: 'cb-btn', onClick: runNow }, 'Run simulation'),
      ]),
      el('p', { class: 'cb-micro' }, 'Simulates the gate cell (incumbent @ $10, \u226570% of spend) plus five door arms (two theme, three price) day by day across the R6 envelope ($5,000 / 14 days), then classifies the gate under the pre-registered sequential rule above.'),
      el('div', { class: 'cb-tag-row', style: 'margin-top:8px;' }, [
        el('label', { class: 'cb-micro' }, ['C9: override reservation-rate threshold (blank = tunables.json default) ', gateOverrideInput]),
      ]),
    ]),
    resultsContainer,
  ]);
}
