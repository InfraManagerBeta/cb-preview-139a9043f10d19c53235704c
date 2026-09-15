// app/ui/components/battle/stage.js — CB-BUILD-005 / R74/R75: the battle
// stage, ported from the shipped 2019 duel presentation (the asset
// bundle's reference/DuelPlayer/ implementation — the state machine, layer
// structure and layout constants come from DuelPlayer.js/DuelPlayer.css,
// not from taste).
//
// The incumbent's stage:
//   - composites on the bundle's arena art (fightScene/fightBG.svg over the
//     grid texture) — never a bare or white field;
//   - renders EACH combatant from its OWN cosmetic shape set, recoloured to
//     its own palette by the parametric rig (CB-BUILD-006) — the two
//     fighters are visually distinct, and a wizard the system has never
//     seen animates as itself;
//   - creates one persistent player per state per side at PRELOAD time
//     (the reference's loadAnimations/handleDataReady gate) and cross-fades
//     layer visibility on state changes — nothing swaps an `img src`,
//     nothing re-fetches, no frame blanks or flashes;
//   - builds the element/affinity FX pass from the bundle's FX sources
//     (per-element backdrop art, element flag animation, per-element/
//     per-tier affinity cape overlay), never a flat colour fill.
//
// The two alternate treatments have no bundled character art (R12 /
// CB-BUILD-007: art is a supply task, never fabricated here); they keep the
// clean treatment-colored provisional stage — dark treatment chrome with
// element iconography, still never bare/white — via renderCombatant below.
// CB-BUILD-007 also put a clearly-marked provisional badge on that stage
// (treatment.copy.provisionalStageLabel) so it reads as "art pending", not
// broken — a complete skin over the same fixed mechanics (R11/R13); that
// badge survives here unchanged even though the incumbent's own path moved
// to the parametric rig above.
import { el } from '../dom.js';
import { LIBRARY_STATES, TIMELINE_TO_LIBRARY_STATE } from './rig.js';
import { createStatePlayer, whenAllReady } from './player.js';
import { arenaSources, elementBackdropUrl, elementFlagUrl, elementSvgMarkup } from './assets.js';
import { setPresentationFreezeHook, releasePresentationFreezeHook } from './sound.js';

export const STATE_LABEL = {
  idle: 'IDLE', battleIdle: 'READY', charge: 'CHARGING', chargeLoop: 'CHARGING',
  attack: 'ATTACK', hit: 'HIT', hitSuccess: 'HIT', win: 'WIN', lose: 'LOSE',
  power: 'POWER', reset: 'RESET', draw: 'DRAW',
};

export function stageLabelFor(state) {
  return STATE_LABEL[state] || state.toUpperCase();
}

// Library states that loop while shown (the reference sets loop=true on the
// chargeLoop instances and keeps idle looping until the chain starts).
export const LOOPED_LIBRARY_STATES = Object.freeze(['idle', 'chargeloop']);

function combatantState(step, side) {
  const key = side === 'p1' ? 'p1State' : 'p2State';
  return step[key] || step.state;
}

// ---- pure plan (node-testable): every layer exists before playback ----------

/**
 * The full layer plan for one duel: per side, one persistent animation layer
 * per library state (created up front, cross-faded afterwards) plus the FX
 * pass layers. Pure data — createBattleStage assembles exactly this plan, so
 * the no-blank/no-flash structure is testable without a browser.
 */
export function stageLayerPlan(sides = ['p1', 'p2']) {
  const layers = [];
  for (const side of sides) {
    for (const state of LIBRARY_STATES) {
      layers.push({ side, kind: 'wizard', state, cls: `cb-anim-layer cb-anim-${side}-${state}` });
    }
    for (const fx of ['capeWin', 'capeLose', 'flag']) {
      layers.push({ side, kind: 'fx', state: fx, cls: `cb-fx-layer cb-fx-${side}-${fx}` });
    }
  }
  return layers;
}

/**
 * The element/affinity FX pass source set (R74 fidelity rule): the bundle's
 * per-element backdrop art + the bundle's element flag animation + the shape
 * library's per-element/per-tier affinity cape overlay. Never a flat fill.
 */
export function fxPassSources(elementKey, { won = true } = {}) {
  return {
    backdrop: elementBackdropUrl(elementKey, won),
    flag: elementFlagUrl(elementKey),
    capeKey: won ? 'win' : 'lose',
  };
}

// ---- the persistent incumbent stage -----------------------------------------

let activeStage = null;

/** Freeze/destroy whichever stage is currently live (back-to-back duels,
 * teardown). Also wired into sound.stopAll via setPresentationFreezeHook. */
