# CB-BUILD-021 Audit — Typography Pardons Audited

**Date:** 2026-09-16 (corrected in fix round f2, 2026-09-17)  
**Auditor:** haiku (CB round-2 build, order 2e56fe57); provenance corrected and the `?` terminator gap closed by fable (fix round f2, order 2d61d6a4)  
**Master Rule (R11):** Prose content — every sentence a player reads — is set in the prose face; the data face carries figures, counters, tags, and code only.

## Provenance — what this ticket did and did not build

An earlier revision of this audit read as if CB-BUILD-021 tightened the
sweep. It did not, and this section states the true authorship:

- **Pre-existing (round 1, commit `91431c2`, the N-C6/R11 re-probe fix):**
  everything the sweep helper `app/tests/helpers/data-face-scan.js` can do
  shipped there — extraction of ALL data-face classes from the two shipped
  participant stylesheets (not hardcoded to one), the bracket/string/
  comment-aware `el()` scanner covering literal, ternary, template-literal
  and array children, the `treatment.copy.*` cross-check against every
  shipped treatment JSON, and the empty, test-asserted allowlist in
  `app/tests/prose-face-css.test.js`. In the round-2 integration range
  (`24b0324..ed28b533`) `data-face-scan.js`, `prose-face-css.test.js` and
  `app/styles/base.css` were byte-unchanged.
- **This ticket (CB-BUILD-021) verified and documented:** it ran the
  round-1 sweep against the round-2 tree, confirmed zero offenders, and
  recorded the uninspected categories and the empty pardon table below. It
  built no new sweep capability.
- **Independent review (round-2 gate):** the reviewer ran a broadened
  sweep across `app/ui` — dropping the terminal-punctuation requirement,
  checking every data-face class, template literals, ternaries and
  `treatment.copy.*` — hand-triaged 25 candidates, and found **no live R11
  offender**. The audit's conclusion survived that scrutiny; its original
  authorship claims did not, hence this correction.
- **Fix round f2 (this revision):** closed one real hole the reviewer
  found — `looksLikeSentence()` tested `/[.\u2026!]\s*$/`, so a
  question-mark-terminated sentence on a data-face node was invisible to
  the sweep. `?` was added to the terminator class and the sweep re-run;
  the result is recorded below.

## Audit Scope

1. Identify all uninspected categories in the data-face-scan helper
2. Enumerate every pardon (uninspected but potentially sentence-containing string)
3. For each pardon: either fix the string/markup so no pardon is needed, or record the reason it belongs in the data face
4. Verify the explicit test-enforced allowlist (shipped empty in round 1) is still correct
5. Record what remains uninspected — without claiming new sweep capability this ticket did not build

## Uninspected Categories

Per the data-face-scan.js helper documentation (round-1 `91431c2`), the sweep deliberately does NOT attempt:
1. **Variable children** — `el(tag, attrs, variable)` where the child is a bare variable reference, not a literal/template/treatment.copy.* reference
2. **Cascade approximations** — CSS properties that depend on complex cascade resolution beyond pure class-compound selectors

### Category 1: Variable Children (Found)

The scan looks for:
- Literal single-quoted strings
- Template literals with ${...} holes collapsed to placeholders (nested-template aware since fix round f2)
- treatment.copy.<field> references against actual field values

The scan DOES NOT attempt to trace:
- Bare variables: `el('div', {}, myVar)` — the value cannot be statically determined
- Complex expressions: `el('div', {}, cond ? obj.a : obj.b)` where the branches are not themselves literals — requires data flow analysis
- Array/map children where the array items are dynamic

**Audit of variable-child sites found:**
- ZERO variable-child sites that contain rendered sentences on data-face classes found in this audit (hand audit, round 1, re-checked here)
- The existing prose-face test suite (app/tests/prose-face-css.test.js) runs the full round-1 sweep and finds zero offenders
- This category carries no recorded pardons — it remains UNINSPECTED by machine, bounded by hand audit

### Category 2: Cascade Approximations (Found)

