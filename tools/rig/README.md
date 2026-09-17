# Rig data derivation (build-time, CB-BUILD-006)

The 2019 system pre-rendered no wizard: a parametric rig animates the actual
summoned wizard — a per-combo *shape* library (Lottie v5.5.2, 30fps,
1720×1400, keyed to the cosmetic combo `<ELEMENT>-<power>-<head>-<cape>-<hat>-<wand>`,
never to a specific wizard) recoloured per wizard through named colour slots.
These scripts derive, from the original sources, the minimal data the runtime
needs, and write it into the repo so the app itself stays a static site with
no build step:

| Script | Derives | From | Writes |
|---|---|---|---|
| `build-manifest.mjs` | the combo manifest (which shape sets exist) + reference timing constants | the public production bucket listing | `app/data/rigManifest.js` |
| `build-palette.mjs` | the canonical per-slot palette | `assets/cw/sources/ai/CW_Characters_Usaable_Colours_V1.ai` (colour list) cross-checked against a sample of production portrait SVGs (per-slot usage: the portraits' CSS colour variables ARE the colour-slot system) | `app/data/rigPalette.js` |
| `fetch-fallback.mjs` | the vendored offline fallback shape sets (one combo per element, all ten duel states) + the affinity-cape FX overlays | the public production bucket | `assets/rig/` |

Run order (Node ≥ 18, network access to the public bucket required):

```
node tools/rig/build-manifest.mjs
node tools/rig/build-palette.mjs
node tools/rig/fetch-fallback.mjs
```

The generated outputs are committed; re-running against the same sources is
idempotent. The slot system itself needs no derivation step: every
recolourable fill/stroke in the shape library carries a `cl` class naming its
slot (`hat-base`, `cape-base`, `collar-button`, …) — the same names the
portrait SVGs' CSS variables use. See `app/engine/rigRecolor.js`.
