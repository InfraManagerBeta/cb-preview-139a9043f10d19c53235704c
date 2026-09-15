# Vendored runtime dependencies

- `lottie_canvas.min.js` — lottie-web v5.12.2, canvas-renderer build
  (MIT license, https://github.com/airbnb/lottie-web). The battle runtime's
  rasterizer for the interchange documents the parametric rig produces
  (R78: GPU-composited canvas playback; Lottie stays interchange-only —
  the rig composites and recolours documents before they ever reach this
  player, and nothing is baked to sprites or GIFs). Vendored so the static
  app runs offline; loaded classically (script tag) by `app/index.html`
  and exposed as `window.lottie`, consumed only via
  `app/ui/components/battle/player.js`.
