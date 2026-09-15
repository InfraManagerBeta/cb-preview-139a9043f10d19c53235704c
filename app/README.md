# Cheddar Battles — app (tickets t1 + t3)

Core game engine + a playable, persistent, navigable app shell (t1), the
full battle presentation, the operator console, and the two alternate
treatments (t3). Static site: no build step, no server, no bundler, no npm
dependencies. Vanilla HTML/CSS/ES modules, relative paths throughout (safe
for a GitHub Pages subpath).

## Run it

From the repo root:

```
python3 -m http.server 8000
```

Then open:
- `http://localhost:8000/app/` — the participant app (playable game).
- `http://localhost:8000/app/console.html` — the **operator console**
  (operator-facing only; reachable by URL, not linked from the participant
  app; the repo-root `index.html` redirect page carries a small "operator"
  link in its footer instead).
- `http://localhost:8000/` — the root redirect page (`index.html`), which
  forwards to `./app/` via a relative redirect (safe at any GitHub Pages
  subpath).

(Any other static file server — `npx serve`, `caddy file-server`, nginx,
etc. — works identically; there is nothing to build.)

Everything works offline except the Google Fonts stylesheet link (Bebas
Neue / DM Mono / Barlow, plus the active treatment's hero face — Pirata One
/ Black Ops One / Alfa Slab One).

State lives in the browser's `localStorage`:
- `cheddarBattles.ledger.v1` — the permanent, append-only event ledger (the
  source of truth for every figure the UI shows).
- `cheddarBattles.session.v1` — transient "where was I" pointer state (the
  in-progress lobby/bracket/commit-window, plus whether this session has
  seen one full battle-presentation playthrough — R75 skippability), so a
  reload resumes mid-duel (§11: "a sealed commit stands").
