// app/tests/el-aria-disabled-coercion.test.js — Folded fix: el()'s boolean
// attribute coercion silently rendered `true` as an empty-string attribute
// (`node.setAttribute(k, '')`), correct for a NATIVE boolean HTML attribute
// (disabled/checked -- presence alone is the signal) but wrong for an
// `aria-*` STATE attribute, whose value is read as the literal string
// "true"/"false" by both a screen reader and any `[aria-disabled="true"]`
// CSS selector (CB-BUILD-008/§12/R83). Every initial render of a gated
// button (screener Continue, summon's element-picker seal, sitting's
// re-entry/spectate buttons, duel.js's Seal Commitment, pve.js's Fight,
// money-sheets.js's deposit confirm, lobby-entry.js's opt-in/RSVP) set
// `aria-disabled=""` on mount instead of `aria-disabled="true"`, so the
// CSS disabled cue never applied until the FIRST user-driven mutation
// (e.g. duel.js's selectMove, which calls `setAttribute('aria-disabled',
// 'true')` directly and was always correct) touched the attribute by hand.
//
// No DOM/CSSOM is available in this harness (see app/README.md's node:test
// gotcha) -- a minimal fake `document`/Element stand-in (same spirit as
// engine/ledger.js's createMemoryStorage fake-storage precedent) is built
// here just far enough for el()'s own attribute-setting logic to run for
// real, rather than re-deriving its behavior via a source-text regex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');

function makeFakeDocument() {
  function makeClassList(node) {
    return {
      add: (c) => { if (!node.className.split(' ').includes(c)) node.className = (node.className ? node.className + ' ' : '') + c; },
      remove: (c) => { node.className = node.className.split(' ').filter((x) => x && x !== c).join(' '); },
      toggle: (c, force) => {
        const has = node.className.split(' ').includes(c);
        const want = force === undefined ? !has : force;
        if (want && !has) node.classList.add(c);
        if (!want && has) node.classList.remove(c);
      },
      contains: (c) => node.className.split(' ').includes(c),
    };
  }
  return {
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(),
        className: '',
        _attrs: new Map(),
        children: [],
        setAttribute(k, v) { this._attrs.set(k, String(v)); },
        getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
        removeAttribute(k) { this._attrs.delete(k); },
        hasAttribute(k) { return this._attrs.has(k); },
        appendChild(c) { this.children.push(c); },
        addEventListener() {},
      };
      node.classList = makeClassList(node);
      return node;
    },
    createTextNode(text) { return { nodeType: 3, text }; },
  };
}

let el;

test.before(async () => {
  globalThis.document = makeFakeDocument();
  ({ el } = await import('../ui/components/dom.js'));
});

test.after(() => {
  delete globalThis.document;
});

test('defect repro (fixed): el(tag, { "aria-disabled": true }) renders the literal string "true", not an empty-string attribute', () => {
  const node = el('button', { 'aria-disabled': true });
  assert.equal(node.getAttribute('aria-disabled'), 'true', 'expected aria-disabled to carry the literal string "true" so [aria-disabled="true"] CSS matches on first render');
});

test('el(tag, { "aria-disabled": false }) omits the attribute entirely (unchanged: an un-gated control has no aria-disabled at all)', () => {
  const node = el('button', { 'aria-disabled': false });
  assert.equal(node.getAttribute('aria-disabled'), null);
});

test('a boolean gate expression (not a pre-stringified literal) is coerced correctly too -- the exact call shape every real call site uses', () => {
  const element = null; // summon.js: 'aria-disabled': !element -- true on initial mount, no element chosen yet
  const node = el('button', { 'aria-disabled': !element });
  assert.equal(node.getAttribute('aria-disabled'), 'true');
});

test('audit scope: a NATIVE boolean HTML attribute (e.g. a hypothetical "disabled": true) still renders as an empty-string presence flag -- the fix is scoped to the "aria-" prefix alone, not every boolean attribute', () => {
  const node = el('input', { disabled: true, required: true });
  assert.equal(node.getAttribute('disabled'), '');
  assert.equal(node.getAttribute('required'), '');
});

test('regression: this now satisfies CB-BUILD-008\'s CSS selector shape -- a freshly-mounted gated button carries aria-disabled="true" (matching .cb-btn[aria-disabled="true"] byte-for-byte), on its VERY FIRST render, no user interaction required', () => {
  const node = el('button', { class: 'cb-btn block', 'aria-disabled': true }, 'Seal Commitment');
  assert.equal(node.className, 'cb-btn block');
  assert.equal(node.getAttribute('aria-disabled'), 'true');
});

