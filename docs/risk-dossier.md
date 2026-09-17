# Risk Dossier — synthetic, honestly labeled (AC3, ticket-t2 slice · revised f3 against the integrated implementation)

**Ticket t2 · task 85baf1fc · 2026-09-10 · revised f3 (review finding A18/AC3).**

**What this document is and is not.** This began as the **documentation-lane slice** of the AC3 risk dossier: adversarial analysis of the PRD's *specified mechanics* (R52–R57, R60–R63, R80–R83), plus **model-side simulations** of the R53 math committed under `docs/risk-sims/` with their outputs quoted verbatim. It is synthetic evidence in R29's sense (it qualifies the machine and answers question 4; it says nothing about human behavior). **f3 revision:** the t2 premise "no implementation exists in this ticket's checkout" is stale — the integrated head now carries the full t1+t3 app plus fix rounds f1/f2 (265/265 tests green). Entries below that t2 marked *"unknown until tested"* have been **re-classified against the now-present implementation wherever the answer is determinable by reading the code on this head** (F-6, F-7, F-3, F-5 updated in place); entries that still need execution or remain out of budget keep their honest labels in §5. **This budget still did not include:** adaptive adversarial agents against a running sandbox, an executed concurrency harness, or the 100× scale proof. Every simulation here is deterministic (seeded PRNG) and reproduces with `node docs/risk-sims/<script>.js`; outputs are committed beside the scripts as `*.out.txt`.

**Budget statement (AC3 asks for it):** one analyst session; four simulation scripts; ~10⁷ simulated duels total; search over pure and equilibrium per-round policies only (no genetic/RL policy search). Findings marked *(analysis-only)* had no simulation run.