- `cheddarBattles.playerId` — a local per-browser player id.
- `consoleOverrides` — the operator console's override layer (t3/R14): every
  O-item switch, the kill switch, run/caps/brand/custody/risk-signoff state,
  and the R75 presentation-moment candidate choices. Read by both the
  participant app and the console; **shared** across both (they are the same
  browser's localStorage), so a console switch takes effect the next time
  the participant app renders a route (most screens; a full reload always
  picks it up).

To start over, clear those four keys (or use your browser's "clear site
data").

### Treatment switching (O1)

The active treatment defaults to **incumbent** (Cheddar Battles). Switch it
from the console's O-item panel (O1: Theme) — this re-skins colors, fonts,
nouns, the Narrator's voice, the name pool, and the whole copy layer live
(R14: "make each switch visibly change the running app"). The two
alternates:
- **adjacent = Scrapyard Kings** (`app/data/treatments/adjacent.json`) — a
  junkyard battle-machine circuit. Bot / SCRAP / the Golden Gear / the
  Crusher.
- **far = Undercard** (`app/data/treatments/far.json`) — a regional
  prizefight circuit. Fighter / PURSE / the Belt / the Cut.

`app/data/treatments/mapping.json` is the R13 mapping (every theme-bound
element, incumbent↔adjacent↔far) plus the R87 conflict resolution record
(`CONFLICT-R71-R12`: the Narrator's discipline lines held semantically
verbatim, with only the role noun substituted in the two lines that
originally quoted incumbent vocabulary).

### Kill switch (A4) — two independent paths

1. **Console button**: Console → Console actions → Kill switch → "KILL NOW".
2. **URL parameter, independent of the console UI**: open the participant
   app with `?kill=1` (e.g. `app/index.html?kill=1`) — this sets the same
   switch directly, with no console interaction at all.

Either path halts the participant app into a stopped-state banner on every
route until cleared from the console.

## Test it

```
node --test app/tests/*.test.js
```

`app/tests/` contains plain `node:test` files that import the engine
modules directly (no browser needed). **Gotcha:** in some Node builds,
passing a bare directory to `--test` (`node --test app/tests/`) doesn't
walk it as expected — this was observed in the sandbox this was built in
(Node v22.22.0). The glob form above is the form verified to run the full
suite; if your Node handles bare directories, `node --test app/tests/`
should also work, and `node --test` from inside `app/` (no args) also
auto-discovers everything.

As of f4 (this fix round): **308/308 tests pass** (265 going into f4, +43
new regression tests for the seven merge-blocking findings + the bounded
advisory extras fixed this round — see "f4 fix round" below).

## File map

```
app/
  index.html                  SPA entry: Google Fonts link, styles/base.css + battle.css, ui/app.js
  console.html                 t3: the operator console entry (operator-facing only)
  README.md                   this file

  data/
    tunables.json             R85: every numeric/timer/threshold constant, O-item alternatives as data
    narrator-prompt.txt        R71: the incumbent's Narrator system prompt, shipped verbatim as product data
    treatments/
      incumbent.json           R12: every theme-bound value (nouns, colors, fonts, name pool, seed roster, copy, narrator)
      adjacent.json             t3: Scrapyard Kings, same schema
      far.json                  t3: Undercard, same schema
      mapping.json              t3: the R13 mapping + the R87 CONFLICT-R71-R12 resolution record

  engine/                      pure ES modules — no DOM, no localStorage assumptions baked in
    duel.js                    R53/R54: roundWinner, duelScore, powerTransfer, resolveDuel (rounds/tags/coin flip)
    bracket.js                 R56: 8-seat single-elim structure, top-half-feeds-top-semi, match recording
    economy.js                 R58-R63: summon, tier ladder/gating, re-entry, cash-out, the emptied-character check
    pve.js                     R57: opponent range, equilibrium-mix + drift, win-only rake, no floor rule
    npc.js                     R80/R82: NPC seat generation from the seed roster (+ procedural fallback), NPC tag
    sync.js                    §11/R80-R81: lobby seating/fill-plan, commit window, auto-commit-hesitated, intermission
    rng.js                     seedable PRNG (mulberry32) + weighted choice, for reproducible sims/tests
    id.js                      isomorphic random id helper
    ledger.js                  §13/R83: append-only event ledger, idempotent appends, in-memory adapter for tests
    projection.js               replays the ledger into current state; ledger-conservation accounting (invariant #2)
    retention.js               R41-R50: anchor/day-k/week/D1/D7/weekly-returner/replay-after-loss/bust-to-top-up/reservation
    narrator.js                §9/R71-R73: match-data shape, XML rendering, deterministic narration (now noun-parameterized per treatment), scanner, static bypass
    narratorPrompt.js           t3/R71/R87: composes the full per-treatment Narrator prompt (persona/register/examples theme-bound; Format/Voice/Content discipline verbatim modulo the recorded noun substitution)
    dataLoader.js              isomorphic loader for tunables.json/treatments/*.json/narrator-prompt.txt (browser fetch or Node fs)
    game.js                    orchestration facade: every UI action -> one idempotent ledger event; snapshot()/conservation()
    overrides.js                t3/R14: the consoleOverrides layer -- load/save/patch + effectiveTunables()/effectiveTreatmentId()
    presentationTimeline.js      t3/R74-R77: the per-round + final-sequence animation timeline (pure, DOM-free, unit-tested)
    duelProjection.js           t3/R76: the tug-of-war bar's "projected all-remaining-draws" math (reuses duel.js's duelScore/powerTransfer verbatim)
    gate.js                     t3/R21/R51/R28, f2/C9/C10/C11: gate classification, now derived from tunables.gate (+ a console override layer) via deriveGateConfig(); a real Lan-DeMets/O'Brien-Fleming-type alpha-spending boundary (engine/alphaSpending.js), Wilson 95% CI
    runSimulator.js              t3/R19/R19a/AC0, f2/C9/C12: the seeded synthetic cohort/day-by-day run generator + pre-registration (thresholds now read from gate.js's deriveGateConfig); the R22 door-yield layer (impressions/clicks/intent-clicks/enrollments, door yield per 1,000 impressions, the band rule, theme/price recommendations)
    alphaSpending.js             f2/C10/C11: normCdf/normInv, the O'Brien-Fleming-type Lan-DeMets spending function (documented normal-approximation), Pocock fallback, Wilson score 95% CI
    hypotheses.js                f2/C13/O3/R26: the six manifest-hypothesis cards' registry + card 1 (scouting history) and card 4 (marquee slot) pure data functions

  ui/
    app.js                     bootstrap: loads data + overrides, resolves the active treatment (O1), applies the theme, wires the router, kill-switch gate on every route
    theme.js                    t3/R12/R79: applies the active treatment's colors/hero-face/title/stake-unit abbreviation as CSS custom properties, live
    router.js                  tiny hash router
    session.js                 transient/resumable session state (localStorage, separate from the ledger) -- now also tracks R75 playthrough-seen for skippability
    components/
      dom.js                   el()/mountScreen()/money()/cheddar()/showToast() helpers (cheddar()'s unit abbreviation is now treatment-driven via setCheddarUnit())
      chrome.js                top bar (logo + CASH pill), truth badge (R8a), bottom nav
      money-sheets.js          R67 Load Funds sheet, R69 Withdraw sheet (shared "PLAY CASH ONLY" skeleton)
      battle/                   t3/§10: the battle presentation
        assets.js               GIF/icon/sound path helpers (incumbent bundle paths + generic SVG glyphs for the alternates)
        tugbar.js                R76: the tug-of-war bar
        stage.js                 R74/R75: the animated combatant stage (GIF-based for incumbent, placeholder-art for the alternates)
        rails.js                 R77: spell rails, round cards, the result card
        moments.js                R75: the six coverage-gap-moment candidates (two each for floor drain/coin flip/prize award)
        sound.js                  R10: default-off sound toggle wired to the bundle's fight-intro/loop/round WAVs
    screens/
      landing.js                the acquisition message + R8a truth line -> screener
      screener.js               R70: in-product age/jurisdiction gate, simulated verdict
      summon.js                 R58/R59: element picker, pool-drawn name, $10 -> 100 stake units
      lobby-entry.js            pick which character enters the sync bracket lobby next
      lobby.js                  §11/R80: seat-fill simulation with NPC tags, countdown to the board
      duel.js                   R52/R53/R81 + t3 §10: 5-move sealed commit, timer, the full R74-R77 battle-presentation timeline, result card, Narrator prose
      bracket-board.js          R56: the 8-seat/3-round tree, wins-to-the-top, NPC tags
      sitting.js                R60/R61/R63/R68: re-enter / cash out / sit, the emptied-character card
      wallet.js                 R58/R67-R69: CASH + characters, Load Funds/Withdraw entry points
      reserve.js                R49a: the RESERVE action
      pve.js                    R57: the PvE power-building mini-loop
    console/                    t3/§10 B: the operator console
      main.js                   bootstrap: resolves overrides + treatment, re-renders the whole console on any change
      overridesPanel.js          O1-O10 switches
      runPanel.js                 pre-registration (R21), synthetic run generator + daily reports + gate verdict (R19a/R51)
      actionsPanel.js              kill switch, run activation, per-arm caps editor, brand accept/reject, custody actions, risk sign-off
      riskParser.js                 pure docs/risk-dossier.md family parser (DOM-free, unit-tested)

  styles/
    base.css                    R79 design frame: CSS custom properties (colors/fonts), Bebas Neue/DM Mono/Barlow, 32px grid texture, components
    battle.css                   t3/§10: the battle-presentation stage, tug bar, rails, round cards, coverage-gap moments
    console.css                  t3: operator-console layout only (same CSS custom properties as base.css)

  tests/                        node:test files (see below)
    duel.test.js, bracket.test.js, economy.test.js, pve.test.js, ledger.test.js,
    retention.test.js, narrator.test.js, game.test.js, data-schema.test.js,
    invariants.test.js          the 12 §15 invariants, each exercised where it applies to this artifact
    gate.test.js                  t3: R51 gate classification on planted pass/fail (AC0), sequential-rule edge cases, cap-breach pausing
    invariant-arm-diff.test.js     t3: §15.12 REAL config diff across arm configs (arms differ in the arm variable alone)
    r1-scan-extended.test.js       t3: R1 scan extended over adjacent.json/far.json/mapping.json + the operator console + battle UI
    narrator-prompt-compose.test.js t3: the R71/R87 prompt-composition rule (byte-identical Format/Content; Voice differs only at the recorded lines)
    treatments-schema.test.js       t3: adjacent/far schema completeness, name pools >=12, seed rosters, copy-key parity, R8a meaning preserved
    presentation-timeline.test.js   t3: R74-R77 timeline ordering/cadence/skippability/<45s ceiling, coverage-gap moment selection
    overrides.test.js               t3: the consoleOverrides layer's pure effective-value computation
    risk-parser.test.js             t3: the console's risk-dossier parser against the real shipped docs/risk-dossier.md
    kill-switch.test.js              f1: C16/AC0 -- every Game method freezes on kill; mid-duel void rule
    sync-narration.test.js           f1: C18 -- SYNC_*/NARRATION_GENERATED/OPEN_RESPONSE streams actually emit
    session.test.js                  f1: C19 -- the pure app-session-number computation
    cross-check-r53.test.js          f1: A12 -- docs/risk-sims/r53.js vs app/engine/duel.js agree across 10k cases
    narrator-register.test.js        f2: C5/C17/A9 -- register-aware narration, variant genuinely changes structure, scanner bans every product name
    money-truth-scan.test.js         f2: C7 -- every money-figure screen also renders the R8a truth line
    duel-screen-structure.test.js    f2: C8/A2/A4/A16/A17 -- both combatants on the result card, no per-step mountScreen(), the intermission, tug-bar portraits, targeted clock update
    sync-fill-density-intermission.test.js f2: C14/A4 -- O7 fill-density fallback semantics, the intermission window
    gate-alpha-spending-door-yield.test.js f2: C9/C10/C11/C12/C20 -- one gate-config source, alpha-spending boundary shape, Wilson CI, door yield + band rule, house-play disclosure accuracy
    price-arm-summon-charge.test.js  f2: C15 -- summonCharacter charges the active price door arm's displayed price
    target-size-scan.test.js         f2: A10 -- automated 44px touch-target scan over every stylesheet
    deposit-tap-to-edit.test.js      f2: A11 -- the Load Funds amount is tap-to-edit to the cent
    manifest-hypotheses.test.js      f2: C13 -- the six O3 manifest hypotheses, each surface gated to its own id, scouting/brief data from real ledger events
```

## f1 fix round (engine/core crucials, on top of t1+t3)

A verification review of the integrated t1+t3 head found several crucial
findings in t1's territory (engine/core); this round fixed them, added a
regression test per fix, and kept the diff out of t3's territory (battle UI,
console, gate.js/runSimulator.js). Notes for later rounds:

- **Kill switch / AC0 void rule**: `Game` now guards EVERY ledger-touching
  method with `isKilled()` (reads the `consoleOverrides` kill switch),
  throwing `KillSwitchFrozenError` instead of appending anything once
  killed — guarded at the Game layer, not just the UI, so any caller
  inherits the freeze. The stated shutdown rule: **on kill, an unfinished
  bracket is VOIDED — no auto-commit, no resolution, no stake transfer
  happens after the kill; every character keeps exactly the stake it held
  at that instant; a single `BRACKET_VOIDED` event records the rule**
  (`Game#voidBracketOnKill`, the one method deliberately NOT frozen by the
  switch, since running while killed is its whole purpose).
- **Coin-flip verification surface (C22)**: a true tie now resolves via
  commit-reveal (`app/engine/duel.js`: `generateFlipSeed`/`sha256Hex`/
  `deterministicFlipFromSeed`) — the commitment is appended
  (`COIN_FLIP_COMMITTED`) BEFORE the seed decides anything; the seed and
  commitment are revealed on the `DUEL_RESOLVED` event. The duel result
  screen (`app/ui/screens/duel.js`) renders a `<details>` fold with the
  commitment, the revealed seed, recompute instructions, and a one-tap
  "Re-verify (Web Crypto)" button that independently recomputes SHA-256 via
  `crypto.subtle.digest` (a second, real, independent recomputation, not a
  tautology against the engine's own synchronous hash).
- **Session-number semantics (C19)**: `app/ui/session.js` now tracks a real
  app-session number (`getOrCreateSessionNumber`/`computeSessionNumber`), a
  judgment call documented here per the order: a NEW session starts when
  either (a) ≥30 minutes have passed since the app was last touched, or (b)
  this is a browser tab that hasn't seen the app yet this tab-lifetime
  (`sessionStorage` is tab-scoped and clears on tab close, used as the "new
  tab/window" signal). `Game#loadFunds` now REQUIRES `sessionNumber` (and
  `intentId`, C1) from the caller.
- **A5 (R57) — left AS SHIPPED, not changed.** For a sub-floor PvE player,
  R57's clauses collide: the opponent range's upper bound (2x the player's
  own small stake) can sit BELOW the tier floor (the range's stated lower
  bound), so the shipped code collapses to a fixed `[floor, floor]` range
  rather than a range scaled off the player's actual stake — see the source
  comment at `app/engine/pve.js`'s `generatePvEOpponent`. This is a named,
  documented internal conflict in R57 itself (not an invented rule); f3
  should record it in the decision record (R87).
- **A8 (dead parallel implementations)**: `economy.js`'s
  `advanceTierOnBracketWin`/`recordDuelResult`/`sitIndefinitely` and
  `sync.js`'s `scheduleNpcCommit`/`windowComplete` and `retention.js`'s
  `retainedUserBracketsWeek1` were unused by both the live path AND any
  test — deleted. `economy.js` gained `bracketWinOutcome(...)`, the single
  rule `Game#resolveMatch` now actually calls for a bracket win (this is
  where C2's tier-7 brick + wrong T6 payout lived: the live path used to
  re-implement this inline, uncapped).

See `app/tests/*.test.js` (the new/strengthened tests across
`duel.test.js`, `economy.test.js`, `game.test.js`, `ledger.test.js`,
`invariants.test.js`, `treatments-schema.test.js`, plus the new
`kill-switch.test.js`, `sync-narration.test.js`, `session.test.js`,
`cross-check-r53.test.js`) for the full fix-by-fix detail.

## Scope note (per the work order)

This is a client-only static artifact. External rails are simulated at the
enumerated substitution points (no ad-platform calls, no live model-provider
calls, no real payments/identity) — the game mechanics themselves (duel
math, economy, tiers, ledger, sync-bracket simulation, Narrator discipline)
are real, per the PRD. **t1** delivered the engine + app shell. **t3**
(this ticket) delivered the full battle presentation (§10), the operator
console, and the two alternate treatments (Scrapyard Kings / Undercard),
all on top of t1's engine unchanged (no engine math was altered; `duel.js`,
`bracket.js`, `economy.js`, `pve.js`, `ledger.js`, `projection.js`,
`retention.js` are untouched — `narrator.js` gained one additive, backward-
compatible parameter (`nouns`) so its body prose can swap the world/stake-
unit noun per treatment, defaulting to the incumbent's exact words for every
existing call site). Docs under `docs/` are a parallel ticket (t2); t3 only
added `docs/presentation-candidates.md`, per the work order's boundary.

The ad machine, live model calls, and real payments remain simulated at the
same substitution points t1 established; the operator console's "Run
simulation" is a seeded synthetic generator (`app/engine/runSimulator.js`),
not a live ad-platform integration — see its module comment and
`docs/presentation-candidates.md`/the PRD for what's simulated vs real.

## f2 fix round (t3-territory crucials + two fresh-scope items)

A verification review of the integrated t1+t3+f1 head found crucial
findings in t3's territory (battle presentation, console, gate/runSimulator,
narrator register); this round fixed all of them, added a regression test
per fix, and additionally built two fresh-scope items priced into this
round: the R22 door-yield layer (C12) and the six R26 manifest hypotheses
at minimum fair-test scope (C13). Notes for f3:

