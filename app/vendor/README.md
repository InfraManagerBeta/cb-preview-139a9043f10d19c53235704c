# app/vendor

`lottie.min.js` — lottie-web v5.12.2 (MIT, github.com/airbnb/lottie-web),
vendored unmodified from the published package (`build/player/lottie.min.js`).

Why vendored, why this player: the runtime engine choice for the battle
presentation (§10 R78, CB-PATCH-030 posture: Lottie is interchange only; the
runtime is the build's own). The 2019 reference implementation
(`assets/cw/reference/Animation-index.js`) drove exactly this player with the
canvas renderer and `setSubframe(false)`; matching the shipped behaviour with
the same playback engine is the highest-fidelity port available, and the
per-combo shape library uses AE expressions/trim/masks that a from-scratch
player would reimplement with lower fidelity for zero gain. Vendored as one
static file — no npm dependency, no build step; the app stays static-servable.

Loaded lazily (dynamic import) by `app/ui/components/battle/rigStage.js`; the
UMD wrapper attaches `globalThis.lottie`. Nothing outside the battle stage
touches it, and no test requires it (tests run DOM-free in Node).
