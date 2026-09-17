// tools/parity/reference-runner.mjs — CB-BUILD-015, the REFERENCE side's
// player: the shipped 2019 engine (app/vendor/lottie.min.js) driven
// headlessly over the per-combo animation JSON from the public production
// bucket, with the wizard's palette applied through the portrait
// colour-slot system (reference-recolor.mjs).
//
// The configuration is not retyped here: it is PARSED out of the reference's
// own source, assets/cw/reference/Animation-index.js — the 2019
// `animationInstance()` factory every DuelPlayer animation went through
// (renderer 'canvas', autoplay false, loop false, rendererSettings
// progressiveLoad true, then setSubframe(false), "we always want animations
// to run on the frames they're supposed to (30fps for fight scenes)"). If
// that file ever changes, this side changes with it.
//
// Headless substitution (stated, applied to BOTH sides identically): the
// 2019 factory mounts into a DOM `container`; under node-canvas there is no
// laid-out container, so the harness passes `context` + `clearCanvas`
// instead. Nothing else about the configuration is altered.
import { createCanvas } from 'canvas';
import { lottie } from './lib.mjs';
import { referenceRecolor, buildReferenceSlotMap } from './reference-recolor.mjs';
import { parseReferencePlayerConfig, REFERENCE_FACTORY } from './player-config.mjs';

// The configuration parser lives in player-config.mjs (canvas-free, so the
// node test suite can bind it); re-exported here for callers of this runner.
export { parseReferencePlayerConfig, REFERENCE_FACTORY };

/**
 * A headless instance of the 2019 player over one animation document, at
 * the reference's own configuration. Mirrors lib.mjs's empty-frame retry
 * (the documented node-canvas seek quirk) so both sides treat an
 * unrenderable frame the same way.
 */
export function makeReferenceRenderer(animationData, { width, height, config = parseReferencePlayerConfig() } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const source = JSON.stringify(animationData);
  let anim = null;
  const load = () => {
    if (anim) { try { anim.destroy(); } catch { /* ignore */ } }
    anim = lottie.loadAnimation({
      renderer: config.renderer,
      autoplay: config.autoplay,
      loop: config.loop,
      animationData: JSON.parse(source),
      rendererSettings: {
        progressiveLoad: config.progressiveLoad, // the reference's own setting, carried verbatim
        context: ctx, // headless substitution for the DOM container
        clearCanvas: true,
      },
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
    width, height, config,
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
    totalFrames: () => anim.totalFrames,
    destroy: () => { try { anim.destroy(); } catch { /* ignore */ } },
  };
}

/**
 * The reference side for ONE wizard and ONE duel state: the per-combo
 * document for that wizard's combo, recoloured from the wizard's portrait
 * colour slots, rendered at the declared frame positions by the 2019 player.
 *
 * `fetchClip(state, comboKey)` is injected (the sample driver supplies a
 * disk-cached bucket fetch), so this module never decides where the library
 * lives.
 */
export async function referenceFrames({ wizard, state, frameIndices, fetchClip, width, height, slotMap = buildReferenceSlotMap(), config }) {
  const source = await fetchClip(state, wizard.comboKey);
  const { animation, stats } = referenceRecolor(source, wizard.palette, slotMap);
  const renderer = makeReferenceRenderer(animation, { width, height, config });
  const frames = frameIndices.map((n) => ({ n, img: renderer.frame(n) }));
  renderer.destroy();
  return {
    side: 'reference',
    state,
    animation,
    source,
    recolourStats: stats,
    clip: { fps: source.fr, width: source.w, height: source.h, frames: source.op - source.ip, version: source.v },
    frames,
    playerConfig: renderer.config,
  };
}
