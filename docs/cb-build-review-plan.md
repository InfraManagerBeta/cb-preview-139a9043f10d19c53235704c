# Cheddar Battles — Build Review: Expected Shortfalls and Test Plan

**2026-09-15 · CC for Alan.** Two parts. Part 1 is where a build is likely to fall short *because of our own documents* — contradictions between PRD and master, and acceptance bars that are underspecified or unreachable as written. Part 2 is a phone-in-hand test plan, one line per thing to press and what you should see, keyed to the patch list (`cb-build-patch-log.md`) and the acceptance bars (master §17).

Part 1 stands regardless of which build you are holding. Part 2 is run against the build.

---

## Part 1 — Where the build can fall short, and why it is on us

Ranked by how likely a competent builder is to diverge, and how much it matters.

### 1. PRD and master contradicted on the missed-clock auto-commit — my doing · **RESOLVED: all five random, every time** (see Rulings)
- **PRD §9.9:** a missed clock "auto-commits a uniform-random sequence." The delivered engine (`sync.js`) does exactly this — all five moves random.
- **Master R81 (edited 2026-09-10 after your "my moves were changed on me"):** "the player's own selections are kept; only unpicked rounds are filled, uniform-random."
- **Why it matters:** a builder reading the PRD or the existing engine ships full-random; one reading the master ships keep-chosen. Either is "conformant." I put keep-chosen in the master with a note to confirm with you and never got the confirmation.
- **Ruling needed:** keep-chosen (kinder, matches the complaint) or full-random (the 2019 behaviour, "as it was implemented"). Then the loser's text is aligned.

### 2. AC1 "first duel under two minutes" was unreachable on default timers · **RESOLVED: clock stops at first seal; lobby wait 30s**
- **AC1:** "Link to first duel under two minutes on a phone… median under two minutes."
- **The timers:** PRD §9.9 and O6 — the lobby *waits up to 60s for additional humans* before NPCs fill; then a 30s countdown to the board; then a 60s commit clock (O5). A solo tester in a mostly-NPC room always eats the full 60s wait. Landing → screener → summon adds 30–60s. Total to the first *reveal*: roughly 3–3.5 minutes.
- **Why it matters:** the bar cannot be met as written, so a builder either fails it honestly or redefines "first duel" to mean "reached the commit screen."
- **Two soft spots:** "first duel" has no endpoint defined (commit screen? first reveal?). And the 60s human-wait exists for a paid launch with real humans; in the test's NPC-filled rooms it is dead time.
- **Ruling needed:** define the AC1 endpoint, and consider O6 = 30s (its alternative) as the test default.

### 3. The sound default was unspecified · **RESOLVED: on, arming on first tap, first heard at summon**
- You flagged "sound and music are missing." The build ships sound **default-off** behind a toggle, with a code comment attributing that to "R10." Master R10 is the labour rule ("everything absent from these lists belongs to the machine"); nothing in the master or PRD states a sound default.
- **Why it matters:** the duel audio bed is in the bundle and wired; a player never hears it unless they find the toggle. Your expectation was audible.
- **Ruling needed:** sound on by default with a mute control, arming on the first tap (mobile browsers block audio until a gesture). Or off. Say which; I write it in.

### 4. Master §0 promises "two researched alternates as playable builds"; R12 now allows a marked provisional stage
- **§0:** the machine contained "the incumbent treatment and two researched alternates… as playable, persistent, ledger-backed builds."
- **R12 (amended, CB-BUILD-007):** an alternate without provided art carries "a clearly-marked provisional stage behind the click."
- **Why it matters:** judged against §0 the alternates fail; judged against R12 they pass. A builder picks the reading that suits.
- **Fix applied (no ruling needed):** §0 wording aligned to R12.

### 5. The PRD's screen flow has no screener step and no summon step
- **PRD §9.1 S-flow:** S0 landing → S1 wizard picker → … → S9 reserve. It is the prototype's flow. The screener (R70) is absent; the persistent-game summon (affinity → SUMMON → name revealed, R58/R59) is absent; S1 describes the prototype's pre-made wizard picker.
- **Why it matters:** a builder working from the PRD's flow omits or freelances the screener, and can defend the name-preview by pointing at S1.
- **Fix applied (no ruling needed):** S-flow gains an explicit screener step and a summon step, in the master's terms.

### 6. Two different D7 numbers live in our documents
- PRD §12.2: "Retention (Stage 2) D7 ≥ 25%." Master R47 and the tunables: 30% diagnostic. Both are intentional (Stage 2 real-money bar vs Stage 0.5 play-money diagnostic) but nothing says so where they sit.
- **Why it matters:** low, since D7 carries no verdict in this run — but a builder can reasonably pick either for the console display.
- **Note only.** Worth one clause in §12.2 naming the stage each number belongs to.

