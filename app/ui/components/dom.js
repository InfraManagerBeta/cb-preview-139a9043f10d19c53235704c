// app/ui/components/dom.js — minimal DOM helpers (no framework, no build step).

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    // Folded fix (el() aria-disabled coercion): a bare `true` used to
    // render every boolean attribute as an empty-string presence flag
    // (`node.setAttribute(k, '')`) -- correct for a NATIVE boolean HTML
    // attribute (disabled/checked/required, where presence alone is the
    // signal), but every `aria-*` boolean state attribute (aria-disabled,
    // aria-hidden, aria-checked, ...) is a STRING-valued ARIA attribute:
    // its value is read as the literal string "true"/"false", and an
    // empty string is neither. The only boolean `aria-*` attr this
    // codebase actually passes through el() is `aria-disabled` (audited:
    // money-sheets.js, sitting.js x2, screener.js, duel.js, lobby-entry.js
    // x2, summon.js, pve.js -- every one passes a plain boolean
    // expression, never the string 'true'/'false'), so `el()`'s initial
    // render emitted `aria-disabled=""` for a gated control -- CB-BUILD-
    // 008's `.cb-btn[aria-disabled="true"]` CSS selector never matched an
    // initial render, only a later `setAttribute('aria-disabled', 'true')`
    // call (e.g. duel.js's selectMove, which sets the STRING literal
    // directly and was always fine). Scoped to the `aria-` prefix alone
    // (the least-blast-radius fix): every other boolean attribute call
    // site in the app keeps its previous (correct, presence-based)
    // empty-string behavior untouched.
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? (k.startsWith('aria-') ? 'true' : '') : v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function mountScreen(children) {
  const app = document.getElementById('app');
  app.innerHTML = '';
  app.appendChild(el('div', { class: 'cb-screen' }, children));
  window.scrollTo(0, 0);
}

export function money(usd) {
  const sign = usd < 0 ? '-' : '';
  return `${sign}$${Math.abs(usd).toFixed(2)}`;
}

// R12: the stake-unit abbreviation ("100C" / "100S" / "100P") is theme-bound
// (treatment.nouns.stakeUnitAbbrev). Every screen calls cheddar(amount)
// without threading the active treatment through every call site, so the
// active abbreviation is set once at app boot (and again on a live O1
// treatment switch from the console) via setCheddarUnit(), and read here.
let _cheddarUnitAbbrev = 'C';
export function setCheddarUnit(abbrev) {
  _cheddarUnitAbbrev = abbrev || 'C';
}
export function cheddar(amount) {
  return `${Math.round(amount).toLocaleString()}${_cheddarUnitAbbrev}`;
}

let toastTimer = null;
// N-C6/R11 [LAW] re-probe fix: `.cb-toast` itself now resolves to the
// PROSE face (styles/base.css) -- every toast message is body copy a
// player reads, not a bare figure/tag. The one genuine exception
// (pve.js's PvE-duel delta, e.g. "+50C"/"-30C", carries no sentence
// around it at all) opts BACK onto the data face explicitly by passing
// `{ figure: true }`, toggling the `.cb-toast-figure` modifier class --
// every other call site (the overwhelming majority: retire/re-enter/
// cash-out/reserve confirmations, funds-wall/deposit toasts, the
// corrupt-ledger notice, ...) leaves it unset and gets the prose-face
// default, correctly.
export function showToast(message, { figure = false } = {}) {
  let node = document.getElementById('cb-toast');
  if (!node) {
    node = el('div', { id: 'cb-toast', class: 'cb-toast' });
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.style.display = 'block';
  // `toggle(cls, force)` both adds AND removes -- required since this DOM
  // node is REUSED across every toast call for the lifetime of the page;
  // without the explicit `force` a later ordinary (sentence) toast could
  // otherwise inherit a stale `.cb-toast-figure` left on by an earlier
  // figure toast.
  node.classList.toggle('cb-toast-figure', !!figure);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.style.display = 'none'; }, 2600);
}
