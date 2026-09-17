// app/tests/helpers/dom-harness.js — a minimal fake `document`/`window`
// good enough to run the app's real `el()`/`mountScreen()` (app/ui/
// components/dom.js) end to end in node:test, no jsdom dependency (same
// spirit as app/tests/el-aria-disabled-coercion.test.js's inline fake, and
// engine/ledger.js's createMemoryStorage fake-storage precedent). Not a
// `*.test.js` file itself (app/tests/*.test.js's glob never picks up this
// subdirectory), so it carries no tests of its own -- import it from a real
// test file and call `installFakeDom()` in `test.before`, `uninstallFakeDom()`
// in `test.after`.
//
// This is deliberately generic (not scoped to any one finding) so C1/C2/C3/
// C4/C5/C6's DOM-level tests can all share one harness instead of five
// slightly-different inline fakes drifting apart over time.

function makeClassList(node) {
  return {
    add: (c) => { if (!node.className.split(' ').filter(Boolean).includes(c)) node.className = (node.className ? node.className + ' ' : '') + c; },
    remove: (c) => { node.className = node.className.split(' ').filter((x) => x && x !== c).join(' '); },
    toggle: (c, force) => {
      const has = node.className.split(' ').filter(Boolean).includes(c);
      const want = force === undefined ? !has : force;
      if (want && !has) node.classList.add(c);
      if (!want && has) node.classList.remove(c);
    },
    contains: (c) => node.className.split(' ').filter(Boolean).includes(c),
  };
}

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    className: '',
    style: {},
    _attrs: new Map(),
    _listeners: new Map(),
    children: [],
    parentNode: null,
    setAttribute(k, v) { this._attrs.set(k, String(v)); },
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
    removeAttribute(k) { this._attrs.delete(k); },
    hasAttribute(k) { return this._attrs.has(k); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
    replaceChildren(...nodes) {
      this.children = [];
      for (const n of nodes) { if (n != null) this.appendChild(n); }
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener(type, handler) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(handler);
    },
    dispatch(type, evt = {}) {
      for (const handler of this._listeners.get(type) || []) handler(evt);
    },
    focus() {},
    select() {},
    blur() { this.dispatch('blur', { target: this }); },
    querySelector(sel) { return querySelectorImpl(this, sel); },
    querySelectorAll(sel) { return querySelectorAllImpl(this, sel); },
    get textContent() { return textContentOf(this); },
    set innerHTML(v) {
      if (v === '') { this.children = []; }
    },
  };
  node.classList = makeClassList(node);
  // just enough <canvas> for a canvas-probing library (e.g. the vendored
  // lottie player's import-time feature detection) to load under node:test:
  // a context whose every method is a noop and whose properties stick.
  if (node.tagName === 'CANVAS') {
    node.width = 0;
    node.height = 0;
    node.getContext = () => new Proxy({ canvas: node }, {
      get: (t, k) => (k in t ? t[k] : () => {}),
      set: (t, k, v) => { t[k] = v; return true; },
    });
  }
  return node;
}

function textContentOf(node) {
  if (node.nodeType === 3) return node.text;
  return (node.children || []).map(textContentOf).join('');
}

function matchesSimpleSelector(node, sel) {
  if (node.nodeType !== 1) return false;
  if (sel.startsWith('.')) return node.classList.contains(sel.slice(1));
  if (sel.startsWith('#')) return node._attrs.get('id') === sel.slice(1) || node.id === sel.slice(1);
  return node.tagName === sel.toUpperCase();
}

function querySelectorImpl(root, sel) {
  const stack = [...(root.children || [])];
  while (stack.length) {
    const n = stack.shift();
    if (matchesSimpleSelector(n, sel)) return n;
    if (n.children) stack.unshift(...n.children);
  }
  return null;
}

function querySelectorAllImpl(root, sel) {
  const out = [];
  const stack = [...(root.children || [])];
  while (stack.length) {
    const n = stack.shift();
    if (matchesSimpleSelector(n, sel)) out.push(n);
    if (n.children) stack.push(...n.children);
  }
  return out;
}

/** Walks a subtree (or the whole fake document body) and returns every
 * rendered text-node string, in document order -- the "what would a player
 * actually read" view, independent of which element wraps it. */
export function renderedTexts(root) {
  const out = [];
  (function walk(n) {
    if (n.nodeType === 3) { if (n.text) out.push(n.text); return; }
    for (const c of n.children || []) walk(c);
  })(root);
  return out;
}

/** Same, joined into one string (convenient for a single regex match over
 * "everything the screen rendered"). */
export function renderedText(root) {
  return renderedTexts(root).join(' ');
}

let previousDocument;
let previousWindow;
let fakeDocument;

export function installFakeDom() {
  previousDocument = globalThis.document;
  previousWindow = globalThis.window;
  const body = makeNode('body');
  const appDiv = makeNode('div');
  appDiv.id = 'app';
  appDiv.setAttribute('id', 'app');
  body.appendChild(appDiv);
  fakeDocument = {
    body,
    createElement: makeNode,
    createTextNode(text) { return { nodeType: 3, text }; },
    getElementById(id) {
      if (id === 'app') return appDiv;
      return querySelectorImpl(body, `#${id}`);
    },
    getElementsByTagName(tag) {
      const t = String(tag).toUpperCase();
      if (t === 'BODY') return [body];
      return querySelectorAllImpl(body, tag);
    },
  };
  globalThis.document = fakeDocument;
  globalThis.window = { scrollTo() {} };
  return fakeDocument;
}

export function uninstallFakeDom() {
  globalThis.document = previousDocument;
  globalThis.window = previousWindow;
}

export function appRoot() {
  return fakeDocument.getElementById('app');
}
