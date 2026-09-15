// app/tests/cb-build-004-prose-face.test.js
// CB-BUILD-004: Body copy uses the prose face (Barlow), not the data face (DM Mono).
// Every sentence a player reads is set in --font-prose, while figures/tags/code use --font-data.

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

const uiDir = path.join(process.cwd(), 'app/ui');
const screenDir = path.join(process.cwd(), 'app/ui/screens');
const componentDir = path.join(process.cwd(), 'app/ui/components');

// CB-BUILD-fix-round-1 #5: the scan is RECURSIVE (ui/components/battle/* is
// covered, per the review advisory) and the old hard-coded exclusion list is
// GONE. R11 admits no legal/technical carve-out — every sentence a player
// reads is prose-face; legal lines, coin-flip verification paragraphs,
// kill-stop copy and hypothesis fair-test lines all wear .cb-prose (a small
// modifier may shrink the point size — the FACE is the law, not the size).
//
// CB-BUILD-fix-round-2 (re-review B): the scan is keyed on the FACE, not on
// any one class name. It derives, from the stylesheets the PARTICIPANT page
// actually ships (app/index.html — the operator console's console.css is not
// participant-facing and is excluded by construction), the full set of
// classes whose CSS rule sets `font-family: var(--font-data)`.
//
// CB-BUILD-fix-round-3 (re-re-review): the scan is keyed on the SENTENCE, not
// the tag. R11's words — "the data face carries figures, counters, tags, and
// code ONLY, never body copy" — bind every element, not just <p>. So the scan
// now visits EVERY `el(<tag>, …)` call in the participant tree (app/ui/*.js +
// app/ui/screens/** + app/ui/components/**; app/ui/console/** is the operator
// surface, excluded like console.css) and fails when a node carrying a
// data-face class has sentence-shaped text children. The CSS parser is
// brace-balanced and at-rule-safe (a rule first inside @media is seen), and
// the reviewer's three evasion probes (data-face <div> sentence; @media-first
// rule; participant <p> sentence in app/ui/app.js) are permanent self-checks
// below.
//
// CB-BUILD-fix-round-4 (re-re-re-review): the scan also reads RUNTIME writes
// — the round-4 review's two live crucials were both text this file could
// not see because it only read the authored CHILDREN of `el()` calls:
// `showToast()` assigning participant sentences to the data-face toast, and
// duel.js's coin-flip verdict line written via `.textContent` after the
// re-verify press. A second rule now flags `X.textContent = …` string
// literals (and `html:` attribute payloads) where X's declaring `el()` call
// carries a data-face class, with a ONE-HOP sink resolution for the
// `showToast(message)` shape (a bare parameter written to a data-face node
// makes the function a runtime sentence sink; its call sites — direct and
// through `toast: showToast`-style aliases — are judged across the tree).
// The reviewer's N2 (.textContent) and N8 (html:) probes are permanent
// self-checks below. Comments are stripped from the JS before any scan
// (string/template-aware, line numbers preserved) so a commented-out
// example never reddens the build.

// --------------------------------------------------------------------------
// File roots
// --------------------------------------------------------------------------
function walkJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** CB-BUILD-fix-round-3: the participant tree = the top-level app/ui/*.js
 * modules (app.js, router.js, session.js, theme.js — the reviewer's B5 probe
 * planted a sentence in app.js and the old roots missed it) plus the whole
 * screens/ and components/ trees. app/ui/console/** is the OPERATOR surface
 * (paired with console.css, which the participant page never links) and stays
 * out by construction. */
function participantJsFiles() {
  const out = [];
  for (const entry of fs.readdirSync(uiDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(path.join(uiDir, entry.name));
  }
  out.push(...walkJsFiles(screenDir));
  out.push(...walkJsFiles(componentDir));
  return out;
}

/** The stylesheets shipped to the PARTICIPANT (app/index.html's own <link>
 * tags) — the operator console (console.html/console.css) is not a
 * participant surface and never enters the scan. */
function participantStylesheets() {
  const html = fs.readFileSync(path.join(process.cwd(), 'app/index.html'), 'utf-8');
  const sheets = [];
  const re = /<link\s+rel="stylesheet"\s+href="\.\/(styles\/[^"]+\.css)"/g;
  let m;
  while ((m = re.exec(html))) sheets.push(path.join(process.cwd(), 'app', m[1]));
  return sheets;
}

// --------------------------------------------------------------------------
// CSS side: brace-balanced, at-rule-safe rule extraction (round-3 advisory:
// the old regex parser was blind to the FIRST rule inside an @media block —
// its declarations were swallowed into the at-rule prelude's match).
// --------------------------------------------------------------------------
/** Flat list of { selector, body } style rules. Comments are stripped first
 * so prose in a comment can never leak a phantom class into the set. Block
 * at-rules (@media/@supports/…) are recursed into; their inner rules come
 * back with their OWN selectors, so a rule first-inside-@media is seen. */
function cssRules(css) {
  const rules = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  (function walk(block) {
    let i = 0;
    let selStart = 0;
    while (i < block.length) {
      const ch = block[i];
      if (ch === '{') {
        const selector = block.slice(selStart, i).trim();
        let depth = 1;
        let j = i + 1;
        for (; j < block.length; j += 1) {
          if (block[j] === '{') depth += 1;
          else if (block[j] === '}') { depth -= 1; if (depth === 0) break; }
        }
        const body = block.slice(i + 1, j);
        if (selector.startsWith('@')) walk(body); // block at-rule: recurse
        else rules.push({ selector, body });
        i = j + 1;
        selStart = i;
      } else if (ch === '}' || ch === ';') { // stray close / statement at-rule (@import …;)
        i += 1;
        selStart = i;
      } else {
        i += 1;
      }
    }
  })(src);
  return rules;
}

/** Every class whose rule sets the given face (font-family: var(--font-<face>))
 * across the given CSS sources. */
function faceClassesFromCss(cssSources, face) {
  const classes = new Set();
  const decl = new RegExp(`font-family:\\s*var\\(--font-${face}\\)`);
  for (const css of cssSources) {
    for (const rule of cssRules(css)) {
      if (decl.test(rule.body)) {
        for (const cls of rule.selector.match(/\.[A-Za-z0-9_-]+/g) || []) classes.add(cls.slice(1));
      }
    }
  }
  return classes;
}

function faceClasses(sheetPaths, face) {
  return faceClassesFromCss(sheetPaths.map((p) => fs.readFileSync(p, 'utf-8')), face);
}

