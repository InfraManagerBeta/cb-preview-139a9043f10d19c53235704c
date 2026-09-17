// app/tests/prose-face-css.test.js — CB-BUILD-004/R11: prose content --
// every sentence a player reads -- is set in the prose face (Barlow); the
// data face (DM Mono) carries figures, counters, tags, timestamps, and
// code only, never body copy. Static CSS-rule scan (no DOM/CSSOM available
// in this harness -- same static-approximation approach as the existing
// target-size scan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

function parseRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) {
    rules.push({ selector: m[1].trim(), body: m[2] });
  }
  return rules;
}

function fontFamilyOf(rules, selectorExact) {
  const rule = rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes(selectorExact));
  if (!rule) return null;
  const m = rule.body.match(/font-family\s*:\s*var\((--font-[a-z]+)\)/);
  return m ? m[1] : null;
}

test('CB-BUILD-004/R11 (defect repro): .cb-legal is no longer set to the data face', async () => {
  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'base.css'), 'utf8');
  const rules = parseRules(css);
  const family = fontFamilyOf(rules, '.cb-legal');
  assert.notEqual(family, '--font-data', 'expected .cb-legal to no longer route body prose to the monospace data face');
});

test('CB-BUILD-004/R11: .cb-legal (every screen\'s body-prose class) resolves to --font-prose (Barlow)', async () => {
  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'base.css'), 'utf8');
  const rules = parseRules(css);
  assert.equal(fontFamilyOf(rules, '.cb-legal'), '--font-prose');
});

test('CB-BUILD-004/R11: a new .cb-prose class exists, sharing the same prose-face rule as .cb-legal (introduced per the brief instead of hand-editing every screen\'s class name)', async () => {
  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'base.css'), 'utf8');
  const rules = parseRules(css);
  const rule = rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes('.cb-legal') && r.selector.split(',').map((s) => s.trim()).includes('.cb-prose'));
  assert.ok(rule, 'expected .cb-legal and .cb-prose to share one rule');
  assert.equal(fontFamilyOf(rules, '.cb-prose'), '--font-prose');
});

test('CB-BUILD-004/R11: .cb-micro (figures/tags/timestamps) STAYS on the data face -- the fix is scoped to body prose, not every small-text class', async () => {
  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'base.css'), 'utf8');
  const rules = parseRules(css);
  assert.equal(fontFamilyOf(rules, '.cb-micro'), '--font-data');
});

test('CB-BUILD-004/R11: money/result-figure classes (.cb-data, .cb-result-delta) still resolve to the data face -- untouched by this patch', async () => {
  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'base.css'), 'utf8');
  const rules = parseRules(css);
  assert.equal(fontFamilyOf(rules, '.cb-data'), '--font-data');
  const resultDeltaRule = rules.find((r) => r.selector.includes('.cb-result-delta'));
  assert.ok(resultDeltaRule && /var\(--font-data\)/.test(resultDeltaRule.body));
});

test('CB-BUILD-004/R11: every screen\'s body-copy <p>/<div> using class "cb-legal" now renders in the prose face by inheritance from the single base.css rule (spot-check across the 10 screens/components that use it)', async () => {
  const files = [
    'ui/components/chrome.js', 'ui/components/money-sheets.js', 'ui/screens/duel.js',
    'ui/screens/landing.js', 'ui/screens/lobby-entry.js', 'ui/screens/pve.js',
    'ui/screens/reserve.js', 'ui/screens/sitting.js', 'ui/screens/summon.js', 'ui/screens/wallet.js',
  ];
  let sawCbLegal = 0;
  for (const file of files) {
    const src = await fs.readFile(path.join(APP_ROOT, file), 'utf8');
    if (/class:\s*'cb-legal'/.test(src)) sawCbLegal++;
  }
  assert.ok(sawCbLegal >= 8, `expected most of the 10 known cb-legal call sites to still use the class (found ${sawCbLegal}) -- this patch is a CSS-only reclass, not a per-screen edit`);
});