CSS pseudo-selectors, media queries, and complex cascade scenarios that the static scan approximates:
- Pseudo-classes like `:hover`, `:focus`, `:disabled` that may override base rules
- Media queries that change font-face rules at different breakpoints
- Specificity calculations that require understanding the full CSS context

**Audit of cascade-approximation sites:**
- ZERO cascade-approximation issues found on participant-facing surfaces (round-1 design audit, unchanged CSS in this range)
- The probe covers base.css and battle.css (the two files index.html actually loads); console.css is operator-only and excluded
- This category remains an approximation, not a proof — no pseudo-class or media-query rule in the shipped CSS sets a font face today, which is why zero issues are recorded

## Fix round f2 — the `?` terminator gap, closed

The reviewer found that `looksLikeSentence()` (data-face-scan.js) required
`/[.\u2026!]\s*$/`, so a **question-mark-terminated sentence on a data-face
node was invisible to the sweep**. R11 quantifies over every sentence a
player reads; the terminator class now includes `?`.

**Sweep re-run result (app-wide, both `app/ui` and the full `app/` walk the
pardon test performs):** no live R11 offender. The widened terminator
surfaced exactly one candidate, and it was a **scanner false positive, not
a rendered sentence**: `app/ui/screens/pve.js:62` renders
`House opponent · <name> · <stake> · tendency <label>` — a middot-joined
data line on `cb-micro`, no terminal punctuation, correctly on the data
face. The old bounded template-literal regex desynchronised on the
template NESTED inside its `${...}` hole and fabricated a candidate ending
mid-hole (`"House opponent \u00b7 ${opponent.name ? "`), which the widened
class then read as `?`-terminated. The extraction is now a real scan
(nested-template aware); the fabricated candidate is gone, the data line
stays on the data face, and no participant-facing string was changed.

## Pardon Table

| Status | Category | File | Line | String / Identifier | Reason |
|--------|----------|------|------|-------------------|--------|
| **CLEAN** | Variable children | — | — | (None found) | All variable-child sites hand-audited (round 1, re-checked); none carry sentence content on data-face classes |
| **CLEAN** | Cascade approximations | — | — | (None found) | No pseudo-class or media-query rule in shipped participant CSS sets a font face; nothing to pardon |
| **CLEAN** | Question-terminated sentences (f2) | — | — | (None found) | `?` added to `looksLikeSentence()`; re-run sweep found only a scanner false positive at pve.js:62 (fixed in the scanner, string unchanged) |

## Summary

- **Total Pardons Recorded:** 0
- **Fixed (converted to prose face or markup changed):** 0 (all known offenders were already fixed in round-1 `91431c2`, CB-BUILD-004/N-C6)
- **Recorded (reason documented, test-enforced):** 0 (no legitimate exceptions found)
- **Deferred (owned by sibling ticket):** 0

### What remains uninspected

- Variable children (documented as ZERO offenders by hand audit — not machine-swept)
- Cascade pseudo-selectors / media queries (ZERO font-face rules of that shape exist in shipped participant CSS today; the sweep would not see one that was added)
- Sentences assembled at runtime from non-literal parts (out of the static scan's reach by design — see the helper's own header)

## Enforcement

`app/tests/prose-face-css.test.js` (round-1 `91431c2`, extended in f2) enforces:
- Zero data-face call sites carry a sentence-length string (now including `?`-terminated)
- Zero treatment.copy.* references on data-faced nodes contain sentence values
- The explicit allowlist (currently empty) is asserted empty on every test run
- The nested-template extraction is unit-pinned so the pve.js false-positive shape cannot silently return
- This test blocks any future regression

## Conclusion

✓ **AUDIT PASSED** (provenance corrected)

R11 is satisfied: every participant-facing sentence is on the prose face; the data face carries only figures, tags, and code. No pardons are necessary or recorded. The sweep's capabilities are round-1 work (`91431c2`); this ticket verified them, and fix round f2 closed the `?` terminator gap the review found.
