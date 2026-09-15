// app/ui/components/dom.js — minimal DOM helpers (no framework, no build step).

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
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
export function showToast(message) {
  let node = document.getElementById('cb-toast');
  if (!node) {
    node = el('div', { id: 'cb-toast', class: 'cb-toast' });
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.style.display = 'none'; }, 2600);
}