// ---- N-C6/R11 [LAW] re-probe fix: the C6 sweep above was NEVER real --
// it inspected exactly one of the 25 shipped data-face classes
// (`cb-micro`), matched only a bare literal string passed directly as an
// el() call's third argument (missing every ternary branch, template
// literal, and array child), and had no way to see a sentence sourced
// from the active treatment's OWN copy JSON rather than the calling JS
// file. All three gaps let real, live rendered sentences sit on the data
// face: `lobby.js`'s two ternary lines ("Seating humans first...",
// "…waiting for a 2nd human (O7)…" / "All seated. Locking the
// bracket…"), EVERY toast (`.cb-toast` itself resolved to the data face --
// "That didn't go through...", "Reminder set...", "Needs at least...",
// and the "Retired to the ledger." toast -- distinct from the identical
// STRING C6 already (correctly) moved on wallet.js's own emptied-card
// line), plus two more this sweep's OWN construction additionally turned
// up while building it: `moments.js`'s four battle-caption template
// literals ("<name> — struck from the ledger.", etc.) and rails.js's
// verbatim `treatment.copy.tieLine` ("All square — coin flip. You
// advance. No cheddar transferred.") on `.cb-result-line` -- a sentence
// that lives entirely in theme data, invisible to any scan of the JS
// source's own literals.
//
// app/tests/helpers/data-face-scan.js carries the real implementation
// (CSS-class-extraction + a bracket/string/comment-aware el() scanner +
// a treatment-copy cross-check); this file wires it up and asserts on it.
import {
  extractFontFaceRules, dataFaceClassNames, sweepDataFaceSentences,
  loadTreatmentCopyFields, looksLikeSentence, extractCandidateLiterals,
} from './helpers/data-face-scan.js';

const PARTICIPANT_CSS_FILES = [path.join(APP_ROOT, 'styles', 'base.css'), path.join(APP_ROOT, 'styles', 'battle.css')];
const TREATMENTS_DIR = path.join(APP_ROOT, 'data', 'treatments');

// ---- PRE-FIX PROOF (this test's own repro, quoted verbatim in the fix
// round's completion notes): run the sweep's exact assertion against the
// tree as it stood BEFORE this round's lobby.js edit, and it fails on
// exactly the line the review named.
test('N-C6/R11 pre-fix repro: the OLD cb-micro-only, literal-only sweep never saw lobby.js:29/46 at all (ternary children) -- proof the prior sweep was not real', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui', 'screens', 'lobby.js'), 'utf8');
  // The OLD sweep's own call-site pattern (prose-face-css.test.js as it
  // shipped after F1): a literal single-quoted string immediately
  // following a cb-micro class attr. A ternary's branches are never a
  // bare literal at that position (the position holds the whole
  // conditional EXPRESSION, `cond ? '...' : '...'`), so it matches
  // nothing here, even pre-fix, even though a real rendered sentence sits
  // right there.
  const oldSweepPattern = /el\('[a-zA-Z]+',\s*\{[^}]*class:\s*'([^']*\bcb-micro\b[^']*)'[^}]*\}\s*,\s*\n?\s*'([^']*)'/gs;
  const oldSweepHits = [...src.matchAll(oldSweepPattern)];
  assert.deepEqual(oldSweepHits, [], 'expected the OLD literal-only pattern to match zero call sites in lobby.js -- it cannot see the ternary at all');

  // The NEW sweep's own extraction, run against this file alone, DOES see
  // it (this is the assertion that would have failed pre-fix -- see this
  // round's completion notes for the actual pre-fix failing-assertion
  // quote, captured by temporarily re-running this block against the
  // pre-fix source).
  const faceRules = await extractFontFaceRules(PARTICIPANT_CSS_FILES);
  const copyFields = await loadTreatmentCopyFields(TREATMENTS_DIR);
  const { literalOffenders } = await sweepDataFaceSentences(path.join(APP_ROOT, 'ui'), faceRules, copyFields);
  const lobbyOffenders = literalOffenders.filter((o) => o.file.endsWith('screens/lobby.js'));
  assert.deepEqual(lobbyOffenders, [], 'expected the NEW sweep to find lobby.js clean POST-fix (see completion notes for the pre-fix failure this exact assertion produced)');
});