- **Register-aware narration (C5/C17/A9)**: `engine/narrator.js`'s
  deterministic templates are now per-treatment REGISTER sets (incumbent:
  dry/precise archivist; adjacent: deadpan mechanical scrutineer; far:
  terse/plain broadcast scorekeeper — genuinely shorter sentences, no
  subordinate clauses), selected by `treatment.id` and threaded from
  `app/ui/screens/duel.js`'s `generateNarration({ register })` call — a
  participant now actually sees the register difference, not just the
  test-only `composeNarratorPrompt`. `variant` (regenerate-on-scan-fail) now
  genuinely changes the lead fact/structure instead of re-invoking the same
  render. The R73 scanner bans every treatment's product name in every
  register, not just the incumbent's.
- **NPC tag + money truth line reach every surface (C6/C7)**: the battle
  stage (`stage.js`) and tug bar (`tugbar.js`) now render the permanent NPC
  tag (invariant #8 extended to both files); every screen that renders a
  money figure also renders `truthBadge()`/`compactMoneyTruth()` (see
  `app/tests/money-truth-scan.test.js`).
- **Result card shows both combatants (C8)**: `renderResultCard`
  (`rails.js`) now takes and shows the opponent's before/after/delta too,
  from `lastOutcome.combatants`.
- **One source for the gate (C9/C10/C11)**: `tunables.json`'s `gate` key
  (+ a console `gateOverrides` patch layer, `engine/overrides.js`) is the
  ONE place `engine/gate.js`'s `deriveGateConfig()`, `runSimulator.js`'s
  pre-registration, and the console all read. The sequential rule is now a
  REAL Lan-DeMets/O'Brien-Fleming-type alpha-spending design
  (`engine/alphaSpending.js`, one-sided, documented normal-approximation --
  the exact recursive multivariate boundary is NOT implemented, see that
  module's header comment; Pocock's constant-boundary fallback is also
  implemented per the brief but not this build's primary choice). Wilson
  score 95% CI: the pre-registration states the EXPECTED interval at max N
  (computed from the setpoint, not hardcoded); the console's gate-verdict
  card states the interval REACHED at close.
- **Door-yield layer (C12, fresh scope)**: `runSimulator.js`'s per-arm
  simulation now models impressions -> clicks -> intent clicks (=
  enrollments, R19a's own column) -> qualified activations -> completers ->
  reservations, at an identical assumed CPM across arms (R22: "identical
  message, targeting, pacing") with an arm-specific (documented, synthetic
  `doorYieldBiasMultiplier`) cost-per-intent-click driving door-yield
  differences. `classifyDoorYieldWinner`/`buildDoorYieldReport` implement
  the pre-registered BAND rule and R22's exact reporting language
  ("recommendations... the gate is the run's verdict"), surfaced in the
  console's new door-yield report section. **What's now TRUE about R22**:
  theme and price both have a real, testable door-yield primary metric and
  band-rule winner; what's still simulated: impressions/CPM/cost-per-
  intent-click are an ASSUMED synthetic model (no live ad platform), not a
  re-derivation of R30's wave-level numbers -- f3 should treat the
  bias-multiplier table in `runSimulator.js:armDefinitions()` as a labeled
  placeholder for real door-yield data once available.
- **Six manifest hypotheses (C13, fresh scope)**: `engine/hypotheses.js` +
  `overridesPanel.js`'s O3 (a real radio switch now, default = manifest
  order card 1) + per-card wiring in `duel.js`/`sitting.js`/
  `lobby-entry.js`/`pve.js`. **What's now TRUE about O3/R26**: all six cards
  are built and switchable at delivery (AC0 row 1); each card's surface
  renders ONLY when active; cards 1/2's data (scouting history, pre-match
  brief) derive from real `DUEL_RESOLVED` ledger events; card 5's roster
  opponents are real named `seedRoster` characters with per-name ledger-
  derived W/L; card 4's reminder opt-in and card 3's spectate view are real
  ledger events; card 6 reuses O1's own treatment-resolution mechanism,
  keyed off the last console run's door-yield theme winner. **f7 update on
  card 1 (supersedes the f3 note below)**: R26 asks for "elements played by
  round" in the scouting panel -- f6 already started persisting a SLIM
  per-round record on every `DUEL_RESOLVED` event (`game.js:
  slimOutcomeForLedger`/`hydrateRoundsFromLedger`, added for the
  cross-instance reveal-replay fix), so a true per-round move history HAS
  been reconstructable from the shipped ledger schema since f6; f7 wires
  the scouting panel up to it. `opponentDuelHistory()` now returns, per past
  duel, `playedByRound`/`facedByRound` element arrays (oriented via
  `combatants`) alongside the original summary fields (W/L, score, an
  affinity-play-rate proxy, transfer, floor-drain/tie flags); the panel
  renders both. The ONE remaining, unavoidable caveat: a LEGACY (pre-f6)
  `DUEL_RESOLVED` event has no per-round record at all (no migration) --
  those rows fall back to summary-only, honestly marked
  (`roundsAvailable: false`), not a fabricated per-round guess. (Superseded
  f3 note, kept for history: at f3, per-round history was genuinely not
  reconstructable, because f1's original A6 slimming dropped `rounds`
  outright; f6 changed that premise before this panel was ever updated to
  use it -- the stale claim this f7 pass corrects.)
- **O7 fill-density + intermission (C14/A4)**: `sync.js:buildFillPlan` now
  actually reads `tunables.npcFillDensity` (previously ignored); the
  "≥2 humans required" alternative, on this single-device build (only ever
  ONE real human), holds the shortfall seat open ("waiting for a 2nd
  human") until the O6 wait deadline, then falls back to an NPC fill anyway
  (documented on the console's O7 row and in `sync.js`). The intermission
  (`createIntermission`/`intermissionOver`, previously dead) is wired into
  `duel.js` between a won (non-bracket-completing) duel and the next.
- **Displayed price = charged price (C15)**: `Game#summonCharacter` now
  charges the ACTIVE price door arm's displayed price (O2: $5/$10/$25/$0),
  always minting the same 100C stake (R19: the arm varies the door price,
  not the stake or the 20C=$1 peg, which only holds exactly at the $10
  default arm).
- **House-play disclosure accuracy (C20)**: `npc.js`'s procedural NPC
  fallback drift is now `tunables.pve.driftPerSessionPct` (3%, matching
  R57/PvE), not an independent hardcoded 10%. The pre-registration's
  house-play disclosure now names three populations separately and
  accurately: bracket NPCs' hand-authored R82 roster (with its real,
  computed bias range), the procedural fallback's (now-aligned) drift, and
  PvE house opponents' drift+rake.
- **Presentation timing + targeted DOM updates (A2/A17)**: the TRUE worst
  case (5 CRITICAL rounds + floor drain + a bracket-completing prize),
  INCLUDING the pre-round hold that `totalDurationMs` previously omitted,
  now stays at ~40.4s at O9=1500ms (down from a true 44.55s, ~450ms under
  the 45s ceiling) -- `presentationTimeline.js`'s per-step weights were
  trimmed and `preRoundHoldMs()` is the one place that expression lives. The
  reveal loop (`duel.js`) no longer calls `mountScreen()` (a full teardown+
  rebuild) on every timeline step -- `buildShell()` mounts the screen once;
  `updateFrame()` patches the tug-bar/stage/round-cards containers in place
  via `replaceChildren()`. The commit screen's clock is now a targeted
  per-tick text update (`updateClockDisplay()`), not a full rebuild.
- **Touch targets + tap-to-edit deposit (A10/A11)**: `.cb-skip-btn`/
  `.cb-sound-toggle` now clear 44px (were 32px/~22px);
  `app/tests/target-size-scan.test.js` is the automated (static-
  approximation) scan the review noted was absent. The Load Funds deposit
  figure is tap-to-edit, supplying a custom amount to the cent (steppers
  stay whole-dollar).
- **Tug-bar portraits (A16)**: the incumbent uses the bundle's full-body
  element portrait art (`client-static/img/wizards/{fire,water,wind}.svg`);
  the two alternates get a clean, treatment-colored monogram portrait
  (`assets.js:monogramPortraitMarkup`) instead of a bare icon.

See `app/tests/*.test.js` (the new files listed in the file map above, plus
strengthened tests in `invariants.test.js` #8, `presentation-timeline.test.js`,
and `sync.js`'s test coverage) for the full fix-by-fix detail.

### Files touched that also exist in f1's territory, and why

Per the boundary ("do not change f1's engine fixes... except where a fix
above requires touching the same file — keep those diffs surgical"):

- `app/engine/game.js`: `summonCharacter` (C15: charges the active price
  arm), `startPveOpponent`/`resolvePveDuel` (C13 card 5: named roster
  opponents + `opponentName` on the ledger payload when active), two new
  methods (`optInMarqueeReminder`, `recordSpectateView` -- C13 cards 3/4).
  None of this touches the kill-switch guard, the idempotency-key scheme,
  or `voidBracketOnKill` -- every new/changed method still opens with
  `this._assertNotKilled(...)` exactly like its neighbors.
- `app/engine/npc.js`: `proceduralNpc`/`generateNpcSeat` gained a leading
  `tunables` parameter (C20: reads the shared drift rate instead of a
  hardcoded one); `sync.js`'s two call sites updated to match.
- `app/engine/sync.js`: `buildFillPlan`/`advanceLobby` (C14: O7 fill-density
  + the fallback timing) and the intermission functions (A4: now called,
  previously dead) -- `duel.js`'s math (`resolveDuel`, `powerTransfer`,
  the coin-flip primitives) is untouched.
- `app/engine/ledger.js`: two new `EVENT_TYPES` (`MARQUEE_REMINDER_OPT_IN`,
  `SPECTATE_VIEW`, C13 cards 3/4) -- additive, no existing event type
  changed shape.
- `app/engine/overrides.js`: `effectiveTreatmentId` gained the card-6
  (theme-change) branch; new `effectiveHypothesisId` export; `gateOverrides`
  deep-merge (C9). Every existing O1-O10 branch is unchanged.

## f4 fix round (re-probe v1b: seven merge-blocking findings + bounded advisory extras)

A re-probe of the integrated t1+t3+f1+f2 head (f3 was docs-only, no code
changes) found seven merge-blocking findings; this round fixed all seven,
plus the bounded advisory extras priced into the round, and added a
regression test per fix. `docs/tunables-workbook.{md,csv}` (W-89…92 rows)
and `docs/decision-graph.{md,json}` (a new R87 conflict entry) are the
only two docs files touched, per the round's boundary.

- **N3 (R6/R19/R21/R28) — `engine/gate.js`**: the max-N/time-ceiling
  branch declared PASS on a bare `z >= 0`, bypassing the alpha-spending
  boundary entirely (repro: 36.0% at n=50, z=0.148 → wrongly `'pass'`).
  Deleted the carve-out: a ceiling now passes ONLY if the reached-N read
  crosses the REAL efficacy boundary re-evaluated at `t=1`; otherwise it
  closes `'inconclusive'` — a completed result, reported with its reached
  Wilson interval, treated as a miss in verdict/report language (R6/R19).
  `runSimulator.js`'s `onMaxNWithoutFiring` pre-registration text updated
  to match; the planted `'pass'` fixture's true reservation rate bumped
  0.55 → 0.65 (0.55 only reliably reached `'pass'` at max N via the
  now-deleted shortcut).
- **N4 (O3/R26/R20) — `engine/overrides.js` + `overridesPanel.js`**:
  `effectiveHypothesisId` defaulted to `'scouting_reports'`, so a default
  install rendered card 1's panel with zero operator action. Defaults to
  NONE now; the console's O3 radio group carries an explicit,
  selected-by-default "none (manifest order — each hypothesis runs in a
  later envelope, R6)" option.
- **N1 (R62/R56) — `ui/screens/duel.js` + `ui/components/battle/moments.js`**:
  the T6 win card and the prize-award moment both read
  `tierLadder.tiers[6].prizeCheddar` (20,000,000C) independently of the
  ledger, which actually pays $999,999.92 CASH + stake at 20:1,
  prizeCheddar 0. `Game#resolveMatch` now returns the exact
  `characterAdvancedPayload` it appends to the ledger; both display sites
  read it, and the topped-out case renders R56's two separate lines (cash
  payout, stake-at-20:1 conversion).
- **N2 (R60/R61) — `engine/projection.js`**: a topped-out T6 champion
  stayed `ACTIVE` at 0C with no legal action anywhere. The champion now
  transitions to `SITTING` (its stake was cashed out by the same payout),
  reaching R61's emptied-character RETIRE TO THE LEDGER card; a
  `toppedOutChampion` flag drives a champion-specific, theme-voiced line
  on that card (all three treatments).
- **N5 (R85/AC0/R30) — `engine/runSimulator.js`**:
  `doorYield.intentClickPctOfClicksBaseline` (5.2%) had zero readers; the
  model now derives `dayIntentClicks` from `dayClicks * rate * arm bias`
  and `costPerIntentClickUSD` is the DERIVED, reported quantity. CPM is
  now derived (`deriveCpmFromDoorYieldTunables`, the one free
  parameterization, full arithmetic in its header comment) so the
  gate-cell arm's own numbers reproduce R30's $6.815/5.2% mean/baseline
  **in expectation**, rather than drifting to an ungrounded ~$3.42/~2.6%.
  **f5/crucial-3 correction**: this previously read "reproduce R30's
  $6.63–7/5.2% exactly, by construction" — false as a per-run claim once
  f4/A-c added real per-day binomial sampling noise. The calibration holds
  exactly in expectation ($6.815 mean); any one seed's REPORTED figure
  varies around it (measured, 400 seeds: mean $6.805, min $5.952, max
  $7.592) — the shipped default seed (20260910) itself reports
  $6.446/5.409%, outside the $6.63–7.00 range, and ~57% of the 400 seeds
  swept land outside that range. What the system enforces is the 5.2%
  baseline intent-rate parameter and the CPM derivation, not any
  particular per-seed reported range.
- **N6 (R12/R13) — `data/treatments/adjacent.json` + `far.json`**: the
  incumbent's `(0C)` had leaked into both alternates' `cashOutBody`;
  fixed to each treatment's own unit (`(0 SCRAP)` / `(0 PURSE)`).
- **C17 (R73) — `engine/narrator.js`**: `renderAdjacent`/`renderFar` had
  no variant-2 branch at all (a v2 request silently rendered the same as
  v0); added it, mirroring the incumbent's own variant-2 structure in
  each register's voice. Every register's tie-line template was hardcoded
  filler text that is only accurate when `draws === 5` — not guaranteed
  for a true tie once affinity multipliers are in play — and could
  degrade to the generic `STATIC_FALLBACK`; every tie now leads with the
  real score breakdown, guaranteeing genuine specificity.

**Bounded advisory extras** (one line each; see the individual commits
for detail): **A-a** `recordSpectateView` re-keyed on
`bracketId::playerId` (once per bracket per player) + a submitting guard
on the spectate button. **A-b** submitting guard on the screener
Continue. **A-d** `classifyDoorYieldWinner` names the tie-holder on an
all-zero or runner-up-zero read, never a `lead: Infinity` "winner". **A-f**
O8's load-funds presets now derive from the active O2 price-door arm's
displayed entry price. **A-g/A-h** `duel.js`'s `renderResult` and
`pve.js`'s Fight handler both catch `KillSwitchFrozenError` and render
the (now-shared, `components/chrome.js:renderKillStopBanner`) stop
banner instead of freezing/sticking with no feedback. **A-i** a new
`router.js:onUnmount(fn)` hook clears `duel.js`'s tick interval, reveal
timeouts, and intermission interval on any navigation away — no more
auto-commit after leaving the screen. **A-k** `pve.js`'s `resolvePvEDuel`
passes a real `flipSeed` on a PvE tie, matching bracket duels'
commit-reveal shape. **A-l** one honest sentence beside the coin-flip
verification fold: verifiable after the fact; the seed is
house-generated. **A-j** (bounded docs edit) the R58-vs-R19 door-price
conflict added as an R87 entry at the top of `decision-graph.{md,json}`
(same shape as the other seven; previously only recorded as a decision
node). **A-c** clicks/intent-clicks in the door model are now real
per-day binomial draws, so door yield genuinely varies by seed/day; the
plant's rate bias sits underneath the noise, and the specific seeds this
suite pins for planted-pass/planted-fail classification were verified
still correct with the noise on.

See `app/tests/*.test.js` — `gate.test.js`, `manifest-hypotheses.test.js`,
`game.test.js`, `duel-screen-structure.test.js`,
`gate-alpha-spending-door-yield.test.js`, `treatments-schema.test.js`,
`narrator-register.test.js`, `kill-switch.test.js`, `pve.test.js`, plus
the new `router-teardown.test.js` and `duel-teardown.test.js` — for the
full fix-by-fix detail.
