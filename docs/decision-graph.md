# Decision Graph — readable rendering (AC2)

**Ticket t2 · task 85baf1fc · 2026-09-10 · refreshed f3, f4.** This document renders `docs/decision-graph.json` (the machine-readable graph is authoritative). Every load-bearing decision carries **authority** (constraint / ours / provider), **evidence** (tier: tested / configuration-tested / assumed; kind; source), and **status** (proposed / accepted / superseded). Per R87 and AC0, conflicts sit at the top. **f3 refresh (AC2 — "the graph updates itself as phases run"):** the four conflicts the verification review found undeclared (C21) are added as completed results at the top; the fix rounds' load-bearing decisions are recorded as nodes (§"Fix-round decisions"); statuses and counts corrected where fixes obsoleted the t2 text. **f4 addition (A-j):** the R58-vs-R19 door-price conflict (item 1 below) -- previously recorded only as decision node `D-PRICE-ARM-CHARGE`, now ALSO declared as the R87 conflict it actually resolves.

---

## ⚠ Conflicts (R87) — at the top, as required

**Were any found? Yes — eight.** Declared at t2: one law conflict, one evidence conflict, one data discrepancy (items 6–8 below). Added at f3 (found undeclared by the verification review, C21): three law conflicts and one internal-rule conflict, each **delivered as a completed result** (items 2–5). Added at f4 (re-probe v1b/A-j): one law conflict (R58's literal accounts arithmetic vs R19's door-price law), delivered as a completed result (item 1).

| # | Conflict | Laws | Status |
|---|---|---|---|
| 1 | CONFLICT-R58-R19-DOOR-PRICE | R58 vs R19 | accepted (delivered configuration; declared f4) |
| 2 | CONFLICT-INV1-R57-RAKE | §15.1 vs R57 | accepted (delivered configuration; declared f3) |
| 3 | CONFLICT-R60-R61 | R60 vs R61 | accepted (copy fixed f1; declared f3) |
| 4 | CONFLICT-R12R13-LITERAL-STRINGS | R12/R13 vs R56/R61/R67/R77 | accepted (documented f3) |
| 5 | CONFLICT-R57-INTERNAL | R57 vs itself (sub-floor PvE) | accepted (declared f3; revisitable) |
| 6 | CONFLICT-R71-R12 | R71 vs R12/R13 | resolved (implemented; sign-off pending) |
| 7 | CONFLICT-R57-EVIDENCE | R57's TESTED tag vs our re-test | proposed (owner ruling needed) |
| 8 | NOTE-T6-PAYOUT | R62 vs R58 arithmetic | proposed (code now pays as written) |

### 1. CONFLICT-R58-R19-DOOR-PRICE — law conflict (R87) · status: accepted, delivered configuration (declared f4)

