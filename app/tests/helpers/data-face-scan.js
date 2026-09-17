// app/tests/helpers/data-face-scan.js — N-C6/R11 [LAW] re-probe fix: a REAL
// data-face/prose-face sweep, shared by app/tests/prose-face-css.test.js.
//
// The prior sweep (C6/F1) only ever checked ONE data-face class
// (`cb-micro`, of 25 shipped in base.css/battle.css) and only matched a
// literal single-quoted string passed directly as an el() call's third
// argument -- missing every ternary branch, template-literal child, and
// any sentence sourced from the active treatment's OWN copy data
// (treatment.copy.*), not the JS source text at all. This module fixes
// all three gaps:
//
//   1. Data-face (and prose-face) classes are EXTRACTED from the shipped,
//      participant-facing stylesheets (base.css + battle.css -- the two
//      index.html actually loads; console.css is operator-only and
//      excluded, same exclusion the rest of the suite already uses) --
//      never hardcoded to one class name.
//   2. `el(tag, attrs, children)` call sites are located with a real
//      bracket/string/comment-aware scanner (not a single bounded regex),
//      so a ternary (`cond ? 'A' : 'B'`), an array of mixed children, and
//      a template literal (with its `${...}` holes collapsed to a
//      placeholder so the surrounding sentence shape is still checkable)
//      are all inspected, not just a bare literal third argument. The
//      effective face is resolved like a real cascade would: an
//      element's OWN class wins if it sets one; otherwise the nearest
//      lexically-enclosing el() call's class is inherited (an "ancestor
//      walk"), same as font-family's real CSS inheritance; the doc root
//      defaults to the prose face (html/body's own rule).
//   3. A SEPARATE pass cross-references every `treatment.copy.<field>`
//      reference that resolves to a data-face node against the field's
//      REAL string value across every shipped treatment JSON -- catching
//      a sentence that lives entirely in theme data, not in the calling
//      JS source at all (this is how rails.js's verbatim `tieLine` --
//      "All square — coin flip. You advance. No cheddar transferred." --
//      was found on `.cb-result-line`, a data-face class, invisible to
//      any scan of the JS source's own string literals).
//
// Deliberately NOT attempted: a fully general JS/CSS engine (no
// dependencies ship with this project -- see app/README.md's "no
// framework, no build step"). Variable children whose value can't be
// traced to either a literal, a template literal, or a `treatment.copy.*`
// field are left uninspected ("catch ternary and variable children where
// feasible" -- the brief's own qualifier); none are known to carry
// sentence content today (audited by hand alongside building this scan).

import fs from 'node:fs/promises';
import path from 'node:path';

// ---- CSS: extract class-selector font-face rules, in cascade order -------

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Parses `files` (in the order the page actually loads them) into a flat,
 * cascade-ordered list of { classes: string[], face: 'data'|'prose',
 * specificity } entries -- one per PURE class-compound selector (e.g.
 * `.cb-micro` or `.cb-result-line.cb-prose`) that explicitly sets
 * `font-family: var(--font-data)` or `var(--font-prose)`. Non-class
 * selectors (bare tag names, `html, body`, `a`, ...) are skipped -- no
 * participant screen renders a sentence via a bare `el('code', ...)`-style
 * tag selector (audited), so this scan only needs to reason about classes.
 */
export async function extractFontFaceRules(files) {
  const rules = [];
  let order = 0;
  for (const file of files) {
    const css = stripCssComments(await fs.readFile(file, 'utf8'));
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const [, selectorList, body] = m;
      const faceMatch = body.match(/font-family\s*:\s*var\((--font-[a-z]+)\)/);
      if (!faceMatch) continue;
      const face = faceMatch[1] === '--font-data' ? 'data' : faceMatch[1] === '--font-prose' ? 'prose' : null;
      if (!face) continue;
      for (const sel of selectorList.split(',')) {
        const trimmed = sel.trim();
        if (!/^(\.[a-zA-Z0-9_-]+)+$/.test(trimmed)) continue; // pure class-compound selectors only
        const classes = trimmed.split('.').filter(Boolean);
        rules.push({ classes, face, specificity: classes.length, order: order++ });
      }
    }
  }
  return rules;
}

/**
 * Resolves the winning face for an element carrying `classNames` (its OWN
 * classes only -- ancestor inheritance is the caller's job) against the
 * cascade-ordered `faceRules`: a rule matches if EVERY one of its classes
 * is present on the element; among matches, highest specificity (most
 * classes) wins, ties broken by source order (later wins) -- real CSS
 * cascade semantics. Returns null if nothing on this element sets a face
 * at all (the caller then walks up to the parent).
 */
