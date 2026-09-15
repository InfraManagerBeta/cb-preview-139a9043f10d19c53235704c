# Vendored shape JSONs (CB-BUILD-006)

A small, byte-identical cache of the 2019 per-combo animation library
(public bucket `cheeze-wizards-production`, prefix
`0x0d8c864da1985525e0af0acbeef6562881827bd5/wizard-animations/`), vendored so
tests run offline and the app has a sensible fallback when the bucket is
unreachable from the browser. This is caching an interchange source — the
runtime still composites and recolours these documents live per wizard
(see `app/ui/components/battle/rig.js`); nothing here is sprite-sheeted,
GIF'd, or colour-baked.

Contents:

- `<state>-FIRE-1-head02-cape04-hat01-wand01.json` — all ten duel states
  (idle, charge, chargeloop, attack, hit, reset, cancel, win, lose, draw) of
  one canonical cosmetic shape set. This is the offline/parity fallback
  combo: when a wizard's own combo cannot be fetched, its palette is applied
  to these shapes instead (colours stay the wizard's own).
- `idle-WATER-1-head02-cape02-hat01-wand01.json` — a second combo's idle,
  so shape-level distinctness is exercisable offline in tests.
- `affinitycapewin-FIRE-1.json` / `affinitycapelose-FIRE-1.json` — the
  affinity cape overlay pair for the FX pass fallback.

Lottie v5.5.2, 30 fps, 1720×1400, self-contained (no external images) —
interchange format only (R78: playback is the runtime engine's own).
