// app/engine/dataLoader.js
// Isomorphic JSON/text loader: works from a browser (fetch, relative to this
// module's URL) and from Node (fs, relative to this module's file path).
// Never uses an absolute "/" URL (the app is hosted at a GitHub Pages subpath).

const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

let _fs, _path, _url;
async function nodeDeps() {
  if (!_fs) {
    _fs = await import('node:fs/promises');
    _path = await import('node:path');
    _url = await import('node:url');
  }
  return { fs: _fs, path: _path, url: _url };
}

/**
 * Resolve a path relative to a module's `import.meta.url` and load it.
 * @param {string} relativePath e.g. '../data/tunables.json'
 * @param {string} baseUrl import.meta.url of the calling module
 * @param {'json'|'text'} kind
 */
export async function loadRelative(relativePath, baseUrl, kind = 'json') {
  if (isNode) {
    const { fs, path, url } = await nodeDeps();
    const baseFile = url.fileURLToPath(baseUrl);
    const target = path.resolve(path.dirname(baseFile), relativePath);
    const raw = await fs.readFile(target, 'utf8');
    return kind === 'json' ? JSON.parse(raw) : raw;
  } else {
    const target = new URL(relativePath, baseUrl);
    const res = await fetch(target);
    if (!res.ok) throw new Error(`loadRelative: failed to fetch ${target} (${res.status})`);
    return kind === 'json' ? res.json() : res.text();
  }
}

let _tunablesCache = null;
export async function loadTunables() {
  if (_tunablesCache) return _tunablesCache;
  _tunablesCache = await loadRelative('../data/tunables.json', import.meta.url, 'json');
  return _tunablesCache;
}

const _treatmentCache = new Map();
export async function loadTreatment(id = 'incumbent') {
  if (_treatmentCache.has(id)) return _treatmentCache.get(id);
  const data = await loadRelative(`../data/treatments/${id}.json`, import.meta.url, 'json');
  _treatmentCache.set(id, data);
  return data;
}

export async function loadNarratorPrompt() {
  return loadRelative('../data/narrator-prompt.txt', import.meta.url, 'text');
}

// Test/embedding helper: allow callers (e.g. Node tests, or the UI bootstrap)
// to inject already-parsed data instead of loading it, and to reset caches.
export function _resetCaches() {
  _tunablesCache = null;
  _treatmentCache.clear();
}