export function resolveOwnFace(classNames, faceRules) {
  if (!classNames || classNames.length === 0) return null;
  const classSet = new Set(classNames);
  let best = null;
  for (const rule of faceRules) {
    if (!rule.classes.every((c) => classSet.has(c))) continue;
    if (!best || rule.specificity > best.specificity || (rule.specificity === best.specificity && rule.order > best.order)) {
      best = rule;
    }
  }
  return best ? best.face : null;
}

export function dataFaceClassNames(faceRules) {
  const names = new Set();
  for (const rule of faceRules) if (rule.face === 'data') for (const c of rule.classes) names.add(c);
  return names;
}

// ---- JS: a bracket/string/comment-aware scanner for el(...) calls --------

/** Scans `src` from `openIdx` (the index of an opening bracket char) for
 * its matching close, treating '(' '{' '[' as generic nesting and
 * correctly skipping over '...'/"..."/`...${ ... }...` string/template
 * content and `//`/`/* *‌/` comments (an apostrophe inside a COMMENT, e.g.
 * "doesn't", must never be mistaken for the start of a string literal --
 * this codebase's own JSDoc-style inline comments are full of contractions
 * exactly like that). Returns the index of the matching close, or -1. */
function findMatchingClose(src, openIdx) {
  const openCh = src[openIdx];
  const stack = [openCh];
  let i = openIdx + 1;
  const n = src.length;
  while (stack.length && i < n) {
    const c = src[i];
    const top = stack[stack.length - 1];
    if (top === "'" || top === '"') {
      if (c === '\\') { i += 2; continue; }
      if (c === top) { stack.pop(); i++; continue; }
      i++; continue;
    }
    if (top === '`') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }
      if (c === '$' && src[i + 1] === '{') { stack.push('${'); i += 2; continue; }
      i++; continue;
    }
    if (top === '//') { if (c === '\n') { stack.pop(); i++; continue; } i++; continue; }
    if (top === '/*') { if (c === '*' && src[i + 1] === '/') { stack.pop(); i += 2; continue; } i++; continue; }
    // Normal code context.
    if (c === '/' && src[i + 1] === '/') { stack.push('//'); i += 2; continue; }
    if (c === '/' && src[i + 1] === '*') { stack.push('/*'); i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') { stack.push(c); i++; continue; }
    if (c === '(' || c === '{' || c === '[') { stack.push(c); i++; continue; }
    if (c === ')') { if (top === '(') { stack.pop(); if (stack.length === 0) return i; } i++; continue; }
    if (c === '}') {
      if (top === '{') { stack.pop(); if (stack.length === 0) return i; i++; continue; }
      if (top === '${') { stack.pop(); i++; continue; } // back into template mode
      i++; continue;
    }
    if (c === ']') { if (top === '[') { stack.pop(); if (stack.length === 0) return i; } i++; continue; }
    i++;
  }
  return -1;
}

/** Every `el(...)` call span in `src` (including nested ones -- a `.map`
 * callback's own el() calls are found too, just like every top-level
 * call), as `{ start, openIdx, closeIdx }` (indices into `src`). */
export function findElCalls(src) {
  const calls = [];
  const callRe = /\bel\(/g;
  let m;
  while ((m = callRe.exec(src))) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingClose(src, openIdx);
    if (closeIdx === -1) continue;
    calls.push({ start: m.index, openIdx, closeIdx });
  }
  return calls;
}

/** Top-level (depth-0, outside any string/comment) comma split of `text`. */
function topLevelSplit(text) {
  const segments = [];
  const stack = [];
  let last = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (top === "'" || top === '"') {
      if (c === '\\') { i += 2; continue; }
      if (c === top) { stack.pop(); i++; continue; }
      i++; continue;
    }
    if (top === '`') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }
      if (c === '$' && text[i + 1] === '{') { stack.push('${'); i += 2; continue; }
      i++; continue;
    }
    if (top === '//') { if (c === '\n') { stack.pop(); i++; continue; } i++; continue; }
    if (top === '/*') { if (c === '*' && text[i + 1] === '/') { stack.pop(); i += 2; continue; } i++; continue; }
    if (c === '/' && text[i + 1] === '/') { stack.push('//'); i += 2; continue; }
    if (c === '/' && text[i + 1] === '*') { stack.push('/*'); i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') { stack.push(c); i++; continue; }
    if (c === '(' || c === '{' || c === '[') { stack.push(c); i++; continue; }
    if (c === ')' || c === '}' || c === ']') {
      if (top === '${' && c === '}') { stack.pop(); i++; continue; }
      if (stack.length) stack.pop();
      i++; continue;
    }
    if (c === ',' && stack.length === 0) { segments.push(text.slice(last, i)); last = i + 1; i++; continue; }
    i++;
  }
  segments.push(text.slice(last));
  return segments;
}