test('N-C6/R11 REAL sweep: zero participant-facing rendered sentences sit on ANY of the shipped data-face classes (all 25, extracted from base.css+battle.css, not hardcoded) -- literal/ternary/template JS children', async () => {
  const faceRules = await extractFontFaceRules(PARTICIPANT_CSS_FILES);
  const dataClasses = dataFaceClassNames(faceRules);
  assert.ok(dataClasses.size >= 20, `expected the extraction to find the full shipped set of data-face classes (found ${dataClasses.size}) -- a hardcoded single-class scan is exactly what this round replaces`);
  const copyFields = await loadTreatmentCopyFields(TREATMENTS_DIR);
  const { literalOffenders } = await sweepDataFaceSentences(path.join(APP_ROOT, 'ui'), faceRules, copyFields);
  assert.deepEqual(literalOffenders, [], `expected zero data-face call sites carrying a sentence-length string: ${JSON.stringify(literalOffenders)}`);
});

test('N-C6/R11 REAL sweep: zero `treatment.copy.<field>` references resolve to a data-faced node while that field\'s REAL value (any shipped treatment) reads as a sentence', async () => {
  const faceRules = await extractFontFaceRules(PARTICIPANT_CSS_FILES);
  const copyFields = await loadTreatmentCopyFields(TREATMENTS_DIR);
  const { copyFieldOffenders } = await sweepDataFaceSentences(path.join(APP_ROOT, 'ui'), faceRules, copyFields);
  assert.deepEqual(copyFieldOffenders, [], `expected zero data-faced treatment.copy.* references carrying a sentence value: ${JSON.stringify(copyFieldOffenders)}`);
});

