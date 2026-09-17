# Presentation candidates — R75 coverage-gap moments

**Ticket t3.** R75: "Where the incumbent set lacks a moment (floor drain,
coin flip, prize award), the provider delivers two candidates each, side by
side with its ranking and reasons; we choose once." This document is that
delivery. Both candidates for all three moments are implemented in
`app/ui/components/battle/moments.js` and are selectable live from the
operator console (per-moment radio switch, default = candidate #1 below in
every case). Nothing here is a math input — every candidate is purely
presentational; the underlying transfer, coin-flip winner, and prize amount
are computed identically regardless of which candidate is on screen.

Ranking method: each candidate is scored against three reasons that matter
for this artifact — (1) legibility at a glance on a phone screen within the
O9 cadence budget, (2) how cleanly it survives the incumbent/adjacent/far
placeholder-art split (R12: art sources are theme-bound; the alternates have
no bundled character art), and (3) how well it reads against the Narrator's
own discipline (the moment should not need to "explain" itself — the same
restraint R71 asks of the prose).

---

## 1. Floor drain (R55/R75: "an erasure treatment in the Narrator-accent
color composed from Lose and the bundle's mold material")

### Candidate 1 — "Erosion Wipe" *(default)*
A rectangular field in the treatment's Narrator-accent color, textured with
a diagonal repeating pattern (standing in for "the bundle's mold material",
which has no equivalent asset for the two alternate treatments), wipes away
top-to-bottom over ~1.1s (`clip-path` animation), composed directly against
the combatant that just went to zero.
- **Rank: #1.** Reads instantly as "erased/consumed" without needing a
  caption; the wipe direction (top-to-bottom) matches the Narrator's own
  "the ledger will take the name" framing (the record closing over the
  character). Works identically well whether the stage is the incumbent's
  GIF or a placeholder box — it is a full-bleed overlay, not tied to any
  specific character art.
- **Caption:** `"{loser} — drained to nothing."`

### Candidate 2 — "Ledger Stamp"
A rotated, oversized "VOID" rubber-stamp slams down over the losing
combatant (scale+rotate keyframe), rendered in the Narrator-accent color
with a heavy border, evoking a physical ledger being marked closed.
- **Rank: #2.** More literal ("the ledger" as an object, not a texture) and
  reads well too, but the slam motion is a slightly busier gesture than the
  moment needs (R75 wants restraint — "brevity is not failure, it is
  accuracy," per the Narrator's own Format rules, and the visual language
  should match). Held as the console-selectable alternate.
- **Caption:** `"{loser} — struck from the ledger."`

## 2. Coin flip (R54/R75: "a coin-flip presentation and the advancing
character's Win")

### Candidate 1 — "Spinning Coin" *(default)*
A circular disc does a 3D `rotateY` spin (four full turns) and settles,
showing a plain H/T face — a literal coin flip, the most direct reading of
"provably fair coin flip decides who advances" (R54).
- **Rank: #1.** Immediately legible as "a coin flip happened"; a single
  self-contained element with no dependency on either treatment's palette
  beyond the coin's own gold tone, so it survives all three treatments
  without modification. Shortest honest way to say "this was random, not
  skill" before the advancing character's Win state plays.
- **Caption:** `"{winner} advances — coin flip."`

### Candidate 2 — "Split-Screen Flash"
The stage splits into the two combatants' win/loss colors and strobes
between them before settling on the winner's half.
- **Rank: #2.** More dynamic and ties directly to the two combatants (their
  names are on screen throughout, not just an abstract coin), but the strobe
  reads slightly more like "a decision was made between them" than "a coin
  was flipped" — a small drift from R54's "provably fair coin flip" framing.
  Kept as the alternate because some reviewers may prefer the
  character-forward version over the abstract coin.
- **Caption:** `"{winner} advances — coin flip."`

## 3. Prize award (R56/R75: the winner's Power over the stake counter; the
prize entered as a fact separate from the duel)

### Candidate 1 — "Rising Counter" *(default)*
The headline-prize noun (e.g. "Big Cheese" / "the Golden Gear" / "the Belt")
banners above a glowing Cheddar/SCRAP/PURSE figure.
- **Rank: #1.** Directly matches R56's requirement that "the win screen
  shows DUEL WON and the prize as separate lines" — this is that separation,
  animated. The glow-pulse keeps it from feeling like a static label without
  adding motion complexity a placeholder stage can't support.
- Prize amount is the tier's shipped `prizeCheddar` value; nothing here
  varies by treatment except the noun label and color.

### Candidate 2 — "Trophy Card Flip"
A card flips 180° from the headline-prize noun to the amount on its back
face.
- **Rank: #2.** Adds a satisfying reveal beat, but a card flip reads
  slightly more like "a surprise" than "a fact being entered" — R56 frames
  the prize as a computed, pre-known fact (paid from the external pool at a
  fixed tier value), not a mystery box. Kept as the alternate for operators
  who want more ceremony at a bracket win.

---

## Selecting a candidate

Console → **O-item switches** → the three "moment" radio rows (Floor-drain /
Coin-flip / Prize-award moment), each defaulting to candidate 1. The choice
writes to `consoleOverrides.presentationMoments` and is read by
`app/engine/presentationTimeline.js`'s `buildFinalSteps()` on the next duel
resolution — no reload required for a duel started after the switch.
