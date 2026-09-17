# Cheddar Battles — Build Patch Log

**Purpose.** The delivered riptide-lane build (`nvdtf/cheddar-battles-app`, preview at the inframanagerbeta path) is a strong mechanical start: the engine, gates, instrumentation, and tests are real and verified. It is worth building **on**, not restarting. This log is how we do that.

Two jobs, one doc:
1. **Build forward.** Each entry names what the delivered build did wrong and the exact change to make in the existing code, so we patch this start rather than start over.
2. **Carry the scar.** The master spec (`docs/cb-outcome-spec.md`) now reads as the clean destination — the wounds are closed in the rules, not narrated as history. The record of what was caught and why lives here.

Master = where we are going. This = what went wrong and how it was repaired.

---

## What the delivered build got right (keep, build on)

Verified independently in-container (Node 22, the preview's own code): every economy and duel constant matches the spec (weights, affinity, 7× cap, floors, re-entry ladder, tier ladder including the $999,999.92 payout, gate thresholds, the R30 door-yield calibration); the duel engine computes R53/R54 including the provably-fair commit-reveal coin flip; the operator console runs a real O'Brien-Fleming / Lan-DeMets alpha-spending sequential gate with Wilson intervals; 111 spec-critical tests pass including the §15 invariant suite and the R1 name scan; the append-only idempotent ledger and the three-treatments-as-data architecture are sound. **This is the keep. Everything below is the patch set on top of it.**

---

## Status

**CB-BUILD-001…013 — delivered in round 1** by both lanes and verified in code (`cb-lane-performance-report-2026-09-15.md`). They remain here as the record of what was fixed and why. **CB-BUILD-009 needs a revert** (below) because the rule it implemented changed after delivery. **CB-BUILD-014…022 are round-2 scope**, on prime (PR #8) as the base.

## Patches

### CB-BUILD-001 — Jurisdiction asked as a checkbox, not detected
- **Symptom.** The screener asks "Do you currently reside in a permitted region?" as a self-report checkbox, and never says which regions qualify, so the question is both unrealistic and unanswerable.
- **Root cause.** R70 said "identity gates run as the shipped product will" without naming the mechanism; the lane implemented two identical checkboxes.
- **Master rule now.** R70 — age is attested by date of birth; jurisdiction is determined from the connection (a location check), never a region self-report; a player outside the set meets the shipped "not available in your region" outcome; in play money the check is simulated but presents as a detected verdict.
- **Build forward.** In `ui/screens/screener.js`: drop the jurisdiction checkbox; simulate a location verdict (stubbed detected region → pass, or the "not available" screen); replace the age checkbox with a date-of-birth entry. `submitScreener` keeps its idempotency key.

### CB-BUILD-002 — Wizard name previewed before summon
- **Symptom.** The summon screen shows the wizard's name before you summon and before you pick an affinity; it reads as a previewed, re-rollable attribute.
- **Root cause.** R59 said "comes summoned with a name" but did not forbid a pre-summon preview; `summon.js` calls `pickUnusedName()` at mount and displays it.
- **Master rule now.** R59 — the name is assigned and first revealed by the act of summoning, on the summoned character, never on the pre-summon screen and never before an element is chosen.
- **Build forward.** In `ui/screens/summon.js`: remove the `previewName` card; let `summonCharacter` draw the name server-side at commit; reveal it on the result/character card after the Summon press (a small reveal moment), not on the picker.

### CB-BUILD-003 — Reserve and match-recall reachable before any match
- **Symptom.** RESERVE sits in the bottom nav from a cold start, and the open-response prompt asks "What do you remember about your last match?" before a match exists.
- **Root cause.** The recall prompt (`reserve.js`) renders whenever the account has not answered, with no check for a concluded bracket; the validated funnel offered reserve after play (S9), not as a first-screen tab.
- **Master rule now.** R49a — reserve is offered in the played funnel's reserve step; R22 — the character-recall open response is asked only after the player's first bracket concludes (post-anchor), never before a staked duel exists.
- **Build forward.** In `ui/screens/reserve.js`: gate `renderOpenResponsePrompt()` on `snapshot()` showing a concluded first bracket (an anchor); until then, hide the recall card. Keep RESERVE pressable, but surface it in the played funnel; if the nav tab stays, it shows the notification-list copy only, no last-match question, until an anchor exists.

### CB-BUILD-004 — Body prose set in the monospace data face
- **Symptom.** Every paragraph a player reads is monospace, giving the whole app a terminal/wireframe look unlike Cheeze Wizards.
- **Root cause.** `base.css` routes `.cb-legal` (used for body copy on every screen) to `--font-data` (DM Mono). The prose face (Barlow) is loaded but barely used for reading text.
- **Master rule now.** R11 — prose content, every sentence a player reads, is set in the prose face; the data face carries figures, counters, tags, and code only, never body copy.
- **Build forward.** In `styles/base.css`: give body copy a prose class in `--font-prose`; reserve `--font-data` for figures, the CASH pill, result deltas, tags, timestamps. Reclass the screens' paragraph text off `cb-legal`-as-mono.

### CB-BUILD-005 — Battle stage: identical generic wizards, no arena, flashing, flat FX
- **Symptom.** Both combatants are the same generic wizard on white boxes; no arena background; the animation flashes to black on state changes; the "effect" is a single color pulse.
- **Root cause.** `stage.js` renders one shared GIF per state for both sides; nothing composites an arena; the `img` `src` is swapped per state (an animated GIF reloads and blanks); `renderAffinityFx` is one colored div.
- **Master rule now.** R74 — each combatant is the actual summoned wizard, composited and recoloured live by the parametric rig (§18, CB-BUILD-006), visually distinct; composited on the treatment's arena, never a bare or white field; state transitions seamless with no blank or flash (preload, never re-fetch mid-duel); element/affinity FX to the bundle's FX-source fidelity. AC1 gets the matching teeth.
- **Build forward.** In `ui/components/battle/`: composite the stage on the bundle's arena art (`sources/arena`, `client-static/img/fightScene/fightBG.svg`); render each combatant from its own cosmetic set (see CB-BUILD-006); preload state frames and cross-fade instead of swapping `src`; build the FX pass from the bundle's FX sources, not a flat fill.

### CB-BUILD-006 — The wizard is parametric, not a pre-rendered clip
- **Symptom.** The build uses the nine canonical GIFs (one example wizard) for every fighter, so both combatants are the same generic wizard.
- **Root cause (corrected).** Cheeze Wizards never shipped GIFs, and it pre-rendered no wizard. Every wizard is unique and generated; the animation code predates the wizards it animates. A parametric rig animates the *actual* wizard — its parts composited from its traits (head/cape/hat/wand/element/power) and recoloured to its own palette. The GIFs and PNG sequences are marketing/parity renders of one example. The bucket's per-combo animation is the *shape* layer, keyed to the cosmetic combo and recoloured per wizard, not a per-wizard clip. (An earlier version of this patch said to "process the per-character library into sprite sheets" — wrong: baking to a sprite atlas fixes the colour and destroys the per-wizard identity, and it cannot animate a freshly summoned wizard that has no pre-baked entry.)
- **Master rule now.** §18 / R74 — each combatant is the actual summoned wizard, composited and recoloured live by the reconstructed parametric rig (motion from `CW_RIG_06.aep`, part vectors from `CW_Main_v09.ai`, the trait-and-colour system from the portrait colour slots), in a modern runtime engine (Lottie interchange-only). Per-combo animation is shape reference to recolour; GIFs and PNG sequences are parity references only.
- **Build forward.** Reconstruct the rig in the runtime engine: a wizard's traits select the part shapes and its palette recolours them, driven by the rig's motion per state. Key each summoned wizard to its own traits+colours so it animates as itself — including a wizard the system has never seen. Do not sprite-sheet or GIF the combatant; do not bake colour. Use the bucket's per-combo shapes as reference and the GIFs/PNG-seq as parity targets only. **This is a port of an existing implementation, not new work:** match the shipped 2019 behaviour in `assets/cw/reference/DuelPlayer/` and the AE rig — there is no art to direct.

### CB-BUILD-007 — Alternate treatments have no character art (scope reality)
- **Symptom.** Scrapyard Kings and Undercard render a colored box with an element icon; no character, no animation.
- **Root cause.** R12 asked each treatment to supply "character art with a complete animation set." The provider is an agent fleet with no art production and had assets for the incumbent only, so it stubbed the alternates.
- **Master rule now.** R12 — the build animates and composites provided art; it does not originate character illustration. The incumbent's is the bundle's; each alternate's is a provided input. A treatment without provided art is tested at the door (R18/R22, where theme is judged) on the ad and landing creative the build produces, and carries a clearly-marked provisional stage behind the click until art is supplied.
- **Build forward.** Two tracks. (1) The theme test can run now: it is a door test (door yield), which needs ad + landing creative per treatment, not in-game character art. (2) In-game alternate art is a supply task for us, not a generation task for any lane; until supplied, the alternate's provisional stage is acceptable for the click-through only. Do not ask a lane to illustrate.

---

### CB-BUILD-008 — Disabled buttons don't read as disabled (opacity-only cue)
- **Symptom.** SEAL COMMITMENT looks active before five moves are placed. Pressing it does nothing (correct), so the logic is right but the button invites a press it will refuse.
- **Root cause.** The gate is wired correctly — `duel.js` sets `aria-disabled` until every move is placed, and the press no-ops. The only disabled treatment in the app is `base.css`'s `opacity: 0.5`, which on a saturated-yellow primary button still reads as pressable. This is systemic: every gated button (screener Continue, seal commitment) shares the weak cue.
- **Master rule now.** §12/R83 and PRD §9.10 — a control whose precondition is unmet renders a clearly disabled state, distinct in fill and weight rather than opacity alone, and never presents as actionable while inert. The wiring (aria-disabled + no-op guard) is already correct and stays.
- **Build forward.** In `styles/base.css`, strengthen `.cb-btn:disabled, .cb-btn[aria-disabled="true"]`: replace the vivid yellow fill with a muted/desaturated fill, drop the drop-shadow, keep `cursor: not-allowed`, so disabled reads at a glance. Do not touch the per-button gate logic. Optional enhancement (keeps the disabled look): on a press of a still-gated button, briefly highlight the rounds still missing a move, so the player is told what is left rather than met with a dead control.

### CB-BUILD-009 — Commit clock invisible; auto-commit unexplained
- **Symptom.** The match started before five moves were chosen and unpicked moves appeared changed. There is a timer, but a player does not notice it, and nothing warns that the clock auto-commits.
- **Root cause.** R81 requires a commit clock and auto-commits a missed one (spec-correct). The build renders the clock as a small `cb-timer` data span, easy to miss, and never communicates the auto-commit consequence, so expiry feels like the game changing the player's moves.
- **Master rule now.** R81 — a prominent, persistent countdown, pinned and colour-shifting as it nears zero; the screen states before the clock runs low what happens at zero: a missed clock auto-commits a **uniform-random five-move sequence** (the whole hand, including rounds already picked) and flags the duel hesitated. Consistency wins: preserving partial picks needs the device online at the instant of expiry, and a rule that holds only sometimes is the worst experience. The engine already does this; the change is presentation.
- **Build forward.** In `ui/screens/duel.js`: promote the clock to a large sticky countdown that changes colour under (say) 10s; add a one-line statement of the auto-commit rule ("at zero, all five moves are chosen at random"). Leave `sync.autoCommitHesitated`'s full-random behaviour exactly as it is. Optional: a low-time warning pulse.

### CB-BUILD-010 — Choosing a move scrolls the screen to the top
- **Symptom.** Selecting a move jumps the view back to the top of the round list.
- **Root cause.** `onClick` calls `buildCommitScreen()`, which re-mounts the whole screen (`mountScreen` clears and rebuilds `#app`), resetting scroll. The A17 fix stopped the *timer* from re-mounting but move-selection still does.
- **Master rule now.** §12/R83 — interactive elements hold position during updates; selecting one option never moves the rest of the screen under the player.
- **Build forward.** In `ui/screens/duel.js`: on a move tap, mutate only the tapped round's three buttons (toggle `selected`) and the seal button's disabled state in place; stop calling `buildCommitScreen()` for a selection. Preserve scroll.

### CB-BUILD-011 — The move-choice screen needs a redesign (and deeper scouting) [partly blocked on a design tension]
- **Symptom.** The move-choice screen is poor top to bottom: weak clock, scroll jump, weak disabled button, cramped mono layout, and only an opponent *tendency* label where a player wants to read and research the opponent's match history.
- **Root cause.** The screen was assembled to the letter (tendency card, timer, five rounds) without the craft or the information depth the audience wants. Full opponent match-history is currently only manifest card #1 (scouting reports, O3), not in the base build.
- **Master rule now.** R11/R79 design bar and R83 interaction contract apply here (see CB-BUILD-004/005/008/009/010); scouting depth is governed by the tension below, not yet a fixed rule.
- **Build forward.** Redesign the screen against the design bar once CB-BUILD-004/005 land: prominent clock, no scroll jump, clear disabled state, prose in the prose face, room for a scouting panel. **Do not build deep opponent match-history yet** — its value collides with pace and fun (see the open tension); resolve that first.

### CB-BUILD-012 — Funds wall is a dead end (no deposit CTA, balance not tappable)
- **Symptom.** Summoning with CASH $5 and a $10 cost shows an error and offers no way to add funds; tapping the CASH balance does nothing; there is no route to Load Funds from the screen. The player is stuck.
- **Severity.** Higher than UX: this strands players and makes **bust-to-top-up and deposit-intent (R49) impossible to observe** — the very signals the test exists to read. A funds wall with no deposit path corrupts the run.
- **Root cause.** The Load Funds sheet exists (`money-sheets.js: openLoadFundsSheet`) but the summon path only toasts an error; the CASH pill in `chrome.js` is a non-interactive `<span>`; the summon screen has no nav to the wallet.
- **Master rule now.** R67 — Load Funds is reachable from every funds wall; the CASH balance is a control that opens it; a blocked action states the shortfall in player language and opens Load Funds inline, returning to the blocked action on deposit.
- **Build forward.** In `ui/screens/summon.js`, on insufficient CASH call `openLoadFundsSheet(ctx, { onDeposited: retrySummon })` instead of toasting; make `.cb-cash-pill` in `chrome.js` a button that opens Load Funds; apply the same to re-entry (`game.js:868`). Verify bust-to-top-up can fire end to end.

### CB-BUILD-013 — Raw developer error strings shown to players
- **Symptom.** "summonCharacter: insufficient CASH" — a raw thrown Error, function name and all, displayed to the player.
- **Root cause.** Catch blocks toast `e.message` (`summon.js`), and the thrown messages (`game.js`) are developer strings, not player copy.
- **Master rule now.** §12/R83 — no raw or developer error text reaches a participant surface; every blocked or failed action is explained in player language, and the resolving action is offered in place.
- **Build forward.** Replace thrown-string display with mapped player copy; never toast `e.message`. The insufficient-CASH case routes to Load Funds (CB-BUILD-012) rather than showing any error text at all. Sweep every `catch` that surfaces `e.message`.

### CB-BUILD-009r — Missed clock commits five random moves (revert of the round-1 behaviour)
- **Symptom.** Both round-1 lanes preserve the player's already-selected moves when the commit clock expires and randomise only the blanks. That is the rule they were given.
- **Root cause.** Master R81 said preserve-partial on the day the task was issued. The owner ruled the other way on 2026-09-15: preserving a partial selection depends on the device being online at the instant of expiry, and a rule that holds only sometimes is the worst experience.
- **Master rule now.** R81 — a missed clock auto-commits a uniform-random five-move sequence, the whole hand including rounds already picked, flagged hesitated and excluded from staked-duel metrics. The duel proceeds without the player and earns nothing in their favour.
- **Build forward.** Restore the untouched full-random path in `sync.autoCommitHesitated` (drop the picked-indices parameter prime added and the merge helper foreman added). Keep the prominent countdown and the on-screen statement of the rule, updated to read that all five moves are chosen at random at zero.

### CB-BUILD-014 — The summon is a ceremony: full 2019 summon animation, typed random reveal
- **Symptom.** Summon is a form: pick an element, press a button, land on the next screen. The 2019 summon animation — in the bundle, wired to nothing — never plays, and the wizard's parts and colours are never generated at summon.
- **Root cause.** R58/R59 specified the transaction and the name, not the presentation; the bundle's summon sequence (`lottie/summon*.json`, element flags and preps, `client-static/video/summon/`) was delivered as assets only.
- **Master rule now.** R74a — pressing SUMMON plays the full 2019 summon sequence for the chosen element and ends in the reveal of a random wizard of that element, its parametric parts and colours generated at summon and drawn by the fighting rig, its name revealed with it. First sight of the wizard is the reveal.
- **Build forward.** Port the shipped summon flow from the 2019 client (`assets/cw/reference/` and the bundle's `lottie/` summon set) into the modern engine; on SUMMON, generate the wizard's trait set and palette for the chosen element, play the sequence, reveal the composited wizard and its name. Instrument the seal-to-reveal duration.

### CB-BUILD-015 — Parity harness, keyed by wizard id (mandatory deliverable)
- **Symptom.** Nothing in the build proves the port matches 2019 for any wizard but the one demo wizard in the GIFs.
- **Root cause.** AC1 asked for parity against the reference implementation's output for arbitrary wizards without naming the tool that produces that output.
- **Master rule now.** AC1 — the build delivers a harness: given any wizard id, run the 2019 reference implementation (`assets/cw/reference/`, the per-combo animation from the bucket, the wizard's recolour from its portrait colour slots) to emit reference frames per state; run the new engine for the same wizard id; diff (visual parity within tolerance, timing to the reference constants). Run on the canonical wizard and a random sample of generated wizards; ship the diff report.
- **Build forward.** Build `tools/parity/`: a headless runner for the reference (lottie-web over the per-combo JSON with the wizard's palette applied), a frame dumper for the new engine, a per-state comparer with a tolerance, and a sample driver. Same wizard id in on both sides. This is the QA target for CB-BUILD-005/006; without it, those patches are unverified.

### CB-BUILD-016 — Sound on, arming on first tap, first heard at summon
- **Symptom.** The duel audio bed is in the bundle and wired, but ships muted behind a small toggle; a player never hears the game.
- **Root cause.** No rule stated a sound default; the build guessed off and cited a rule that says nothing about sound.
- **Master rule now.** R78a — on by default; arms on the player's first tap (phones withhold audio until a gesture); first heard during the summon ceremony (R74a); the bracket audio bed plays as the 2019 client played it; a mute control visible wherever sound plays.
- **Build forward.** In `ui/components/battle/sound.js` and the summon screen: default the toggle on; arm the audio context on the first `pointerdown` anywhere; start the summon audio with the ceremony; carry the bed through the bracket; keep the mute visible.

### CB-BUILD-017 — Lobby wait 30s for the test; "first duel" measured to the first seal
- **Symptom.** A solo tester waits a full 60s in the lobby for humans who, in an NPC-filled room, never come; AC1's two-minute bar had no defined endpoint.
- **Root cause.** O6's 60s default and PRD §9.9 were written for a paid launch with real humans; AC1 said "first duel" without saying which moment.
- **Master rule now.** O6 default 30s (60s/120s as alternatives). AC1 — the clock stops at the player's first submitted seal; a first duel that times out (hesitated) is a duel that happened without them and earns no credit toward the bar.
- **Build forward.** Set `tunables.timers.lobbyHumanWaitSec.default` to 30 (alternatives 60, 120). Instrument `link → first seal` as a first-class metric in the ledger and the console's daily report; exclude hesitated first duels from its numerator.

### CB-BUILD-018 — Bust-to-top-up misses bracket-duel busts
- **Symptom.** The measurement that pairs a character reaching zero stake with the next deposit observes practice-mode busts and misses bracket-duel busts, so the signal the deposit wall exists to serve is half-blind.
- **Root cause.** `retention.js` matches a flat `payload.stakeAfter === 0`; bracket-duel busts carry the stake figure nested, so the matcher passes over them. Predates round 1; foreman disclosed it, and it sits outside the thirteen-patch scope it was working.
- **Master rule now.** R49 — bust-to-top-up is the seconds from a character reaching zero stake to a confirmed deposit, wherever the bust occurs.
- **Build forward.** In `engine/retention.js`, match the bust condition against both payload shapes (or normalise the event at write time so one shape reaches the matcher). Add a test that busts in a bracket duel and asserts the pairing, alongside the practice-mode case that already passes.

### CB-BUILD-019 — Tests reachable from the preview
- **Symptom.** Round 1's merge base deployed its application to the preview and left its test suite out, so an outside reviewer could verify by reading but not by running.
- **Root cause.** The preview build published the app tree only.
- **Master rule now.** AC-supporting practice, not a numbered rule: a claim of a green suite is checkable by whoever holds the preview.
- **Build forward.** Include `app/tests/`, and any fixtures the suite reads, in the preview deployment. A reviewer who clones nothing can run the suite against the preview's own files.

### CB-BUILD-020 — One spec file in the repo
- **Symptom.** The repo carries the master spec under two names with the same content, and source comments reference specification paths that the branch removed.
- **Root cause.** Round-1 branches re-added a duplicate that the handoff had deliberately archived, and the removal of an older specification directory left dangling references behind.
- **Master rule now.** Repo hygiene in service of the entry file's own premise: if it is not in this repo it does not exist, which requires exactly one authority per subject.
- **Build forward.** Delete the duplicate or reduce it to a one-line pointer at the master spec. Update the source comments that name removed paths to name the master spec's rule instead.

### CB-BUILD-021 — Typography pardons audited
- **Symptom.** The prose-face sweep records pardons that let some strings stay in the data face by reviewer judgment rather than by rule.
- **Root cause.** R11 is absolute about prose content; a sweep that can pardon has an escape hatch with no recorded test of whether each pardon is sound.
- **Master rule now.** R11 — prose content, every sentence a player reads, is set in the prose face; the data face carries figures, counters, tags, and code only.
- **Build forward.** List every pardon. For each, either fix the string so the pardon is unnecessary, or record the reason it belongs in the data face (a code identifier, a numeric figure, a tag). A pardon without a recorded reason gets fixed.

### CB-BUILD-022 — Character identity derives at read time
- **Symptom.** The round-1 merge base derives character traits and palette at summon and records them as ledger fields, which the read path then relies on.
- **Root cause.** Two valid designs existed and the spec named neither. With the playback engine slated for replacement, binding the ledger to the current identity model is the heavier of the two commitments.
- **Master rule now.** R74/§18 — each combatant is the actual character, composited and recoloured by the rig. The rig's derivation is the authority; the ledger records history.
- **Build forward.** Derive traits and palette deterministically from the character id at read time, as the alternate lane did. Recorded identity fields may remain as an audit record, read by nothing. Add a test proving a character renders identically with those fields absent.

## Appendix — Rulings history (relocated from master §19)

The dated record of how each earlier decision moved, kept here as scar tissue so the master carries only the clean rules. Newest first.

- 2026-09-10 — Build review of the delivered lane produced CB-BUILD-001 through 007 above; each wound closed in the master rules, the scar kept here.
- 2026-09-09 — The gate is the validated test at scale: reservation and replay, on players told from the first screen the money is free play. Earlier text gated on D7 and weekly return; the owner expects those near zero in play money, now diagnostics. Prize-backed arms declined (sybil destroys metric reliability); deposit fake doors declined (a real-looking promise of absent money is a rug pull; always up front).
- 2026-09-09 — The Narrator's register is theme-bound; its discipline is fixed. Earlier text froze the Pratchett register in every treatment, locking the largest whimsy lever inside the arm built to remove whimsy (caught in review).
- 2026-09-09 — One run, $5,000, 14 days, read daily under a pre-registered sequential rule. Envelope first set at $50,000, then re-cut to the scale of the three validating waves (~$5,500). Ansii's catch: an 80/10/10 theme split with price randomized inside the incumbent arm left the "$10 incumbent" gate cell at ~15 completers against a claimed 10× N; the gate cell is now the incumbent at $10 with ≥70% of spend; theme and price read at the door; large differences are the only ones worth detecting.
- 2026-09-09 — Assets travel with the document or sit behind a public URL; nothing waits on a person; Google Fonts in place of the 2019 Adobe faces; the Dapper deposit screen described in words. Files exceeding every transfer path leave the spec rather than sit "on request."
- 2026-09-09 — Daily. Results. Fast. Every gate reads every day; a run ends the day the evidence is enough; the envelope is spend plus a per-run day ceiling, not months.
- 2026-09-09 — Everything as it will be: shipped flows with rails stubbed only at enumerated points; the refill is the shipped Load Funds button; Cash Out is real and is the point; D7 defined to the timestamp.
- 2026-09-09 — A theme treatment is a complete skin over fixed mechanics; palette and register theme-bound; alternates chosen by research at build time and final at delivery (an earlier post-delivery concept screen was withdrawn as a second shot).
- 2026-09-08 — One wish, one handover: the document is the whole world; one shot, one delivery, one verification. Build the proven thing or kill it; unproven variants are off the table.
- 2026-09-03 — Speed makes it a test, slow makes it a bet. Sync is the product; NPCs act as players and wear visible tags; gate numbers set before data.
