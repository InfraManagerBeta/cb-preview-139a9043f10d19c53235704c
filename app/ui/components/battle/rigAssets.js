// app/ui/components/battle/rigAssets.js — CB-BUILD-005/006: the duel's
// animation loadout. For each combatant, fetch the per-combo SHAPE sets the
// duel will need (every rig state + the affinity-cape FX overlays) from the
// public production library, recolour each to the wizard's OWN palette
// (app/engine/rigRecolor.js), and hold everything in memory BEFORE the duel
// starts — the stage never fetches or re-fetches mid-duel (R74: no frame
// blanks or flashes; preload, never re-fetch).
//
// Degradation contract (stated, not silent): the library lives in the
// public bucket. When a fetch fails (offline of the bucket), the loadout
// substitutes the element's vendored fallback SHAPE set (assets/rig/ —
// byte-identical library downloads committed to this repo) for that state,
// still recoloured to the wizard's own palette — the combatant keeps its
// own colours (visually distinct, R74) and degrades only in cosmetic shape.
// The substitution is recorded on `loadout.report` (per side: which states
// fell back), never hidden.
import { wizardIdentity, animationUrl, affinityCapeUrl, elementToken } from '../../../engine/wizardRig.js';
import { recolorAnimation } from '../../../engine/rigRecolor.js';

// The rig states one duel presentation can reach (cancel is in the library
// and the fallback bundle but no timeline step maps to it — not fetched).
export const DUEL_STATES = Object.freeze(['idle', 'charge', 'chargeloop', 'attack', 'hit', 'reset', 'win', 'lose', 'draw']);

// All paths relative to the HTML document (app/index.html), like assets.js.
const FALLBACK_BASE = '../assets/rig';

// Raw (source-coloured) animation JSON, cached by URL for the whole session
// — two combatants sharing a state set, or a rematch, never re-fetch.
// (Tests inject their own cache/fetch; the app uses the session cache.)
const sessionCache = new Map();

async function fetchJson(url, fetchImpl, cache) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`rig fetch failed: ${res.status}`);
  const json = await res.json();
  cache.set(url, json);
  return json;
}

async function loadStateWithFallback({ state, identity, fetchImpl, report, cache }) {
  try {
    return await fetchJson(animationUrl(state, identity.comboKey), fetchImpl, cache);
  } catch {
    report.fallbackStates.push(state);
    const url = `${FALLBACK_BASE}/fallback/${elementToken(identity.element)}/${state}.json`;
    return fetchJson(url, fetchImpl, cache);
  }
}

async function loadCapeWithFallback({ kind, identity, fetchImpl, report, cache }) {
  const url = affinityCapeUrl(kind, identity.element, identity.traits.power);
  try {
    if (!url) throw new Error('no cape in manifest');
    return await fetchJson(url, fetchImpl, cache);
  } catch {
    report.fallbackCapes.push(kind);
    return fetchJson(`${FALLBACK_BASE}/fx/affinitycape${kind}-${elementToken(identity.element)}.json`, fetchImpl, cache);
  }
}

/**
 * Create (and immediately start) the preload for one duel: both combatants'
 * full state sets + affinity capes, each recoloured to its wizard's own
 * palette. `characters` are snapshot characters (id/element/tier and, when
 * summoned on this build, stored traits/palette).
 *
 * Returns { ready, progress(), report, get(side, state), getCape(side, kind) }.
 *  - ready: a Promise resolving when EVERY animation source is in memory.
 *  - progress(): { loaded, total } for the loader bar.
 *  - report: { p1: {fallbackStates, fallbackCapes}, p2: {...} } — honest
 *    record of any bucket-unreachable degradation.
 */
export function createRigLoadout({ p1Character, p2Character, fetchImpl, cache }) {
  const doFetch = fetchImpl || ((url) => fetch(url));
  const rawCache = cache || sessionCache;
  const identities = {
    p1: wizardIdentity(p1Character),
    p2: wizardIdentity(p2Character),
  };
  const report = {
    p1: { fallbackStates: [], fallbackCapes: [], unslottedStates: [] },
    p2: { fallbackStates: [], fallbackCapes: [], unslottedStates: [] },
  };
  const store = { p1: { states: {}, capes: {} }, p2: { states: {}, capes: {} } };

  const total = 2 * (DUEL_STATES.length + 2);
  let loaded = 0;
  const tasks = [];

  for (const side of ['p1', 'p2']) {
    const identity = identities[side];
    for (const state of DUEL_STATES) {
      tasks.push((async () => {
        const raw = await loadStateWithFallback({ state, identity, fetchImpl: doFetch, report: report[side], cache: rawCache });
        // Recolour LIVE to this wizard's own palette — per combatant, in
        // memory, never baked (rigRecolor never mutates the cached source).
        const { animation, stats } = recolorAnimation(raw, identity.palette);
        // Honesty guard: a set with no slot classes cannot carry the
        // wizard's palette (colour baked at export) — recorded, never hidden.
        if (stats.recoloured === 0) report[side].unslottedStates.push(state);
        store[side].states[state] = animation;
        loaded++;
      })());
    }
    for (const kind of ['win', 'lose']) {
      tasks.push((async () => {
        const raw = await loadCapeWithFallback({ kind, identity, fetchImpl: doFetch, report: report[side], cache: rawCache });
        store[side].capes[kind] = recolorAnimation(raw, identity.palette).animation;
        loaded++;
      })());
    }
  }

  return {
    identities,
    report,
    ready: Promise.all(tasks).then(() => undefined),
    progress: () => ({ loaded, total }),
    get: (side, state) => store[side].states[state] || null,
    getCape: (side, kind) => store[side].capes[kind] || null,
  };
}