### 7. AC1's battle parity had no harness for arbitrary wizards · **RESOLVED: harness by wizard id, mandatory (CB-BUILD-015)**
- AC1 asks for a diff "against the reference implementation's own output for a sample of arbitrary summoned wizards." Producing that ground truth means running the 2019 reference (lottie-web playing the per-combo animation with the wizard's recolour) headless to emit frames. The reference is React code inside a Next.js app; the harness to do this is not described.
- **Why it matters:** a builder can claim parity on the nine canonical GIFs only and skip arbitrary-wizard parity, and be within the letter.
- **Ruling needed (small):** either name the harness — render the bucket's per-combo animation with lottie-web headless, recoloured per the portrait slots, as the reference frame source — or accept canonical-GIF parity plus a code-conformance review of the recolour path for arbitrary wizards.

### 8. Runtime engine · **RESOLVED: modern engine is the target; "same implementation" is the QA floor it may exceed**
- CB-PATCH-030 / the entry file: reproduce the 2019 behaviour, render in a modern engine. "As it was implemented" was lottie-web.
- **Why it matters:** two faithful builds, different substrates. Both reproduce behaviour; only one is literally as-was.
- **Ruling needed:** one word — modern engine (current text) or Lottie runtime.

### 9. Commit clock length — open by your ruling, and the build will ship 60s
- Not a contradiction. O5 default is 60s; you found it too short; the length is a knob inside the scouting-vs-pace-vs-fun tension you asked to sit with. The build will ship 60s and you will feel it again. Test item 14 below has you try 90s in the console.

---

## Part 2 — Test plan (phone in hand)

Run in order; each item names what to do and what a pass looks like. Where a step depends on a ruling above, it says so.

**Pre-flight.** Open the build on your phone. Note the URL and, if shown, the commit. Clear site data first so you start as a new player (Safari: Settings → Safari → Advanced → Website Data → the preview domain → delete).

| # | Test | Do | Pass looks like | Checks |
|---|---|---|---|---|
| 1 | Screener | Land → continue into the screener | A **date-of-birth** entry, not a checkbox. **No** "do you reside in a permitted region" question. Jurisdiction resolves as a detected verdict. | CB-BUILD-001, R70 |
| 2 | Blocked region | If the console can simulate a blocked region, do so and reload | The shipped "not available in your region" screen, in player copy | R70 |
| 3 | Summon: no preview | Reach the summon screen | **No wizard name** shown before you summon. Only the affinity choice and the Summon button. | CB-BUILD-002, R59 |
| 4 | Summon: reveal | Pick an affinity, press Summon | The name appears **after** the press, on the wizard card, as a reveal | CB-BUILD-002 |
| 5 | Summon: prose | Read the summon screen's body text | Reading text is in a **sans** face (Barlow); only figures, tags, the CASH pill are monospace | CB-BUILD-004, R11 |
| 6 | Funds wall | Get CASH below $10 (play down, or console) and press Summon | **Load Funds sheet opens** — no error text, no "summonCharacter:" string. Deposit → you return to summon and it completes. | CB-BUILD-012/013, R67 |
| 7 | Balance tap | Tap the CASH pill in the top bar, from any screen | Load Funds sheet opens | CB-BUILD-012 |
| 8 | Reserve, cold | Before any bracket, open Reserve | Notification-list copy only. **No** "what do you remember about your last match" question. | CB-BUILD-003 |
| 9 | Commit: disabled | Enter a bracket; on the move screen pick fewer than five | SEAL COMMITMENT is **clearly muted/greyed**, not vivid yellow; pressing it does nothing | CB-BUILD-008 |
| 10 | Commit: enabled | Pick all five | Button turns vivid; press seals | CB-BUILD-008 |
| 11 | Commit: clock | Watch the move screen | A **large, persistent countdown**, pinned in view; changes to the danger colour under ~10s; a line states unpicked rounds auto-commit at zero | CB-BUILD-009, R81 |
| 12 | Commit: expiry | Pick 3 of 5 and let the clock run out | Duel starts with **all five moves random** (your 3 discarded — consistent every time); the duel is flagged hesitated (console/ledger) and counts for nothing in your favour | CB-BUILD-009, R81 |
| 13 | Commit: scroll | Scroll to Round 5, pick a move | The screen **stays put** — no jump to the top | CB-BUILD-010 |
| 14 | Clock length | In the console set O5 to 90s; play a round | Note whether 90s feels right. (Feeds the open tension; no pass/fail.) | O5 |
| 15 | Battle: two wizards | Watch a duel | The two fighters are **visibly different wizards** (different hat/cape/wand/colours), not the same figure twice | CB-BUILD-005/006, R74 |
| 16 | Battle: arena | Watch a duel | An **arena background** behind the fighters; **no white boxes** | CB-BUILD-005 |
| 17 | Battle: no flash | Watch state changes (idle→charge→attack→hit) | **No black or blank frame** between states | CB-BUILD-005 |
| 18 | Battle: FX | Watch an affinity round | An element effect beyond a flat colour pulse | CB-BUILD-005 |
| 19 | Battle: variety | Play 3+ duels | Your wizard is the **same** every time; opponents **vary** | CB-BUILD-006 |
| 20 | Battle: parity | Open `assets/cw/renders/gifs/CW_Attack.gif` beside a live attack | Motion, silhouette, and timing match the render | AC1 |
| 21 | Tug bar & rails | During a duel | Tug-of-war bar pinned at top with portraits and floor lines; spell rails flank the stage; round cards stack | R76/R77 |
| 22 | Sound | From a fresh load, tap once, then summon | Sound is **on**: it arms on your first tap and is first heard during the summon ceremony; the duel audio bed carries through the bracket; a mute control is visible | CB-BUILD-016, R78a |
| 23 | Reserve, post-match | After your first bracket concludes, open Reserve | The recall question appears **once**, now that a match exists | CB-BUILD-003 |
| 24 | R1 sweep | Every screen you visit | The words "Cheeze Wizards", "Cheese Wizards", or "CW" appear **nowhere** a player reads | R1 |
| 25 | Alternate treatment | In the console switch to Scrapyard Kings; reload | Its own palette, nouns (Bot / SCRAP), copy, and door creative. Behind the click a **clearly-marked provisional stage** — no fabricated character art, no CW names | CB-BUILD-007, R12 |
| 26 | Time to first duel | Stopwatch from landing to your **first submitted seal** | Under two minutes. Lobby waits 30s, not 60. If you time out on the first duel it does not count. | CB-BUILD-017, AC1 |
| 27 | Console: gate | Open `/app/console.html` | Pre-registration panel shows the gate (35% reservation + two of the family) and the sequential rule; daily report renders; caps shown as frozen | AC0, R21, R51 |
| 28 | Console: synthetic run | Run the seeded synthetic run | Daily reports and a gate verdict appear; door-yield layer shows theme/price arms | AC0, R19a, R22 |
| 29 | Kill switch | Mid-duel, open `?kill=1` in another tab, return | The duel stops; a stop banner; the bracket voids with stakes intact | AC0, A4 |
| 31 | Summon ceremony | Pick an element, press SUMMON | The **full summon animation plays** for that element (the 2019 sequence), then a **random wizard of that element** is revealed — distinct parts and colours — with its name. First sight of the wizard is the reveal. | CB-BUILD-014, R74a |
| 32 | Parity report | Ask for `tools/parity/` output | A diff report exists: same wizard id run through the 2019 reference and the new engine, per state, within tolerance, on the canonical wizard plus a random sample | CB-BUILD-015, AC1 |
| 30 | Constants sanity | Summon, then cash out immediately | Summon costs $10 for 100C; cashing out 100C yields **$5.00** (20:1) — the deliberate gap | R58 |

**What to send back.** For each row: pass / fail / can't tell, plus a screenshot on any fail. Rows 12, 22, and 26 also need your rulings 1, 3, and 2 to score.

---

## Rulings — resolved 2026-09-15

1. **Missed clock:** all five moves random, every time. Preserving partial picks would need the device online at the instant of expiry; a rule that holds only sometimes is the worst experience. A timed-out duel happens without the player and earns no credit.
2. **AC1 "first duel":** the clock stops at the player's first submitted seal. Hesitated first duels are excluded. Lobby wait 30s for the test (O6 default).
3. **Sound:** on, arming on the first tap, first heard during the summon ceremony; mute visible.
4. **Parity:** the build delivers a harness — same wizard id through the 2019 reference and the new engine, diffed per state. Mandatory (CB-BUILD-015).
5. **Runtime:** modern engine is the target; "same implementation" is the QA floor; the engine may exceed it (frame rate) and never fall short.

Plus a new requirement from the same ruling: the summon is a ceremony — the full 2019 summon animation for the chosen element, ending in the reveal of a random wizard of that element (CB-BUILD-014, R74a).
