# Tunables Workbook — reference rendering (R85)

**Ticket t2 · task 85baf1fc · 2026-09-10 · revised f3 (truth pass against the f1/f2-fixed code).** The machine-readable workbook is **`docs/tunables-workbook.csv`** (93 rows, one per shipped value or value family; rows W-88…W-93 added at f3 for values f2 introduced); this document is its readable rendering plus the notes the CSV points at. R85's contract: *everything a person could want to adjust after delivery lives in data the system reads*, and this workbook *reproduces every shipped value so we can retune by hand* — the AC0 test ("a hand edit propagates to the running system") binds the delivered machine (t1+), not this reference document; this document is the reproduction half of that contract, and every value here is quoted with its rule id so a reviewer can trace it to `docs/PRD.md`.

**Enforcement legend (R85 requires the distinction per value):**
- **enforced-by-system** — the running system reads the value and mechanically enforces it (duel math, timers, fees, caps frozen at pre-registration, gate computation).
- **held-as-policy** — a target, planning figure, derived quantity, or judgment bar people hold (design targets like "bracket in 6–9 minutes", planning figures like ~$70/completer, derived rates like the ~57% zero-out).

## The values, grouped (full detail in the CSV)

### Duel math (R53–R55) — all enforced-by-system
| Value | Shipped | Note |
|---|---|---|
| Round weights | [78, 79, 81, 86, 100] (sum **424**) | W-1/W-2 |
| Affinity multiplier | **1.3**, floor() after multiply, win or lose | W-3 |
| Power clamp | **7×** | W-4; bounds single-duel extraction |
| Floors T0…T6 | **50 / 50 / 500 / 500 / 5,000 / 5,000 / 50,000** C | W-6…W-12; full drain under floor; true tie exempt |
| Floor formula | 2 × tier re-entry bonus | W-5 — the formula is **held-as-policy** (ASSUMED hypothesis under test, R55); the floor *values* are enforced |
| Min bracket stake | = tier floor | W-74; **no maximum specified** — risk finding F-9 proposes a cap as new data |

### Economy (R58, R62–R63, R66–R68)
| Value | Shipped | Enforcement | Note |
|---|---|---|---|
| Peg | 20 CHEDDAR = $1, fixed | system | W-57; role nouns rename the unit per treatment, constants identical |
| Summon | $10 → 100C (cashout value $5) | system | W-58 |
| Signup grant | $25 play CASH | system | W-59 |
| Cashout | 20:1, sole retirement path **for a stake-holding character** (an emptied 0C character retires to the ledger, R61) | system | W-60; `CONFLICT-R60-R61` in the decision graph; f1 fixed the player-visible copy |
| Tier prizes T0…T6 | $20 / $25 / $100 / $500 / $10,000 / $100,000 / $1,000,000 (400C … 20,000,000C) | system | W-14…W-20; T0–T2 TESTED in the slice, T3–T6 ASSUMED |
| **T6 payout method** | "$999,999.92 CASH plus battle stake at 20:1" | **system** (f3) | **Note W-13:** the code now pays **as written** — `economy.js:bracketWinOutcome` + `tunables.tierLadder.tiers[6].payout` pay $999,999.92 CASH plus the champion's stake at 20:1, no minted Cheddar (f1/C2). The arithmetic note stands: 20,000,000C at 20:1 = $1,000,000.00 exactly; the stated $999,999.92 leaves **$0.08 unexplained**. Both figures reproduced verbatim; open node `P-T6-PAYOUT`; ledger conservation (R86.2) balances to the cent at the implemented figure. |
| Re-entry fees/bonuses T0…T6 | $5+25C / $15+25C / $77.50+250C / $400+250C / $2,500+2,500C / $12,500+2,500C / $62,500+25,000C | system | W-21…W-27 |
| **Full play-through rake** | **6.3%** | **policy** | **Note W-29:** stated aggregate (R63); it is not independently derivable from the fee/prize tables without a behavior model (how often players re-enter per tier), so the system cannot enforce it — it can only be *realized*. The run report should state the realized play-through rake beside the 6.3% target. Open node `P-63-RAKE-DERIVATION`. |
| PvE rake | 5%, on wins only | system | W-64; see risk F-8 — insufficient against a perfect drift exploiter as constructed |

### PvE (R57) — all enforced-by-system
Session drift **3%** toward one element (W-61 — risk F-8/`P-DRIFT-CONSTRUCTION` attached); opponent range **tier floor … 2× player stake** (W-62); hard cap **1.5× entry par** of highest eligible tier (W-63); zeroed opponents **replaced** with new tendency (W-65); floor rule absent.

