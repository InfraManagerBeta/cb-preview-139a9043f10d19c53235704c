// app/ui/screens/screener.js — R70: identity gates run in-product, simulated
// verdicts. R8a truth line repeated (every money-adjacent surface repeats it).
//
// CB-BUILD-001: R70 says jurisdiction is DETECTED from the connection, never
// a region self-report, and age is attested by date of birth, never a raw
// checkbox. The delivered build asked two identical self-report checkboxes
// ("Do you currently reside in a permitted region?") -- unrealistic (nobody
// self-reports a jurisdiction check) and unanswerable (it never named which
// regions qualify). Fixed:
//   - jurisdiction: simulated ONCE, at mount, before any UI renders, and
//     presented as an already-DETECTED verdict -- never a question. A
//     player whose simulated verdict is not permitted meets the shipped
//     "not available in your region" outcome (the existing rejected
//     screen) immediately; the DOB step never renders for that player.
//   - age: a date-of-birth entry replaces the checkbox; age18 is COMPUTED
//     from the entered DOB (attested), not hand-ticked.
// `submitScreener` keeps its exact idempotency-key scheme (game.js
// untouched) -- only what the UI collects and when it calls it changed.
import { mountScreen, el } from '../components/dom.js';

// R70: jurisdiction is determined from "the connection" -- a location
// check, never a region self-report. The play-money build has no real
// connection to check, so the verdict is SIMULATED, but it must still
// PRESENT as a detected verdict and never ask the player a region
// question. `ctx.detectLocation` is an injection point (tests; a future
// real backend) for the two possible simulated verdicts named by the
// patch: a stubbed detected-permitted region (the shipped default, since
// the play-money build has no permitted-set data to reject against), or
// the shipped "not available in your region" outcome.
export function simulateLocationVerdict(ctx) {
  if (ctx && typeof ctx.detectLocation === 'function') return ctx.detectLocation();
  return { permitted: true, region: 'DETECTED' };
}

// R70: age is attested by date of birth. Returns false for an empty/
// unparseable value so an incomplete field never computes a false "18+".
export function computeAge18(dobString, now = Date.now()) {
  if (!dobString) return false;
  const birth = new Date(dobString);
  if (Number.isNaN(birth.getTime())) return false;
  const today = new Date(now);
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 0 && age >= 18;
}

function isValidDobString(dobString) {
  if (!dobString) return false;
  const d = new Date(dobString);
  return !Number.isNaN(d.getTime());
}

export function mountScreener(ctx) {
  const { treatment } = ctx;
  // R70: detected once, up front -- never re-checked per keystroke, never
  // presented as a question.
  const verdict = simulateLocationVerdict(ctx);
  let dob = '';
  let submitting = false; // f4/A-b: submitting guard on Continue (submitScreener's own attempt-count idempotency key is unchanged/untouched -- this only stops a double-tap firing two attempts before the first press's navigation lands)

  // C2/R70: a player outside the permitted set meets the shipped "not
  // available in your region" outcome -- its OWN rendering, never the
  // under-18 copy, and never attributing the verdict to the player's
  // "answers" (the jurisdiction verdict isn't an answer at all -- it's a
  // detected fact, per R70). `screenerRejectedMessage` (under-18) keeps its
  // own separate copy, also with no answers-framing (both messages are
  // outcome statements, not "you answered wrong").
  function renderRejected(reason) {
    const message = reason === 'jurisdiction' ? treatment.copy.screenerNotAvailableMessage : treatment.copy.screenerRejectedMessage;
    mountScreen([
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
      el('div', { class: 'cb-card' }, [
        el('p', {}, message),
        el('button', { class: 'cb-btn secondary block', onClick: () => ctx.router.navigate('landing') }, 'Back'),
      ]),
    ]);
  }

  function finalizeSubmit(age18, reason) {
    if (submitting) return; // f4/A-b
    submitting = true;
    const result = ctx.game.submitScreener({ age18, jurisdictionOk: verdict.permitted });
    if (result.passed) {
      ctx.router.navigate('summon');
    } else {
      // The caller already knows structurally which outcome this is (the
      // jurisdiction pre-check below never collects a DOB at all; the
      // Continue-button path below only ever calls this once jurisdiction
      // is already permitted) -- no need to infer it back out of
      // `result.reasons` (which, per the A2 fix below, may legitimately
      // carry both flags for a jurisdiction rejection since age was never
      // attested either way).
      renderRejected(reason || (verdict.permitted ? 'age' : 'jurisdiction'));
    }
  }

  function render() {
    const dobValid = isValidDobString(dob);
    const age18 = computeAge18(dob);
    mountScreen([
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
      el('h2', {}, treatment.copy.screenerHeading),
      el('p', { class: 'cb-legal' }, treatment.copy.screenerBody),
      el('div', { class: 'cb-card' }, [
        // R70: the location verdict is PRESENTED, already decided -- not a
        // checkbox, not a question.
        el('div', { class: 'cb-checkbox-row', style: 'min-height:44px' }, [
          el('span', { class: 'cb-micro' }, 'Location'),
          el('span', {}, 'Verified for play'),
        ]),
        el('label', { class: 'cb-checkbox-row', style: 'min-height:44px' }, [
          el('span', {}, 'Date of birth'),
          el('input', {
            type: 'date',
            value: dob,
            style: 'min-height:44px',
            onChange: (e) => { dob = e.target.value; render(); },
          }),
        ]),
      ]),
      el('button', {
        class: 'cb-btn block',
        'aria-disabled': !dobValid || submitting,
        onClick: () => {
          if (!dobValid) return; // gated: nothing to submit yet
          finalizeSubmit(age18, 'age');
        },
      }, 'Continue'),
    ]);
  }

  if (!verdict.permitted) {
    // R70: outside the simulated permitted set -> the shipped "not
    // available in your region" outcome, immediately, with no DOB step and
    // no question ever shown.
    //
    // A2 fix: this used to call finalizeSubmit(true) -- fabricating an
    // `age18: true` attestation on the ledger for a player whose date of
    // birth was NEVER collected (the DOB step never renders on this path).
    // That's a false attestation, not merely an unused field: a later
    // audit of the SCREENER_RESULT event would read "attested 18+" for
    // someone who was never asked. Recorded honestly instead: `age18: null`
    // -- "not attested," not "attested true." The verdict is unaffected
    // either way (jurisdictionOk alone already fails `passed`); this only
    // changes what's WRITTEN to the ledger.
    finalizeSubmit(null, 'jurisdiction');
  } else {
    render();
  }
}
