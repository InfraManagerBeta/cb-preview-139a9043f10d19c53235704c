// app/ui/components/battle/player.js — CB-BUILD-005 / R78: the battle
// runtime's playback layer. The parametric rig (rig.js) composites and
// recolours each wizard's own documents BEFORE anything reaches this module
// — Lottie is interchange only; this player rasterizes the finished
// documents to <canvas> (GPU-composited playback), one persistent player
// per state per side, all created at preload time and merely shown/hidden
// afterwards. Nothing here ever re-fetches, re-creates, or swaps an
// `img src` mid-duel (R74: seamless, no blank, no flash).
//
// The rasterizer is the vendored interchange player (assets/vendor/
// lottie_canvas.min.js, loaded classically by app/index.html as
// window.lottie). In a non-browser context (node --test) every player is an
// inert descriptor with the same surface, so the stage's structure and
// sequencing stay unit-testable; actual pixel playback is browser-verified
// (see the parity notes in app/tests/battle-parity.test.js).

function runtimeAvailable() {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && window.lottie && typeof window.lottie.loadAnimation === 'function';
}

/**
 * One persistent state player.
 * @param {object} args
 * @param {Element} args.container the layer element this player draws into
 * @param {object} args.doc the composited parametric document (rig output)
 * @param {boolean} [args.loop]
 * @param {string} [args.name] diagnostic name ("p1:idle")
 */
export function createStatePlayer({ container, doc, loop = false, name = '' }) {
  const descriptor = { name, loop, docName: doc && doc.nm, playing: false, destroyed: false };

  if (!runtimeAvailable() || !container) {
    // Inert (test/node) player: same surface, no rasterization.
    return {
      ...descriptor,
      inert: true,
      ready: Promise.resolve(),
      play() { this.playing = true; },
      stop() { this.playing = false; },
      pause() { this.playing = false; },
      setLoop(v) { this.loop = !!v; },
      resize() {},
      destroy() { this.destroyed = true; this.playing = false; },
    };
  }

  const anim = window.lottie.loadAnimation({
    container,
    renderer: 'canvas',
    loop,
    autoplay: false,
    animationData: doc,
    rendererSettings: {
      preserveAspectRatio: 'xMidYMax meet',
      clearCanvas: true,
      progressiveLoad: false,
    },
  });

  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  // canvas builds fire data_ready synchronously for animationData input, and
  // DOMLoaded once the first frame can draw — resolve on whichever lands.
  anim.addEventListener('data_ready', () => readyResolve());
  anim.addEventListener('DOMLoaded', () => readyResolve());
  // animationData is inline: if neither event fires (already ready), resolve
  // on the next macrotask rather than hanging the preload gate.
  setTimeout(() => readyResolve(), 0);

  return {
    ...descriptor,
    inert: false,
    anim,
    ready,
    play() { this.playing = true; anim.goToAndPlay(0, true); },
    stop() { this.playing = false; anim.stop(); },
    pause() { this.playing = false; anim.pause(); },
    setLoop(v) { this.loop = !!v; anim.loop = !!v; },
    /** Re-measure the canvas against its container. The stage creates every
     * player BEFORE its root joins the document (preload-first, R74), so the
     * canvas is 0×0 until the stage is mounted — whenAllReady/the stage call
     * this once connected (and the driver may call it on viewport changes). */
    resize() { try { anim.resize(); } catch { /* not yet renderable */ } },
    destroy() {
      this.destroyed = true; this.playing = false;
      try { anim.destroy(); } catch { /* already gone */ }
    },
  };
}

/** Aggregate readiness across a set of players (the reference's
 * animationsLoaded/animationsTotal gate, promise-shaped). */
export function whenAllReady(players, onProgress = () => {}) {
  let done = 0;
  return Promise.all(players.map((p) => p.ready.then(() => {
    done += 1;
    onProgress(done, players.length);
  })));
}