// --------------------------------------------------------------------------
// CB-BUILD-fix-round-4 (review advisory): the JS the scans read is stripped
// of comments FIRST — a commented-out `el(…)` example is documentation, not
// a rendered node (the round-4 review demonstrated a false positive on
// exactly that shape planted in pve.js). The stripper is string/template-
// aware (`//` inside a quoted string or URL template is content, not a
// comment) and replaces comment characters with spaces, keeping every
// newline, so reported line numbers are unchanged.
// --------------------------------------------------------------------------
function stripJsComments(src) {
  let out = '';
  let i = 0;
  let state = null; // null = code; otherwise the open quote char (' " `)
  while (i < src.length) {
    const c = src[i];
    if (state === null) {
      if (c === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') { out += ' '; i += 1; }
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        out += '  ';
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
          out += src[i] === '\n' ? '\n' : ' ';
          i += 1;
        }
        if (i < src.length) { out += '  '; i += 2; }
        continue;
      }
      if (c === "'" || c === '"' || c === '`') state = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if (c === state) state = null;
    out += c;
    i += 1;
  }
  return out;
}

// --------------------------------------------------------------------------
// JS side: every el(<tag>, …) call, tag-agnostic, with balanced attrs and
// children extraction (string/template aware, so braces and parens inside
// literals never derail the walk).
// --------------------------------------------------------------------------
function elCalls(src) {
  const calls = [];
  const re = /\bel\(\s*['"]([a-zA-Z0-9-]+)['"]\s*,/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    const parenOpen = src.indexOf('(', start);
    let depth = 0;
    let i = parenOpen;
    let inStr = null;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (inStr) {
        if (c === '\\') { i += 1; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
      if (c === '(') depth += 1;
      else if (c === ')') { depth -= 1; if (depth === 0) break; }
    }
    const end = i; // closing paren of the el() call
    const braceStart = src.indexOf('{', parenOpen);
    let attrs = '';
    let attrsStart = -1;
    let attrsEnd = -1;
    if (braceStart !== -1 && braceStart < end) {
      let d = 0;
      let j = braceStart;
      let s = null;
      for (; j <= end; j += 1) {
        const c = src[j];
        if (s) { if (c === '\\') { j += 1; continue; } if (c === s) s = null; continue; }
        if (c === "'" || c === '"' || c === '`') { s = c; continue; }
        if (c === '{') d += 1;
        else if (c === '}') { d -= 1; if (d === 0) break; }
      }
      attrs = src.slice(braceStart, j + 1);
      attrsStart = braceStart;
      attrsEnd = j;
    }
    calls.push({
      tag: m[1],
      start,
      end,
      attrs,
      attrsStart,
      attrsEnd,
      childrenSrc: attrsEnd !== -1 ? src.slice(attrsEnd + 1, end) : '',
    });
  }
  return calls;
}

/** Class tokens of an attrs object — quoted literal or template literal (the
 * template's static tokens; interpolations contribute nothing). A class
 * declared on any line of the attrs object is seen. */
function classListOf(attrs) {
  const out = [];
  const m = attrs.match(/class:\s*'([^']*)'/) || attrs.match(/class:\s*"([^"]*)"/);
  if (m) out.push(...m[1].split(/\s+/));
  const t = attrs.match(/class:\s*`([^`]*)`/);
  if (t) out.push(...t[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/));
  return out.filter(Boolean);
}

/** Static text of a template literal starting at src[i] === '`'. Every
 * `${…}` interpolation (brace-balanced, nested strings/templates skipped)
 * becomes a \u0000 placeholder; escapes are kept raw for later stripping.
 * Returns [staticText, indexAfterClosingBacktick]. */
function templateStaticText(src, i) {
  let out = '';
  i += 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if (c === '`') return [out, i + 1];
    if (c === '$' && src[i + 1] === '{') {
      out += '\u0000';
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        const d = src[i];
        if (d === "'" || d === '"') {
          const q = d;
          i += 1;
          while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; }
          i += 1;
          continue;
        }
        if (d === '`') { i = templateStaticText(src, i)[1]; continue; }
        if (d === '{') depth += 1;
        else if (d === '}') depth -= 1;
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return [out, i];
}

/** All string-literal texts and template static texts in a source region. */
function extractTexts(region) {
  const texts = [];
  let i = 0;
  while (i < region.length) {
    const c = region[i];
    if (c === "'" || c === '"') {
      const q = c;
      let out = '';
      i += 1;
      while (i < region.length && region[i] !== q) {
        if (region[i] === '\\') { out += region.slice(i, i + 2); i += 2; continue; }
        out += region[i];
        i += 1;
      }
      texts.push(out);
      i += 1;
    } else if (c === '`') {
      const [out, next] = templateStaticText(region, i);
      texts.push(out);
      i = next;
    } else {
      i += 1;
    }
  }
  return texts;
}

/** The copy tables of every shipped treatment — `copy.<key>` references in a
 * children region are AUTHORED COPY (the tieLine evasion: the sentence lives
 * in a JSON table, not in the JS literal), so the scan resolves them against
 * every treatment and judges the VALUES. */
function treatmentCopyTables() {
  const dir = path.join(process.cwd(), 'app/data/treatments');
  const tables = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    if (j && j.copy && typeof j.copy === 'object') tables.push(j.copy);
  }
  return tables;
}

