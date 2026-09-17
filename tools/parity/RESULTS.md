# AC1 battle-fidelity verification — recorded results

**"Verified as new output against old output — a comparison, not a judgment."**
This directory measures, on rendered output under plain Node (no browser),
what it can honestly measure of AC1's battle-fidelity row: recolour identity
against the bundle renders (check A), reference-pipeline recolour fidelity
for arbitrary summoned wizards (check B), timing against the reference's
constants (check C), and the row's four named criteria — **distinctness,
arena-composite, no-blank, FX-fidelity — each measured with a declared
tolerance and an explicit PASS/FAIL verdict** (check D). CB-BUILD-015 adds
**check E: the harness AC1 actually names — keyed by a WIZARD ID.** Given
any id it runs the 2019 REFERENCE pipeline and the NEW ENGINE for that same
wizard and diffs them **per duel state**, against tolerances pre-registered
before the run ([`PREREGISTRATION.md`](PREREGISTRATION.md)); the run's real
per-state numbers are in [`PARITY-REPORT.md`](PARITY-REPORT.md). The SHIPPED
player (`app/vendor/lottie.min.js`, canvas renderer, `setSubframe(false)` —
the 2019 reference's own configuration) is driven headlessly under Node:
jsdom supplies the `window`/`document` globals the player needs to load, and
each instance is handed a **node-canvas 2D context** in place of a DOM
container (no mount, no layout, no CSS — see "Residual" below). What headless
execution cannot measure is named in "Residual" below — nothing is claimed
beyond the verdict table. Committed results were produced in this repo's CI
container (Node v22.22.0); **all five recorded runs below were made at commit
`0c43a0c`** — every run names the commit it was made at and digests the
sources it measured (`results/check-*.json` `.provenance`), and those digests
are **asserted**, so a run that no longer describes the tree fails the root
test suite instead of quietly reading as if it did (see "A recorded result is
a claim about ONE tree" below). Re-run with:

```
cd tools/parity && npm install && npm run all          # checks A-E
cd tools/parity && npm run parity -- --id <wizardId>   # check E for ONE wizard id
node tools/parity/freshness.mjs                        # are the recorded runs still this tree's? (offline, no deps)
```

(`find-canonical.mjs` is the one-off search that identified the canonical
wizard's combo; its result is recorded in `results/canonical-combo.json` and
hardcoded into check A.)

## Verdict table (criterion → declared tolerance → measured → verdict)

| Criterion | Declared tolerance | Measured | Verdict |
|---|---|---|---|
| **AC1 distinctness** (D1) | every sampled pair/state: ≥ 3% of content pixels differ beyond 48/255 | min **32.54%** over 12 pair/state diffs (4 pairs incl. same element+power and same-COMBO palette-only × idle/attack/win) | **PASS** |
| **AC1 arena-composite** (D2) | arena raster ≥ 90% ink; bare-field (no layer paints) ≤ 1%; under-combatant field ≥ 90% arena ink; layer stack parsed from shipped source | arena **100%** ink; bare-field **0%**; under-combatant **100%**; arena-under-scene true, no layer background true | **PASS** |
| **AC1 no-blank** (D3) | every transition endpoint frame ≥ 1% ink; mid-duel source fetches = 0 | **110** endpoint frames over 55 side-transitions, min ink **10.30%**, blank **0**; fetches after preload **0** (22 at preload) | **PASS** |
| **AC1 FX-fidelity** (D4) | cape geometry digest identical (exact); unexplained pixels ≤ 5% at 60/255; overlay non-empty over the pose | geometry **identical**; max unexplained **1.89%**; overlay covers **6.69%** of the frame | **PASS** |
| A palette identity | every fitted slot snaps to a canonical palette colour within 8/255 | max snap distance **6** over 9 fitted slots | **PASS** |
| A camera anchor | frozen-camera anchor ink IoU ≥ 0.10 | anchor IoU **0.195** | **PASS** |
| A render similarity (cross-vintage floor) | per non-gap state: mean matched% ≥ 40 at 48/255 AND mean ink IoU ≥ 0.10 | worst state matched **44.89%**, worst ink IoU **0.110** | **PASS** |
| B structural | geometry digest identical AND 0 colour changes off slot classes (exact) | **18/18** identical, **0** off-slot changes | **PASS** |
| B recolour explained | unexplained mean ≤ 3%, worst ≤ 5% at 60/255 | mean **2.03%**, worst **3.13%** | **PASS** |
| C library constants | 0 deviations from {30fps, 1720×1400, v5.5.2, reference clip lengths} (exact) | **0** over 50 live-sampled files | **PASS** |
| C render rate | every bundle GIF within 30 ± 0.5 fps | worst \|fps−30\| = **0.1** | **PASS** |
| C duel ceiling (R75) | worst-case duel < 45,000 ms at EVERY switchable O9 arm | 900 ms → **24,310 ms**; 1170 ms (default) → **31,482 ms**; 1500 ms → **40,350 ms** | **PASS** |
| **E visual parity, per wizard id, per duel state** (CB-BUILD-015) | every wizard/state: ≥ 99.5% of union-content pixels within 8/255 AND silhouette IoU ≥ 0.99 (pre-registered) | worst matched **100%**, worst IoU **1.0**, worst MAE **0/255** over **81** per-state comparisons (9 wizards × 9 states, 243 frame pairs) | **PASS** |
| **E recolour parity** (CB-BUILD-015) | every wizard/state: 0 slot-map disagreements (portrait-derived vs engine table) AND 0 differing static colours | **0** disagreements, **0** colour differences | **PASS** |
| **E timing vs the reference constants** (CB-BUILD-015) | every wizard/state: 30 fps, 1720×1400, the reference clip length (0-frame tolerance), duration within 33.4 ms | worst duration delta **0 ms**, **0** constant deviations | **PASS** |
| **E harness sensitivity** (negative control) | the SAME comparison with the WRONG wizard's palette must FAIL | wrong-wizard match **24.13%** (floor 99.5%), 32 colour differences → **FAIL** as required | **PASS** |

Full per-pair/per-state/per-cape numbers: `results/check-d-ac1.json`,
`results/check-a-gifs.json`, `results/check-b-wizards.json`,
`results/check-c-timing.json`, `results/check-e-idparity.json`. Every script
prints its `VERDICT` lines and exits non-zero on any FAIL.

The suite itself also binds a node-only slice of the distinctness criterion
on every run (`app/tests/rig-distinctness.test.js`: same-element and
same-combo duels' recoloured layer trees must differ in EVERY duel state),
so `node --test` alone catches a distinctness regression without this
harness.

## What the bundle actually provides as pixel reference

- `renders/gifs/` — nine 500×400 GIFs at ≈30fps (measured 29.9–30.1fps):
  **the** pixel parity reference.
- `renders/png-seq/` — **unusable**: all 265 PNGs are macOS Finder-window
  screen captures (someone recording themselves browsing the animation
  export folders), not duel frames. Verified visually across the sequence.
- The GIFs are 2019 *marketing renders from the AE rig* with their own edit
  lengths (e.g. Attack: 60 GIF frames vs the library's 32-frame attack clip;
  Win: 60 vs 112). Time mappings are therefore searched per state
  (palette-independent outline-ink IoU) and stated with each number.

## Check A — canonical wizard vs the nine bundle GIFs (`check-a-gifs.mjs`)

What check A binds with a verdict: **recolour identity** (the palette fitted
from the renders through the shipped engine must land on canonical palette
colours) and a **cross-vintage similarity floor**. The per-state matched%
below is the measurement of how close two render vintages run under one
frozen camera — the declared floor (40% / IoU 0.10) is deliberately below
the search variance, so the disclosed best-of-search mapping choice cannot
manufacture a pass; it is NOT a claim of frame-exactness.

The canonical wizard's cosmetic combo is **identified from the renders**
(outline-ink IoU over all 312 power-1 combos in the library):
`NEUTRAL-1-head01-cape01-hat01-wand01` (wand05/06 grip-variants tie within
0.001). Its palette is **fitted from the renders through the shipped
recolour engine** (slot-isolation masks; median GIF colour under each mask,
snapped to the canonical sources/ai palette):

| slot | fitted | snap distance (0–255) |
|---|---|---|
| hat-base | #999999 | 0 |
| cape-base | #808080 | 0 |
| collar-base | #FFFFFF | 2 |
| medallion-base | #FF88F9 | 6 |
| hands-base / hands-accent | #FFFFFF / #CCCCCC | 2 / 0 |
| pants-base | #FFFFFF | 2 |
| boot-base / boot-accent | #9B4F40 / #C17D49 | 1 / 4 |

Every fitted slot lands on a canonical palette colour at snap distance ≤6 —
the strongest identity signal in this check: **the recolour engine, driven
only by the renders, recovers exactly the classic default-wizard palette.**

Per-state diff (every GIF frame; alignment = ONE camera mapping fitted on
the Battle-Idle anchor, frozen for all states/frames; tolerance 48/255;
`matched%` = content pixels within tolerance, `MAE` = mean abs error over
the content union, `inkIoU` = dilated black-outline IoU):

| GIF | engine clip(s) | time mapping | frames (gif/clip) | matched% | MAE | inkIoU |
|---|---|---|---|---|---|---|
| CW_Battle Idle | idle | stretch | 34/34 | **78.01** | 32.10 | 0.201 |
| CW_Attack | attack | 1:1 hold | 60/32 | **69.08** | 47.61 | 0.180 |
| CW_Hit Success | reset | stretch | 60/60 | **65.73** | 53.42 | 0.155 |
| CW_Win | win | 1:1 hold | 60/112 | **62.70** | 55.95 | 0.179 |
| CW_Lose | lose | 1:1 hold +26 | 60/112 | **55.61** | 63.25 | 0.136 |
| CW_Hit | hit | stretch | 60/60 | **51.79** | 70.15 | 0.115 |
| CW_Charge | charge+chargeloop | stretch | 60/60 | **49.54** | 74.68 | 0.110 |
| CW_Idle | idle | stretch +4 | 31/34 | **44.89** | 81.28 | 0.122 |
| CW_Power | win (no library clip) | stretch +52 | 60/112 | 53.78 | 54.22 | 0.165 |

Reading the residual honestly: the GIFs are a different render vintage (AE
edits, easing and staging differ per state — visible in the mapping search
itself: Lose best-matches the library clip's frames 26–86, Attack holds).
Static-pose states run high-70s; action states 45–70% under a frozen camera
and searched-but-simple time mappings. `CW_Power` has **no library clip at
all** (the ten duel states carry no "power"); it is diffed against `win` as
a stated reference-gap — the runtime holds win/lose under the stake counter,
per the reference DuelPlayer's own closing chain. The published `matched%`
are best-of-search over the stated time-mapping/clip candidates (disclosed
above and in the JSON); the verdict floors sit below the search variance.

## Check B — arbitrary summoned wizards vs the reference pipeline's own output (`check-b-wizards.mjs`)

Six fresh characterIds (ids the system has never seen; elements/tiers
cycled) → deterministic identity → each wizard's REAL library combo fetched
live → shipped recolour → shipped player. Reference output = the same
library set rendered by the same player at source colours; every differing
pixel must be *explained* as "slot source colour → this wizard's palette
colour".

Per-wizard/state (18 pairs; states idle/charge/win; 3 frames each;
tolerance 60/255):

- geometry digest identical (recolour changed colours and NOTHING else):
  **18/18** → declared exact, **PASS**
- colour changes off slot classes: **0** → declared exact, **PASS**
- pixels identical: **41.11%** mean (the outline ink, head skin, wand wood,
  FX — everything that must NOT change)
- pixels explained as the wizard's own recolour: **56.86%** mean
- pixels unexplained: **2.03%** mean, **3.13%** worst (antialiased slot
  edges, where the blend sits between palette and outline) → declared
  mean ≤ 3% / worst ≤ 5%, **PASS**

**97.97% of every rendered pixel is exactly "the reference's output, with
this wizard's own colours in the slots" — per arbitrary unseen wizard.**

*Re-measured at `0c43a0c` in fix round g1. The previous numbers here (mean
1.95%, worst 3.12%, identical 41.27%) were measured before fix round f3
rewrote `deriveIdentity`: check B derives its six wizards' identities from
their ids too, so f3 moved which combos they resolve to, and the old figures
described wizards this engine no longer produces for those ids. Same six
ids, same tolerances, every verdict still PASS — and the digest gate below
now makes that kind of drift fail the suite rather than sit unnoticed.*

## Check C — timing vs the reference constants (`check-c-timing.mjs`)

- Library constants over 5 live-sampled combos × all 10 states (50 files):
  **0 deviations** from {30fps, 1720×1400, Lottie v5.5.2, clip lengths
  idle 34 / charge 42 / chargeloop 18 / attack 32 / hit 60 / reset 60 /
  cancel 60 / win 112 / lose 112 / draw 112}. Declared exact → **PASS**.
  (The same constants are asserted over the vendored fallback sets by
  `app/tests/rig-timing.test.js` on every suite run.)
- Bundle GIFs measure 29.9–30.1fps — the reference rate the runtime plays at
  (no setSpeed, no fps override). Declared 30 ± 0.5 → **PASS**.
- Presentation timeline (verified keep) step windows vs native clip
  durations — the stage plays clips at native 30fps inside each window
  (loop or hold; a window shorter than its clip cuts by cross-fade, exactly
  as the reference cut by visibility toggling). Worst-case duel
  (5×CRITICAL + floor drain + prize award, incl. the pre-round hold),
  recorded at **every switchable O9 arm** (A-O9: the cadence is
  console-switchable, so the R75 ceiling evidence covers each arm, not just
  the default):

| O9 cadence | worst-case duel | ceiling | verdict |
|---|---|---|---|
| 900 ms | **24,310 ms** | 45,000 ms | UNDER — PASS |
| 1170 ms (default) | **31,482 ms** | 45,000 ms | UNDER — PASS |
| 1500 ms (slowest arm) | **40,350 ms** | 45,000 ms | UNDER — PASS |

Full deltas (incl. `timeline.ceilingByO9Arm`) in
`results/check-c-timing.json`.

## Check D — AC1's four battle-fidelity criteria, measured (`check-d-ac1.mjs`)

- **D1 distinctness.** Both combatants of four sampled duels rendered with
  the shipped pipeline (identity → real library shapes → live recolour →
  shipped player) and diffed **against each other**, three states × three
  frames per pair. The sample includes same element + same power (twice)
  and the hardest case: two wizards colliding on the SAME shape combo,
  distinct by palette alone — that pair still measures **32.54–36.43%** of
  content pixels differing (declared floor 3%). Cross-element and
  different-combo pairs run 68.87–73.51% (re-measured at `0c43a0c`: fix
  round f3's `deriveIdentity` change moved which combos the sampled ids
  resolve to, so these per-pair figures moved with it; every verdict number
  above — the 32.54% floor included — is unchanged).
- **D2 arena-composite.** The actual arena source
  (`client-static/img/fightScene/fightBG.svg`) rasterized (100% ink — a
  drawn scene, not a bare field) and both combatants composited at the
  geometry PARSED from the shipped `battle.css` (wizard bottom 21%, width
  41%, aspect 1720/1400, away mirrored) — see
  `results/frames/d2-arena-composite.png`. Bare-field pixels (no layer
  paints): **0%**. Under-combatant field (box pixels the wizard leaves
  transparent): **100% arena ink** — the arena is present under the
  combatants. Layer-stack facts (arena `<img>` under the scene; no
  combatant layer paints its own background) are parsed from the shipped
  source/CSS, not assumed.
- **D3 no-blank.** A REAL loadout (instrumented fetch) preloads both sides
  (22 fetches), then the REAL worst-case timeline (39 steps) is driven
  through rigStage.js's own exported STEP_TO_CLIP/LOOP_CLIPS mapping —
  every one of the 55 side-transitions has both endpoint frames rendered
  (the outgoing frame the stage holds at the switch, the incoming frame 0
  that `setClip` paints before the fade): **110 frames, min ink 10.30%,
  zero blank** (blank = <1% ink). Source fetches after preload: **0** —
  nothing fetches mid-duel.
- **D4 FX-fidelity.** The loadout's recoloured affinitycape overlays
  (exactly what the stage plays on an affinity round) rendered and diffed
  against the bundle's own FX sources: geometry digests **identical**,
  unexplained pixels **1.65% / 1.89%** (declared ≤5% at 60/255), and
  the FX pass composited over the win pose covers **6.69%** of the frame
  (`results/frames/d4-fx-over-pose.png`) — real overlay content, not an
  empty layer. The overlays fade in by design (first ~20 frames empty);
  sampling sits inside the visible act.

## Check E — the id-keyed parity harness (`parity-wizard.mjs`, `check-e-idparity.mjs`)

CB-BUILD-015, the harness AC1 names: **give it a wizard id, and it runs both
implementations for that same wizard and diffs them per duel state.**

```
cd tools/parity && npm install
npm run parity -- --id my-wizard-id --element fire --tier 2   # one wizard
npm run parity -- --canonical --dump-frames                   # the 2019 demo wizard, with PNGs
npm run check-e                                               # the whole pre-registered sample
```

- **Reference side** — the per-combo animation JSON from the public
  production bucket, recoloured through the **portrait colour-slot system**
  (slot vocabulary and part→slot routing PARSED at run time from the
  production portrait SVGs in `assets/cw/client-static/img/wizards/`, not
  imported from `app/engine/rigRecolor.js`), played by the shipped 2019
  player at the reference's own configuration, PARSED from
  `assets/cw/reference/Animation-index.js`
  (`canvas`, `autoplay:false`, `loop:false`, `progressiveLoad:true`,
  `setSubframe(false)`, no `setSpeed`).
- **New-engine side** — the row's identity through the shipped
  `rigAssets.js` loadout (fetch + live recolour) → the stage's own
  configuration, PARSED from `rigStage.js` (`canvas`, `autoplay:false`,
  `setSubframe(false)`, loop policy `LOOP_CLIPS`).
- **One identity, both sides.** For a generated wizard id it is whatever the
  shipped read path (`wizardRig.js` `wizardIdentity()`) derives for that id.
  For the CANONICAL wizard — the only row with a real 2019 ground truth — it
  is the identity PRE-REGISTERED in `PREREGISTRATION.md` §3 (combo from
  round-1 `find-canonical.mjs`, palette FITTED from the bundle renders by
  check A), injected verbatim into both sides by `tools/parity/identity.mjs`.
  It is deliberately NOT read off a wizard record: since CB-BUILD-022/R74/§18
  the read path derives identity from the characterId alone and ignores
  `character.traits`/`character.palette`, so a record would be silently
  dropped and the row would compare `FIRE-1-head02-cape04-hat11-wand04`
  instead of the wizard the 2019 renders show. What the read path derives for
  that id is RECORDED beside the row, never implied to match.
- **Diffed per duel state** (all nine the stage can play: idle, charge,
  chargeloop, attack, hit, reset, win, lose, draw) at three frame positions
  each, plus the two documents compared colour-for-colour and the clip
  compared to the reference's timing constants.

**Everything that decides an outcome was declared first.**
[`PREREGISTRATION.md`](PREREGISTRATION.md) — tolerances, per-state pass
criteria, the per-state reference constants, the sample size and the
sampling seed — was committed BEFORE the harness ran, and the comparer reads
its numbers from that file (`app/tests/parity-preregistration.test.js` binds
both facts, and fails if a tolerance is edited without re-running).

**The run** (recorded in `results/check-e-idparity.json`, reported per state
per wizard in [`PARITY-REPORT.md`](PARITY-REPORT.md)): made at commit
`0c43a0c` (nothing it measures uncommitted), `2026-09-17T02:39:03Z`, Node
v22.22.0 — the
canonical 2019 demo wizard (the pre-registered identity, combo
`NEUTRAL-1-head01-cape01-hat01-wand01` from check A's own identification and
its fitted palette, injected into both sides) plus **8 generated wizards
drawn from seed `CB-BUILD-015:t2:parity-sample-v1`** (FNV-1a → `0x884bbe80`,
mulberry32; the drawn ids are recorded and reproduced by the test suite).
**81 per-state comparisons, 243 frame pairs, 0 skipped headless, 108
distinct animation documents downloaded live from the bucket during the run
(291 reads in total — both sides read the same bytes).** Every state of every
wizard: **matched 100.00%** of union-content
pixels within 8/255, **silhouette IoU 1.0**, **MAE 0/255**, **0** colour
differences between the two recoloured documents, **0** slot-map
disagreements, clip lengths exactly the reference constants (34/42/18/32/60/
60/112/112/112 frames at 30 fps, 1720×1400), **0 ms** duration delta.

*This run replaces one made at `248eb12`, which was measured before fix round
f3 rewrote `deriveIdentity` in `app/engine/wizardRig.js`. The seed, the sample
size and the eight drawn **ids** are unchanged and pre-registered; what
changed is the **combo each id resolves to** — f3 carries the tier-0 cosmetic
combo into the live power family, so all 8 generated rows now compare a
different combo (e.g. `parity015-884bbe80-1`: `WIND-2-head02-cape03-hat01-wand05`
→ `WIND-2-head03-cape03-hat03-wand03`), at the same palettes and the same
power families. The canonical row (tier 0, injected declaration) is
unchanged. No tolerance was touched; every verdict above is from this run.
The digest gate below exists so that this cannot happen again unnoticed.*

That the two sides agree exactly is the *expected* result and the reason the
declared tolerance is tight: both play the same per-combo geometry with the
same shipped player, so a routing or playback divergence has nowhere to
hide. To show the comparison can in fact fail, the run includes a
**negative control**: the same wizard's combo rendered with a DIFFERENT
wizard's palette on the reference side measures **24.13%** matched (32
colour differences) and is reported **FAIL**. A harness that cannot fail
proves nothing; this one fails on the wrong wizard and passes on the right
one.

The slot-map cross-check is the substantive finding of the check: the
routing derived from the 2019 portraits' own CSS variables
(`--hat-base`, `--cape-base`, `--medallion-base`, …) lands on the engine's
`CLASS_TO_SLOT` table for **every class the shape library actually carries**
— including the three spellings the two vocabularies do not share
(`hand-*`→`hands-*` by number, `body-pants`→`pants-base` by part, and the
one pre-declared alias `collar-button`→`medallion-base`). The engine's
recolour is not merely self-consistent; it matches what the portraits meant.

## Residual — what headless execution cannot measure (stated, not hidden)

- **No CSS layout, paint, or animation runs headlessly.** jsdom supplies the
  globals the vendored 2019 player needs to load, but neither side mounts
  into a DOM container: each is handed a node-canvas 2D context through
  `rendererSettings.context` + `clearCanvas`, and frames are read back with
  `getImageData`. The
  cross-fade's 120ms opacity ramp and browser compositing are therefore not
  pixel-measured here. What IS measured: both endpoint frames of every
  transition are non-blank (D3), the mechanism holds the previous canvas
  painted while the next fades in (structural: stacked preloaded players,
  opacity transition, no `src` swap, no mid-duel fetch —
  `app/tests/rig-stage.test.js` + D3's fetch instrumentation), and the
  composite geometry comes from the shipped stylesheet. Verifying the ramp
  itself in a real browser is a one-command manual step (open the app, run
  a duel), documented here because this container has no browser.
- **Headless renderer quirk (worked around, counted):** seeking
  (`goToAndStop`) across certain layer in-point boundaries (win/lose clips,
  frames ≈56–64) can silently blank the canvas-renderer instance. The
  harness retries each such frame on a fresh instance and counts genuinely
  unrenderable frames (`framesSkippedHeadless`: 4/60 on CW_Win, 5/60 on
  CW_Power in check A; 0 in checks B/D, 0 over check E's 243 frame pairs). The app's stage never seeks across
  boundaries — it plays each preloaded clip forward from frame 0 (`play()`),
  the reference's own pattern — so this path does not arise there.
- **Check E's headless residual, named:** the 2019 React `DuelPlayer`
  component tree is NOT executed — it cannot run without its build and its
  chain data. What check E executes is that pipeline's own player factory
  configuration over its own per-combo sources with the portrait
  colour-slot recolour; the component tree's DOM layer-switching is covered
  structurally by check D's no-blank walk over the shipped `STEP_TO_CLIP`.
  Frames are compared at 430×350, identically on both sides, not at the
  library's native 1720×1400 (run time). Both sides substitute a node-canvas
  `context` for the browser container — the same substitution, applied the
  same way, on both sides.
- **Check E does NOT measure the id→identity derivation.** The reference side
  is handed the engine-resolved `comboKey` AND `palette` — that is what makes
  every difference downstream attributable to the pipelines rather than to
  the wizard — so which combo and which palette a characterId maps to is
  outside this comparison for every row. `app/tests/rig-identity.test.js` and
  `app/tests/identity-read-time.test.js` cover that. For the canonical row the
  injected identity is the pre-registered declaration and the read path would
  derive a different wizard for that id; the difference is recorded in the
  result and stated in the report, not smoothed over.
- **A recorded result is a claim about ONE tree — and the claim is GATED.**
  Every recorded run (A–E) records the commit it ran at, whether the tree was
  dirty, which of ITS OWN sources were uncommitted (`dirtySources` — always
  empty here), and a sha256 of each harness source and each engine module it
  measures (`results/check-*.json` `.provenance`; the per-check file lists are
  declared in `tools/parity/provenance.mjs` `CHECK_RUNS`).
  `app/tests/parity-harness.test.js` fails if a run was made with one of its
  own sources uncommitted, at a commit that is not an ancestor of HEAD, or
  with **any of those files — harness OR engine — changed since the run**. The
  engine digests used to be recorded and not asserted, on the argument that a
  re-run needs bucket access and a native canvas build; check E's run then
  went stale a second time (f3's `deriveIdentity` rewrite), the mechanism
  detected it and nothing surfaced it — and checks B and D had gone stale the
  same way. So the cost is now paid deliberately: an engine change that
  invalidates any of these AC1 deliverables turns `node --test
  app/tests/*.test.js` red, naming the files and the check to re-run
  (`cd tools/parity && npm install && npm run all`); a container that cannot
  re-run them cannot be green and has to say so. `node
  tools/parity/freshness.mjs` (or `npm run freshness`) prints the same verdict
  per file for all five runs in one offline command, and
  [`PARITY-REPORT.md`](PARITY-REPORT.md) opens with it.
- **Device-matrix timing** (AC1's p95 visual-acknowledgment target on
  mid-range Android) is out of this harness's reach and is NOT claimed;
  the recolour cost measurement lives with the reviewer's findings and the
  cost is pre-positioned before the duel starts.
