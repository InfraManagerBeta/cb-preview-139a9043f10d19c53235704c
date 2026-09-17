# Disclosure — models, tools, services, and provenance terms (AC0 disclosure row, ticket-t2 slice)

**Ticket t2 · task 85baf1fc · 2026-09-10.** AC0's disclosure row requires: *models, tools, third-party services, provenance terms for machine-generated artifacts, data-processing terms.* This document discloses honestly what **this lane** (the evidence & documentation pack on branch `rtp/task-85baf1fc-foreman-t2`) actually used and under what terms its machine-generated content exists. The app/engine lane (t1) and the treatment-skin lane (t3) owe their own rows for what they use; the delivered machine owes the runtime disclosure (its Narrator model, ad platforms, hosting, analytics) at delivery.

## 1. Models used to produce this artifact

| Model | Role | What it produced |
|---|---|---|
| **Anthropic Claude** (Claude-family large language model; fleet designation `claude-fable-5`, persona `fable`) | The sole authoring model, operated as an autonomous coding/writing agent under a human-set work order | All eight documents in this pack, the decision-graph JSON, the workbook CSV, and the five Node.js simulation scripts under `docs/risk-sims/` — including this pack's f3 revision (same persona, same model, same terms) |

**Fix-round provenance (added f3):** since t2 delivery, this repository received fix rounds f1 and f2 (engine and presentation/console fixes under `app/`, outside this pack) and f3 (this pack's documentation truth pass). All fix rounds were produced by Claude-family models operated as autonomous agents in the same fleet, under the same engagement and work-order terms as t2 — same ownership (§3.2), same honest-labeling terms (§3.5). f3's revisions to this pack were authored by the same persona/model as the original (`fable` / `claude-fable-5`).

No other generative model was used. **No image, audio, or video generation was used anywhere in this pack.** No fine-tuning, no retrieval index; the PRD (`docs/PRD.md` @ `71d9397`) and the public web sources cited in the dossier were the only inputs beyond the work order.

## 2. Tools and third-party services used

| Tool / service | Use | Data sent |
|---|---|---|
| Node.js v22 (local sandbox) | Running the deterministic simulations in `docs/risk-sims/` | none (offline computation) |
| `curl` HTTP status checks | Verifying that every cited URL resolves (t2 session: 57 checked, 55 kept, 2 discarded — counts reconciled f3, see dossier §6; f3 session: 8 more checked, 8 kept — dossier §7) | the URLs only |
| Web search & page fetch (Anthropic-provided tooling over public web/search infrastructure) | Locating and confirming the published survey sources (Pew, Siena/SRI, Fortune/BofA, Statista) | search queries only |
| GitHub (`github.com`) | Source hosting; this branch; the PR venue for start/completion comments | the committed files themselves |
| Riptide market API | The work-order lifecycle (accept/complete) for this ticket | order metadata only |

**No participant data exists in this lane and none was processed** — there are no cohorts, no accounts, no events yet. Data-processing terms for participant data (invariant 7: privacy to Dapper standards; participant data is the owner's) bind the delivered machine and are owed with its runtime disclosure, not here; this pack neither collects nor touches such data.

## 3. Provenance terms for the machine-generated content in this pack

1. **Authorship & direction.** Every file in this pack is machine-generated text/code produced by the model above under the manager's written work order; it was not copied from any third-party work. Third-party facts are cited by URL and used as facts; no third-party creative text is reproduced beyond short attributed factual references.
2. **Ownership.** Per the engagement's terms (PRD §20: all delivered documents, code, and new art made with the owner's IP are the owner's), the owner takes full ownership of this pack on delivery. The authoring provider asserts no rights over it.
3. **Reproducibility.** All quantitative claims that originate in this lane reproduce deterministically: the simulations use a seeded PRNG and their exact outputs are committed beside them (`docs/risk-sims/*.out.txt`); `node docs/risk-sims/<script>.js` regenerates them byte-comparably. Arithmetic reproductions of PRD figures (e.g., the R28 interval, W-45) show their formulas inline.
4. **Citations.** Every external URL was status-checked from the session that added it (t2 sources on 2026-09-10; f3 additions in the dossier's §7 on their own session) and is marked `[verified live]` or `[stable public source, rate-limited this session]` in place; two 404 candidates were discarded rather than kept; no fabricated article or statistic URLs exist in this pack (decision-graph node `D-CITATION-POLICY`, counts corrected f3).
5. **Honest-labeling terms.** Evidence produced by this lane is **synthetic/model-side** in R29's sense: it qualifies mechanics and machine questions (question 4) and makes **no claims about human behavior**. Everywhere this pack's evidence disputes or extends a PRD tag, that is recorded in the decision graph (CONFLICT-R57-EVIDENCE, NOTE-T6-PAYOUT) rather than silently resolved.
6. **Names and creative concepts.** The treatment names, working titles, character name pools, personas, and copy lines in `docs/concept-cards.md` are original machine-generated fiction created for this engagement; referenced real-world properties (BattleBots, UFC, etc.) are cited as audience evidence only — nothing in the skins copies their protected expression, and naming of any shipped product remains the owner's (R12, invariant 5). The R1 scan passes: no forbidden strings appear in any participant-facing content proposed by this pack.
7. **The Narrator prompt derivatives.** The two alternate persona lines and example sentences derive from the PRD's own prompt structure (R71) as the spec requires; the discipline lines are held verbatim except the role-noun substitution recorded as CONFLICT-R71-R12's law-preserving configuration, pending the owner's ruling.

## 4. What this lane did NOT use (for the avoidance of doubt)

No ad-platform APIs or accounts; no analytics or tracking services; no payment or banking services; no model calls to any Narrator runtime; no cloud deployment; no secrets beyond the two credentials scoped to source hosting and the work-order market, neither of which appears in any committed file.

## 5. Runtime artifact figures still ASSUMED, not TESTED — CB-BUILD-017 fix round f4 (§0/R5 [LAW])

This row is added by the CB-BUILD-017 fix round (f4, ticket 4b9567a3), which owns `app/engine/runSimulator.js` and `app/ui/console/**` — not this pack's original ticket (t2/85baf1fc) — recorded here because this is the disclosure document §0/R5 names for labeling ASSUMED figures, per that fix round's Finding 3.

| Figure | Value | Where it renders | Status |
|---|---|---|---|
| `linkToFirstSealMedianSec` (`engine/runSimulator.js`) | 95s, fixed | Console → Run simulation + gates → per-arm daily table, "Link→Seal" column, every day, every arm (incl. the planted-fail arm) | **ASSUMED** — no live pilot telemetry exists yet for this artifact; a synthetic placeholder chosen comfortably inside AC1's stated pilot bar (median < 120s), not re-derived per day or per arm |
| `linkToFirstSealP90Sec` (`engine/runSimulator.js`) | 205s, fixed | Not currently rendered on any console surface (carried in the day-level data only, read by tests) | **ASSUMED** — same synthetic placeholder as above, inside AC1's p90 < 240s bar |

**Why these stay ASSUMED, not wired to a real measurement (fix preference (a) does not apply here):** `runSimulator.js` is a synthetic, day-level statistical cohort generator (R29: "synthetic evidence ... qualifies the machine") — it has no individual simulated players or per-player ledger events, only aggregate day-level counts, so there is no live ledger for these two figures to be derived from at this surface. A REAL, ledger-derived equivalent (`engine/retention.js`'s `linkToFirstSeal()`) exists and is exercised end-to-end in `app/tests/link-to-first-seal.test.js` against a real per-player `Game`/`Ledger`, but that path has no analogue reaching the console's synthetic run panel.

**The fix (preference (b)):** both figures are now carried on each simulated day's data with an explicit `linkToFirstSealSecondsAssumed: true` flag; `ui/console/runPanel.js` reads that flag to render the median cell in a visually distinct style (italic, amber, the literal word "ASSUMED," and a hover title) instead of the plain, unmarked figure the reviewer found indistinguishable from the measured columns beside it, and the same wording renders as the panel's own legend line beneath every daily table. `app/tests/run-panel-assumed-labeling.test.js` asserts the marker renders on the cell and in the legend.