// --------------------------------------------------------------------------
// The sentence heuristic (R11: "figures, counters, tags, and code ONLY,
// never body copy"). A text is SENTENCE-SHAPED (body copy) when, after
// stripping escapes (\uXXXX, \n, …), interpolation placeholders (\u0000) and
// authored-copy placeholders ({ADVANCE_OR_ELIMINATED}):
//   1. it has >= 2 letter-words, AND
//   2. at least one word carries a lowercase letter — text with NO lowercase
//      at all is the app's badge/label convention ("NEXT OPPONENT", "VOID",
//      "CRITICAL WIN", "SUMMONING COMBATANTS…", the provisional-render
//      badges) and reads as a TAG, permitted in the data face, AND
//   3. EITHER a word carries sentence-terminal punctuation (. ! ? …
//      directly after word text, closing quotes/brackets allowed)
//      OR it is multi-word natural language (>= 5 words, >= 2 lowercase).
// This catches every authored sentence the round-3 review flagged (see the
// self-check test) while passing genuine figures ("Score: ", cheddar
// arrows, "F/W/A" tendency rows, timestamps) and tags.
// --------------------------------------------------------------------------
function isParticipantSentence(raw) {
  let t = String(raw);
  t = t.replace(/\\u\{?[0-9a-fA-F]{1,6}\}?/g, ' '); // \uXXXX escapes (glyphs, emoji)
  t = t.replace(/\\[ntrbfv'"`\\]/g, ' ');           // control/quote escapes
  t = t.replace(/\u0000/g, ' ');                    // ${…} interpolation placeholders
  t = t.replace(/\{[A-Z_]+\}/g, ' ');               // authored-copy placeholders
  t = t.replace(/\s+/g, ' ').trim();
  const words = t.match(/[A-Za-z][A-Za-z'\u2019-]*/g) || [];
  if (words.length < 2) return false;
  const lower = words.filter((w) => /[a-z]/.test(w));
  if (lower.length === 0) return false; // ALL-CAPS badge/label = tag
  if (/[A-Za-z][)'"\u2019]*[.!?\u2026]/.test(t)) return true;
  if (words.length >= 5 && lower.length >= 2) return true;
  return false;
}

/** The texts a node's children render, for face purposes: string literals,
 * template static parts and resolved copy.<key> values in the children
 * region. Nested el() calls that carry their OWN face class are blanked out
 * (they are scanned in their own right — a nested .cb-prose paragraph does
 * not incriminate its data-face parent); nested calls WITHOUT a face class
 * only lose their attrs object (their text children INHERIT this node's
 * face, so wrapping a sentence in a bare <span> is not an escape). */
function childTexts(call, copyTables, dataClasses, proseClasses) {
  let region = call.childrenSrc;
  const blanks = [];
  for (const nested of elCalls(region)) {
    const cls = classListOf(nested.attrs);
    if (cls.some((c) => dataClasses.has(c) || proseClasses.has(c))) {
      blanks.push([nested.start, nested.end + 1]);
    } else if (nested.attrsStart !== -1) {
      blanks.push([nested.attrsStart, nested.attrsEnd + 1]);
    }
  }
  for (const [a, b] of blanks) region = region.slice(0, a) + ' '.repeat(b - a) + region.slice(b);
  const texts = extractTexts(region);
  const copyRe = /\bcopy\.([A-Za-z0-9_]+)/g;
  let m;
  while ((m = copyRe.exec(region))) {
    for (const table of copyTables) {
      if (typeof table[m[1]] === 'string') texts.push(table[m[1]]);
    }
  }
  return texts;
}

// --------------------------------------------------------------------------
// Allow-judgments (CB-BUILD-fix-round-3, item 5): sentence-shaped texts the
// round-3 REVIEW judged to be TAGS, permitted in the data face. The judgment
// is recorded here so the call is visible; anything not on this list that
// scans as a sentence on a data-face node FAILS the build.
// --------------------------------------------------------------------------
const ALLOW_JUDGMENTS = [
  {
    file: 'app/ui/screens/wallet.js',
    match: (t) => t.trim() === 'Retired to the ledger.',
    reason: 'STATUS TAG on a retired character card (reviewer round-3 judgment: a state label like RETIRED, not body copy)',
  },
  {
    file: 'app/ui/screens/duel.js',
    match: (t) => t.includes('over the last') && t.includes('staked duel'),
    reason: 'scouting RECORD + qualifying clause — a figure row (W-L record with its sample-size qualifier), reviewer round-3 judgment',
  },
  {
    file: 'app/ui/screens/lobby.js',
    match: (t) => t.includes('waiting for a 2nd human'),
    reason: 'seat PLACEHOLDER tag in the lobby seat grid (…waiting…-family status label), reviewer round-3 judgment',
  },
];

function isAllowJudged(relFile, text) {
  const t = text.replace(/\u0000/g, ' ');
  return ALLOW_JUDGMENTS.some((a) => a.file === relFile.split(path.sep).join('/') && a.match(t));
}

/** Scan one source string: every el() node carrying a data-face class whose
 * children carry sentence-shaped text. Returns { line, tag, classes,
 * sentences, judged } records. Comments are stripped first (round-4
 * advisory: a commented-out el() example is not a rendered node). */
function scanSource(rawSrc, relFile, dataClasses, proseClasses, copyTables) {
  const src = stripJsComments(rawSrc);
  const hits = [];
  for (const call of elCalls(src)) {
    const classes = classListOf(call.attrs);
    const bad = classes.filter((c) => dataClasses.has(c));
    if (bad.length === 0) continue;
    const sentences = childTexts(call, copyTables, dataClasses, proseClasses).filter(isParticipantSentence);
    if (sentences.length === 0) continue;
    const line = src.slice(0, call.start).split('\n').length;
    const judged = sentences.every((s) => isAllowJudged(relFile, s));
    hits.push({ line, tag: call.tag, classes, badClasses: bad, sentences, judged });
  }
  return hits;
}

function scanContext() {
  const sheets = participantStylesheets();
  return {
    sheets,
    dataClasses: faceClasses(sheets, 'data'),
    proseClasses: faceClasses(sheets, 'prose'),
    copyTables: treatmentCopyTables(),
  };
}

// --------------------------------------------------------------------------
// CB-BUILD-fix-round-4: the RUNTIME-WRITE rule. The round-4 review's two
// live crucials were both runtime-written text (its N2/N8 evasion shapes):
// the child scan above reads what el() calls AUTHOR, not what code assigns
// later. Three sub-rules, all keyed on the same face derivation and the
// same sentence heuristic:
//   1. `X.textContent = <expr>` where X's declaring el() call carries a
//      data-face class: every string literal / template static in the
//      assigned expression is judged (N2 — the duel.js verdict-line shape).
//   2. one-hop SINK resolution: when the assigned expression is a bare
//      parameter of the enclosing function (`showToast(message)` writing
//      `node.textContent = message` to a data-face node), the function is a
//      runtime sentence sink; its call sites — direct calls and calls
//      through an object-property alias (`toast: showToast` → `ctx.toast`)
//      — are judged across the whole participant tree (the toast shape).
//   3. `html:` attribute payloads on a data-face el() call: injected markup
//      is rendered text like any child (N8).
// --------------------------------------------------------------------------
/** Variable bindings to el() calls: `const X = el(…)` / `let X = el(…)` /
 * `X = el(…)`. The last binding of a name in the file wins. */
function elVarBindings(src) {
  const bindings = new Map();
  for (const call of elCalls(src)) {
    const before = src.slice(Math.max(0, call.start - 80), call.start);
    const m = before.match(/(?:const|let|var)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*$/);
    if (m) bindings.set(m[1], call);
  }
  return bindings;
}

/** The right-hand side of an assignment starting at `from`, up to the
 * statement's `;` (or an unbalanced closer) at depth 0, string-aware. */
function assignmentRhs(src, from) {
  let depth = 0;
  let inStr = null;
  let i = from;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i += 1; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') { if (depth === 0) break; depth -= 1; }
    else if (c === ';' && depth === 0) break;
  }
  return src.slice(from, i);
}

/** The nearest function header (declaration or arrow-const) preceding `pos`:
 * { name, params }. Good enough for the sink shape — a helper whose body
 * assigns its own parameter to a node it declared. */
function enclosingFunctionInfo(src, pos) {
  const re = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\))|(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>)/g;
  let m;
  let best = null;
  while ((m = re.exec(src))) {
    if (m.index > pos) break;
    best = {
      name: m[1] || m[3],
      params: (m[2] !== undefined ? m[2] : m[4] || '').split(',').map((p) => p.split('=')[0].trim()).filter(Boolean),
    };
  }
  return best;
}

/** The inside of the balanced paren region opening at src[openIdx]. */
function balancedParenRegion(src, openIdx) {
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < src.length; i += 1) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i += 1; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return src.slice(openIdx + 1);
}

/** Literal/template static payloads of an `html:` attribute. */
function htmlPayloadTexts(attrs) {
  const out = [];
  const q = attrs.match(/html:\s*'([^']*)'/) || attrs.match(/html:\s*"([^"]*)"/);
  if (q) out.push(q[1]);
  const tIdx = attrs.search(/html:\s*`/);
  if (tIdx !== -1) out.push(templateStaticText(attrs, attrs.indexOf('`', tIdx))[0]);
  return out;
}

/** The runtime-write scan over a { relFile → source } map (cross-file, so
 * a sink declared in dom.js binds its call sites everywhere). Returns
 * violation strings; comments are stripped before reading. */
function runtimeWriteIssues(rawFileMap, dataClasses) {
  const fileMap = new Map();
  for (const [rel, raw] of rawFileMap) fileMap.set(rel, stripJsComments(raw));
  const issues = [];
  const sinks = [];
  for (const [rel, src] of fileMap) {
    const bindings = elVarBindings(src);
    const re = /([A-Za-z_$][\w$]*)\.textContent\s*=(?!=)/g;
    let m;
    while ((m = re.exec(src))) {
      const call = bindings.get(m[1]);
      if (!call) continue;
      const classes = classListOf(call.attrs);
      if (!classes.some((c) => dataClasses.has(c))) continue;
      const rhs = assignmentRhs(src, m.index + m[0].length);
      const line = src.slice(0, m.index).split('\n').length;
      const sentences = extractTexts(rhs).filter(isParticipantSentence);
      if (sentences.length > 0) {
        issues.push(`${rel}:${line}: runtime textContent write puts sentence-shaped text on <${call.tag} class="${classes.join(' ')}">: ${sentences.map((s) => JSON.stringify(s.slice(0, 80))).join(' | ')}`);
      }
      const bare = rhs.trim().match(/^([A-Za-z_$][\w$]*)$/);
      if (bare) {
        const fn = enclosingFunctionInfo(src, m.index);
        if (fn && fn.name && fn.params.includes(bare[1])) {
          sinks.push({ fn: fn.name, tag: call.tag, classes, declFile: rel });
        }
      }
    }
    for (const call of elCalls(src)) {
      const classes = classListOf(call.attrs);
      if (!classes.some((c) => dataClasses.has(c))) continue;
      const payloads = htmlPayloadTexts(call.attrs).filter(isParticipantSentence);
      if (payloads.length > 0) {
        const line = src.slice(0, call.start).split('\n').length;
        issues.push(`${rel}:${line}: html: payload puts sentence-shaped markup on <${call.tag} class="${classes.join(' ')}">: ${payloads.map((s) => JSON.stringify(s.slice(0, 80))).join(' | ')}`);
      }
    }
  }
  for (const sink of sinks) {
    const aliases = new Set();
    for (const [, src] of fileMap) {
      const aliasRe = new RegExp(`([A-Za-z_$][\\w$]*)\\s*:\\s*${sink.fn}\\b`, 'g');
      let a;
      while ((a = aliasRe.exec(src))) aliases.add(a[1]);
    }
    const callRes = [new RegExp(`(?<![\\w$.])${sink.fn}\\s*\\(`, 'g')];
    for (const alias of aliases) callRes.push(new RegExp(`[\\w$\\])]\\.${alias}\\s*\\(`, 'g'));
    for (const [rel, src] of fileMap) {
      for (const re of callRes) {
        let m;
        while ((m = re.exec(src))) {
          const open = src.indexOf('(', m.index + m[0].length - 1);
          const args = balancedParenRegion(src, open);
          const sentences = extractTexts(args).filter(isParticipantSentence);
          if (sentences.length > 0) {
            const line = src.slice(0, m.index).split('\n').length;
            issues.push(`${rel}:${line}: sentence reaches the data face at RUNTIME through sink ${sink.fn}() -> <${sink.tag} class="${sink.classes.join(' ')}"> (declared in ${sink.declFile}): ${sentences.map((s) => JSON.stringify(s.slice(0, 80))).join(' | ')}`);
          }
        }
      }
    }
  }
  return issues;
}

// --------------------------------------------------------------------------
// THE UNIVERSAL (R11): no participant node carrying a data-face class renders
// sentence-shaped text — any tag, any file in the participant tree.
// --------------------------------------------------------------------------
test('CB-BUILD-fix-round-3: SENTENCE-KEYED scan — no el(<any tag>) in the participant tree (app/ui/*.js + screens/** + components/**) carrying a data-face class renders sentence-shaped text', async (t) => {
  const { sheets, dataClasses, proseClasses, copyTables } = scanContext();
  assert(sheets.length >= 2, `expected the participant page to ship at least base+battle stylesheets, found ${sheets.length}`);
  assert(sheets.some((s) => s.endsWith('base.css')) && sheets.some((s) => s.endsWith('battle.css')), 'scan sanity: base.css and battle.css are the shipped participant sheets');
  assert(!sheets.some((s) => s.endsWith('console.css')), 'operator console styles must not enter the participant scan (not participant-facing)');

  // Face-blindness guard: the derived set must contain the classes the old
  // scans were blind to — the scan is keyed on the face, not on one name.
  // (Round-4 advisory: the FIX PINS — assertions that a specific reclassed
  // class stays prose-face — moved to their own test below, so a reverted
  // fix trips the pin test while THIS test still runs its loop and reports
  // the universal's own enumeration.)
  for (const known of ['cb-legal', 'cb-micro', 'cb-data', 'cb-result-line', 'cb-result-delta']) {
    assert(dataClasses.has(known), `face-keyed derivation sanity: expected '${known}' in the data-face class set`);
  }
  assert(proseClasses.has('cb-prose'), 'prose-face derivation sanity: cb-prose derives');

  const files = participantJsFiles();
  assert(files.length >= 20, `scan sanity: expected the whole participant UI tree, found ${files.length} files`);
  // Round-3 widened roots (reviewer B5): the top-level ui modules are scanned.
  for (const mustHave of ['app.js', 'router.js']) {
    assert(files.some((f) => path.dirname(f) === uiDir && path.basename(f) === mustHave), `scan roots must include app/ui/${mustHave}`);
  }
  assert(!files.some((f) => f.includes(`${path.sep}console${path.sep}`)), 'the operator console UI is not a participant surface');

  const foundIssues = [];
  for (const filePath of files) {
    const rel = path.relative(process.cwd(), filePath);
    const src = fs.readFileSync(filePath, 'utf-8');
    for (const hit of scanSource(src, rel, dataClasses, proseClasses, copyTables)) {
      if (!hit.judged) {
        foundIssues.push(`${rel}:${hit.line}: <${hit.tag} class="${hit.classes.join(' ')}"> renders sentence-shaped text in the data face: ${hit.sentences.map((s) => JSON.stringify(s.slice(0, 80))).join(' | ')}`);
      }
    }
  }
  assert.strictEqual(
    foundIssues.length,
    0,
    `R11: every sentence a player reads wears the prose face — found participant body copy set in the data face:\n${foundIssues.join('\n')}`
  );
});

// --------------------------------------------------------------------------
// THE UNIVERSAL, RUNTIME HALF (CB-BUILD-fix-round-4): R11 binds text however
// it arrives — no textContent assignment, runtime sentence sink, or html:
// payload puts sentence-shaped text on a data-face node either.
// --------------------------------------------------------------------------
test('CB-BUILD-fix-round-4: RUNTIME-WRITE scan — no textContent assignment, one-hop runtime sink, or html: payload puts sentence-shaped text on a data-face node in the participant tree', async (t) => {
  const { dataClasses } = scanContext();
  const fileMap = new Map();
  for (const filePath of participantJsFiles()) {
    fileMap.set(path.relative(process.cwd(), filePath).split(path.sep).join('/'), fs.readFileSync(filePath, 'utf-8'));
  }
  assert(fileMap.size >= 20, `scan sanity: expected the whole participant UI tree, found ${fileMap.size} files`);
  const issues = runtimeWriteIssues(fileMap, dataClasses);
  assert.strictEqual(
    issues.length,
    0,
    `R11 binds runtime-written text too — found sentence-shaped runtime writes reaching the data face:\n${issues.join('\n')}`
  );
});

// --------------------------------------------------------------------------
// FIX PINS (round-4 advisory: kept OUT of the universal tests so a reverter
// always sees the universals' own enumeration; reverting a landed fix trips
// THIS test instead).
// --------------------------------------------------------------------------
test('CB-BUILD-fix-round-3/4: fix pins — the reclassed surfaces stay prose-face (moment captions; the toast; the coin-flip verdict line)', async (t) => {
  const { dataClasses, proseClasses } = scanContext();
  // Round 3: the caption class (captions are authored sentences).
  assert(!dataClasses.has('cb-moment-caption'), 'CB-BUILD-fix-round-3: .cb-moment-caption carries the prose face now (captions are authored sentences)');
  assert(proseClasses.has('cb-moment-caption'), 'prose-face derivation: the reclassed cb-moment-caption derives');
  // Round 4: the toast is a runtime sentence surface (ledger notices,
  // summon errors, reminders) — it wears the prose face; R11 constrains the
  // DATA face only, so figure toasts like "+150C" are fine in prose.
  assert(!dataClasses.has('cb-toast'), 'CB-BUILD-fix-round-4: .cb-toast must not derive as data-face — showToast() writes participant sentences to it at runtime');
  assert(proseClasses.has('cb-toast'), 'CB-BUILD-fix-round-4: .cb-toast carries the prose face');
  // Round 4: the coin-flip verification verdict line matches its four
  // prose-face siblings in the same card.
  const duel = fs.readFileSync(path.join(screenDir, 'duel.js'), 'utf-8');
  assert(
    /const resultLine = el\('div', \{ class: 'cb-prose cb-prose-small', style: 'margin-top:6px;' \}, ''\)/.test(duel),
    "duel.js: the coin-flip verification verdict line (resultLine) must carry .cb-prose .cb-prose-small"
  );
});

// --------------------------------------------------------------------------
// Self-checks for the runtime-write rule: the reviewer's N2 and N8 probes as
// permanent synthetic fixtures (red when the rule is evaded), the one-hop
// toast sink shape, and the clean shapes that must keep passing.
// --------------------------------------------------------------------------
test("CB-BUILD-fix-round-4: self-check — the runtime-write rule flags the reviewer's N2 (.textContent sentence) and N8 (html: payload) shapes and resolves the toast sink one hop; figures, timers and markup payloads pass", async (t) => {
  const { dataClasses } = scanContext();

  // N2 — the live duel.js shape: a data-face node written at runtime with
  // sentence literals (incl. the ternary form).
  const n2 = [
    "const line = el('div', { class: 'cb-micro' }, '');",
    'function verdict(ok) {',
    '  line.textContent = ok',
    "    ? 'A verdict sentence written at runtime evades the child scan.'",
    "    : 'Another verdict sentence — the mismatch case.';",
    '}',
  ].join('\n');
  const n2Issues = runtimeWriteIssues(new Map([['app/ui/screens/x.js', n2]]), dataClasses);
  assert.strictEqual(n2Issues.length, 1, `N2 must be flagged (red when evaded): ${n2}`);
  assert(n2Issues[0].includes('cb-micro') && n2Issues[0].includes('verdict sentence'), `N2 issue names the node and the sentence: ${n2Issues[0]}`);

  // N8 — a sentence injected as raw HTML via el()'s html: attribute.
  const n8 = "el('div', { class: 'cb-micro', html: 'A sentence injected as raw HTML markup.' })";
  const n8Issues = runtimeWriteIssues(new Map([['app/ui/screens/x.js', n8]]), dataClasses);
  assert.strictEqual(n8Issues.length, 1, `N8 must be flagged (red when evaded): ${n8}`);

  // The toast shape: a sink function writing its parameter to a data-face
  // node, called through an object-property alias in ANOTHER file.
  const sinkDecl = [
    'export function myToast(message) {',
    "  let node = document.getElementById('t');",
    "  if (!node) { node = el('div', { id: 't', class: 'cb-micro' }); document.body.appendChild(node); }",
    '  node.textContent = message;',
    '}',
  ].join('\n');
  const sinkFixture = new Map([
    ['app/ui/components/sink.js', sinkDecl],
    ['app/ui/app-fixture.js', 'const ctx = { toast: myToast };'],
    ['app/ui/screens/caller.js', [
      "ctx.toast('A sentence delivered through the runtime toast sink.');",
      'ctx.toast(`+${cheddar(delta)}`);',
      'ctx.toast(playerFacingError(e));',
    ].join('\n')],
  ]);
  const sinkIssues = runtimeWriteIssues(sinkFixture, dataClasses);
  assert.strictEqual(sinkIssues.length, 1, `the sink shape must flag exactly the sentence call site: ${JSON.stringify(sinkIssues)}`);
  assert(sinkIssues[0].startsWith('app/ui/screens/caller.js:1:') && sinkIssues[0].includes('myToast()'), `the issue names the call site and the sink: ${sinkIssues[0]}`);

  // …and the same sink writing to a PROSE-face node flags nothing (the
  // round-4 toast fix: the surface's face changed, not the strings).
  const proseSink = new Map(sinkFixture);
  proseSink.set('app/ui/components/sink.js', sinkDecl.replace("class: 'cb-micro'", "class: 'cb-prose'"));
  assert.strictEqual(runtimeWriteIssues(proseSink, dataClasses).length, 0, 'a prose-face sink carries sentences legitimately');

  // Clean shapes that must keep passing:
  const clean = [
    // the commit-clock shape: a template FIGURE written per tick
    "let tnode = null;\nfunction tick(ms) {\n  tnode = el('span', { class: 'cb-micro' }, '');\n  tnode.textContent = `${Math.ceil(ms / 1000)}s`;\n}",
    // a sentence written to a PROSE-face node — exactly where it belongs
    "const p = el('div', { class: 'cb-prose cb-prose-small' }, '');\np.textContent = 'A sentence on a prose-face node is exactly where sentences belong.';",
    // a spinner tag written to a data-face node (single word — a tag)
    "const s = el('div', { class: 'cb-micro' }, '');\ns.textContent = 'Verifying…';",
    // an html: payload that is a function call, not authored text
    "el('span', { class: 'cb-data', html: elementSvgMarkup(element, 40) })",
    // a write to a node the scan never saw declared via el()
    "other.textContent = 'Not an el()-declared node; out of this rule\\u2019s reach.';",
  ];
  for (const fixture of clean) {
    const hits = runtimeWriteIssues(new Map([['app/ui/screens/x.js', fixture]]), dataClasses);
    assert.strictEqual(hits.length, 0, `the runtime rule must not flag legitimate usage: ${fixture}`);
  }
});

test('CB-BUILD-fix-round-4: self-check — commented-out code is documentation: both scans skip it, live code after a comment still reports the right line, and // inside a string is content', async (t) => {
  const { dataClasses, proseClasses, copyTables } = scanContext();

  // The round-4 review's demonstrated false positive: a commented-out el()
  // example must not redden the build.
  const lineComment = "// el('div', { class: 'cb-micro' }, 'This example in a comment is not rendered at all.')";
  assert.strictEqual(scanSource(lineComment, 'app/ui/screens/x.js', dataClasses, proseClasses, copyTables).length, 0, 'a //-commented el() example is not a rendered node');
  const blockComment = "/* el('p', { class: 'cb-legal' }, 'A sentence in a block comment is documentation.') */";
  assert.strictEqual(scanSource(blockComment, 'app/ui/screens/x.js', dataClasses, proseClasses, copyTables).length, 0, 'a block-commented el() example is not a rendered node');

  // Live code after a comment is still caught, at its true line number.
  const mixed = "// docs: el('div', { class: 'cb-micro' }, 'Commented example sentence, not rendered.')\nel('div', { class: 'cb-micro' }, 'A live sentence right after the comment.')";
  const mixedHits = scanSource(mixed, 'app/ui/screens/x.js', dataClasses, proseClasses, copyTables);
  assert.strictEqual(mixedHits.length, 1, 'the live call after the comment is still flagged');
  assert.strictEqual(mixedHits[0].line, 2, 'line numbers survive comment stripping');

  // `//` inside a string literal is content, not a comment.
  const urlish = "el('div', { class: 'cb-micro' }, 'A sentence with a URL https://example.com inside it.')";
  assert.strictEqual(scanSource(urlish, 'app/ui/screens/x.js', dataClasses, proseClasses, copyTables).length, 1, 'a string containing // is not a comment');

  // The runtime rule skips commented-out writes too.
  const commentedWrite = "const line = el('div', { class: 'cb-micro' }, '');\n// line.textContent = 'A commented-out runtime sentence.';";
  assert.strictEqual(runtimeWriteIssues(new Map([['app/ui/screens/x.js', commentedWrite]]), dataClasses).length, 0, 'a commented-out textContent write is documentation');
});

// --------------------------------------------------------------------------
// The allow-judgments stay LIVE: the three reviewer-judged tag sites still
// exist, still scan as sentence-shaped, and are passed ONLY by judgment —
// so the carve-out is visible and exactly as wide as the review said.
// --------------------------------------------------------------------------
test('CB-BUILD-fix-round-3: the three reviewer-judged data-face tags (wallet status, scouting record clause, lobby seat placeholder) are live, sentence-shaped, and passed by RECORDED judgment only', async (t) => {
  const { dataClasses, proseClasses, copyTables } = scanContext();
  const expected = [
    ['app/ui/screens/wallet.js', 'Retired to the ledger.'],
    ['app/ui/screens/duel.js', 'over the last'],
    ['app/ui/screens/lobby.js', 'waiting for a 2nd human'],
  ];
  for (const [rel, needle] of expected) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
    assert(src.includes(needle), `${rel}: the judged tag site should still exist (contains ${JSON.stringify(needle)})`);
    const judgedHits = scanSource(src, rel, dataClasses, proseClasses, copyTables)
      .filter((h) => h.judged && h.sentences.some((s) => s.replace(/\u0000/g, ' ').includes(needle)));
    assert.strictEqual(judgedHits.length, 1, `${rel}: expected exactly one allow-judged data-face hit for ${JSON.stringify(needle)} — the judgment must be doing real work (the text IS sentence-shaped) and must stay that narrow`);
  }
  assert.strictEqual(ALLOW_JUDGMENTS.length, 3, 'the allow-judgment list is exactly the three reviewer-judged rows — widening it requires a recorded review judgment');
});