Severity: **critical / high / medium / low** (impact on the run's decision validity or on value integrity). Feasibility: **high / medium / low** (effort for a motivated attacker against *this* artifact — a play-money test whose gate is metric integrity, not money custody; R6/R51).

---

## 1. Attack families (the seven named in AC3)

| # | Family | Severity | Feasibility | One-line result |
|---|---|---|---|---|
| F-1 | Sybil | **high** (gate integrity) | medium | Grant/metric farming blunted by screener+assignment; contamination estimate is the real defense |
| F-2 | Collusion | medium | medium | Lobby seeding is the enabling step; O7 fill and pairing telemetry bound it |
| F-3 | Throwing | medium–**high** | high | Includes the **hesitation-contamination lever** on the R43 anchor — cheap denominator gaming; anchor semantics now enforced in code (see below) |
| F-4 | Laundering | low (this run) / high (real build) | low | Mechanics tax every hop ≥50% at T0; provable haircut |
| F-5 | Sync timing | medium | medium | Sealed commits + resumable state kill the classic reveals; this artifact has no server clock (client-only) — window-edge behavior is a product-level test |
| F-6 | Ledger races | medium (this artifact) / **critical** (server build) | medium | Same-context double-fire closed & tested (f1); cross-tab lost-update **present by code reading** (whole-array persist, per-instance cache, no lock) |
| F-7 | Replay | **was PRESENT at review · FIXED in f1** | — | The review's C1 finding confirmed t2's "critical if present": six mutations keyed on `randomId()`; a double-fired $100 deposit credited $200. Fixed: deterministic intent keys + check-before-compute; regression-tested |

### F-1 Sybil
- **Against this artifact:** every account gets $25 play CASH (R66) and a $10 summon path; the value is play-only (invariant 1) so there is nothing to *withdraw* — the sybil payoff is **metric corruption**: inflating reservation, replay, or door yield in a chosen arm (the PRD itself declined prize-backed arms because "sybil destroys metric reliability", §19). A competitor or a hostile bettor community could spike an arm.
- **Feasibility:** medium. In-product screener + age/jurisdiction gate + behavioral fingerprinting (R70, AC0) with server-side assignment (AC0) must all be beaten per account; ad-side, fake accounts also cost the attacker real ad-click behavior to arrive on-arm.
- **Proposed reproduction:** synthetic off-target agent cohort (the AC0 verification row already requires this) — script N agents with shared device/behavior signatures at varying evasion effort; measure screen-out rate at each tier of effort.
- **Fix:** ship what the spec already demands (R70 estimates with method); add per-arm anomaly alerts on completer-rate discontinuities (R19a daily report is the natural surface); contamination estimated per cohort with denominator left whole (R43 — already law).
- **Retest:** re-run the agent cohort after each fingerprinting change; gate: false-accept rate stated in every pre-registration (AC0).

### F-2 Collusion (bracket seeding)
- **Against this artifact:** brackets seat 8; humans seat first, NPCs fill after the O6 wait (R80). Two coordinated accounts joining an off-peak lobby land in the same bracket with p → 1, enabling F-3/F-4 plays and record boosting (tier entry needs a live W>L record at tier N−1, R60 — collusion is the cheap way to manufacture W's).
- **Feasibility:** medium — timing joins is trivial; *meeting each other in the draw* is the only randomness (top half feeds top semifinal, R56: with 2 humans + 6 NPCs, P(meet before final) depends on seeding order, which the spec does not randomize — **specification gap**).
- **Proposed reproduction:** scripted paired joins at controlled offsets across 1,000 synthetic lobbies; measure same-bracket rate and same-half rate.
- **Fix:** randomize seat→slot assignment (cheap, invisible); log pairing frequency per account pair; alert on pairs exceeding binomial expectation (the §13 event stream already carries everything needed).
- **Retest:** re-run the scripted joins; pairing telemetry shows expectation-consistent rates; invariant-12 diff confirms the fix is arm-neutral.

### F-3 Throwing (including the hesitation-contamination lever)
- **Against this artifact, two distinct throws:**
  1. **Stake throwing** — lose on purpose to move stake to a confederate (enabler: F-2; economics: F-4's haircut applies only at cashout — *within* the game, a throw at score 424 moves 100% of the loser's stack (see §2 table), so intra-game value moves cheaply).
  2. **Denominator gaming via hesitation** — R42 excludes auto-committed "hesitated" duels from the *staked duel* definition, and R43 anchors a player only when **every duel of theirs in the bracket is a staked duel**. A player (or scripted cohort) that lets the clock lapse once in their first bracket **never anchors** and drops out of the retention denominator while still appearing in raw counts. One idle spectator behavior = one gate-denominator exit. **(f3 update — implemented and verified, no longer analysis-only in the mechanism sense:** at review the shipped code *wrongly anchored these brackets anyway* (`allDuelsStaked` was hardcoded `true` — the C4 crucial finding); the f1 fix makes the R43 semantics real: `game.js#resolveMatch` tracks `hesitatedCharacterIds` per bracket and stamps `allDuelsStaked: !wasHesitated` onto each character's `CHARACTER_ADVANCED`/`BRACKET_COMPLETED` events — **both seats** of a hesitated duel are marked, so a bracket path containing a hesitated duel does not anchor for either combatant — and `retention.js#computeAnchor` accepts only events with `allDuelsStaked !== false`. So the lever now operates exactly as specified: hesitation removes the bracket from the anchor denominator, which is both R43-correct and exactly the gaming surface this finding describes.)
- **Severity:** medium for stake throwing (play value); **high** for the hesitation lever — it games the gate itself (R51's denominators) at zero skill and zero cost, and even *non-adversarial* distracted players produce it.
- **Proposed reproduction:** synthetic cohort with x% one-hesitation players; recompute R51 metrics with and without them; report the wedge as a function of x.
- **Fix:** R43 already orders contamination estimated and the denominator left whole — implement the hesitation-share as a *named* line in the daily report (R19a) and in every gate recomputation package (R23); consider counting a hesitated-then-eliminated player as anchored for denominator purposes as a console-side sensitivity view (policy question → decision graph, not a law change).
- **Retest:** planted-outcome synthetic run (AC0 gate-logic row) with hesitation cohorts at 0/5/15%; gate classification must be invariant to the reported wedge.

### F-4 Laundering
- **Against this artifact:** move value account A → account B via thrown duels, cash out B. **Provable haircut from the mechanics:** A's $10 summon mints 100C with cashout value $5 (R58 — 50% in at T0); each thrown transfer moves ≤ the loser's stack (invariant 1, verified model-side: 0 violations in 10⁶ duels); B's exit is Cash Out at 20:1 (R68). Best case A→B moves 100% of stack in one bracket meeting, so the end-to-end pipe is bounded at **50 cents per dollar at T0**, before fees/re-entries — and the payout rail is *play CASH*, which never leaves the game (invariant 1; R69 withdraw is the play-cash sheet). In this run there is no real-money exit at all.
- **Severity/feasibility:** low/low for this run; **high relevance recorded for the real-money build**, where the same math bounds efficiency but a real exit exists.
- **Proposed reproduction:** ledger-graph query — flow of C between account pairs vs bracket co-occurrence (needs the running product).
- **Fix (real build, recorded now):** pair-flow telemetry (same as F-2), source-of-funds on cashout thresholds, per-account velocity caps (all outside this run's scope by R6/R65).
- **Retest:** re-run the ledger-graph query after fixes on a planted laundering script.

### F-5 Sync timing
- **Against this artifact:** (a) commit-sniping — no information leaks pre-reveal by design (sealed simultaneous commitment, R52; the board shows *other* duels, not the opponent's pending commit — R81); (b) disconnect abuse — a sealed commit stands and resume is from persisted state (R81; f1 additionally records `SYNC_DISCONNECT`/`SYNC_RECONNECT`), so rage-quit gains nothing; (c) last-millisecond commits — needs a server-authoritative clock with a stated grace, else clock skew disputes; (d) lobby-timing for collusion — F-2; (e) NPC identification by timing (joins 2–10s, commits 10–45s) — moot: NPCs are tagged by law (R80, invariant 8/R86.8).
- **Severity/feasibility:** medium/medium. **(f3 re-classification against the implementation:** this checkout is client-only — there is no server, so the commit window runs on the client clock (`sync.js`) and (c) is *structurally out of scope for this artifact* rather than untested; it becomes a real, open surface the moment a server-authoritative build exists, and stays listed in §5 for that build. What IS determinable here: a lapsed window auto-commits and flags `hesitated` per R42 — verified in `game.js#resolveMatch`.)
- **Proposed reproduction (server build):** clients submitting at window-edge ± network jitter against the real server; fuzz clock skew.
- **Fix:** server timestamp is the only clock (the R42 definitions already imply server-side truth); accept-window = O5 + fixed server grace; log edge-commits.
- **Retest:** edge-commit fuzz suite in CI; hesitate-rate metric (≤10%, §13) monitored for discontinuity at the boundary.

### F-6 Ledger races · F-7 Replay — **re-classified at f3 against the implemented ledger (review findings C1/A18)**
- **What t2 said:** the spec closes both *on paper* (R83 per-action keys, R86.7 replay-is-a-no-op), severity **critical if present**, "cannot be established from math, only from tests" — *needs executed tests*.
- **F-7 (replay/double-fire) — was POSITIVELY PRESENT at review, FIXED in f1.** The verification review's C1 crucial finding confirmed t2's worst case: six ledger mutations (re-enter, PvE session, PvE duel, PvE opponent-zeroed, **deposit**, lobby-join) drew their idempotency keys from `randomId()` at call time — a fresh key per retry, i.e. the R83 key scheme existed but protected nothing. **A double-fired $100 deposit credited $200.** The f1 fix: deterministic *intent* keys (the caller captures the intent — `intentId`, sitting-epoch, session+duel-seq, join-epoch — and a retry reuses the same key) plus **check-before-compute** (`ledger.hasKey`/`findByKey`: a replayed action returns the already-persisted result instead of recomputing). Regression tests on this head: `app/tests/game.test.js` ("C1: loadFunds — double-firing the same intentId credits CASH exactly once", plus the matching re-enter / PvE-session / PvE-duel / opponent-zeroed / lobby-join double-fire tests) and `app/tests/ledger.test.js` ("append: replaying the same idempotency key changes nothing (invariant #7)"). Status: **fixed and regression-tested**; the t2 "needs executed tests" label is discharged for same-context replay.
- **F-6 (concurrent races) — split verdict, determined by reading the code on this head.** Within one execution context the F-7 fix closes the double-fire family (same key → same event, tested). **Cross-tab concurrency remains a real, unmitigated lost-update surface:** `ledger.js` caches the parsed event array per instance (`_load()` reads storage once) and `_persist()` writes the whole array back — two tabs holding live `Ledger` instances can interleave and the last writer silently drops the other tab's appended events (no lock, no merge, no `storage`-event reconciliation). Severity for *this* artifact: **medium** (single-player, single-device by design; the tab-scoped session pointer discourages but does not prevent two live tabs); severity for any server build: **critical**, unchanged from t2. This is now a *determined-by-reading* result, not an unknown — what still needs an executed test is only the demonstration harness (two-tab interleaving) and, on a server build, true concurrent-write behavior.
- **Retest:** the double-fire harness now exists as the regression tests named above and runs in the suite (R86 "in the model and in the product"); a two-tab lost-update repro and any server-side concurrency harness remain listed in §5.

---

## 2. Mechanics findings (the actual R53–R57 math)

Everything in this section reproduces from `docs/risk-sims/`. Properties verified model-side over 10⁶ random duels (`properties.js`): transfer ≤ loser's pre-duel stake — 0 violations; zero score → zero transfer — 0 violations; stake never enters win probability — high-stake side won 50.045% of decisive duels (sampling error at N=10⁶). These are **established by mechanics** (the code is the PRD's pseudocode verbatim).

### F-8 · PvE drift exploitation — the headline finding · severity HIGH · feasibility HIGH

R57: house opponents play "the equilibrium mix with a 3% drift toward one element chosen per session"; rake 5% on wins only; PRD tags this **[TESTED: … bounded against a perfect exploiter]**. Our independent re-test of the literal construction disagrees (recorded as **CONFLICT-R57-EVIDENCE** in the decision graph):

```
$ node docs/risk-sims/pve-exposure.js
PvE exposure, player 100C vs house 150C (T0 hard cap 1.5x entry par, R57), 2e6 duels per cell, 5% rake on wins:
  worst cell for the house: house affinity Water, session drift toward Water,
  exploiter plays pure Air with own affinity Air:
    player win rate 56.35%, loss rate 43.15%, tie 0.50%
    player EV per duel (net of 5% rake on wins): 10.108C on a 100C stack (10.108% of stack per duel)
  baseline equilibrium player vs drifted house: EV per duel -1.883C, win rate 49.72%
  uniform-random player vs drifted house: EV per duel -1.708C, win rate 49.76%
```

- **Why the leak is structural:** the equilibrium mix already *underweights* the house's own affinity (0.278 vs 0.361 — `skill-evidence.js`) because affinity-amplified rounds are double-edged. The 3% session drift, once identified, hands the exploiter rounds that pay **+169** (both affinities engaged, 100·1.3·1.3) against losses of **−130** — the drift converts a balanced matchup into a positive-expectation farm that the flat 5% win-rake cannot tax away. Meanwhile honest players pay ≈ −1.7 to −1.9C/duel: **the rake is calibrated for non-exploiters and the exploiter simply isn't one.**
- **Compounding:** PvE has no floor rule and zeroed opponents are replaced fresh (R57), so the farm never runs out of counterparties; the upper range bound (2× player stake) *scales the farm with the player's bankroll*; PvE stake feeds bracket entries (F-9). **(f3 note, R57-internal conflict:** for a *sub-floor* player the shipped range collapses to `[floor, floor]` — the floor-as-lower-bound clause wins over the 2×-stake upper bound (`pve.js#generatePvEOpponent`, documented at f1/A5 and recorded as `CONFLICT-R57-INTERNAL` in the decision graph). This pins a sub-floor exploiter against opponents *larger than 2× their own stake* — the same larger-house-opponent geometry as this finding's worst measured cell (player 100C vs house 150C), so the collapse changes which cell a sub-floor farmer occupies, not the sign of the leak this script measures.)
- **Feasibility:** high — tendencies are *deliberately readable* (R26(5), R80 posts tendency cards), and a 3% drift on ~1/3 baselines is identifiable in a few dozen observed house rounds (the house's five moves per duel are all observed at reveal).
- **Proposed reproduction (product-level):** scripted client: observe one session's house rounds, χ² the drift element, then best-respond with matching affinity; measure C/hour.
- **Fixes to evaluate (all are R85 data, console-tunable between runs):** (i) shrink drift ≤1% and re-run this script; (ii) re-roll the drift element per *opponent* rather than per session; (iii) dynamic PvE rake or a per-session PvE net-win cap; (iv) house plays the exact win-game equilibrium (see F-11) with zero drift and the "tendency" becomes presentation-only. Each preserves R57's letter to different degrees — the choice is an owner ruling (node `P-DRIFT-CONSTRUCTION`).
- **Retest plan:** rerun `pve-exposure.js` with the tuned parameters (one-line change), then the product-level script against the sandbox; acceptance: worst-cell exploiter EV ≤ 0 net of rake, honest-player EV within its current band.

### F-9 · Big-stack farming of floor-stake brackets · severity MEDIUM-HIGH · feasibility MEDIUM (analysis + `properties.js` table)

The transfer formula is sharply asymmetric in stakes (committed output, floor 0 to isolate the formula):

```
p_winner p_loser | tr@r=0.5 (%loser) | tr@r=1.0 (%loser)
     100     100 |        50 (50.0%) |       100 (100.0%)
     100    5000 |         5 (0.1%)  |       700 (14.0%)
    5000     100 |        91 (91.0%) |       100 (100.0%)
```

A 5,000C character entering a T0 bracket (minimum stake = floor = 50C, R55 — **no maximum is specified**) against fresh 100C characters wins ~91–100% of the victim's stack on a win but loses ~5C on a moderate loss (loser-side exponent cp2/cp1 = 7 after the clamp). Win rate stays 50% vs equal skill (R54 — verified), so EV ≈ +43C per duel against 100C opponents at trivial downside — a **fairness griefing loop**, not a house drain (zero-sum vs other players), and exactly the experience that kills replay-after-loss in the victims. With F-8 supplying cheap big stacks, F-9 is its bracket-side laundering of unfairness into the gate metrics.
- **Fix:** cap bracket entry stake per tier (e.g., ≤ entry par × k, mirroring the PvE upper bound's logic) or band brackets by stake; both are data (R85) and arm-neutral.
- **Retest:** rerun the table under the cap; product-level: distribution of stake ratios in seated brackets.
- **Note:** the 7× clamp does bound the *whale's own upside* per duel (max extraction 7× the smaller clamped stack at ratio 1.0 — the 700 in the table) — the clamp works as designed; the leak is the loser-side exponent, not the cap.

### F-10 · Floor-drain (zero-out) rate — intended, confirmed · severity: none (documented property)

```
[R55] T0 equal 100C stacks, floor 50C, uniform-random play: zero-out on 58.2% of decided duels (ties 0.4%; PRD R55 states ~57% intended)
```

Our independent implementation reproduces the PRD's intended ~57% within simulation error — the documentation's numbers cohere. Recorded so nobody "discovers" this as a bug later: **more than half of decided equal-stack T0 duels end in a full drain, by design** (the 2× floor formula remains ASSUMED/under-test per R55).

### F-11 · Affinity-matchup value asymmetry · severity LOW (advisory) · feasibility n/a

Solving the *win* game exactly as a finite zero-sum game (243×243 deterministic payoffs, `win-game-equilibrium.js`): same-affinity matchups solve to value ≈ 0 (residual exploitability 0.32 win-pts/100 at 4×10⁶ fictitious-play iterations), but **Fire-vs-Water solves to a nonzero value bracketed at +1.6 to +2.5 win-points per 100 duels for the Fire-affinity side**. If an exact LP confirms it, cross-affinity duels are not exactly fair coin flips even between perfect players — small, but R52's skill posture ("outcomes decided entirely by the committed moves") deserves the exact number in the register, and seeding/matchmaking may want affinity balance. Proposed node `P-EQ-ASYMMETRY`. Also of note: the *expected-score* equilibrium (the natural reading of R57's "equilibrium mix") is itself win-rate exploitable by ~2.9 points (51.14% vs 48.25%, `skill-evidence.js`) because expected score ≠ win probability — one more reason `P-DRIFT-CONSTRUCTION` must pin which equilibrium the house plays.

---

## 3. Skill-evidence pack (AC3: benchmark populations)

Committed outputs, `skill-evidence.js` and `win-game-equilibrium.js` (2×10⁶ duels/cell, seeded):

| Matchup (both Fire affinity unless noted) | Win % | Loss % | Tie % |
|---|---:|---:|---:|
| uniform-random vs expected-score equilibrium | 49.83 | 49.68 | 0.49 |
| expected-score equilibrium vs itself | 49.74 | 49.75 | 0.51 |
| best-exploit (pure Water) vs expected-score equilibrium | 51.14 | 48.25 | 0.62 |
| best-exploit (pure Water) vs uniform-random | 60.54 | 39.05 | 0.41 |
| best-exploit (pure Water) vs leaky habit [0.50 F, 0.25 W, 0.25 A] | **82.61** | 17.29 | 0.10 |

Analytic reading, per the AC3 populations: **uniform-random** is nearly unexploitable in *win rate* by pure strategies (60.5% is the ceiling, driven by affinity amplification, not round wins) but pays through score magnitudes; the **equilibrium policy** (win-game version) is unexploitable within 0.32 pts/100 (same-affinity); the **best exploit found** is against human-like habits — a 50%-favorite-element player loses 82.6% of duels to a counter-player. That last row is the game's skill claim (R52) *demonstrated*: reading tendencies is worth +32 points of win rate, which is precisely what the tendency cards (R81) and scouting reports (R26(1)) sell. House-play controls for the run must disclose which policy NPCs run (R51) — these tables are the disclosure's benchmark numbers.

## 4. Security review pointers (ledger APIs, console auth, secrets) — premise refreshed at f3

**The t2 premise ("no implementation exists in this ticket's checkout to review") is stale and removed:** the integrated head carries the full app. What the implementation's existence lets us say by reading (f3), and what still stands open:
- **Ledger mutation integrity:** every ledger-touching `Game` method now runs behind the kill-switch guard (`isKilled()` → `KillSwitchFrozenError`) and deterministic idempotency keys with check-before-compute (see F-6/F-7 above) — the R83 pattern is now real, not just specified.
- **Kill paths (AC0):** two genuinely independent paths exist — the console action and the `?kill=1` URL parameter on the participant app (`app/ui/app.js`), the latter touching no console code. Verified present.
- **Console authentication: none exists** — the console is reachable by URL in this client-only artifact (documented in `app/README.md`); there is no server, no accounts, no secrets in the artifact, so "console auth" is a *deployment-time* obligation, not a present defect: the shipped run is single-operator on the owner's own device. Recorded obligation for the delivered machine: console behind owner identity.
- **Secrets/IaC:** nothing to review — the artifact holds no credentials (confirmed by reading; also `docs/disclosure.md` §4). The IaC-vault and platform-token-scoping rows (AC0 handover) attach to the real deployment and remain **uncertain after this budget by definition.**

## 5. The three-way classification (AC3 requires the register to distinguish these)

**Established by mechanics (provable from the math, model-side verified):**
- Transfer ≤ loser's pre-duel stake; zero score transfers nothing; win rate independent of stake (R54/R86.1/4/5 — 10⁶-duel sweep, 0 violations).
- Laundering haircut ≥50% at T0 with no real-money exit in this run (R58/R68/invariant 1).
- The 7× clamp bounds single-duel extraction at 7× the smaller clamped stack.
- T0 equal-stack zero-out ≈ 58% under uniform play (matches the PRD's intended ~57%).
- Skill headroom: +32.6 win-points for a counter-player vs a leaky habit; ≤0.32 pts/100 exploitability of the solved same-affinity equilibrium.

**Established by reading/testing the implementation (new tier at f3 — the code now exists):**
- F-7 replay/double-fire: closed by deterministic intent keys + check-before-compute, regression-tested in the shipped suite (was POSITIVELY PRESENT at review — C1).
- F-6 cross-tab lost-update: PRESENT by construction (whole-array persist, per-instance cache, no lock); bounded by the single-device design; critical for any server build.
- R43 anchor semantics (F-3's lever): implemented as specified after the C4 fix — a bracket containing a hesitated duel anchors neither combatant.
- Model↔product agreement: `docs/risk-sims/r53.js` and `app/engine/duel.js` agree across ≥10k random cases (`app/tests/cross-check-r53.test.js`) — this dossier's §2/§3 numbers attach to the shipped engine, not just our model.

**Needs executed tests (cannot be settled from spec or code reading):**
- F-6's two-tab lost-update demonstration harness; any server build's true concurrent-write behavior.
- F-5(c) window-edge commits under real clocks (server build only — this artifact has no server clock).
- F-1 screener false-accept/false-reject rates (synthetic agent cohorts, AC0).
- F-2 same-bracket seeding rates under scripted joins (and the seat-randomization fix).
- Product-level confirmation of F-8's C/hour and of any drift/rake retune.

**Uncertain after this budget:**
- Whether R57's TESTED tag and our F-8 result describe different house constructions (CONFLICT-R57-EVIDENCE; owner ruling `P-DRIFT-CONSTRUCTION` required).
- Exact win-game values for all 9 affinity pairings (F-11; LP solve proposed).
- Deployment-time security (console behind owner identity, IaC vault, token scoping — see §4), the 100× scale proof, and adaptive-agent search beyond pure/equilibrium policies — named as remaining AC3 scope for the machine delivery, not silently dropped.
