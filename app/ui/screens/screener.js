// app/ui/screens/screener.js — R70: identity gates run in-product,
// simulated verdicts. Age is attested by date of birth (never a checkbox);
// jurisdiction is DETECTED from the connection (a location check) and
// presented to the player as an already-decided verdict -- never a
// question the player answers or self-reports. In the play-money build the
// location check is simulated (simulateLocationVerdict, below), but it
// still presents as a detected verdict, exactly per R70's master rule.
// submitScreener (game.js) is UNCHANGED by this patch: it keeps its own
// per-attempt idempotency key -- this file only changes how age18/
// jurisdictionOk are DERIVED before that call is made.
// R8a truth line repeated (every money-adjacent surface repeats it).
import { mountScreen, el } from '../components/dom.js';

/**
 * CB-BUILD-001/R70: age is attested by date of birth, not a self-report
 * checkbox. Pure (no DOM) so it's directly unit-testable -- see
 * app/README.md's node:test gotcha (no DOM harness in this suite).
 * `dobString` is an HTML date input value ("YYYY-MM-DD"). Exact calendar
 * age (year/month/day comparison), not a 365.25-day average -- an average
 * misclassifies real birthdays close to the 18-year boundary depending on
 * how many leap days happen to fall inside the span.
 */
export function isAtLeast18(dobString, now = Date.now()) {
  if (!dobString) return false;
  const dob = new Date(`${dobString}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return false;
  if (dob.getTime() > now) return false; // a future DOB is never valid
  const today = new Date(now);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - dob.getUTCMonth();
  const dayDiff = today.getUTCDate() - dob.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age >= 18;
}

/**
 * CB-BUILD-001/R70: jurisdiction is determined from the connection (a
 * location check), never a region self-report -- the player never answers
 * a question here. In play money the check is SIMULATED but presents as a
 * DETECTED verdict: a stubbed detected region that passes ("stubbed
 * detected region -> pass"), per the master rule's play-money-build
 * clause. Exported (and parameterized) so both this build's default
 * detected-and-eligible path AND the shipped "not available in your
 * region" outcome for a player outside the permitted set are directly
 * testable without a DOM or a real geo-IP call.
 */
export function simulateLocationVerdict({ region = 'US', allowed = true } = {}) {
  return { detected: true, region, allowed };
}

export function mountScreener(ctx) {
  const { treatment } = ctx;
  let dob = '';
  let submitting = false; // f4/A-b: submitting guard on Continue (submitScreener's own attempt-count idempotency key, above, is unchanged/untouched -- this only stops a double-tap firing two attempts before the first press's navigation lands)
  // CB-BUILD-001: the location verdict is DETECTED once, up front, and
  // never re-asked -- there is no jurisdiction checkbox to check.
  const locationVerdict = simulateLocationVerdict();

  function render() {
    const age18 = isAtLeast18(dob);
    const canContinue = !!dob && locationVerdict.allowed;
    mountScreen([
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
      el('h2', {}, treatment.copy.screenerHeading),
      el('p', { class: 'cb-prose' }, treatment.copy.screenerBody),
      el('div', { class: 'cb-card' }, [
        el('label', { class: 'cb-field-row' }, [
          el('span', {}, 'Date of birth'),
          el('input', {
            type: 'date',
            id: 'cb-screener-dob',
            value: dob,
            onChange: (e) => { dob = e.target.value; render(); },
          }),
        ]),
        // CB-BUILD-001/R70: a detected verdict, presented as a status line
        // -- never a checkbox, never a question the player answers.
        el('div', { class: 'cb-micro cb-location-verdict' },
          locationVerdict.allowed
            ? `LOCATION: DETECTED (${locationVerdict.region}) \u2014 ELIGIBLE`
            : 'LOCATION: NOT AVAILABLE IN YOUR REGION'),
      ]),
      el('button', {
        class: 'cb-btn block',
        'aria-disabled': !canContinue || submitting,
        onClick: () => {
          if (!canContinue) return; // gated: nothing to submit yet
          if (submitting) return; // f4/A-b
          submitting = true;
          const result = ctx.game.submitScreener({ age18, jurisdictionOk: locationVerdict.allowed });
          if (result.passed) {
            ctx.router.navigate('summon');
          } else {
            renderRejected();
          }
        },
      }, 'Continue'),
    ]);
  }

  function renderRejected() {
    mountScreen([
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
      el('div', { class: 'cb-card' }, [
        el('p', {}, treatment.copy.screenerRejectedMessage),
        el('button', { class: 'cb-btn secondary block', onClick: () => ctx.router.navigate('landing') }, 'Back'),
      ]),
    ]);
  }

  render();
}