// --------------------------------------------------------------------------
// Self-checks: the scan CATCHES what it is built to catch — including the
// round-3 reviewer's evasion probes as permanent fixtures (synthetic strings,
// never committed source mutations).
// --------------------------------------------------------------------------
test('CB-BUILD-fix-round-3: self-check — the sentence-keyed scan flags data-face sentences on ANY tag, in any file, via literals, templates, copy refs, wrappers and multi-line attrs', async (t) => {
  const { dataClasses, proseClasses, copyTables } = scanContext();
  const flagged = [
    // Reviewer evasion probe B3 (previously GREEN, now RED): a data-face
    // sentence on a <div> in an un-enumerated file.
    ["app/ui/screens/anywhere.js", "el('div', { class: 'cb-micro' }, 'A sentence the player reads, on a div.')"],
    // Reviewer evasion probe B5: a participant <p> sentence in app/ui/app.js
    // (the widened roots cover the file; the scan covers the tag).
    ['app/ui/app.js', "el('p', { class: 'cb-data' }, 'A paragraph sentence planted in app.js is caught.')"],
    // The round-3 crucial shapes, as permanent regression fixtures:
    ['app/ui/components/battle/rails.js', "el('div', { class: 'cb-result-line' }, treatment.copy.tieLine.replace('{ADVANCE_OR_ELIMINATED}', x))"], // authored copy resolved from the treatment tables
    ['app/ui/components/battle/moments.js', "el('div', { class: 'cb-micro' }, `${loserName} — struck from the ledger.`)"], // template static part
    ['app/ui/screens/duel.js', "el('div', { class: 'cb-micro', style: 'margin-top:4px;' }, 'Still being decided elsewhere in the bracket…')"], // ellipsis terminal
    // Round-2 shapes still bind, tag-agnostically:
    ["app/ui/screens/x.js", "el('p', { class: 'cb-micro' }, 'a sentence a player reads without terminal punctuation')"],
    ["app/ui/screens/x.js", "el('p', { class: 'cb-legal' }, treatment.copy.loadFundsLegal)"], // copy ref resolution
    ["app/ui/screens/x.js", "el('p', {\n  style: 'margin-top:6px;',\n  class: 'cb-result-line',\n}, 'A caption-like sentence hides here.')"], // multi-line attrs
    ["app/ui/screens/x.js", "el('div', { class: `cb-result-line ${cls}` }, 'A sentence behind a template class.')"], // class in a template literal
    ["app/ui/screens/x.js", "el('div', { class: 'cb-micro' }, [el('span', {}, 'A sentence wrapped in a bare span inherits the face.')])"], // wrapper is not an escape
  ];
  for (const [rel, fixture] of flagged) {
    const hits = scanSource(fixture, rel, dataClasses, proseClasses, copyTables).filter((h) => !h.judged);
    assert.strictEqual(hits.length, 1, `the scan must flag: ${fixture}`);
  }

  // …and does NOT flag prose-face body copy, genuine figures, counters, tags.
  const clean = [
    "el('p', { class: 'cb-prose cb-prose-small' }, card.fairTestLine)",
    "el('p', { class: 'cb-prose' }, 'A real sentence, correctly set in the prose face.')",
    "el('div', { class: 'cb-micro' }, '12:04:33')", // timestamp
    "el('span', { class: 'cb-data' }, cheddar(amount))", // figure
    "el('div', { class: 'cb-result-line' }, `Score: ${scoreString}`)", // labelled figure
    "el('span', { class: 'cb-micro' }, 'NEXT OPPONENT')", // label (no lowercase = tag convention)
    "el('div', { class: 'cb-provisional-badge cb-micro' }, 'PROVISIONAL RENDER. BOT ART PENDING SUPPLY.')", // ALL-CAPS badge
    "el('span', { class: 'cb-badge big' }, `CRITICAL ${r.result}`)", // badge
    "el('div', { class: 'cb-micro' }, `${treatment.elements[r.element].label} \\u00b7 F/W/A ${tendencyLabel(r.tendency)} \\u00b7 ${rec.w}-${rec.l}`)", // tendency figure row
    "el('div', { class: 'cb-round-row' }, [el('p', { class: 'cb-prose' }, 'A prose-face child does not incriminate its data-face parent.')])",
    "el('div', { class: 'cb-result-line' }, [el('span', {}, `${name}: `), `${cheddar(before)} \\u2192 ${cheddar(after)} `])", // combatant figure row
  ];
  for (const fixture of clean) {
    const hits = scanSource(fixture, 'app/ui/screens/x.js', dataClasses, proseClasses, copyTables);
    assert.strictEqual(hits.length, 0, `the scan must not flag legitimate usage: ${fixture}`);
  }
});