// ---- call-site audit (locks in the audit result this fix's blast-radius --
// analysis relied on): every el() call passing a boolean 'aria-disabled'
// value in the whole app, so a future call site can't silently reintroduce
// a differently-shaped boolean (e.g. a pre-stringified 'true'/'false',
// which this fix must NOT double-encode) without this test catching it.

const AUDITED_ARIA_DISABLED_SITES = [
  ['ui/components/money-sheets.js', "'aria-disabled': submitting,"],
  // C3/R67+§12/R83 fix round: the re-entry button's aria-disabled no longer
  // ties to "short on CASH" at all -- that state IS the funds wall's live
  // door (its own onClick opens Load Funds), so dressing it disabled read
  // as a dead control that was actually actionable. Only reenterSubmitting
  // (a genuinely in-flight request) still dresses as disabled now.
  ['ui/screens/sitting.js', "'aria-disabled': reenterSubmitting,"],
  ['ui/screens/sitting.js', "'aria-disabled': submitting,"],
  ['ui/screens/screener.js', "'aria-disabled': !dobValid || submitting,"],
  ['ui/screens/duel.js', "'aria-disabled': moves.some((m) => m == null),"],
  ['ui/screens/lobby-entry.js', "'aria-disabled': alreadyOptedIn,"],
  ['ui/screens/lobby-entry.js', "'aria-disabled': !meetsFloor || submitting,"],
  ['ui/screens/summon.js', "'aria-disabled': !element,"],
  ['ui/screens/pve.js', "'aria-disabled': moves.some((m) => m == null) || submitting,"],
];

test('audit: every el()-passed boolean aria-disabled call site in the app is accounted for (a plain boolean expression, never a pre-stringified "true"/"false")', async () => {
  for (const [file, needle] of AUDITED_ARIA_DISABLED_SITES) {
    const src = await fs.readFile(path.join(APP_ROOT, file), 'utf8');
    assert.ok(src.includes(needle), `${file}: expected to still find the audited call site "${needle}" -- audit is now stale, re-run it`);
    // None of these may already be pre-stringified ('true'/'false' as a
    // JS string literal) -- if one were, el()'s new `k.startsWith('aria-')`
    // branch would pass the STRING through unchanged (v === true is false
    // for a string), which is already correct and harmless, but a
    // pre-stringified 'false' would render `aria-disabled="false"` instead
    // of omitting the attribute -- a different (also spec-compliant, ARIA
    // permits an explicit "false") but NOT what this audit assumed. Assert
    // the shape stays a bare boolean expression.
    assert.ok(!/'aria-disabled':\s*'(true|false)'/.test(src), `${file}: found a pre-stringified aria-disabled literal -- audit assumption changed`);
  }
});

test('audit: no OTHER boolean attribute (native or aria-*) is passed through el() anywhere else in ui/ -- aria-disabled is the only boolean attribute this fix needed to cover', async () => {
  const files = await fs.readdir(path.join(APP_ROOT, 'ui'), { recursive: true });
  const jsFiles = files.filter((f) => f.endsWith('.js'));
  // Matches only a BOOLEAN-shaped value (a bare identifier/expression, `!x`,
  // `true`/`false`, or a comparison/logical chain) -- excludes any value
  // that starts with a quote (a string, e.g. an aria-label) or a template
  // literal/backtick.
  const booleanAttrPattern = /'(aria-[a-z-]+|disabled|checked|required|readonly|hidden|selected|multiple|autofocus)':\s*(!?[a-zA-Z_$][\w.]*(?:\s*(?:===|!==|==|!=|<|>|<=|>=|\|\||&&)\s*[^,}]*)?|true|false)\s*[,}]/g;
  const offenders = [];
  for (const f of jsFiles) {
    const full = path.join(APP_ROOT, 'ui', f);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    const src = await fs.readFile(full, 'utf8');
    let m;
    while ((m = booleanAttrPattern.exec(src))) {
      const key = m[1];
      if (key !== 'aria-disabled') offenders.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `expected NO other boolean-valued aria-*/native-boolean attribute call sites besides aria-disabled (found: ${JSON.stringify(offenders)}) -- if this fails, the fix's scoped "aria-" prefix approach needs re-auditing against the new call site`);
});
