# CB-BUILD-015 — pre-registration of the id-keyed parity harness

**This document is committed BEFORE the harness is run.** It declares, in
advance, every tolerance, every pass criterion, the sample size and the
sampling seed that the run will use. The runner and the comparer READ their
tolerances and their reference constants from this file (parsed by
`preregistration.mjs`) — they do not carry them as literals — so a number
here cannot drift out of step with a number in the report.

**Amendment rule.** A tolerance is never tuned after seeing a result. If one
of these tolerances turns out to be wrong, it is amended in its OWN commit
whose message states what was seen and why the change is honest; the
superseded value stays visible in the history and in the "Amendments"
section at the foot of this file.

Machine-readable pass: `preregistration.mjs` parses the fenced `prereg` JSON
blocks below. The prose around them is the reasoning; the JSON is the
contract.

---

## 1. What is being compared

Given ONE wizard id, the harness produces two sides and diffs them **per
duel state**:

- **Reference side** — the 2019 implementation. The per-combo animation JSON
  from the public production bucket
  (`https://storage.googleapis.com/cheeze-wizards-production/…/wizard-animations`),
  recoloured by the **portrait colour-slot system** (the slot vocabulary and
  the part→slot routing parsed live from the shipped portrait SVG
  `assets/cw/client-static/img/wizards/*.svg`, NOT from
  `app/engine/rigRecolor.js`), played by the shipped 2019 player
  `app/vendor/lottie.min.js` under the reference's OWN configuration, parsed
  live from `assets/cw/reference/Animation-index.js`
  (`renderer: 'canvas'`, `autoplay: false`, `loop: false`,
  `rendererSettings.progressiveLoad: true`, `setSubframe(false)`).
- **New-engine side** — the shipped path for the SAME wizard id:
  `app/engine/wizardRig.js` identity → `app/ui/components/battle/rigAssets.js`
  loadout (fetch + `app/engine/rigRecolor.js` live recolour) → the stage's
  own player configuration, parsed live from
  `app/ui/components/battle/rigStage.js` (`renderer: 'canvas'`,
  `autoplay: false`, `setSubframe(false)`, loop policy `LOOP_CLIPS`).

Both sides are driven headlessly: `lib.mjs` installs jsdom's
`window`/`document`/`navigator` globals so the vendored 2019 player
(`app/vendor/lottie.min.js`) can load under Node at all, but NEITHER side
mounts into a DOM container — each is handed a **node-canvas 2D context**
through `rendererSettings.context` + `clearCanvas` in place of the container,
and frames are read back with `getImageData`. That container substitution is
the only configuration difference the harness introduces, and it is applied
identically to both sides; no DOM layout, CSS or browser compositing takes
part in any number below.

### 1.1 The reference side's class → slot resolution (declared in advance)

The portrait SVG declares the colour slots as CSS variables
(`--hat-base`, `--cape-base`, `--medallion-base`, …) and routes part groups
to them (`#hat01 #base { fill: var(--hat-base); }`). The shape library
mirrors the same system as `cl` classes on its fill/stroke items. The
reference side resolves a library class to a portrait slot by these rules,
in order:

1. **exact** (case-insensitive): the class IS a portrait slot name
   (`hat-base`, `cape-base`, `CAPE-base`, `collar-base`, `boot-accent`, …).
2. **number**: the class is `<part>-<role>` with `role ∈ {base, accent}` and
   the singular/plural variant of `<part>` is a portrait slot part
   (`hand-base` → `hands-base`).
3. **part-only**: the class carries no role token and exactly one portrait
   slot has a part matching one of its tokens (`body-pants` → `pants-base`).
4. **declared alias** (the one spelling the portrait and the library do not
   share a word for): `collar-button` → `medallion-base` — the portrait's
   `#medallion` element is the button on the collar. Declared here, before
   the run, as a reference-side assumption.

A class that resolves to no slot keeps its SOURCE colour on the reference
side (outlines `black*`, head skin `head-base`/`head-accent`, wand wood
`wand-base`, and any unclassed colour), and every such class is reported in
the results as `unmappedClasses` — never silently dropped. Animated colour
values (`c.a === 1`) are never substituted on either side.

---

## 2. Duel states under test, sampling, and frames

```prereg
{
  "duelStates": ["idle", "charge", "chargeloop", "attack", "hit", "reset", "win", "lose", "draw"],
  "framePositions": [0, 0.3333, 0.6667],
  "framesPerState": 3,
  "minComparableFramesPerState": 2,
  "renderWidth": 430,
  "renderHeight": 350
}
```

- `framePositions` are fractions of the clip's own length (`op - ip`), the
  same positions round 1's checks B and D sampled, so the numbers are
  comparable across checks.
- A frame the headless renderer genuinely cannot produce (`lib.mjs`
  `frame.empty`, after its fresh-instance retry) is EXCLUDED from the pixel
  metrics and COUNTED. A state with fewer than `minComparableFramesPerState`
  comparable frames is recorded **INCONCLUSIVE**, which does NOT count as a
  pass in the overall verdict.