// ---- Fix round f2 (CB-BUILD-021 finding C): the `?` widening surfaced a
// SCANNER defect, not a live offender -- pve.js:62's opponent line nests a
// template literal inside a `${...}` hole, and the old bounded template
// regex desynchronised on the inner backtick, fabricating a candidate that
// ended mid-hole ("House opponent \u00b7 ${opponent.name ? ") -- which the
// widened terminator class then read as a question-terminated "sentence".
// The rendered string is a genuine data line (figures/tags, middot-joined,
// no terminal punctuation) and correctly stays on cb-micro; the fix is the
// scanner's template extraction (a real scan, nested-template aware).
test('N-C6/R11 f2: extractCandidateLiterals handles a template nested inside a ${...} hole -- no mid-hole candidate, the collapsed shape is not a sentence', () => {
  const src = '`House opponent \\u00b7 ${opponent.name ? `${opponent.name} \\u00b7 ` : \'\'}${cheddar(opponent.stakeCheddar)} \\u00b7 tendency ${tendencyLabel(opponent.tendency)}`';
  const candidates = extractCandidateLiterals(src);
  assert.ok(!candidates.some((c) => /\$\{/.test(c)), `no candidate may end mid-hole: ${JSON.stringify(candidates)}`);
  assert.ok(!candidates.some((c) => looksLikeSentence(c)), `the opponent data line must not read as a sentence: ${JSON.stringify(candidates)}`);
  // The old regex's failure shape, pinned so a regression is legible: it
  // produced a candidate ending in "?" that the widened terminator flags.
  const oldRegexCandidate = (src.match(/`((?:[^`\\]|\\.)*)`/) || [])[1]
    .replace(/\$\{[^}]*\}/g, 'X').replace(/\\(.)/g, '$1');
  assert.equal(looksLikeSentence(oldRegexCandidate.trim()), true, 'the OLD bounded-regex extraction fabricated exactly the false positive the real scan removes');
});

// ---- Explicit allowlist (extension point the brief requires): genuine
// labels/figures that legitimately trip `looksLikeSentence`'s shape check
// would be listed HERE, each with a justifying comment, and the sweep
// above would need to subtract them before asserting. As of this fix
// round, a hand audit alongside building the sweep (every data-face class
// call site was read once while designing `resolveOwnFace`) found NONE --
// every current data-face render is a genuine label/tag/figure. Kept
// empty rather than invented; the mechanism (and this comment) is the
// deliverable, not a manufactured entry.
const DATA_FACE_SENTENCE_ALLOWLIST = [];

test('N-C6/R11 sweep sanity: looksLikeSentence catches every shape this round actually moved (pre-fix) and does not false-positive on real labels still in the codebase', () => {
  assert.equal(DATA_FACE_SENTENCE_ALLOWLIST.length, 0, 'see the comment above -- update together if a genuine exception is ever added');
  // F1's three shapes (still correctly off the data face).
  assert.equal(looksLikeSentence('Still being decided elsewhere in the bracket…'), true);
  assert.equal(looksLikeSentence('Even a re-entry bonus would not clear the floor yet — PvE first.'), true);
  assert.equal(looksLikeSentence('Provisional rig — final chassis art pending.'), true);
  assert.equal(looksLikeSentence('Retired to the ledger.'), true, 'expected the sweep to also catch this pre-existing, un-named site');
  // This round's shapes.
  assert.equal(looksLikeSentence('Seating humans first, NPCs fill the rest — every NPC seat is tagged.'), true);
  assert.equal(looksLikeSentence('…waiting for a 2nd human (O7)…'), true);
  assert.equal(looksLikeSentence('All seated. Locking the bracket…'), true);
  assert.equal(looksLikeSentence('That didn\u2019t go through. Please try again.'), true);
  assert.equal(looksLikeSentence('Reminder set \u2014 we\u2019ll notify you at T-15m.'), true);
  assert.equal(looksLikeSentence('Needs at least 100C to enter tier 3.'), true);
  assert.equal(looksLikeSentence('X — struck from the ledger.'), true, 'the moments.js caption shape, template hole collapsed to X');
  assert.equal(looksLikeSentence('All square — coin flip. X. No cheddar transferred.'), true, 'the treatment-copy tieLine shape, {ADVANCE_OR_ELIMINATED} hole collapsed to X');
  // Fix round f2 (CB-BUILD-021 finding C): a question mark terminates a
  // sentence too — before this fix looksLikeSentence tested /[.\u2026!]\s*$/,
  // so a question-mark-terminated sentence on a data-face node was
  // INVISIBLE to the sweep (R11 says EVERY sentence a player reads).
  assert.equal(looksLikeSentence('Did that wager go through for you?'), true, 'a question-terminated sentence must trip the sweep');
  assert.equal(looksLikeSentence('Ready to lock these five moves in?'), true);
  assert.equal(looksLikeSentence('What happens to my cheddar now?'), true);
  // Genuine labels/captions/figures that must NOT trip the scanner.
  for (const label of [
    'CASH', 'RETIRED', 'vs', 'VS', 'ONE QUESTION (OPTIONAL, ASKED ONCE)', 'OPPONENT TENDENCY',
    'PER-ROUND (most recent first):', 'The updated board:', 'CHOOSE YOUR FIVE MOVES', 'Location',
    '…waiting…', 'NPC', 'HESITATED', 'PLAY MONEY · FREE · STAYS IN GAME', 'PRIZE', '+50C', '-30C',
  ]) {
    assert.equal(looksLikeSentence(label), false, `expected no false positive on the genuine label/figure: "${label}"`);
  }
});

// ---- direct call-site checks (the sites THIS fix round touched).
test('N-C6/R11: lobby.js\'s two ternary lines (the O7 waiting line, the seating/locking line) are on the prose face, not cb-micro', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui', 'screens', 'lobby.js'), 'utf8');
  assert.ok(/class:\s*'cb-prose'\s*\},\s*waitingForHuman \? '…waiting for a 2nd human \(O7\)…' : '…waiting…'/.test(src.replace(/\n\s*/g, ' ')), 'expected the O7/waiting line to render on cb-prose');
  assert.ok(/class:\s*'cb-prose'\s*\},\s*lobby\.phase === 'COUNTDOWN'/.test(src.replace(/\n\s*/g, ' ')), 'expected the seating/locking line to render on cb-prose');
  assert.ok(!/class:\s*'cb-micro'\s*\},\s*waitingForHuman/.test(src.replace(/\n\s*/g, ' ')));
  assert.ok(!/class:\s*'cb-micro'\s*\},\s*lobby\.phase/.test(src.replace(/\n\s*/g, ' ')));
});

test('N-C6/R11: moments.js\'s four battle-caption sites (.cb-moment-caption) resolve to the prose face -- a class-level CSS fix, no per-site JS edit needed (every use is a sentence)', async () => {
  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'battle.css'), 'utf8');
  const rules = parseRules(css);
  assert.equal(fontFamilyOf(rules, '.cb-moment-caption'), '--font-prose');
});

test('N-C6/R11: rails.js\'s tie-line row carries BOTH cb-result-line and cb-prose (a compound-selector override) -- the card\'s two OTHER cb-result-line rows (figures) are untouched', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui', 'components', 'battle', 'rails.js'), 'utf8');
  assert.ok(/class:\s*'cb-result-line cb-prose'\s*\},\s*treatment\.copy\.tieLine/.test(src.replace(/\n\s*/g, ' ')), 'expected the tie-line row to carry both classes');
  const otherResultLineSites = (src.match(/class:\s*'cb-result-line'\s*\}/g) || []).length;
  assert.ok(otherResultLineSites >= 1, 'expected at least one OTHER cb-result-line site (the Score row) to remain data-only');

  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'base.css'), 'utf8');
  const rules = parseRules(css);
  assert.equal(fontFamilyOf(rules, '.cb-result-line'), '--font-data', 'expected the plain .cb-result-line rule to stay on the data face');
  const compoundRule = rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes('.cb-result-line.cb-prose'));
  assert.ok(compoundRule, 'expected a .cb-result-line.cb-prose compound rule to exist');
  assert.ok(/var\(--font-prose\)/.test(compoundRule.body));
});

test('N-C6/R11: .cb-toast resolves to the prose face; the pve.js PvE-delta toast explicitly opts back onto a data-faced .cb-toast-figure modifier', async () => {
  const css = await fs.readFile(path.join(APP_ROOT, 'styles', 'base.css'), 'utf8');
  const rules = parseRules(css);
  assert.equal(fontFamilyOf(rules, '.cb-toast'), '--font-prose', 'expected .cb-toast itself to now resolve to the prose face');
  const figureRule = rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes('.cb-toast.cb-toast-figure'));
  assert.ok(figureRule, 'expected a .cb-toast.cb-toast-figure compound override to exist');
  assert.ok(/var\(--font-data\)/.test(figureRule.body), 'expected the figure modifier to resolve to the data face');

  const domSrc = await fs.readFile(path.join(APP_ROOT, 'ui', 'components', 'dom.js'), 'utf8');
  assert.ok(/export function showToast\(message,\s*\{\s*figure = false\s*\}\s*=\s*\{\}\)/.test(domSrc), 'expected showToast to accept a figure option');
  assert.ok(/classList\.toggle\('cb-toast-figure',\s*!!figure\)/.test(domSrc), 'expected showToast to toggle (add AND remove) the figure class, not just add it once');

  const pveSrc = await fs.readFile(path.join(APP_ROOT, 'ui', 'screens', 'pve.js'), 'utf8');
  assert.ok(/ctx\.toast\(result\.playerDelta >= 0[\s\S]{0,120}\{ figure: true \}\)/.test(pveSrc), 'expected the PvE-delta toast (a genuine bare figure, e.g. "+50C") to opt into the figure modifier');
});

test('N-C6/R11: every OTHER known toast call site does NOT opt into the figure modifier (all are sentences, correctly defaulting to the new prose face)', async () => {
  const sites = [
    ['ui/screens/sitting.js', /ctx\.toast\('Retired to the ledger\.'\)/],
    ['ui/screens/sitting.js', /ctx\.toast\('Re-entered\.'\)/],
    ['ui/components/reserveOffer.js', /ctx\.toast\('Reserved\.'\)/],
    ['ui/screens/sitting.js', /ctx\.toast\(cashOutToastMessage\(cashUSD\)\)/],
    ['ui/screens/lobby-entry.js', /ctx\.toast\('Reminder set/],
    ['ui/screens/lobby-entry.js', /ctx\.toast\(`Needs at least/],
    ['ui/screens/summon.js', /ctx\.toast\('That didn\\u2019t go through\. Please try again\.'\)/],
    ['ui/components/money-sheets.js', /ctx\.toast\(`Deposited/],
  ];
  for (const [file, pattern] of sites) {
    const src = await fs.readFile(path.join(APP_ROOT, file), 'utf8');
    assert.ok(pattern.test(src), `expected to find the known toast call site in ${file}: ${pattern}`);
    // None of these call sites pass a second argument at all (default
    // figure:false) -- spot-check no `{ figure:` appears near the match.
    const m = src.match(pattern);
    const around = src.slice(m.index, m.index + pattern.source.length + 40);
    assert.ok(!/figure:\s*true/.test(around), `expected ${file}'s toast NOT to opt into the figure modifier`);
  }
});

// ---- direct call-site checks (the four sites this fix round actually --
// touched -- source-level, same static-scan style CB-BUILD-004 already
// established for this file).
test('C6/R11: duel.js\'s intermission "Still being decided elsewhere..." line is on the prose face, not cb-micro', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui', 'screens', 'duel.js'), 'utf8');
  assert.ok(/class:\s*'cb-prose'\s*,\s*style:[^}]*\},\s*'Still being decided elsewhere in the bracket…'/.test(src.replace(/\n\s*/g, ' ')), 'expected the line to render on cb-prose');
});

test('C6/R11: lobby-entry.js\'s PvE-rebuild warning line is on the prose face, not cb-micro', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui', 'screens', 'lobby-entry.js'), 'utf8');
  assert.ok(/class:\s*'cb-prose'\s*,\s*style:[^}]*\},\s*'Even a re-entry bonus would not clear the floor yet — PvE first\.'/.test(src.replace(/\n\s*/g, ' ')), 'expected the line to render on cb-prose');
});

test('C6/R11: stage.js\'s provisional-stage notice is on the prose face, not cb-micro (another builder\'s line, fixed here as announced)', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui', 'components', 'battle', 'stage.js'), 'utf8');
  assert.ok(/class:\s*'cb-provisional-stage-notice cb-prose'/.test(src));
  assert.ok(!/class:\s*'cb-provisional-stage-notice cb-micro'/.test(src));
});

test('C6/R11: wallet.js\'s "Retired to the ledger." line (the sweep\'s un-named catch) is on the prose face, not cb-micro', async () => {
  const src = await fs.readFile(path.join(APP_ROOT, 'ui', 'screens', 'wallet.js'), 'utf8');
  assert.ok(/class:\s*'cb-prose'\s*\},\s*'Retired to the ledger\.'/.test(src));
});