| | |
|---|---|
| **Laws** | R58 vs R19 |
| **Condition** | Any door-price arm other than the incumbent $10 default (O2's under/$5, over/$25, or free/$0 arms) |
| **The conflict** | R58 states the accounts law **literally**: *"Summon $10 → 100C (immediate cashout value $5; the gap is the price of competing for the prize)."* R19's door-price law makes the entry price a **per-arm variable**: *"A player arriving through a door arm plays the treatment and the price their door showed."* Read literally, R58 fixes the summon price at exactly $10; R19 requires it to be whatever the active price-door arm displays. Both cannot hold at once under the $5, $25, or $0 arms — R58's literal "$10 →" clause and R19's "the price their door showed" directly disagree on what a summon costs. |
| **Evidence** | `docs/PRD.md` R58 ("Summon $10 → 100C") vs R19 ("A player arriving through a door arm plays the treatment and the price their door showed"); `app/engine/game.js:summonCharacter` (reads `tunables.priceDoorArms.displayedEntryPriceDefaultUSD`, the active O2 arm, not a hardcoded $10); `app/engine/overrides.js:effectiveTunables`'s O2 patch; `app/tests/price-arm-summon-charge.test.js` (f2/C15). |
| **Delivered configuration** | **The door-price law wins on price; R58's stake/peg arithmetic wins on everything else.** Each price-door arm CHARGES exactly what it displays ($5/$10/$25/$0, per O2) — R19's door-price semantics honored literally, "the price their door showed" is the price actually charged, no display-only arm. R58's OTHER two clauses stay exactly as written regardless of arm: the summon always mints the same **100C** stake (never scaled by price), and the **20C = $1 peg is fixed** — it holds EXACTLY only at the $10 default arm (where $10 -> 200C-worth-of-peg vs a 100C mint is the R58-stated "immediate cashout value $5" gap); at any other arm the charged price and the minted stake's dollar-equivalent diverge further, an honest, unavoidable consequence of R58's fixed peg once R19 makes the charged price itself variable. This is the SAME delivered configuration already implemented and tested as decision node `D-PRICE-ARM-CHARGE` (f2/C15) — recorded here as an R87 conflict (it was previously only a decision node, not declared as resolving a law conflict) at the same completed-result shape as the other seven. |

### 2. CONFLICT-INV1-R57-RAKE — law conflict (found by review, C21) · status: accepted, delivered configuration


| | |
|---|---|
| **Laws** | §15.1 (invariant 1) vs R57 |
| **Condition** | Any PvE duel the player wins (the 5% winner-side rake applies) |
| **The conflict** | §15.1: *"the winner's gain equals the loser's loss"* for every resolved duel. R57 rakes 5% off the winner's side in PvE. On net numbers both cannot hold: the winner's credit differs from the loser's loss by exactly the rake. |
| **Evidence** | `docs/PRD.md` §15.1 vs R57; `app/engine/pve.js:resolvePvEDuel` (`playerDelta = transfer − rakeTaken` on wins; `opponentDelta = −transfer`). |
| **Delivered configuration** | **Gross-vs-net semantics.** Invariant #1 holds on the **gross** transfer at the duel-math layer — `resolveDuel` returns one signed transfer, so gain = loss by construction there, and that is exactly what `app/tests/invariants.test.js` #1 asserts (transfer ≤ loser's pre-duel stake; *"winner's gain equals loser's loss by construction (single signed transfer)"*). The PvE layer then credits the winner **net** of the rake and ledgers `rakeTaken` explicitly, so conservation (#2) still balances — `projection.js` sums current stake + rake taken + cash-outs + PvE outflow, tested across randomized brackets and PvE sessions. The rake is an explicit, ledgered house take between gross and net, never a silent #1 violation. |

### 3. CONFLICT-R60-R61 — law conflict (found by review, C21) · status: accepted, copy fixed f1

| | |
|---|---|
| **Laws** | R60 vs R61 |
| **Condition** | A character whose stake has reached 0C |
| **The conflict** | R60: *"Cashout is the sole path to retirement."* R61: the emptied character's single action is **RETIRE TO THE LEDGER** — a retirement with nothing to cash out. Both cannot hold at 0C. |
| **Evidence** | `docs/PRD.md` R60 vs R61; the emptied-character check in `app/engine/economy.js`; f1 commit `2cb154e`. |
| **Delivered configuration** | Cash-out's exclusivity **scoped to stake-holding characters**. f1 fixed the player-visible copy in all three treatments — the incumbent's `cashOutBody`, verbatim: *"Convert this Wizard's stake to CASH at 20:1. The Wizard retires. This is the only way to retire a Wizard that still holds a stake — an emptied (0C) Wizard retires to the ledger instead."* (adjacent/far carry the same sentence over their own role nouns; regression-tested in all three). R61's card line *"Holds nothing. The ledger will take the name."* ships verbatim. |

### 4. CONFLICT-R12R13-LITERAL-STRINGS — law conflict (found by review, C21) · status: accepted, documented f3

| | |
|---|---|
| **Laws** | R12 ("all in-frame copy is theme-bound") + R13 ("differs in every theme-bound element") vs R56/R61/R67/R77's prescribed literal strings |
| **Condition** | Any non-incumbent treatment rendering the PRD's exact-wording UI strings |
| **The conflict** | An alternate cannot both differ in *every* copy element and reproduce the literals the PRD prescribes: R77's result headers **CLAIMED**/**DRAINED**, R56's **DUEL WON**, R67's Load Funds heading *"PLAY CASH ONLY · How much would you like to deposit?"*, R61's **RETIRE TO THE LEDGER** / *"Holds nothing. The ledger will take the name."* |
| **Evidence** | `docs/PRD.md` R12/R13 vs R56/R61/R67/R77; `app/data/treatments/mapping.json` `fixedAcrossEveryTreatment`. |
| **Delivered configuration** | The t3 build resolved this in `mapping.json` but never declared it — recording it here makes it an R87 result instead of a silent choice. Three named string families are held **identical across treatments**, scoping R13's "every theme-bound element" to the R12 set minus: **(1) mechanicalVocabulary** — generic engine/state words that are not one of the four role nouns (`duel`, `bracket`, `round`, `tier`, the SITTING heading, the ledger concept including R61's lines, NPC/HESITATED tags — the same way R71 fixes "Round" inside the Voice rules); **(2) law-literalUIText** — strings the PRD prescribes by exact wording (the R77/R56/R67 literals above); **(3) genericChrome** — copy with no theme-bound token in the incumbent's original (cash-out/wallet/withdraw/reserve headings, money truth badge, screener questions, tie lines, tag labels), kept identical rather than manufacturing difference. `treatments-schema.test.js` + the R1/R73 scans pin the result. |