## 3. Sample: the canonical wizard + a seeded random sample

```prereg
{
  "canonicalWizard": {
    "id": "cb-canonical-wizard",
    "comboKeySource": "tools/parity/results/canonical-combo.json (round-1 find-canonical.mjs)",
    "comboKey": "NEUTRAL-1-head01-cape01-hat01-wand01",
    "paletteSource": "tools/parity/results/check-a-gifs.json .paletteFit.palette (round-1 check A: fitted from the bundle renders through the shipped recolour engine)",
    "identityInjection": "both-sides-declared"
  },
  "sampleSeed": "CB-BUILD-015:t2:parity-sample-v1",
  "sampleSize": 8,
  "sampleElements": ["fire", "water", "air"],
  "sampleTierRange": [0, 6],
  "sampleIdTemplate": "parity015-<seed32hex>-<n>"
}
```

- The canonical wizard is the 2019 demo wizard the bundle's renders show: its
  cosmetic combo was identified in round 1 (`find-canonical.mjs`) and its
  palette was FITTED from those renders. It is the only row in the sample with
  a real 2019 ground truth, so the identity above is a DECLARATION, not an
  inference: `"identityInjection": "both-sides-declared"` means the harness
  hands that exact `comboKey` and that exact fitted palette to BOTH sides
  (`identity.mjs` `canonicalWizard()` → `identityFor()`; the engine side's
  loadout is built from the declared identity through the shipped fetch +
  `app/engine/rigRecolor.js` recolour path, the reference side recolours the
  same combo's documents with the same palette). The harness REFUSES to run
  the canonical row if this key is absent or says anything else — the
  declaration is honoured by the code or the run stops.
  Consequence, stated here and in the report: for this row the engine's
  id→identity derivation (`wizardRig.js`) is OUTSIDE the comparison. What the
  read path WOULD derive for this id is recorded beside the row
  (`identitySource`, `engineDerived.comboKey`), never implied to be the same
  thing.
- The 8 sampled wizards are generated ids drawn from a mulberry32 stream
  seeded with the FNV-1a 32-bit hash of `sampleSeed` (the harness's own PRNG,
  deliberately not the engine's). Element and tier are drawn from the same
  stream. **The generated ids are recorded verbatim in the results JSON**, so
  the run is reproducible id-for-id.
- Total: **9 wizards × 9 duel states = 81 per-state comparisons**, 3 frames
  per state per side.

## 4. Visual parity — tolerances and pass criteria (per wizard, per state)

```prereg
{
  "visual": {
    "pixelChannelTolerance": 8,
    "minMatchPct": 99.5,
    "minSilhouetteIoU": 0.99,
    "reportedOnly": ["meanAbsoluteError", "contentPixels"]
  }
}
```

- **V1 pixel parity** — over the UNION of the two frames' content
  silhouettes, the share of pixels whose per-channel difference is
  ≤ `pixelChannelTolerance` (8/255), averaged over the state's comparable
  frames, must be ≥ **99.5%**.
- **V2 structural parity** — the intersection-over-union of the two frames'
  content silhouettes, averaged over the state's comparable frames, must be
  ≥ **0.99**.
- **V3 mean absolute error** — reported per state, no verdict attached.

**Why this tolerance is tight, declared in advance:** both sides play the
SAME per-combo geometry with the SAME shipped player at the same size; if the
portrait-derived slot routing and the engine's routing agree, the two
animation documents are colour-for-colour identical and the rendered frames
should be identical but for renderer nondeterminism at antialiased edges.
8/255 with a 0.5% escape hatch is the allowance for that and nothing more. A
real routing or playback divergence CANNOT hide under this tolerance — it is
meant to fail loudly. (Contrast round 1's cross-VINTAGE checks A/B, whose
floors are loose because they compare 2019 marketing renders against live
output; this check compares two live pipelines and has no vintage gap.)

## 5. Recolour parity — exact criteria (per wizard, per state)

```prereg
{
  "recolour": {
    "maxSlotMapDisagreements": 0,
    "maxColourDifferences": 0
  }
}
```

- **J1 slot-map agreement** — for every `cl` class present in the state's
  animation JSON, the portrait-derived reference resolution and the engine's
  own resolution must agree (both map it to the same slot, or both leave it
  alone). Disagreements allowed: **0**.
- **J2 colour parity** — the reference-recoloured document and the
  engine-recoloured document must carry identical static fill/stroke colours,
  item for item, in document order. Differences allowed: **0**.

## 6. Timing — the reference's constants (per wizard, per state)

```prereg
{
  "timing": {
    "fps": 30,
    "width": 1720,
    "height": 1400,
    "lottieVersion": "5.5.2",
    "referenceFrames": {
      "idle": 34, "charge": 42, "chargeloop": 18, "attack": 32, "hit": 60,
      "reset": 60, "cancel": 60, "win": 112, "lose": 112, "draw": 112
    },
    "frameCountTolerance": 0,
    "durationToleranceMs": 33.4,
    "reportedOnly": ["stepWindowMs", "stepWindowDeltaMs", "loopPolicy"]
  }
}
```

- `referenceFrames` are the reference library's own per-state clip lengths at
  30fps — the same constants round 1's `check-c-timing.mjs` asserts against
  the live library and `app/tests/rig-timing.test.js` asserts against the
  vendored fallback sets. They are the timing REFERENCE for this check;
  `app/tests/parity-preregistration.test.js` binds this table to
  `check-c-timing.mjs`'s so the two can never drift.
- **T1 constants** — the clip the new engine plays for a state must carry
  `fr = 30`, `w = 1720`, `h = 1400` and exactly `referenceFrames[state]`
  frames (`op - ip`). Deviations allowed: **0** (`frameCountTolerance: 0`).
- **T2 duration** — |engine clip native duration − reference constant
  duration| ≤ **33.4 ms** (one frame at 30fps).
- **T3 step window** — the presentation timeline's per-state step window at
  the shipped default O9 cadence, against the clip's native duration, with
  the stage's loop/hold policy. **Reported, no verdict**: the stage
  deliberately windows a step by cadence and loops or holds — that is the
  shipped design (R75), not a parity defect, and check C already binds the
  45s ceiling.

## 7. Overall verdict rule

```prereg
{
  "overall": {
    "statePassRequires": ["V1", "V2", "J1", "J2", "T1", "T2"],
    "runPassRequires": "every state of every sampled wizard passes",
    "inconclusiveCountsAsPass": false
  }
}
```

The run's exit code is 0 only if every per-state verdict is PASS. Anything
else — a FAIL or an INCONCLUSIVE — exits non-zero and is reported with its
real numbers.

## 8. What this harness does NOT claim

- No CSS layout, paint, or opacity animation runs headlessly, so the stage's
  cross-fade ramp and browser compositing are not pixel-measured here (round
  1's residual, unchanged).
- The reference side reconstructs the 2019 **pipeline** (its player, its
  configuration, its per-combo source, its portrait colour-slot recolour)
  from the shipped reference sources; it does not execute the 2019 React
  `DuelPlayer` component tree, which cannot run without its build and its
  chain data. What is executed is named per number in the report.
- The reference side is handed the identity the run resolved for the wizard —
  its `comboKey` AND its palette — and the engine side is built from that same
  identity. The id→identity derivation itself (`app/engine/wizardRig.js`:
  which combo and which palette a characterId maps to) is therefore NOT under
  test in this check, for any row: what is compared is everything downstream
  of the identity — library addressing, recolour routing, document colours,
  player configuration, rendered pixels, clip timing. For the sampled wizards
  the injected identity IS the derived one; for the canonical wizard it is the
  pre-registered declaration in §3.
- Frames are compared at the harness's render size, not at the library's
  native 1720×1400, for run time; both sides use the identical size.

## Amendments

**Amendment 1 (fix round, CB-BUILD-015) — §3: the canonical wizard enters as
an INJECTED declaration, not as a wizard record.**
What was seen: this document declared that the canonical wizard "enters the
harness as a wizard RECORD (recorded traits + recorded palette on the
character), so both sides resolve exactly that wizard from its id". That was
true of the code at the time (`wizardIdentity()` preferred recorded fields).
CB-BUILD-022/R74/§18 then made identity derive from the characterId at READ
time, ALWAYS — `wizardIdentity()` never reads `character.traits` /
`character.palette` again. For `cb-canonical-wizard` the read path now derives
`FIRE-1-head02-cape04-hat11-wand04` with a different palette, so a run made
this way would silently compare a DIFFERENT wizard from the one this document
declares and the one the 2019 bundle renders show.
The change: the declared combo + check A's fitted palette are injected into
both sides by the harness, and the harness refuses to run the canonical row
unless the declaration says so (`identityInjection`). Why it is honest: no
tolerance is touched, no criterion is loosened, and nothing is hidden — the
identity is the one this document pre-registered, and the fact that the
engine's read path would derive another one for that id is now RECORDED beside
the row and named as a residual in §8. The superseded sentence is above, in
this entry and in the history.

**Amendment 2 (fix round, CB-BUILD-015) — §1: what "driven headlessly"
actually means.**
What was seen: §1 said "Both sides are driven headlessly (jsdom + node-canvas)"
in a way that reads as though the players mount into a jsdom container. They do
not: `lib.mjs` installs jsdom's `window`/`document`/`navigator` globals so the
vendored 2019 player can load at all, but BOTH sides then pass a node-canvas
2D context through `rendererSettings.context` + `clearCanvas` in place of the
DOM container (`reference-runner.mjs`, `engine-frames.mjs`) and read pixels
back with `getImageData`. No DOM layout, CSS or compositing takes part in any
measured number. The change is a correction of description only — no
tolerance, criterion, sample or seed is affected.
