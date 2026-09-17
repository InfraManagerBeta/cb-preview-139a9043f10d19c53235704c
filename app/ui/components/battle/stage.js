// app/ui/components/battle/stage.js — R74/R75: the animated combatant
// stage for the current timeline step. CB-BUILD-005/006: the INCUMBENT's
// combatants are no longer rendered here at all — the parametric rig stage
// (rigStage.js) composites each summoned wizard from its own shape set and
// palette on the arena; the nine bundle GIFs are parity reference only and
// are never combatant art. This module keeps the two ALTERNATE treatments'
// clearly-marked provisional stage (no bundled character art exists for
// them; CB-BUILD-007/011 govern their real stage) and the shared state
// labelling.
import { el } from '../dom.js';
import { elementSvgMarkup } from './assets.js';

const STATE_LABEL = {
  idle: 'IDLE', battleIdle: 'READY', charge: 'CHARGING', chargeLoop: 'CHARGING',
  attack: 'ATTACK', hit: 'HIT', hitSuccess: 'HIT', win: 'WIN', lose: 'LOSE',
  power: 'POWER', reset: 'RESET', draw: 'DRAW',
};

function combatantState(step, side) {
  // Per-side overrides (e.g. one side hitSuccess, the other hit) fall back
  // to the shared step state (both sides share battleIdle/charge/attack/etc).
  const key = side === 'p1' ? 'p1State' : 'p2State';
  return step[key] || step.state;
}

/** One combatant's visual for the current step (the alternates' provisional
 * stage; the incumbent's combatants render on the rig stage, rigStage.js). */
export function renderCombatant({ treatment, name, element, step, side, isNpc = false }) {
  const state = combatantState(step, side);
  const label = STATE_LABEL[state] || state.toUpperCase();

  const art = el('div', { class: `cb-combatant-placeholder cb-state-${state}` }, [
    el('span', { class: 'cb-placeholder-icon', html: elementSvgMarkup(element, 48) }),
  ]);

  return el('div', { class: `cb-combatant cb-combatant-${side}` }, [
    art,
    el('div', { class: 'cb-combatant-state-label cb-micro' }, label),
    el('div', { class: 'cb-combatant-name cb-data' }, [
      name,
      // C6/§15.8/R80: the permanent, visible NPC tag now reaches the battle
      // stage too (previously only the pre-duel header carried it; the
      // stage itself -- the surface a participant actually watches during
      // the reveal -- did not). See app/tests/invariants.test.js invariant #8.
      isNpc ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
    ]),
  ]);
}

/** The affinity FX pass marker for the ALTERNATES' provisional stage (a
 * brief overlay pulse in the element's color). The incumbent's affinity FX
 * pass is the library's own affinity-cape overlays, played by the rig stage
 * (R75 / CB-BUILD-005: FX to the bundle sources' fidelity). */
export function renderAffinityFx({ element }) {
  return el('div', { class: `cb-affinity-fx cb-fx-${element}` });
}

export function stageLabelFor(state) {
  return STATE_LABEL[state] || state.toUpperCase();
}

/**
 * CB-BUILD-007 track 1/R12: "behind the click, the two alternates' battle
 * stage gets a clearly-marked provisional stage label (a visible, honest
 * 'provisional presentation — final art pending' treatment-voiced line on
 * the alternate stage only; incumbent untouched)." Reads
 * treatment.provisionalStageLine (product data, app/data/treatments/
 * adjacent.json / far.json — absent on incumbent.json by design: the
 * incumbent's rig stage is real art, never provisional). Returns null for
 * any treatment without the line (the incumbent), so a caller can render
 * it unconditionally with no per-treatment branching of its own.
 *
 * C6/R11 [LAW] fix round: this is a full sentence (a player reads it) --
 * PROSE face (.cb-prose, --font-prose), never the data face (.cb-micro,
 * --font-data -- figures/tags/timestamps only). `.cb-provisional-stage-
 * notice` itself carries the positioning/color (battle.css); only the
 * font-face class changed.
 */
export function renderProvisionalStageNotice(treatment) {
  if (!treatment || !treatment.provisionalStageLine) return null;
  return el('div', { class: 'cb-provisional-stage-notice cb-prose' }, `\u26A0 ${treatment.provisionalStageLine}`);
}

