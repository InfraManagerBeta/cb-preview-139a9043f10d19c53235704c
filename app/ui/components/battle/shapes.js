// app/ui/components/battle/shapes.js — CB-BUILD-006 (loading) feeding
// CB-BUILD-005 (no blank, no flash): the shape-library loader.
//
// Contract, matching the reference implementation's loadAnimations /
// handleDataReady gate (assets/cw-asset-bundle/reference/DuelPlayer/
// DuelPlayer.js): EVERY animation source a duel can need is fetched and
// composited BEFORE the duel plays a single frame, and NOTHING re-fetches
// mid-duel. `preloadWizard` is the only function that touches the network;
// `getDoc` serves exclusively from the preloaded set and throws on a miss —
// a mid-duel re-fetch is structurally impossible, not merely avoided.
//
// Sources, in order:
//   1. the public bucket (per-combo shape sets, via the CORS-safe JSON-API
//      media endpoint — see rig.js#mediaUrlForObject);
//   2. the vendored exact combo (assets/vendored-shapes/) if present;
//   3. the vendored canonical fallback combo — shapes fall back, the
//      wizard's OWN palette still applies (colours never fall back).
// The vendored files are a cached interchange source (spec latitude), never
// sprite sheets and never colour-baked.
import {
  LIBRARY_STATES,
  wizardRigFor,
  shapeObjectName,
  affinityCapeObjectName,
  mediaUrlForObject,
  compositeParametricDocument,
  identityKey,
} from './rig.js';

// Relative to the HTML documents (app/index.html / app/console.html), same
// convention as every other asset path in this directory.
export const VENDORED_SHAPE_BASE = '../assets/vendored-shapes/';

// The canonical vendored combo: all ten states are shipped in the repo.
export const VENDORED_FALLBACK_COMBO = Object.freeze({
  element: 'FIRE', power: '1', head: '02', cape: '04', hat: '01', wand: '01',
  combo: '1-02-04-01-01',
});

export function vendoredShapeUrl(traits, state, base = VENDORED_SHAPE_BASE) {
  return `${base}${state}-${traits.element}-${traits.power}-head${traits.head}-cape${traits.cape}-hat${traits.hat}-wand${traits.wand}.json`;
}

async function defaultFetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.json();
}

/**
 * @param {object} opts
 * @param {(url: string) => Promise<object>} [opts.fetchJson] injectable for
 *   tests/offline (defaults to window fetch).
 * @param {string} [opts.vendoredBase]
 */
export function createShapeLoader({ fetchJson = defaultFetchJson, vendoredBase = VENDORED_SHAPE_BASE } = {}) {
  const preloadedWizards = new Map(); // identityKey -> { rig, docs: Map(libraryState -> composite), fallbackStates: [] }
  const preloadedFx = new Map(); // fx key -> doc
  const counters = { networkFetches: 0, preloadServes: 0 };

  async function fetchCounted(url) {
    counters.networkFetches += 1;
    return fetchJson(url);
  }

  /** Bucket → vendored exact combo → vendored canonical combo. */
  async function loadShapeDoc(traits, libraryState) {
    try {
      return { doc: await fetchCounted(mediaUrlForObject(shapeObjectName(traits, libraryState))), fallback: false };
    } catch {
      try {
        return { doc: await fetchCounted(vendoredShapeUrl(traits, libraryState, vendoredBase)), fallback: false, vendored: true };
      } catch {
        return { doc: await fetchCounted(vendoredShapeUrl(VENDORED_FALLBACK_COMBO, libraryState, vendoredBase)), fallback: true, vendored: true };
      }
    }
  }

  /**
   * Fetch + composite every library state for one wizard, before the duel.
   * Idempotent per identity: a second call serves from memory (no network).
   */
  async function preloadWizard(identity, { states = LIBRARY_STATES, distinctFrom = null, onProgress = () => {} } = {}) {
    const key = identityKey(identity);
    if (preloadedWizards.has(key)) return preloadedWizards.get(key);
    const rig = wizardRigFor(identity, { distinctFrom });
    const docs = new Map();
    const fallbackStates = [];
    let done = 0;
    await Promise.all(states.map(async (libraryState) => {
      const { doc, fallback } = await loadShapeDoc(rig.traits, libraryState);
      if (fallback) fallbackStates.push(libraryState);
      const composite = compositeParametricDocument({ rig, state: libraryState, shapeDoc: doc });
      docs.set(libraryState, composite);
      done += 1;
      onProgress(done, states.length);
    }));
    const actor = { identity: key, rig, docs, fallbackStates: fallbackStates.sort() };
    preloadedWizards.set(key, actor);
    return actor;
  }

  /** The affinity-cape FX overlays for one wizard (win + lose), preloaded. */
  async function preloadAffinityCapes(identity) {
    const rig = wizardRigFor(identity);
    const out = {};
    for (const won of [true, false]) {
      const objectName = affinityCapeObjectName(identity.element, rig.traits.power, won);
      const cacheKey = objectName;
      if (!preloadedFx.has(cacheKey)) {
        let doc;
        try {
          doc = await fetchCounted(mediaUrlForObject(objectName));
        } catch {
          doc = await fetchCounted(`${vendoredBase}affinitycape${won ? 'win' : 'lose'}-FIRE-1.json`);
        }
        preloadedFx.set(cacheKey, doc);
      }
      out[won ? 'win' : 'lose'] = preloadedFx.get(cacheKey);
    }
    return out;
  }

  /**
   * Serve one preloaded composited document. NEVER fetches: a state that
   * was not preloaded is a programming error surfaced loudly, not a silent
   * mid-duel network round-trip (R74: "preloaded and never re-fetched
   * mid-duel").
   */
  function getDoc(identity, libraryState) {
    const key = typeof identity === 'string' ? identity : identityKey(identity);
    const actor = preloadedWizards.get(key);
    if (!actor) throw new Error(`getDoc: wizard ${key} was not preloaded (preloadWizard must complete before the duel starts)`);
    const composite = actor.docs.get(libraryState);
    if (!composite) throw new Error(`getDoc: state "${libraryState}" was not preloaded for ${key}`);
    counters.preloadServes += 1;
    return composite;
  }

  function isPreloaded(identity, states = LIBRARY_STATES) {
    const key = typeof identity === 'string' ? identity : identityKey(identity);
    const actor = preloadedWizards.get(key);
    return !!actor && states.every((s) => actor.docs.has(s));
  }

  return { preloadWizard, preloadAffinityCapes, getDoc, isPreloaded, loadShapeDoc, counters };
}