function extractStaticClassNames(attrsText) {
  const single = attrsText.match(/class:\s*'((?:[^'\\]|\\.)*)'/);
  if (single) return single[1].split(/\s+/).filter(Boolean);
  const tmpl = attrsText.match(/class:\s*`((?:[^`\\]|\\.)*)`/);
  if (tmpl) return tmpl[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean);
  return null; // dynamic/unresolvable class expression (e.g. a bare variable)
}

/** "Sentence-length prose string" (same operationalization the original
 * C6 sweep used -- it correctly avoids false-positiving genuine
 * labels/tags): terminates like a sentence (period/ellipsis/exclamation/
 * question mark, never just a colon or nothing), contains a lowercase word
 * (an ALL-CAPS label never trips this), and runs >=4 words.
 * Fix round f2 (CB-BUILD-021 finding C): `?` added to the terminator
 * class -- before that, a question-mark-terminated sentence sitting on a
 * data-face node was invisible to the sweep (R11 quantifies over EVERY
 * sentence a player reads). The re-run sweep found no live offender. */
export function looksLikeSentence(text) {
  const trimmed = text.trim();
  if (!/[.\u2026!?]\s*$/.test(trimmed)) return false;
  if (!/[a-z]/.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount >= 4;
}

function stripJsComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let inString = null;
  while (i < n) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[i + 1] || ''; i += 2; continue; }
      if (c === inString) inString = null;
      i++; continue;
    }
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') { inString = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

/** Every candidate sentence-shaped literal in `text` (comments stripped
 * first): single-quoted string literals verbatim, and template-literal
 * bodies with each `${...}` hole collapsed to a placeholder ("X") so a
 * template built around a dynamic figure/name is still shape-checkable.
 * Fix round f2 (CB-BUILD-021 finding C): template bodies are extracted
 * with a real scan, not a bounded regex -- a template NESTED inside a
 * `${...}` hole (pve.js's opponent line) desynchronised the old regex and
 * fabricated a candidate ending mid-hole ("... ${opponent.name ? "), which
 * the widened `?` terminator would then have flagged as a sentence.
 * Exported for the sweep's own unit tests. */
export function extractCandidateLiterals(text) {
  const stripped = stripJsComments(text);
  const out = [];
  const reSingle = /'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = reSingle.exec(stripped))) out.push(m[1].replace(/\\(.)/g, '$1'));
  out.push(...extractTemplateBodies(stripped));
  return out;
}

/** Scans one template literal starting at `openIdx` (its opening backtick):
 * returns { body, end, inner } -- the hole-collapsed body, the index just
 * past the closing backtick, and the collapsed bodies of any templates
 * nested inside `${...}` holes (each a candidate in its own right). */
function scanTemplate(src, openIdx) {
  let body = '';
  const inner = [];
  let i = openIdx + 1;
  const n = src.length;
  while (i < n && src[i] !== '`') {
    if (src[i] === '\\') { body += src[i + 1] || ''; i += 2; continue; }
    if (src[i] === '$' && src[i + 1] === '{') {
      body += 'X';
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        const ch = src[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === "'" || ch === '"') { const q = ch; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
        if (ch === '`') { const t = scanTemplate(src, i); inner.push(t.body, ...t.inner); i = t.end; continue; }
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        i++;
      }
      continue;
    }
    body += src[i];
    i++;
  }
  return { body, end: i + 1, inner };
}

/** Every template-literal body in already-comment-stripped source, holes
 * collapsed, nested templates included as separate candidates. */
function extractTemplateBodies(stripped) {
  const bodies = [];
  let i = 0;
  const n = stripped.length;
  while (i < n) {
    const c = stripped[i];
    if (c === "'" || c === '"') { i++; while (i < n && stripped[i] !== c) { if (stripped[i] === '\\') i++; i++; } i++; continue; }
    if (c === '`') {
      const t = scanTemplate(stripped, i);
      bodies.push(t.body, ...t.inner);
      i = t.end;
      continue;
    }
    i++;
  }
  return bodies;
}

/** Builds the el()-call node tree for one file's source and returns every
 * candidate literal (own class, resolved effective face) alongside the
 * raw text a `treatment.copy.<field>` reference appearing under a
 * data-faced node names (for the caller's own copy-JSON cross-check). */