export function destroyActiveBattleStage() {
  if (activeStage) {
    const s = activeStage;
    activeStage = null;
    s.destroy();
  }
}

function nameplate(plate, treatment, side) {
  return el('div', { class: `cb-stage-nameplate ${side}` }, [
    el('span', { class: 'cb-data' }, plate.name),
    // C6/§15.8/R80: the permanent, visible NPC tag on the stage surface.
    plate.isNpc ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
  ]);
}

/**
 * Build the incumbent's persistent battle stage. Everything is created HERE,
 * before the duel plays: the arena composite, every state layer and player
 * for both combatants (from their preloaded parametric documents), and the
 * FX pass layers. `showStep` afterwards only toggles visibility classes and
 * play/stop — it can neither fetch nor construct.
 *
 * @param {object} args
 * @param {object} args.treatment
 * @param {object} args.p1 { name, element, isNpc }
 * @param {object} args.p2 { name, element, isNpc }
 * @param {object} args.actors { p1, p2 } — shapes.js preloadWizard results
 * @param {object} args.capes { p1: {win, lose}, p2: {win, lose} } cape docs
 * @param {object} args.flags { p1: doc|null, p2: doc|null } element flag docs
 */
export function createBattleStage({ treatment, p1, p2, actors, capes = {}, flags = {} }) {
  destroyActiveBattleStage();

  const arena = arenaSources(treatment);
  const players = new Map(); // `${side}:${state}` -> player
  const fxPlayers = new Map(); // `${side}:${capeWin|capeLose|flag}` -> player
  const backdrops = {}; // side -> Map("element:win|lose" -> img), all created up front
  const layerNodes = new Map(); // `${side}:${state}` -> element
  const visible = { p1: null, p2: null };

  const momentOverlay = el('div', { class: 'cb-moment-overlay' });

  const sideNodes = {};
  for (const side of ['p1', 'p2']) {
    const actor = side === 'p1' ? actors.p1 : actors.p2;
    const slot = el('div', { class: `cb-wizard-slot ${side}` });
    for (const state of LIBRARY_STATES) {
      const layer = el('div', { class: `cb-anim-layer`, 'data-side': side, 'data-state': state });
      const composite = actor.docs.get(state);
      const player = createStatePlayer({
        container: layer,
        doc: composite.doc,
        loop: LOOPED_LIBRARY_STATES.includes(state),
        name: `${side}:${state}`,
      });
      players.set(`${side}:${state}`, player);
      layerNodes.set(`${side}:${state}`, layer);
      slot.appendChild(layer);
    }

    // FX pass layers (per side): backdrop art + element flag + affinity capes.
    // EVERY backdrop variant (element × win/lose) is created up front as its
    // own <img> and merely toggled later — no src is ever swapped mid-duel
    // (R74: preloaded, never re-fetched).
    const fxSlot = el('div', { class: `cb-fx-slot ${side}` });
    const backdropSet = new Map();
    for (const elementKey of ['fire', 'water', 'air']) {
      for (const won of [true, false]) {
        const img = el('img', { class: 'cb-fx-backdrop', alt: '', src: elementBackdropUrl(elementKey, won) });
        backdropSet.set(`${elementKey}:${won ? 'win' : 'lose'}`, img);
        fxSlot.appendChild(img);
      }
    }
    backdrops[side] = backdropSet;
    const sideCapes = capes[side] || {};
    for (const [key, doc] of [['capeWin', sideCapes.win], ['capeLose', sideCapes.lose], ['flag', flags[side]]]) {
      const fxLayer = el('div', { class: 'cb-fx-anim-layer', 'data-side': side, 'data-fx': key });
      if (doc) {
        fxPlayers.set(`${side}:${key}`, createStatePlayer({ container: fxLayer, doc, loop: false, name: `${side}:${key}` }));
      }
      fxSlot.appendChild(fxLayer);
    }
    sideNodes[side] = { slot, fxSlot };
  }

  const root = el('div', {
    class: `cb-arena-stage${arena.provisional ? ' provisional' : ''}`,
    style: arena.background ? `background-image:url('${arena.background}');` : '',
  }, [
    arena.gridPattern ? el('div', { class: 'cb-arena-grid', style: `background-image:url('${arena.gridPattern}');` }) : null,
    sideNodes.p1.fxSlot,
    sideNodes.p2.fxSlot,
    sideNodes.p1.slot,
    sideNodes.p2.slot,
    el('div', { class: 'cb-stage-nameplates' }, [
      nameplate(p1, treatment, 'p1'),
      el('span', { class: 'cb-vs-marker cb-micro' }, 'VS'),
      nameplate(p2, treatment, 'p2'),
    ]),
    momentOverlay,
  ]);

  function setVisible(side, libraryState) {
    if (visible[side] === libraryState) return;
    const prevKey = visible[side] ? `${side}:${visible[side]}` : null;
    const nextKey = `${side}:${libraryState}`;
    const nextLayer = layerNodes.get(nextKey);
    const nextPlayer = players.get(nextKey);
    if (!nextLayer || !nextPlayer) return;
    // Cross-fade: the incoming layer starts playing BEFORE the outgoing
    // layer hides (both fully constructed since preload), so no frame is
    // ever blank between states.
    nextPlayer.setLoop(LOOPED_LIBRARY_STATES.includes(libraryState));
    nextPlayer.play();
    nextLayer.classList.add('visible');
    if (prevKey) {
      const prevLayer = layerNodes.get(prevKey);
      const prevPlayer = players.get(prevKey);
      prevLayer.classList.remove('visible');
      // stop after the fade so the outgoing frames stay drawn during overlap
      setTimeout(() => { if (!prevLayer.classList.contains('visible')) prevPlayer.stop(); }, 200);
    }
    visible[side] = libraryState;
  }

  function playFx(side, key) {
    const player = fxPlayers.get(`${side}:${key}`);
    if (!player) return;
    const fxLayer = root.querySelector(`.cb-fx-anim-layer[data-side="${side}"][data-fx="${key}"]`);
    if (fxLayer) fxLayer.classList.add('visible');
    player.play();
    setTimeout(() => { if (fxLayer) fxLayer.classList.remove('visible'); player.stop(); }, 1400);
  }

  const stage = {
    root,
    players,
    fxPlayers,

    /** Aggregate readiness of every player (the reference's
     * animationsLoaded === animationsTotal gate). Once ready AND mounted,
     * every canvas re-measures against its now-laid-out container (players
     * are created before the stage joins the document — preload first). */
    whenReady(onProgress) {
      const all = [...players.values(), ...fxPlayers.values()];
      return whenAllReady(all, onProgress).then(() => new Promise((resolve) => {
        const finish = () => { for (const p of all) p.resize(); resolve(); };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => finish());
        else finish();
      }));
    },

    /** Drive one timeline step (engine/presentationTimeline.js). Pure
     * visibility/playback switching — no construction, no fetching. */
    showStep(step, { affinityElement = null, winnerSide = null, p1WonRound = true } = {}) {
      if (!step) { setVisible('p1', 'idle'); setVisible('p2', 'idle'); return; }
      const state = step.state;
      if (state === 'affinityFx') {
        // R75: the element FX pass — sides hold their round-result states;
        // the pass itself is the FX layers, from sources (never a flat fill).
        this.playAffinityFx({ element: affinityElement, p1Won: p1WonRound });
        return;
      }
      if (state === 'floorDrain') {
        // R75: the erasure treatment composes with Lose — loser drains in
        // Lose, winner holds idle; the moment overlay carries the treatment.
        setVisible(winnerSide === 'p1' ? 'p1' : 'p2', 'idle');
        setVisible(winnerSide === 'p1' ? 'p2' : 'p1', 'lose');
        return;
      }
      if (state === 'coinFlip') {
        setVisible('p1', 'idle'); setVisible('p2', 'idle');
        return;
      }
      if (state === 'prizeAward') {
        setVisible(winnerSide === 'p2' ? 'p2' : 'p1', 'win');
        setVisible(winnerSide === 'p2' ? 'p1' : 'p2', 'lose');
        return;
      }
      const p1Lib = TIMELINE_TO_LIBRARY_STATE[combatantState(step, 'p1')] || 'idle';
      const p2Lib = TIMELINE_TO_LIBRARY_STATE[combatantState(step, 'p2')] || 'idle';
      setVisible('p1', p1Lib);
      setVisible('p2', p2Lib);
    },

    /** The element/affinity FX pass, layered from the bundle's FX sources:
     * per-element backdrop + element flag + affinity cape overlay. All
     * variants were created at build time; this only toggles and plays. */
    playAffinityFx({ element = null, p1Won = true } = {}) {
      for (const side of ['p1', 'p2']) {
        const won = side === 'p1' ? p1Won : !p1Won;
        const sideElement = side === 'p1' ? p1.element : p2.element;
        const backdrop = backdrops[side].get(`${element || sideElement}:${won ? 'win' : 'lose'}`);
        if (backdrop) {
          backdrop.classList.add('visible');
          setTimeout(() => backdrop.classList.remove('visible'), 1400);
        }
        playFx(side, won ? 'capeWin' : 'capeLose');
        playFx(side, 'flag');
      }
    },

    /** R75 coverage-gap moments (floor drain / coin flip / prize award,
     * moments.js) render as an overlay OVER the composite — the arena and
     * combatants stay behind them, never a blank swap. */
    setMomentOverlay(node) {
      momentOverlay.replaceChildren(...(node ? [node] : []));
      momentOverlay.classList.toggle('active', !!node);
    },

    freeze() {
      for (const p of players.values()) p.pause();
      for (const p of fxPlayers.values()) p.pause();
    },

    destroy() {
      for (const p of players.values()) p.destroy();
      for (const p of fxPlayers.values()) p.destroy();
      players.clear();
      fxPlayers.clear();
      if (activeStage === stage) activeStage = null;
      // CB-BUILD-fix-round-2 (re-review A): release freeze-hook ownership,
      // but only when THIS stage still owns it — a destroy that lands after
      // a newer stage took the hook must never disarm the newer stage's
      // teardown freeze (releasePresentationFreezeHook compares identity).
      releasePresentationFreezeHook(freezeHook);
    },
  };

  activeStage = stage;
  // stopAll() (unmount / skip / result) freezes the visual players too;
  // destroy() above releases this ownership when the stage goes away.
  const freezeHook = () => stage.freeze();
  setPresentationFreezeHook(freezeHook);
  return stage;
}

