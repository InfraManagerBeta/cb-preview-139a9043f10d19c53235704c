// app/ui/components/battle/rigStage.js — CB-BUILD-005: the incumbent's
// battle stage, a port of the 2019 duel presentation (reference:
// assets/cw/reference/DuelPlayer — consulted, never imported):
//  - the combatants are composited on the incumbent's arena art
//    (client-static/img/fightScene/fightBG.svg, exactly the scene image the
//    reference stage used), never a bare or white field;
//  - each combatant is the ACTUAL summoned wizard: its per-combo shape set
//    (selected by its own traits) recoloured live to its own palette
//    (rigAssets.js), so the two fighters are visually distinct;
//  - every state is its own preloaded player instance, stacked and toggled
//    (the reference's layer structure: one hidden layer per state per side,
//    visibility-switched) with an opacity cross-fade — state transitions
//    never swap a src, never re-fetch, never blank or flash;
//  - the away side mirrors (scaleX(-1)) like the reference; charge/attack
//    element FX are the shape sets' own baked FX layers (source fidelity),
//    and affinity rounds overlay the library's affinity-cape win/lose FX;
//  - playback: lottie-web canvas renderer with setSubframe(false), the
//    reference's own player configuration (see app/vendor/README.md — the
//    runtime engine decision; Lottie stays interchange only).
import { el } from '../dom.js';

// Relative to the HTML document (app/index.html) — GitHub Pages subpath safe.
const ARENA_SRC = '../assets/cw/client-static/img/fightScene/fightBG.svg';
// Relative to THIS module's URL (dynamic import resolves module-relative).
const VENDOR_PLAYER = '../../../vendor/lottie.min.js';

// Timeline step state -> rig clip per side. `null` means sticky (the side
// keeps its current clip): the power beat holds the winner's win / loser's
// lose, and the affinity FX pass plays over the round-result poses —
// matching the reference chain, where the winner plays RESET and the loser
// HIT after every attack, and win/lose hold through the closing beats.
// Exported (C7): the parity harness's no-blank check (tools/parity/
// check-d-ac1.mjs) drives THIS mapping over the real timeline, so the
// measured transition path is the shipped one, not a re-derivation.
export const STEP_TO_CLIP = Object.freeze({
  idle: 'idle',
  battleIdle: 'idle',
  charge: 'charge',
  chargeLoop: 'chargeloop',
  attack: 'attack',
  hit: 'hit',
  hitSuccess: 'reset', // reference DuelPlayer: the round winner plays RESET (the recover), the loser plays HIT
  reset: 'reset',
  draw: 'idle',
  win: 'win',
  lose: 'lose',
  power: null,
  affinityFx: null,
});

// Clips that loop while their step holds (reference: idle and chargeLoop
// run with loop=true; everything else plays once and holds its last frame).
export const LOOP_CLIPS = new Set(['idle', 'chargeloop']);

let lottiePromise = null;
function ensureLottie() {
  if (!lottiePromise) {
    // An already-attached player wins (the browser UMD attaches
    // globalThis.lottie when the script is present; tests inject a stub the
    // same way); otherwise import the vendored player. Under a CommonJS
    // loader (the Node parity harness) the namespace default carries it.
    if (globalThis.lottie && typeof globalThis.lottie.loadAnimation === 'function') {
      lottiePromise = Promise.resolve(globalThis.lottie);
    } else {
      lottiePromise = import(VENDOR_PLAYER).then((mod) => {
        const player = globalThis.lottie || (mod && mod.default) || mod;
        if (!player || typeof player.loadAnimation !== 'function') throw new Error('rig player failed to attach');
        return player;
      });
    }
  }
  return lottiePromise;
}

function sideStateFor(step, side) {
  if (!step) return 'battleIdle';
  const key = side === 'p1' ? 'p1State' : 'p2State';
  return step[key] || step.state;
}

/**
 * Build the incumbent battle stage. `loadout` is a rigAssets loadout whose
 * fetches are already in flight; the stage creates every player instance
 * up-front from the loadout's in-memory animation data and never fetches
 * during the duel. Returns { root, whenReady, setStep, resize, destroy }.
 */