### Timers, cadences, sync (O5, O6, O9; R75, R80–R81)
| Value | Default | Alternatives built | Enforcement |
|---|---|---|---|
| Commit window (O5) | **60s** | 45s, 90s | system (W-33) |
| Lobby human wait (O6) | **30s** | 60s, 120s | system (W-34) |
| Reveal cadence (O9) | **1170ms/round** | 900ms, 1500ms | system (W-37) |
| NPC join delay | 2–10s | — | system (W-41) |
| NPC commit delay | 10–45s | — | system (W-42) |
| Lobby countdown | 30s | — | system (W-43) |
| Intermission | 20–30s | — | system (W-44; f3: now actually wired into the duel flow — f2/A4, was dead code at review) |
| Tug-of-war bar hold | 1s before round 1 | — | system (W-70) |
| Reveal skippability | after first full playthrough per session | — | system (W-76) |
| Whole duel | < 45s | — | **policy** (W-66 — design bar; the cadence values are what the system enforces) |
| Complete bracket | 6–9 min | — | **policy** (W-67) |
| Hesitate-rate bar | ≤ 10% | — | **policy** (W-68 — the pacing judgment O5 alternatives are read against) |

### Presets & Narrator (O8, O10; R67, R72–R73)
Load Funds presets default **entry fee, 10×**; alternatives **entry, 5×** and **entry, 10×, 50×** (W-36, system). Narrator temperature **0.7** (alternatives 0.5, 0.9 — W-38), max **200 tokens** (W-39), banned-token strip/regenerate **once** then static fallback (W-71), specificity regenerations **≤2** (W-72), **8s** timeout to fallback (W-73) — all system-enforced. One call per duel at resolution (R72).

### Gate thresholds & statistics (R51, R28, R21)

**One source (f3/C9 — enforced-by-system is now literally true):** every threshold and the sequential rule below are read from `tunables.json`'s `gate` key via `engine/gate.js:deriveGateConfig()` (plus a console `gateOverrides` patch layer) — the same derivation feeds gate classification, `runSimulator.js`'s pre-registration text, and the console display, so a hand edit propagates to all three (the AC0 workbook test).

| Value | Shipped | Enforcement | Note |
|---|---|---|---|
| Reservation rate | **≥ 35%** of first-bracket completers | system (computation) | W-46; owner setpoint fixed before data; the *verdict* is confirmed/overruled in console (R23) — that judgment is policy by design |
| Replay-after-loss | ≥ 50% | system | W-47 (two-of-four block, ASSUMED extensions) |
| Brackets in 48h of anchor | ≥ 2 | system | W-48; PvE dilution reported beside it |
| D1 return | ≥ 40% | system | W-49 |
| First-bracket completion | ≥ 50% of qualified activations | system | W-50 |
| Cost per reservation | ≤ **$100** default, console-set | system | W-51; frozen at pre-registration (A2) |
| Expected interval | **±13 pts at 35%, N≈50** | policy | **W-45, reproduced:** 1.96·√(0.35·0.65/50) = **13.2 points** ✓ (normal approx). f3/C11: the system now also **computes** the expected Wilson score 95% interval at max N from the setpoint (pre-registration) and states the interval **reached** at close (console verdict card) |
| D7 threshold | 30% (definition R47) | policy | W-69; ungated diagnostic in this run — owner expects near zero in play money (R51) |
| Sequential stopping rule | **real Lan-DeMets O'Brien-Fleming-type alpha spending** (one-sided, α = 0.05, information fraction = completers/maxN 50, planned looks 15…50, futility = fixed z −0.5, Pocock fallback implemented) | system | W-85/W-93; `engine/alphaSpending.js`, read from `tunables.gate.sequentialRule`; **documented limitation:** normal-approximation marginal boundary, not the exact recursive multivariate Lan-DeMets integral (stated in the module header and on every console surface) |
| Contamination | estimated, denominator whole | system | W-81; the F-3 hesitation share is a named line |

### Caps & envelope (R6, A2, R19)
Spend **$5,000** (W-52) · ceiling **14 days** from first enrollment (W-53) · gate cell **≥70% of spend** ≈ 50 completers (W-54) · door split default **2 theme + 3 price arms at equal caps** (W-55) · per-arm caps console-set, frozen at pre-registration (W-56) · advance **band rule** with $10/incumbent as tie-holders (W-87) — all enforced-by-system. Planning figure **~$70 per completer** (W-79) and the owner's **2h/week** labor budget (W-78) are policy.

### Defaults switchable in console (O1–O4)
Theme default **incumbent**, alternates = the R16 picks **Scrapyard Kings** (adjacent) and **Undercard** (far) (W-31); price default **$10** with under/over/free door arms (W-30); legs hypothesis default **manifest order R26**, all six built (W-32 — **verified against code at f3**: f2 built all six behind the O3 console switch, `engine/hypotheses.js`; the t2 claim predated the build and was flagged C13); run activation **console action** (W-40).

### Door-yield layer (R22, added f2/C12 — rows W-89…W-92, new at f3; corrected at f4/N5; wording corrected at f5/crucial-3)