### 5. CONFLICT-R57-INTERNAL — R57 vs itself (surfaced f1/A5) · status: accepted, revisitable

| | |
|---|---|
| **Law** | R57 (three of its own clauses) |
| **Condition** | A **sub-floor** player entering PvE (stake below the tier floor — reachable after a drain, before a rebuild) |
| **The conflict** | R57 states (a) opponent-range upper bound = **2× the player's own stake**, (b) lower bound = **the tier floor**, and (c) *"below the tier floor the player rebuilds through PvE"* — implying beatable opponents near the player's small stake. For a sub-floor player, (a) sits **below** (b): the clauses cannot all hold. |
| **Evidence** | `docs/PRD.md` R57; the source comment at `app/engine/pve.js:generatePvEOpponent` (f1/A5); `app/README.md` f1 notes. |
| **Delivered configuration** | **The floor wins** — R57 states the floor clause without a sub-floor carve-out, so the literal lower bound prevails and the range **collapses to [floor, floor]** (a 20C player at T0 faces exactly-50C opponents). Left as shipped; documented, not resolved, at this authority. **Exploit-exposure interaction** (measured by the risk dossier's PvE-exposure finding F-8): the collapse pins a sub-floor exploiter against opponents larger than 2× their own stake — the same larger-house-opponent geometry as F-8's worst measured cell (player 100C vs house 150C) — so it changes which cell a sub-floor farmer occupies, not the sign of the leak. Revisitable under `P-DRIFT-CONSTRUCTION`'s owner ruling. |

### 6. CONFLICT-R71-R12 — law conflict · status: resolved (implemented; owner sign-off pending)

| | |
|---|---|
| **Laws** | R71 vs R12/R13 |
| **Condition** | Any non-incumbent treatment (the adjacent and far arms, R17) |
| **The conflict** | R71 fixes the Narrator **discipline lines verbatim in every treatment** — but two of those verbatim lines contain incumbent theme-bound vocabulary: *"'Cheddar transferred' not 'coffers depleted'"* (Voice rules) and *"Never address the wizard directly."* R12 makes world nouns and role nouns **theme-bound**; R13 requires an alternate to **differ in every theme-bound element**. Under any alternate treatment, the three laws cannot all hold: a verbatim discipline block imports incumbent nouns into a skin that must not contain them. |
| **Evidence** | `docs/PRD.md` R71 ("Discipline lines, verbatim in every treatment: … the Voice rules from 'Round is acceptable' through 'The ledger is permanent'"); the shipped prompt's two quoted lines; R12/R13 text. |
| **Law-preserving configuration (delivered)** | Hold every discipline rule **semantically verbatim**; substitute only role nouns through the R13 mapping recorded in this graph — SK: *"SCRAP transferred"*, *"Never address the bot directly"*; UC: *"PURSE moved"*, *"Never address the fighter directly."* **f3 status update:** this configuration is now **implemented** — `app/data/treatments/mapping.json` carries the substitution table and `app/tests/narrator-prompt-compose.test.js` pins it (Format/Content blocks byte-identical across treatments; Voice differs only at the two recorded lines). Owner sign-off still requested via node `P-R71-NOUN-MAP` (A3 console decision). |

### 7. CONFLICT-R57-EVIDENCE — evidence conflict (not a law conflict) · status: proposed

| | |
|---|---|
| **Law** | R57 (its TESTED tag) |
| **Condition** | PvE; a player who identifies the session drift element and best-responds with matching affinity |
| **The conflict** | R57 states *[TESTED: 3% drift and 5% rake hold house exposure bounded against a perfect exploiter in simulation]*. Our independent model-side re-test of the **literal construction** (house = equilibrium mix of the per-round expected-score game + 3% drift toward one session element) finds a perfect exploiter nets **+10.1C per duel on a 100C stack** (vs a 150C house opponent) **net of the 5% rake** — exposure grows linearly in duels, i.e. not bounded under this reading. Both statements cannot describe the same construction; the likeliest resolution is that the tested policy differs from the construction we inferred. |
| **Evidence** | `docs/risk-sims/pve-exposure.js` (output committed at `pve-exposure.out.txt`): worst cell = house affinity Water, drift Water, exploiter pure Air/affinity Air → player win rate 56.35%, EV +10.108C/duel; baseline equilibrium player EV −1.883C/duel. Full analysis: `docs/risk-dossier.md` finding F-8. |
| **Law-preserving configuration (delivered)** | Implement R57 exactly as written (LAW binds; drift and rake are R85 data, console-tunable between runs); carry the finding in the risk register with its reproduction script; any PvE-bearing pre-registration states the house construction explicitly (R51 requires house strength disclosed). Open question pinned as `P-DRIFT-CONSTRUCTION`. |

### 8. NOTE-T6-PAYOUT — data discrepancy (recorded for completeness) · status: proposed

R62 lists the T6 prize as $1,000,000 (20,000,000C) "paid as **$999,999.92** CASH plus battle stake at 20:1"; at the fixed peg (R58, 20C = $1) 20,000,000C is exactly **$1,000,000.00** — an unexplained $0.08. Trivial in dollars, load-bearing for R86.2 (ledger conservation balances to the cent). Both numbers reproduced verbatim in the workbook (note W-13); ruling requested via `P-T6-PAYOUT`. **f3 update:** the code now implements R62 **as written** — `economy.js:bracketWinOutcome` pays $999,999.92 CASH plus the champion's stake at 20:1 (no minted Cheddar; f1/C2, regression-tested), so conservation balances to the cent at the implemented figure; the $0.08 arithmetic question remains open.

---

## Node index

Legend: **A** = authority (C constraint · O ours · P provider) · **E** = evidence tier (T tested · CT configuration-tested · A assumed) · **S** = status (acc / prop / sup = superseded).

### Constraint spine (the PRD's LAW rules this pack hangs from)

| Node | Decision | A | E | S | Evidence kind / source |
|---|---|---|---|---|---|
| C-R1-BRAND | Cheeze Wizards strings/logo forbidden participant-facing | C | A | acc | Owner rule; R86.9 scan; all t2 content clean |
| C-R6-ENVELOPE | $5,000 / 14 days / gate cell ≥70% (~50 completers) / $100 cost-per-reservation default | C | A | acc | Owner envelope, re-cut 2026-09-09 (§19) |
| C-R8A-UPFRONT | Play money declared free on every money surface | C | T | acc | Validated test ran this way (R8a) |
| C-R11-FIXED-FRAME | Fixed set: mechanics, sync, contract, instrumentation, frame, faces, roles, discipline, message, pacing | C | T | acc | Message/faces tested in three waves (R11, §6) |
| C-R12-THEME-BOUND | Theme-bound set each treatment supplies in full | C | A | acc | Owner rule; the cards' checklist (R12) |
| C-R22-DOOR | Door yield primary for theme & price; band rule; incumbent tie-holder | C | T | acc | Validated fake-door read (R22, R30) |
| C-R28-INTERVAL | ±13 pts at 35%, N≈50, stated & reported | C | T | acc | Arithmetic reproduced: 1.96·√(.35·.65/50)=13.2 pts (W-45) |
| C-R30-CALIBRATION | One audience; *outsmart for real money*; 5.2% intent; ~$6.63–7/click; 57% same-session replay | C | T | acc | Three ad waves, spring–June 2026 (R30) |
| C-R51-GATE | Reservation ≥35% (owner setpoint) + two of four + cost cap | C | T | acc | Setpoint met at N=7; extensions ASSUMED (R51) |
| C-R53-MATH | Duel math: weights [78,79,81,86,100], affinity 1.3, 7× clamp | C | T | acc | Verified vs on-chain (PRD) + our model-side property checks (0 violations / 1e6 duels) |
| C-R55-FLOOR | Floor = 2× re-entry bonus; full drain; ~57% T0 zero-out intended | C | T | acc | Our sim reproduces 58.2%; the 2× formula itself stays ASSUMED (hypothesis under test) |
| C-R57-PVE | PvE: equilibrium mix + 3% drift; 5% rake on wins; ranges; no floor | C | T | acc | PRD TESTED tag **disputed** by our re-test → CONFLICT-R57-EVIDENCE |
| C-R58-PEG | 20C = $1 fixed; summon $10 → 100C | C | A | acc | Owner economic rule (R58) |
| C-R62-LADDER | Tier ladder T0 $10/$20 … T6 $1M | C | CT | acc | T0–T2 in tested slice; T3–T6 ASSUMED (R62) |
| C-R63-REENTRY | Re-entry fees/bonuses; 6.3% full play-through rake | C | A | acc | Stated constants; aggregate not independently derivable (→ P-63-RAKE-DERIVATION) |
| C-R65-SUBSTITUTION-COMPLETE | Shipped product + exactly R67–R69 substitutions | C | A | acc | Owner scope rule ("everything as it will be", §19) |
| C-R67-DEPOSIT-MOCK | Load Funds sheet, play-cash mock, full deposit logging | C | A | acc | Substitution point 1 (R67) |
| C-R68-CASHOUT-REAL | Cash Out real, 20:1, press-on-or-bank-it measured | C | A | acc | Substitution point 2; §19 ruling (R68) |
| C-R69-WITHDRAW | Withdraw opens play-cash-only sheet | C | A | acc | Substitution point 3 (R69) |
| C-R70-IDENTITY | Identity gates as shipped; screener in product | C | A | acc | R70 + AC0 estimate row; sybil surface (F-1) |
| C-R71-NARRATOR | Persona/register/examples theme-bound; discipline verbatim; call shape fixed | C | T | acc | Register praised in slice; XML fix tested → parent of CONFLICT-R71-R12 |
| O1…O10 | The ten open items, defaults + built alternatives (theme, price, legs, activation, commit 60s, lobby 60s, fill-to-8, presets, 1170ms, temp 0.7) | C | A | acc | PRD §5 table; workbook rows W-30…W-39 |

### Provider decisions (this ticket)

| Node | Decision | A | E | S | Evidence kind / source |
|---|---|---|---|---|---|
| D-RUBRIC-WEIGHTS | Weights 0.35/0.25/0.20/0.20, fixed before scoring | P | A | acc | Justified vs R4/R27; sensitivity in rubric §5 |
| D-CANDIDATE-SLATE | Seven candidates across six sourced territories | P | A | acc | Dossier: 55 distinct t2 sources (54 verified live) + 8 f3 additions serving the R14 source-type gap (dossier §7) |
| **D-THEME-ADJ** | **Top adjacent = SCRAPYARD KINGS (4.00)** | P | **A** | acc | R16 rubric over R14 dossier; **ASSUMED until the door race reads it** (R16/R18); brand acceptance still gates publishing |
| **D-THEME-FAR** | **Top far = UNDERCARD (4.60)** | P | **A** | acc | Same; strongest slate score; R17 record-keeper native |
| D-SK-SKIN | Complete SK skin (Bot/SCRAP/Golden Gear/Crusher; Black Ops One; scrutineer persona) | P | A | acc | R13 mapping recorded: Wizard→Bot, CHEDDAR→SCRAP, Big Cheese→Golden Gear, Blue Mold→Crusher |
| D-UC-SKIN | Complete UC skin (Fighter/PURSE/Belt/Cut; Alfa Slab One; commission scorekeeper) | P | A | acc | Mapping: Wizard→Fighter, CHEDDAR→PURSE, Big Cheese→Belt, Blue Mold→Cut |
| D-AIR-COLOR | Incumbent air value = #B0B0B0 | C | CT | acc | Bundle CSS `--cb-air` (globals.css:1427), per R79's pointer |
| D-CITATION-POLICY | All URLs status-checked; verified/stable marks; 404s discarded | P | T | acc | **Counts corrected f3 (A13):** t2 session 57 checked / 55 kept (54 live + 1 rate-limited) / 2 discarded — the t2 node's "59/57" was a miscount; dossier §6 and this node now agree. f3 session: +8 checked, 8 kept (dossier §7) |
| D-SIM-METHOD | Exact R53 implementation, seeded PRNG, fictitious play + Monte Carlo, outputs committed | P | T | acc | Model-side only (R29 synthetic tier); `docs/risk-sims/` |

### Manifest hypotheses (BUILT at f2 behind the O3 switch — verified against code at f3; run in later envelopes)

*The t2 header here read "built now, run later" while the cards were briefs only — false at review time (C13). f2 built all six at minimum fair-test scope (`app/engine/hypotheses.js`, the O3 console radio, per-card surface gating); this table now states the verified truth.*

| Node | Card | A | E | S | Note |
|---|---|---|---|---|---|
| H-R26-1 | Scouting reports | C | A | acc | Reads R51 via 2-brackets/48h, D1. **f7:** card 1 satisfies R26(1) as written — the panel renders per-round elements (`playedByRound`/`facedByRound`) for every current-schema event; a LEGACY (pre-f6) row has no per-round record and falls back to summary-only, honestly marked → `D-LEDGER-SLIM-VS-SCOUTING` |
| H-R26-2 | Pre-match Narrator brief | C | A | acc | Character layer tested; placement untested. Built: register-aware two-sentence brief, discipline-scanned |
| H-R26-3 | Spectate after elimination | C | A | acc | Sweat-as-content culture (dossier §3.5). Built: sitting-screen route to the live board + `SPECTATE_VIEW` event |
| H-R26-4 | Marquee scheduled brackets | C | A | acc | Appointment codes (dossier §3.1/3.3). Built: simulated daily slot + countdown + real reminder-opt-in event |
| H-R26-5 | PvE depth | C | A | acc | Fair test gated on F-8 mitigation decision. Built: named roster opponents with ledger-derived per-name W/L |
| H-R26-6 | Theme change | C | A | acc | Consumes O1's named winner. Built: follows the last console run's door-yield theme winner via O1's own mechanism |

### Fix-round decisions (f1/f2, recorded f3 — AC2)

| Node | Decision | A | E | S | Evidence kind / source |
|---|---|---|---|---|---|
| D-KILL-VOID | Kill/void rule, verbatim: *"on kill, an unfinished bracket is VOIDED — no auto-commit, no resolution, no stake transfer happens after the kill; every character keeps exactly the stake it held at that instant; a single `BRACKET_VOIDED` event records the rule"* | P | T | acc | `game.js` (`isKilled()` guard on every ledger-touching method; `voidBracketOnKill` the one method not frozen); `kill-switch.test.js`; two independent kill paths (console; `?kill=1`) |
| D-COIN-FLIP-VERIFY | Provably-fair coin flip (C22) = **commitment before the flip** (`COIN_FLIP_COMMITTED` appended before the seed decides anything) + **participant verification surface** (result-screen fold: commitment, revealed seed, independent Web-Crypto SHA-256 recompute) | P | T | acc | `duel.js` primitives; event-order tests |
| D-SCREENER-REATTEMPT | Screener attempts keyed **per attempt** (C3); latest attempt's result governs — a failed screener is retryable without breaking R83 idempotency | P | T | acc | `game.js` `actionKey('screener', player, attempt)`; projection last-write-wins |
| D-ACCOUNT-ON-PASS | Account + $25 grant written **only on screener pass** (A15); the boot-time `ensureAccount()` call removed | P | T | acc | `game.js`/`app.js`; R66/R70 |
| D-PRICE-ARM-CHARGE | C15 door-price semantics: **each arm charges what it shows** ($5/$10/$25/$0); the summon constant stays **100C**; the 20C=$1 peg unchanged (holds exactly only at the $10 default arm) | P | T | acc | `game.js:summonCharacter`; `price-arm-summon-charge.test.js` |
| D-ALPHA-SPENDING | Lan-DeMets O'Brien-Fleming-type alpha spending (one-sided) + Wilson 95% CI (expected-at-max-N in pre-registration; reached-at-close in verdict) — **documented normal-approximation**, not the exact recursive integral; Pocock fallback implemented | P | T | acc | `alphaSpending.js` header; `gate-alpha-spending-door-yield.test.js`; W-85/W-93 |
| D-DOOR-YIELD-LAYER | Door yield as R22's primary (impressions → clicks → intent clicks = enrollments; yield/1,000 impressions; band rule; R22's reporting language) — impressions/CPM constants **labeled ASSUMED synthetic** | P | CT | acc | `runSimulator.js`; `tunables.doorYield`; W-89…W-92 |
| D-SESSION-NUMBER | Session semantics (C19): new session after **≥30 min** idle or a fresh tab (tab-scoped `sessionStorage` signal); `loadFunds` requires `sessionNumber` (invariant #11) | P | T | acc | `ui/session.js`; `session.test.js` |
| D-LEDGER-SLIM-VS-SCOUTING | **SUPERSEDED at f7** (status/history below; kept for the record). Original (f1): keep the A6 payload slimming (drops per-round `rounds`, ~1.5KB/duel, for quota headroom); card 1's scouting derives from the retained summary fields only — documented deviation from card 1/R26(1)'s "elements played by round". f6 already began persisting a SLIM per-round record on every `DUEL_RESOLVED` event (for the cross-instance reveal-replay fix, unrelated to scouting at the time) — the premise "not reconstructable from the shipped ledger schema" stopped being true then, though neither the panel nor this document was updated until f7. **f7:** the scouting panel now reads that same per-round record (`playedByRound`/`facedByRound`, oriented via `combatants`); card 1 satisfies R26(1) as written for every current-schema event. One caveat remains, not a new deviation: a LEGACY (pre-f6) event has no per-round record at all (no migration) and falls back to summary-only, honestly marked | P | T | sup (f7) | `game.js:slimOutcomeForLedger`/`hydrateRoundsFromLedger`; `hypotheses.js:opponentDuelHistory`; `ui/screens/duel.js`; `manifest-hypotheses.test.js` |

### Proposed nodes (the open questions — no TBDs anywhere else)

| Node | Question | A | S |
|---|---|---|---|
| P-R71-NOUN-MAP | Sign off role-noun substitution inside R71's verbatim discipline lines | ours | prop |
| P-DRIFT-CONSTRUCTION | Pin the exact construction of "equilibrium mix + 3% drift" | ours | prop |
| P-T6-PAYOUT | Rule on the T6 $0.08 discrepancy | ours | prop |
| P-CC-OVERLAP | Evidence upgrade for cryptid-audience overlap (A2 downgraded 3→2 at f3 after the R15 non-encyclopedia audit; an upgrade to 4 would put A2 at 3.75 — 0.25 below the pick, no flip) | provider | prop |
| P-EQ-ASYMMETRY | Exact LP solve of win-game value across affinity matchups (~+1.6…2.5 pts/100 approx) | provider | prop |
| P-63-RAKE-DERIVATION | Derivation/measurement note for the 6.3% aggregate rake | provider | prop |

## Edge summary (65 edges; full list in the JSON)

- **Evidence flow:** R30 calibration → candidate slate → theme picks; rubric weights and the R6 envelope **constrain** the picks; the picks **implement** O1.
- **Skin constraints:** R11/R12/R1/R71 **constrain** both skins; the R13 mappings live on the skin nodes.
- **Conflict edges:** C-R71-NARRATOR and C-R12-THEME-BOUND → P-R71-NOUN-MAP (`conflicts-with`); C-R57-PVE → P-DRIFT-CONSTRUCTION (`conflicts-with`); C-R62-LADDER → P-T6-PAYOUT (`conflicts-with`). The four f3-declared conflicts live in the JSON's `conflicts` array as completed results (they need no open-question node — their configurations are delivered).
- **Gate reads:** C-R51-GATE `reads` all six H-R26 cards; O3 `constrains` them; P-DRIFT-CONSTRUCTION `constrains` H-R26-5; D-LEDGER-SLIM-VS-SCOUTING `constrains` H-R26-1.
- **Fix-round implementations:** D-SCREENER-REATTEMPT/D-ACCOUNT-ON-PASS `implement` C-R70-IDENTITY; D-PRICE-ARM-CHARGE `implements` O2-PRICE; D-ALPHA-SPENDING `implements` C-R51-GATE and C-R28-INTERVAL; D-DOOR-YIELD-LAYER `implements` C-R22-DOOR.
- **Sim reads:** D-SIM-METHOD `reads` C-R55-FLOOR, C-R57-PVE, P-EQ-ASYMMETRY.

## Maintenance rule (AC2: "the graph updates itself as phases run")

The t2 snapshot was static; **this f3 refresh is the rule operating**: the verification review and fix rounds f1/f2 ran, and the graph absorbed them — four review-found conflicts declared as completed results, nine fix-round decisions added as nodes, the citation counts corrected, the manifest-hypotheses section's obsoleted "built now" paper claim replaced with the verified build truth (its history preserved in the section note rather than deleted, per the supersede rule). Going forward the delivered machine owns the live graph: door-race results move D-THEME-ADJ/D-THEME-FAR evidence from ASSUMED to TESTED (or supersede them per R22's band rule and brand-rejection rule); manifest runs move H-R26-* the same way; proposed nodes close on console rulings (A3). Any node marked `accepted` that a later phase contradicts is marked `superseded`, never deleted.