function analyzeFile(src, faceRules) {
  const calls = findElCalls(src).sort((a, b) => a.start - b.start);
  const nodes = calls.map((c) => {
    const argsText = src.slice(c.openIdx + 1, c.closeIdx);
    const segs = topLevelSplit(argsText);
    const attrsText = segs[1] || '';
    const childrenText = segs.slice(2).join(',');
    const childrenAbsStart = c.openIdx + 1 + (segs[0] !== undefined ? segs[0].length + 1 : 0) + (segs[1] !== undefined ? attrsText.length + 1 : 0);
    const classNames = extractStaticClassNames(attrsText);
    return { ...c, argsText, attrsText, childrenText, childrenAbsStart, classNames, ownFace: resolveOwnFace(classNames, faceRules) };
  });

  function findParent(node) {
    let best = null;
    for (const other of nodes) {
      if (other === node) continue;
      if (other.start < node.start && other.closeIdx > node.closeIdx) {
        if (!best || (other.closeIdx - other.start) < (best.closeIdx - best.start)) best = other;
      }
    }
    return best;
  }
  for (const n of nodes) n.parent = findParent(n);
  function effectiveFace(n) {
    if (n.ownFace) return n.ownFace;
    if (n.parent) return effectiveFace(n.parent);
    return 'prose'; // html/body's own default rule
  }

  const literalOffenders = [];
  const copyFieldRefs = [];
  for (const n of nodes) {
    // This node's DIRECT children text, with any NESTED el() call's own
    // span masked out (that nested call is a separate node, resolved --
    // and, if it sets no class of its own, inheriting FROM this one --
    // independently; without the mask its literals would be attributed
    // to both nodes).
    const nested = nodes.filter((o) => o.start >= n.childrenAbsStart && o.closeIdx <= n.closeIdx && o !== n);
    const cuts = nested.map((o) => [o.start - n.childrenAbsStart, o.closeIdx - n.childrenAbsStart + 1]).sort((a, b) => a[0] - b[0]);
    let masked = '';
    let cursor = 0;
    for (const [s, e] of cuts) { if (s < cursor) continue; masked += n.childrenText.slice(cursor, s); cursor = Math.max(cursor, e); }
    masked += n.childrenText.slice(cursor);

    const face = effectiveFace(n);
    if (face === 'data') {
      for (const lit of extractCandidateLiterals(masked)) {
        if (looksLikeSentence(lit)) literalOffenders.push({ text: lit, classNames: n.classNames });
      }
      const strippedMasked = stripJsComments(masked);
      const copyRe = /treatment\.copy\.([a-zA-Z0-9_]+)/g;
      let m;
      while ((m = copyRe.exec(strippedMasked))) copyFieldRefs.push({ field: m[1], classNames: n.classNames });
    }
  }
  return { literalOffenders, copyFieldRefs };
}

export async function collectParticipantJsFiles(uiRoot) {
  const out = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'console') await walk(p); }
      else if (entry.name.endsWith('.js')) out.push(p);
    }
  }
  await walk(uiRoot);
  return out;
}

/**
 * The full sweep: every participant-facing `ui/**\/*.js` file (ui/console/
 * excluded -- operator-only, not a participant surface, same exclusion
 * money-truth-scan.test.js/no-raw-error-text.test.js already use) against
 * `faceRules`. Returns `{ literalOffenders, copyFieldOffenders }` --
 * `literalOffenders` are JS-source sentence-shaped children rendered on a
 * data-faced node; `copyFieldOffenders` are `treatment.copy.<field>`
 * references on a data-faced node whose REAL value (checked against
 * `copyFieldsByName`, every shipped treatment) reads as a sentence.
 */
export async function sweepDataFaceSentences(uiRoot, faceRules, copyFieldsByName) {
  const files = await collectParticipantJsFiles(uiRoot);
  const literalOffenders = [];
  const copyFieldOffenders = [];
  for (const file of files) {
    const src = await fs.readFile(file, 'utf8');
    const { literalOffenders: lits, copyFieldRefs } = analyzeFile(src, faceRules);
    for (const o of lits) literalOffenders.push({ file, ...o });
    for (const ref of copyFieldRefs) {
      const entries = copyFieldsByName[ref.field] || [];
      for (const entry of entries) {
        if (looksLikeSentence(entry.value)) copyFieldOffenders.push({ file, field: ref.field, treatment: entry.treatment, value: entry.value, classNames: ref.classNames });
      }
    }
  }
  return { literalOffenders, copyFieldOffenders };
}

/** Every string-valued `copy.<field>` across every shipped treatment JSON
 * (incumbent/adjacent/far -- mapping.json carries no `copy` block of its
 * own and is not a treatment), keyed by field name. */
export async function loadTreatmentCopyFields(treatmentsDir) {
  const files = ['incumbent.json', 'adjacent.json', 'far.json'];
  const byField = {};
  for (const f of files) {
    const json = JSON.parse(await fs.readFile(path.join(treatmentsDir, f), 'utf8'));
    for (const [k, v] of Object.entries(json.copy || {})) {
      if (typeof v === 'string') (byField[k] ||= []).push({ treatment: f, value: v });
    }
  }
  return byField;
}