test('CB-BUILD-fix-round-3: self-check — the CSS parser is brace-balanced and at-rule-safe (reviewer probe B4b: a rule FIRST inside @media is derived)', async (t) => {
  const synthetic = `
    /* a comment with .cb-phantom { font-family: var(--font-data); } inside */
    @media (max-width: 480px) {
      .cb-first-in-media { font-family: var(--font-data); }
      .cb-second-in-media { color: red; }
    }
    @supports (display: grid) {
      @media (min-width: 900px) {
        .cb-nested-at-rule { font-family: var(--font-data); }
      }
    }
    .cb-after-at-rules { font-family: var(--font-data); }
    .cb-prose-like { font-family: var(--font-prose); }
  `;
  const data = faceClassesFromCss([synthetic], 'data');
  assert(data.has('cb-first-in-media'), 'B4b: the FIRST rule inside an @media block must be derived (the old regex parser was blind to it)');
  assert(data.has('cb-nested-at-rule'), 'rules nested two at-rules deep must be derived');
  assert(data.has('cb-after-at-rules'), 'rules after an at-rule block must be derived');
  assert(!data.has('cb-second-in-media'), 'a rule without the data face must not be derived');
  assert(!data.has('cb-phantom'), 'comments are stripped before derivation');
  assert(!data.has('cb-prose-like'), 'prose-face rules never enter the data set');
  const prose = faceClassesFromCss([synthetic], 'prose');
  assert(prose.has('cb-prose-like'), 'the prose-face derivation reads the same parser');

  // The real sheets parse identically rule-for-rule where it matters: the
  // known data-face classes still derive (regression against parser rewrite).
  const real = faceClasses(participantStylesheets(), 'data');
  for (const known of ['cb-legal', 'cb-micro', 'cb-data', 'cb-result-line', 'cb-result-delta', 'cb-npc-tag', 'cb-timer']) {
    assert(real.has(known), `real-sheet regression: '${known}' must still derive from the brace-balanced parser`);
  }
});

