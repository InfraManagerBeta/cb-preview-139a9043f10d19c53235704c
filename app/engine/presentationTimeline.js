// app/engine/presentationTimeline.js
// §10/R74-R77 — pure, DOM-free construction of the battle-screen animation
// timeline for one resolved duel. The UI stage (app/ui/components/battle/
// stage.js) walks this list on a timer; this module only computes WHICH
// canonical state comes next and for how long, so the sequencing itself is
// unit-testable without a browser (cadence, ordering, skippability budget,
// the <45s ceiling).
//
// R74 canonical states (the incumbent's are the bundle's nine GIFs; the
// production state list additionally names chargeLoop/reset/draw/cancel):
// Idle, Battle Idle, Charge, Attack, Hit, Hit Success, Win, Lose, Power.

export const CANONICAL_STATES = Object.freeze([
  'idle', 'battleIdle', 'charge', 'chargeLoop', 'attack', 'hit', 'hitSuccess',
  'win', 'lose', 'power', 'reset', 'draw', 'cancel',
]);

// Presentational (non-canonical-GIF) states for the three R75 coverage-gap
// moments -- each ships two candidate treatments (docs/presentation-candidates.md).
export const MOMENT_STATES = Object.freeze(['floorDrain', 'coinFlip', 'prizeAward']);

// Per-state duration as a fraction of the O9 cadence (the "beat"). Chosen so
// a full 5-round duel plus its final sequence stays comfortably under the
// R75 45-second ceiling even at the slowest cadence alternative (1500ms) and
// the "worst case" content (every round tagged CRITICAL, a floor drain, AND
// a prize award) -- see app/tests/presentation-timeline.test.js.
//
// A2 fix (f2): the review's true worst case -- 5 CRITICAL rounds + floor
// drain + prize, AT O9=1500ms, INCLUDING the pre-round hold (previously
// omitted from `totalDurationMs`, see below) -- measured 44,550ms, ~450ms
// under the 45s ceiling and (per the review) 39 full-screen rebuilds. These
// weights are trimmed (from the pre-f2 values) so the same true worst case
// now lands at ~40.4s, leaving real headroom under the ~42s target, and the
// per-step rebuild is gone (see app/ui/screens/duel.js: `renderFrame` now
// patches the tug bar / stage / rails / round-cards containers in place
// instead of calling `mountScreen()` -- a full teardown+rebuild -- on every
// timeline step).
const STEP_WEIGHTS = Object.freeze({
  battleIdle: 0.6,
  charge: 0.85,
  chargeLoop: 0.5,
  attack: 0.8,
  hit: 0.85,
  hitSuccess: 0.85,
  draw: 0.85,
  affinityFx: 0.5,
  reset: 0.35,
  win: 0.85,
  lose: 0.85,
  power: 0.85,
  floorDrain: 1.1,
  coinFlip: 1.1,
  prizeAward: 0.85,
});

function stepMs(state, cadenceMs) {
  return Math.max(1, Math.round((STEP_WEIGHTS[state] ?? 1) * cadenceMs));
}

/**
 * The timeline for a single round (R75): both Battle Idle -> both Charge
 * (committed element) -> chargeLoop -> both Attack simultaneously -> winner
 * Hit Success / loser Hit, or a draw returns both to Battle Idle -> an
 * affinity round gets the element FX pass -> reset -> (caller continues to
 * the next round).
 */
export function buildRoundSteps(round, cadenceMs) {
  const steps = [];
  const push = (state, meta = {}) => steps.push({ state, ms: stepMs(state, cadenceMs), round: round.round, ...meta });

  push('battleIdle');
  push('charge', { p1Move: round.move1, p2Move: round.move2 });
  push('chargeLoop');
  push('attack');

  if (round.result === 'DRAW') {
    push('draw', { p1State: 'battleIdle', p2State: 'battleIdle' });
  } else {
    const p1Result = round.result === 'WIN' ? 'hitSuccess' : 'hit';
    const p2Result = round.result === 'WIN' ? 'hit' : 'hitSuccess';
    push(p1Result === 'hitSuccess' ? 'hitSuccess' : 'hit', { p1State: p1Result, p2State: p2Result });
  }

  if (round.tag === 'BIG' || round.tag === 'CRITICAL') {
    push('affinityFx', { tag: round.tag });
  }

  push('reset', { roundComplete: true });
  return steps;
}

/**
 * The post-round-five sequence (R75): Win/Lose; the winner's Power over the
 * stake counter; a floor drain gets an erasure treatment; a true tie gets a
 * coin-flip presentation before the advancing character's Win. `momentChoice`
 * (from consoleOverrides.presentationMoments, R75 coverage-gap candidates)
 * picks candidate 1 or 2 for floorDrain/coinFlip/prizeAward -- purely a
 * presentation switch, never a math input.
 */
export function buildFinalSteps(outcome, cadenceMs, { momentChoice = {}, bracketComplete = false } = {}) {
  const steps = [];
  const push = (state, meta = {}) => steps.push({ state, ms: stepMs(state, cadenceMs), final: true, ...meta });

  if (outcome.trueTie) {
    push('coinFlip', { candidate: momentChoice.coinFlip || 1 });
    push(outcome.coinFlipWinner === 1 ? 'win' : 'lose');
  } else if (outcome.floorDrain) {
    push('floorDrain', { candidate: momentChoice.floorDrain || 1 });
    push(outcome.winner === 1 ? 'win' : 'lose');
  } else {
    push(outcome.winner === 1 ? 'win' : 'lose');
  }

  push('power');

  if (bracketComplete && (outcome.winner === 1 || outcome.coinFlipWinner === 1)) {
    push('prizeAward', { candidate: momentChoice.prizeAward || 1 });
  }

  return steps;
}

/** The complete duel timeline: all five rounds, then the final sequence. */
export function buildDuelTimeline(outcome, cadenceMs, opts = {}) {
  const roundSteps = outcome.rounds.flatMap((r) => buildRoundSteps(r, cadenceMs));
  const finalSteps = buildFinalSteps(outcome, cadenceMs, opts);
  return [...roundSteps, ...finalSteps];
}

// A2/R76 fix (f2): the reveal loop holds on the pre-round-one frame for
// `Math.max(1000, cadenceMs)` before the timeline itself starts advancing
// (R76: "the bar holds readable for one second before round one") --
// app/ui/screens/duel.js used this literal expression inline; that real
// elapsed time was NOT counted by `totalDurationMs` below, so the review's
// true worst-case measurement (which DOES include it) came out ~1.5s higher
// than the engine's own self-reported total. One source now: the UI reads
// this function instead of re-deriving the same expression.
export function preRoundHoldMs(cadenceMs) {
  return Math.max(1000, cadenceMs);
}

/**
 * Total elapsed wall-clock time for a timeline. A2 fix: now optionally
 * counts the pre-round hold too (pass `cadenceMs` as the second argument) so
 * a caller measuring the TRUE worst case gets the real number the
 * participant actually waits, not just the sum of the timeline's own steps.
 * Omitting `cadenceMs` preserves the old steps-only sum (no behavior change
 * for any caller that doesn't ask for the hold).
 */
export function totalDurationMs(steps, cadenceMs = 0) {
  const hold = cadenceMs > 0 ? preRoundHoldMs(cadenceMs) : 0;
  return hold + steps.reduce((sum, s) => sum + s.ms, 0);
}
