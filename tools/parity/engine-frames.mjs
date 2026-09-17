// tools/parity/engine-frames.mjs — CB-BUILD-015, the NEW ENGINE side's frame
// dumper: for one wizard id, the frames the shipped build would actually
// play, per duel state.
//
// Nothing here re-implements the engine. The wizard's identity comes from
// tools/parity/identity.mjs (the shipped app/engine/wizardRig.js derivation
// for a generated wizard; the PRE-REGISTERED declaration, injected, for the
// canonical wizard — PREREGISTRATION.md §3), the animation documents come
// from app/ui/components/battle/rigAssets.js's loadout (the same fetch + live
// recolour the duel screen runs), and the player configuration is PARSED
// out of app/ui/components/battle/rigStage.js — canvas renderer,
// autoplay false, setSubframe(false), the stage's own LOOP_CLIPS policy —
// so this side moves when the stage moves.
import { createCanvas } from 'canvas';
import { lottie } from './lib.mjs';
import { createRigLoadout, DUEL_STATES } from '../../app/ui/components/battle/rigAssets.js';
import { STEP_TO_CLIP, LOOP_CLIPS } from '../../app/ui/components/battle/rigStage.js';
import { parseStagePlayerConfig as parseStageConfig, STAGE_SOURCE } from './player-config.mjs';
import { identityFor, createDeclaredIdentityLoadout } from './identity.mjs';

export { DUEL_STATES, STEP_TO_CLIP, LOOP_CLIPS, STAGE_SOURCE };

// The configuration parser lives in player-config.mjs (canvas-free, so the
// node test suite can bind it). The stage's own exported LOOP_CLIPS is
// handed to it, so the loop policy comes from the module, not a regex.
export function parseStagePlayerConfig(file = STAGE_SOURCE) {
  return parseStageConfig(file, LOOP_CLIPS);
}

/** A headless instance at the STAGE's configuration (same empty-frame retry
 * as the reference side, so an unrenderable frame is treated identically). */
export function makeEngineRenderer(animationData, { width, height, clip, config = parseStagePlayerConfig() } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const source = JSON.stringify(animationData);
  const loop = clip ? LOOP_CLIPS.has(clip) : false;
  let anim = null;
  const load = () => {
    if (anim) { try { anim.destroy(); } catch { /* ignore */ } }
    anim = lottie.loadAnimation({
      renderer: config.renderer,
      autoplay: config.autoplay,
      loop, // the stage's own per-clip loop policy
      animationData: JSON.parse(source),
      rendererSettings: { context: ctx, clearCanvas: true }, // headless substitution for the mount element
    });
    anim.setSubframe(config.subframe);
  };
  load();
  const paint = (n) => {
    ctx.clearRect(0, 0, width, height);
    anim.goToAndStop(n, true);
    return ctx.getImageData(0, 0, width, height);
  };
  const hasContent = (img) => {
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 128) return true;
    return false;
  };
  let sawContent = false;
  return {
    width, height, config, loop,
    frame(n) {
      let img = paint(n);
      if (!hasContent(img) && sawContent) {
        load();
        img = paint(n);
        if (!hasContent(img)) { load(); img.empty = true; return img; }
      }
      if (!img.empty) sawContent = sawContent || hasContent(img);
      return img;
    },
    destroy: () => { try { anim.destroy(); } catch { /* ignore */ } },
  };
}

/**
 * The engine side for ONE wizard: its identity (`identity.mjs` — the shipped
 * read path's derivation, or, for the canonical row, the PRE-REGISTERED
 * identity injected verbatim), then the loadout (fetch + live recolour) for
 * every duel state. Returns { identity, loadout, report } — the caller
 * renders the states it wants with `engineStateFrames`.
 *
 * A derived identity goes through the shipped `createRigLoadout` untouched.
 * A DECLARED identity cannot: the shipped loadout resolves identity from the
 * characterId internally, with no seam to hand it one. It then goes through
 * `createDeclaredIdentityLoadout` — the shipped loadout's own steps over the
 * given identity, pinned to `createRigLoadout` by app/tests/parity-harness.test.js.
 */
export async function engineLoadoutFor(character, { fetchImpl, cache = new Map() }) {
  const identity = identityFor(character);
  const loadout = identity.source === 'declared'
    ? createDeclaredIdentityLoadout({ identity, fetchImpl, cache })
    // One combatant is enough for a per-wizard dump; the shipped loadout
    // takes two, so the same character is passed for both sides and p1's
    // store is read.
    : createRigLoadout({ p1Character: character, p2Character: character, fetchImpl, cache });
  await loadout.ready;
  return { identity, loadout, report: loadout.report.p1 };
}

/** Render one duel state's declared frames from the loadout the stage plays. */
export function engineStateFrames({ loadout, state, frameIndices, width, height, config }) {
  const animation = loadout.get('p1', state);
  if (!animation) throw new Error(`engine-frames: the loadout carries no '${state}' clip`);
  const renderer = makeEngineRenderer(animation, { width, height, clip: state, config });
  const frames = frameIndices.map((n) => ({ n, img: renderer.frame(n) }));
  renderer.destroy();
  return {
    side: 'engine',
    state,
    animation,
    clip: { fps: animation.fr, width: animation.w, height: animation.h, frames: animation.op - animation.ip, version: animation.v },
    frames,
    looped: LOOP_CLIPS.has(state),
    playerConfig: renderer.config,
  };
}