Lead band **0.15** (W-89 — the pre-registered band rule is real: `runSimulator.js:classifyDoorYieldWinner` names a winner only when its door-yield lead over the runner-up exceeds the band, else the incumbent/$10 tie-holders stand, W-87) · impressions model: click rate **4.5%** of impressions (W-90, read as-is, unchanged), baseline intent-click share **5.2%** of clicks (W-91, anchored to R30) · cost per intent click **$6.63–7.00** (W-92, R30's wave range — the ENFORCED figures are the 5.2% parameter and the CPM derivation below; a per-seed reported cost varies around this range, see the f5 correction). **f4/N5 correction**: at f3, W-91 was labeled enforced-by-system but had ZERO code readers — the simulator instead derived intent clicks from spend ÷ a fixed per-arm cost-per-intent-click, implying a silent ~2.6% intent rate that disagreed with W-91's own 5.2%. The model now genuinely reads W-91: `dayIntentClicks = dayClicks × intentClickPctOfClicksBaseline × arm.doorYieldBiasMultiplier` (the per-arm bias multiplier moved from the cost side to the rate side — same multiplicative effect, now applied to the number the workbook actually names). `costPerIntentClickUSD` (W-92) is now the DERIVED, reported quantity (`cumSpend ÷ cumIntentClicks` per arm) rather than an independently-read constant; its midpoint is used the other direction, exactly once, to derive CPM (`runSimulator.js:deriveCpmFromDoorYieldTunables` — `CPM = costPerIntentClickMidpoint × 1000 × clickRate(W-90) × intentRate(W-91)`). **f5/crucial-3 correction**: the gate-cell (bias 1.00) arm's derived cost-per-intent-click reproduces this $6.63–7.00 range **in expectation** ($6.815 mean by construction) — NOT "exactly, by construction" on every run, as an earlier round's wording here claimed. f4/A-c's per-day binomial sampling noise means any one seed's REPORTED figure varies around that mean: measured over 400 seeds, mean $6.805, min $5.952, max $7.592, with the shipped default seed (20260910) itself reporting $6.446 (5.409% intent rate) — outside the $6.63–7.00 range — and ~57% of the 400 seeds swept landing outside it. What the system actually enforces is the W-91 5.2% baseline parameter and the CPM derivation identity, not any particular per-seed reported range. All four numbers (CPM, W-90, W-91, W-92) remain **labeled ASSUMED synthetic model** per f2's notes — no live ad platform exists in this artifact; the per-arm bias-multiplier table (`runSimulator.js:armDefinitions`) is a documented placeholder for real door data; CPM specifically has no workbook row of its own (a bare code constant, out of the W-89…92 bounded scope) and is derived rather than independently hand-picked precisely so it never again drifts out of step with the three numbers that ARE named here.

### Procedural NPC drift (C20 — row W-88, new at f3)

The bracket-NPC procedural fallback's tendency drift now reads `tunables.pve.driftPerSessionPct` (**3%**, W-88) — at review it hardcoded an independent 10% that disagreed with R57's 3% (crucial C20); one shared value, enforced-by-system.

### Design frame & interaction constants (R79, R83)
Grid texture **32px at 5–6%** (W-82); touch targets **≥44×44pt, ≥8pt spacing** (W-83); press acknowledgment **1 frame / busy within 100ms / p95 ≤100ms** (W-84); per-treatment palette values and hero faces are data (W-86): incumbent = R79's values (air **#B0B0B0** from the bundle CSS `--cb-air`) + Pirata One; SK and UC = the palette blocks in `docs/concept-cards.md` cards A1/F1.

### Derived quantities recorded so nobody retunes them directly
T0 equal-stack zero-out ≈ **57% intended** (58.2% in our model-side sim, `docs/risk-sims/properties.js`) — a consequence of W-1…W-6, not a knob (W-80).

## Coverage check against the order and R85

Duel weights ✓ (W-1) · affinity 1.3 ✓ (W-3) · 7× cap ✓ (W-4) · floors + 2× formula ✓ (W-5…W-12) · tier ladder R62 ✓ (W-13…W-20) · re-entry R63 ✓ (W-21…W-28) · rakes 5% PvE and 6.3% ✓ (W-64, W-29) · PvE drift/ranges ✓ (W-61…W-65) · timers O5/O6/O9 with alternatives ✓ (W-33/34/37) · presets O8 ✓ (W-36) · Narrator temperature + 200 tokens ✓ (W-38/39) · NPC join 2–10s / commit 10–45s ✓ (W-41/42) · gate thresholds R51 incl. $100 cap default ✓ (W-46…W-51, one source per C9) · R28 interval note ✓ (W-45) · caps ✓ (W-52…W-56) · alpha-spending parameters ✓ (W-85/W-93) · door-yield band + impressions model ✓ (W-89…W-92, ASSUMED synthetic) · procedural NPC drift ✓ (W-88) · per-value enforcement stated ✓ (every CSV row; the enforced-vs-policy column re-verified against the code for every row touched at f3).