export function createRigStage({ loadout, p1, p2, treatment }) {
  const anims = { p1: {}, p2: {} }; // side -> clip name -> lottie instance
  const mounts = { p1: {}, p2: {} }; // side -> clip name -> element
  const capeAnims = { p1: {}, p2: {} };
  const capeMounts = { p1: {}, p2: {} };
  const current = { p1: null, p2: null };
  let destroyed = false;

  function wizardColumn(side) {
    const stateStack = el('div', { class: `cb-rig-wizard ${side === 'p1' ? 'home' : 'away'}` });
    for (const clip of Object.keys(loadoutClips())) {
      const mount = el('div', { class: 'cb-rig-anim', 'data-clip': clip, 'data-side': side });
      mounts[side][clip] = mount;
      stateStack.appendChild(mount);
    }
    for (const kind of ['win', 'lose']) {
      const mount = el('div', { class: 'cb-rig-cape', 'data-cape': kind, 'data-side': side });
      capeMounts[side][kind] = mount;
      stateStack.appendChild(mount);
    }
    return stateStack;
  }

  function loadoutClips() {
    // The distinct clips the stage stacks per side (values of STEP_TO_CLIP).
    const clips = {};
    for (const clip of Object.values(STEP_TO_CLIP)) if (clip) clips[clip] = true;
    return clips;
  }

  function namePlate(side, fighter) {
    return el('div', { class: `cb-rig-nameplate cb-rig-nameplate-${side}` }, [
      el('span', { class: 'cb-combatant-name cb-data' }, [
        fighter.name,
        // invariant #8 / R80: the permanent NPC tag reaches the stage.
        fighter.isNpc ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
      ]),
    ]);
  }

  const loaderBar = el('div', { class: 'cb-rig-progress-bar' });
  const loader = el('div', { class: 'cb-rig-loader' }, [
    el('div', { class: 'cb-rig-progress' }, [loaderBar]),
  ]);

  const scene = el('div', { class: 'cb-rig-scene' }, [
    wizardColumn('p1'),
    wizardColumn('p2'),
  ]);

  const root = el('div', { class: 'cb-rig-stage' }, [
    // The treatment's arena, always under the combatants (R74: never a bare
    // or white field). CSS pins the aspect from the arena art itself.
    el('img', { class: 'cb-rig-arena', src: ARENA_SRC, alt: '' }),
    scene,
    loader,
    el('div', { class: 'cb-rig-nameplates' }, [namePlate('p1', p1), namePlate('p2', p2)]),
  ]);

  let progressTimer = null;
  let disconnectWatchdog = null;

  // A-loader (fix round F2, R74/§12/R83): a TOTAL load failure (bucket AND
  // vendored fallback unreachable — loadout.ready rejects) must fail
  // honestly: reveal the stage in its best available degraded form (the
  // arena art and nameplates render independently of the loadout) with a
  // one-line player-language notice on the PROSE face — never a frozen
  // loader pinned over the arena, never a blank field, and never a rejected
  // whenReady stranding the reveal.
  function degrade() {
    clearInterval(progressTimer);
    loader.classList.add('done'); // the loader never freezes over the arena
    root.classList.add('degraded');
    root.appendChild(el('div', { class: 'cb-rig-degraded-notice cb-prose' },
      treatment.copy.stageDegradedNotice));
  }

  const whenReady = (async () => {
    // 1. every animation source in memory (fetch+recolour), with the
    //    loader bar tracking real progress;
    progressTimer = setInterval(() => {
      const { loaded, total } = loadout.progress();
      loaderBar.style.width = `${Math.round((loaded / Math.max(1, total)) * 100)}%`;
    }, 100);
    // the player import runs concurrently with the loadout; its rejection
    // is observed by the await below (the side catch only silences the
    // unhandled-rejection path when the loadout has already failed first).
    const lottieImport = ensureLottie();
    lottieImport.catch(() => {});
    let lottie;
    try {
      await loadout.ready;
      lottie = await lottieImport;
    } catch {
      if (destroyed) return;
      degrade();
      return;
    }
    clearInterval(progressTimer);
    if (destroyed) return;
    // 2. one player instance per clip per side, created from in-memory
    //    data (no path, no network), canvas renderer, setSubframe(false) —
    //    the reference player configuration.
    const created = [];
    for (const side of ['p1', 'p2']) {
      for (const clip of Object.keys(loadoutClips())) {
        const anim = lottie.loadAnimation({
          container: mounts[side][clip],
          renderer: 'canvas',
          autoplay: false,
          loop: LOOP_CLIPS.has(clip),
          animationData: loadout.get(side, clip),
        });
        anim.setSubframe(false);
        anims[side][clip] = anim;
        created.push(anim);
      }
      for (const kind of ['win', 'lose']) {
        const anim = lottie.loadAnimation({
          container: capeMounts[side][kind],
          renderer: 'canvas',
          autoplay: false,
          loop: false,
          animationData: loadout.getCape(side, kind),
        });
        anim.setSubframe(false);
        capeAnims[side][kind] = anim;
        created.push(anim);
      }
    }
    // 3. size the canvases to their now-mounted containers and paint every
    //    first frame so the switch-on shows a drawn wizard, never a blank.
    resize();
    for (const anim of created) { try { anim.goToAndStop(0, true); } catch { /* first paint is best-effort */ } }
    loader.classList.add('done');
    root.classList.add('ready');
    // Teardown watchdog: the duel screen's own unmount teardown covers its
    // timers and sound; the stage covers ITSELF — once its root has been in
    // the document and leaves it (navigation away, kill mid-reveal, result
    // screen mounted), every player instance is destroyed so no detached
    // canvas keeps painting.
    let wasConnected = false;
    disconnectWatchdog = setInterval(() => {
      if (root.isConnected) { wasConnected = true; return; }
      if (wasConnected) destroy();
    }, 1000);
  })();

  function setClip(side, clip) {
    if (current[side] === clip) return;
    const prev = current[side];
    current[side] = clip;
    if (prev && anims[side][prev]) {
      mounts[side][prev].classList.remove('visible');
      try { anims[side][prev].pause(); } catch { /* ignore */ }
    }
    const anim = anims[side][clip];
    const mount = mounts[side][clip];
    if (!anim || !mount) return;
    mount.classList.add('visible'); // cross-fade: CSS opacity transition over the still-painted previous canvas
    try { anim.goToAndStop(0, true); anim.play(); } catch { /* ignore */ }
  }

  function playCape(side, kind) {
    const mount = capeMounts[side][kind];
    const anim = capeAnims[side][kind];
    if (!mount || !anim) return;
    mount.classList.add('visible');
    try {
      anim.goToAndStop(0, true);
      anim.play();
    } catch { /* ignore */ }
    anim.addEventListener('complete', () => mount.classList.remove('visible'));
  }

  /**
   * Drive the stage from one presentation-timeline step (R75 order; the
   * timeline itself is app/engine/presentationTimeline.js, a verified keep).
   * `fx` (for the affinityFx step): { p1Cape: 'win'|'lose'|null, p2Cape }.
   */
  function setStep(step, fx = {}) {
    const state1 = sideStateFor(step, 'p1');
    const state2 = sideStateFor(step, 'p2');
    const clip1 = STEP_TO_CLIP[state1];
    const clip2 = STEP_TO_CLIP[state2];
    if (clip1) setClip('p1', clip1);
    if (clip2) setClip('p2', clip2);
    if (step && step.state === 'affinityFx') {
      if (fx.p1Cape) playCape('p1', fx.p1Cape);
      if (fx.p2Cape) playCape('p2', fx.p2Cape);
    }
  }

  function resize() {
    for (const side of ['p1', 'p2']) {
      for (const anim of Object.values(anims[side])) { try { anim.resize(); } catch { /* ignore */ } }
      for (const anim of Object.values(capeAnims[side])) { try { anim.resize(); } catch { /* ignore */ } }
    }
  }

  function destroy() {
    destroyed = true;
    clearInterval(progressTimer);
    clearInterval(disconnectWatchdog);
    for (const side of ['p1', 'p2']) {
      for (const anim of Object.values(anims[side])) { try { anim.destroy(); } catch { /* ignore */ } }
      for (const anim of Object.values(capeAnims[side])) { try { anim.destroy(); } catch { /* ignore */ } }
      anims[side] = {}; capeAnims[side] = {};
    }
  }

  return { root, whenReady, setStep, resize, destroy };
}