// --------------------------------------------------------------------------
// The round-3 fixes themselves (items 1–3): tie line, moment captions,
// intermission sentence.
// --------------------------------------------------------------------------
test('CB-BUILD-fix-round-3: the true-tie line wears the prose face; the sibling result FIGURES stay data-face', async (t) => {
  const src = fs.readFileSync(path.join(componentDir, 'battle/rails.js'), 'utf-8');
  assert(
    /el\('div', \{ class: 'cb-prose cb-prose-small' \}, treatment\.copy\.tieLine\.replace/.test(src),
    'rails.js: the true-tie line (three authored sentences) must carry .cb-prose .cb-prose-small'
  );
  assert(
    /el\('div', \{ class: 'cb-result-line' \}, `Score: \$\{scoreString\}`\)/.test(src),
    'rails.js: the Score figure row stays data-face (.cb-result-line)'
  );
  assert(
    /return el\('div', \{ class: 'cb-result-line' \}, \[\s*el\('span', \{\}, `\$\{name\}/.test(src),
    'rails.js: the combatant before/after/delta figure rows stay data-face (.cb-result-line)'
  );
  assert(/class: 'cb-result-delta'/.test(src), 'rails.js: the delta figure stays data-face (.cb-result-delta)');
});

test('CB-BUILD-fix-round-3: .cb-moment-caption is prose-face with the <p>-margin clearance restored (12px top over the 10px flex gap)', async (t) => {
  const css = fs.readFileSync(path.join(process.cwd(), 'app/styles/battle.css'), 'utf-8');
  const rule = cssRules(css).find((r) => r.selector === '.cb-moment-caption');
  assert(rule, 'expected a .cb-moment-caption rule in battle.css');
  assert(/font-family:\s*var\(--font-prose\)/.test(rule.body), 'the caption class carries the PROSE face (captions are authored sentences a player reads)');
  assert(/margin:\s*12px 0 0/.test(rule.body), 'the caption restores the ~12px clearance its old <p> UA margin gave it (round-2 .cb-result-delta precedent)');
  // The class is caption-only: all four moment captions still use it.
  const moments = fs.readFileSync(path.join(componentDir, 'battle/moments.js'), 'utf-8');
  const captionCount = (moments.match(/class: 'cb-moment-caption'/g) || []).length;
  assert.strictEqual(captionCount, 4, 'all four moment captions render through .cb-moment-caption');
});

test("CB-BUILD-fix-round-3: the intermission's NEXT OPPONENT placeholder sentence wears the prose face", async (t) => {
  const src = fs.readFileSync(path.join(screenDir, 'duel.js'), 'utf-8');
  assert(
    /el\('div', \{ class: 'cb-prose cb-prose-small', style: 'margin-top:4px;' \}, 'Still being decided elsewhere in the bracket…'\)/.test(src),
    "duel.js: 'Still being decided elsewhere in the bracket…' must carry .cb-prose .cb-prose-small"
  );
});

// --------------------------------------------------------------------------
// Prior rounds' reclass expectations (unchanged behaviour, kept as regression)
// --------------------------------------------------------------------------
test('CB-BUILD-fix-round-2 (B): the remaining data-face participant sentences are reclassed to the prose face', async (t) => {
  const expectations = [
    // duel.js — the scouting/brief fair-test line (identical string already
    // prose-face on sitting/lobby-entry/pve; this site now matches them)
    ['app/ui/screens/duel.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, card\.fairTestLine\)/],
    // duel.js — the intermission's board line
    ['app/ui/screens/duel.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, 'The updated board:'\)/],
    // lobby-entry.js — the below-floor PvE hint
    ['app/ui/screens/lobby-entry.js', /el\('p', \{ class: 'cb-prose cb-prose-small', style: 'margin-top:6px;' \}, 'Even a re-entry bonus would not clear the floor yet — PvE first\.'\)/],
    // lobby.js — BOTH lobby status sentences (one ternary <p>)
    ['app/ui/screens/lobby.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, lobby\.phase === 'COUNTDOWN' \? 'All seated\. Locking the bracket…' : 'Seating humans first, NPCs fill the rest — every NPC seat is tagged\.'\)/],
  ];
  for (const [file, re] of expectations) {
    const content = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
    assert(re.test(content), `${file}: expected reclassed prose-face sentence matching ${re}`);
  }
});

test('CB-BUILD-fix-round-1 #5: the reclassed fine-print sentences carry the prose face (with the small modifier where the old footprint mattered)', async (t) => {
  const expectations = [
    ['app/ui/components/money-sheets.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, treatment\.copy\.loadFundsLegal\)/],
    ['app/ui/components/chrome.js', /el\('p', \{ class: 'cb-prose' \}, 'The operator has halted/],
    ['app/ui/components/chrome.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, 'This is the kill switch/],
    ['app/ui/screens/duel.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, `Commitment \(recorded BEFORE the flip\)/],
    ['app/ui/screens/duel.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, `Revealed seed \(AFTER the flip\)/],
    ['app/ui/screens/duel.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, 'Recompute:/],
    ['app/ui/screens/duel.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, 'Honest limit:/],
    ['app/ui/screens/sitting.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, card\.fairTestLine\)/],
    ['app/ui/screens/lobby-entry.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, card\.fairTestLine\)/],
    ['app/ui/screens/pve.js', /el\('p', \{ class: 'cb-prose cb-prose-small' \}, card\.fairTestLine\)/],
  ];
  for (const [file, re] of expectations) {
    const content = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
    assert(re.test(content), `${file}: expected reclassed prose-face sentence matching ${re}`);
  }
});

test('CB-BUILD-fix-round-1 #5: the .cb-prose-small modifier keeps the prose FACE (it only shrinks size/color — never sets a font-family)', async (t) => {
  const cssContent = fs.readFileSync(path.join(process.cwd(), 'app/styles/base.css'), 'utf-8');
  const rule = cssContent.match(/\.cb-prose\.cb-prose-small\s*\{([^}]+)\}/s);
  assert(rule, 'expected a .cb-prose.cb-prose-small rule in base.css');
  assert(!/font-family/.test(rule[1]), 'the small modifier must not change the face — R11: the face is the law');
});

test('CB-BUILD-004: .cb-prose class is defined in base.css with Barlow font', async (t) => {
  const cssPath = path.join(process.cwd(), 'app/styles/base.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  // Check that .cb-prose class exists
  assert(
    cssContent.includes('.cb-prose'),
    '.cb-prose class not found in base.css'
  );

  // Check that it uses --font-prose (Barlow)
  assert(
    cssContent.includes('font-family: var(--font-prose)') && cssContent.includes('.cb-prose'),
    '.cb-prose does not use var(--font-prose)'
  );

  // Check that Barlow is defined as --font-prose
  assert(
    cssContent.includes("--font-prose: 'Barlow'"),
    '--font-prose Barlow definition not found'
  );
});

test('CB-BUILD-004: Landing screen uses .cb-prose for subhead and truth line', async (t) => {
  const filePath = path.join(screenDir, 'landing.js');
  const content = fs.readFileSync(filePath, 'utf-8');

  // Subhead should use .cb-prose
  assert(
    content.includes("el('p', { class: 'cb-prose' }, treatment.copy.landingSubhead)"),
    'landingSubhead not marked with .cb-prose'
  );

  // Truth line should use .cb-prose
  assert(
    content.includes("el('p', { class: 'cb-prose' }, treatment.copy.truthLine)"),
    'truthLine not marked with .cb-prose'
  );
});

test('CB-BUILD-004: Screener screen uses .cb-prose for body text', async (t) => {
  const filePath = path.join(screenDir, 'screener.js');
  const content = fs.readFileSync(filePath, 'utf-8');

  assert(
    content.includes("el('p', { class: 'cb-prose' }, treatment.copy.screenerBody)"),
    'screenerBody not marked with .cb-prose'
  );
});

test('CB-BUILD-004: Summon screen uses .cb-prose for body and grant notice', async (t) => {
  const filePath = path.join(screenDir, 'summon.js');
  const content = fs.readFileSync(filePath, 'utf-8');

  assert(
    content.includes("el('p', { class: 'cb-prose' }, treatment.copy.summonBody)"),
    'summonBody not marked with .cb-prose'
  );

  assert(
    content.includes("el('p', { class: 'cb-prose' }, treatment.copy.signupGrantNotice)"),
    'signupGrantNotice not marked with .cb-prose'
  );
});

test('CB-BUILD-004: Sitting screen uses .cb-prose for body copy', async (t) => {
  const filePath = path.join(screenDir, 'sitting.js');
  const content = fs.readFileSync(filePath, 'utf-8');

  assert(
    content.includes("el('p', { class: 'cb-prose' }, treatment.copy.sittingBody)"),
    'sittingBody not marked with .cb-prose'
  );

  assert(
    content.includes("{ class: 'cb-prose' }, `Pay ${money(reentry.usd)}, receive"),
    're-entry description not marked with .cb-prose'
  );

  assert(
    content.includes("{ class: 'cb-prose' }, `${treatment.copy.cashOutBody}"),
    'cashOutBody not marked with .cb-prose'
  );

  assert(
    content.includes("{ class: 'cb-prose' }, 'Free, indefinitely. Come back whenever."),
    '"Sit for now" description not marked with .cb-prose'
  );
});
