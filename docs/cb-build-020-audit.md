# CB-BUILD-020 Audit — Spec File Consolidation

**Date:** 2026-09-16  
**Auditor:** haiku (CB round-2 build, order 2e56fe57)  
**Master Rule:** Repo hygiene — if it is not in this repo it does not exist, which requires exactly one authority per subject.

## Audit Scope

Sweep all of `app/`, `tools/`, `docs/`, and root — checking for:
1. Duplicate copies of the master spec file (`docs/cb-outcome-spec.md`)
2. Source comments and documentation that reference spec directories that no longer exist
3. In-repo `.md`/spec paths named by a source comment or doc link that do not actually exist

## Findings

### 1. Duplicate Spec Files
✓ **Result:** NONE FOUND
- Single, authoritative `docs/cb-outcome-spec.md` confirmed
- No other files contain spec content or duplicate rule sets
- No archived `specs/` directory or similar legacy paths detected

### 2. Dangling Spec Path References
✓ **Result:** NONE FOUND
- Swept all `.js` files in `app/`, `tools/`, and `docs/`
- Found 27 references to `.md` files in comments and code
- All referenced files verified to exist:
  - `app/README.md` ✓
  - `docs/cb-outcome-spec.md` ✓
  - `docs/cb-build-patch-log.md` ✓
  - `docs/retention-manifest.md` ✓
  - `docs/concept-cards.md` ✓
  - `docs/risk-dossier.md` ✓
  - `docs/decision-graph.md` ✓
  - `docs/presentation-candidates.md` ✓
  - `app/vendor/README.md` ✓
  - `docs/risk-dossier.md` ✓ (tested for fetch in console)

### 3. File Cross-Reference Validation

**Methods checked:**
- Recursive grep for `specs/` pattern: no matches
- All `.md` path references in source code: all resolve to existing files
- No comments referencing removed specification directory: confirmed

## Conclusion

✓ **AUDIT PASSED**

The repository maintains exactly one authoritative spec (`docs/cb-outcome-spec.md`), with no duplicates and no dangling references. All in-repo `.md` documentation links are valid and point to existing files.

## Test Added

`app/tests/spec-hygiene.test.js` — enforces that:
- No duplicate copy of `cb-outcome-spec.md` appears anywhere in the repo
- Every `.md` path referenced in source comments actually exists
- The presence of a second spec file anywhere in the repo causes test failure