// ---- the alternates' provisional stage (CB-BUILD-007 stays) ------------------

/** One combatant's visual for the current step — the ALTERNATE treatments'
 * provisional stage (no bundled character art, R12; a clearly-provisional
 * treatment-colored stage is acceptable behind the click until art is
 * supplied). The incumbent never routes here (createBattleStage above). */
export function renderCombatant({ treatment, name, element, step, side, isNpc = false }) {
  const state = combatantState(step, side);
  const label = STATE_LABEL[state] || state.toUpperCase();

  // CB-BUILD-005/006 moved the INCUMBENT's own rendering to
  // createBattleStage's parametric rig above (persistent per-side players,
  // preloaded and cross-faded); renderCombatant now only serves the two
  // ALTERNATE treatments' provisional stage, plus the incumbent's own
  // last-resort degrade when no shape source is reachable at all (see
  // duel.js's stageFailed branch) -- still the dark treatment field, never
  // bare/white.
  //
  // CB-BUILD-007 (docs/cb-build-patch-log.md): R12 as now written -- a
  // treatment without provided character art carries a CLEARLY-MARKED
  // provisional stage instead of an unlabeled colored box. The element
  // glyph stays (no character art originated, no incumbent asset
  // referenced); a visible badge in the treatment's own voice
  // (treatment.copy.provisionalStageLabel) states plainly that this is a
  // provisional render, never an R1 string. Mechanics/timeline/state
  // machine are untouched -- this is a skin addition only.
  const art = el('div', { class: `cb-combatant-placeholder cb-state-${state} cb-provisional-stage` }, [
    el('span', { class: 'cb-placeholder-icon', html: elementSvgMarkup(element, 40) }),
    // CB-BUILD-fix-round-1 (advisory, taken with #8): the INCUMBENT's
    // provisionalStageLabel is '' by design (it ships real art and never
    // shows a provisional badge on the happy path — see
    // cb-build-007-alternate-treatments.test.js), so its stageFailed
    // degrade rendered an EMPTY dashed badge. Honest degrade copy instead —
    // hardcoded here (never treatment copy, never an R1 string).
    el('div', { class: 'cb-provisional-badge cb-micro' },
      treatment.copy.provisionalStageLabel || 'COMBATANT ART UNAVAILABLE — DEGRADED RENDER'),
  ]);

  return el('div', { class: `cb-combatant cb-combatant-${side}` }, [
    art,
    el('div', { class: 'cb-combatant-state-label cb-micro' }, label),
    el('div', { class: 'cb-combatant-name cb-data' }, [
      name,
      // C6/§15.8/R80: the permanent, visible NPC tag on the battle stage
      // (see app/tests/invariants.test.js invariant #8).
      isNpc ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
    ]),
  ]);
}

/** The alternates' affinity FX pass marker. The incumbent's FX pass is
 * createBattleStage#playAffinityFx (bundle sources); an alternate has no
 * bundled FX art (R12), so it keeps the treatment-colored pulse, clearly
 * provisional. */
export function renderAffinityFx({ element }) {
  return el('div', { class: `cb-affinity-fx cb-fx-${element}` });
}
