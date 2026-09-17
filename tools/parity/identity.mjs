// tools/parity/identity.mjs — CB-BUILD-015 (fix round): WHICH WIZARD enters
// the comparison, and how it gets onto both sides.
//
// Pure (fs + the shipped engine modules): no jsdom, no node-canvas, so the
// root test suite can bind every rule in here offline.
//
// Two kinds of row in the sample:
//
//  * SAMPLED wizards — generated ids with nothing recorded anywhere. Their
//    identity is whatever the shipped read path (`wizardRig.js`
//    `wizardIdentity`) derives for the id, and that same identity is handed
//    to both sides. Whatever the derivation rule is today or tomorrow
//    (CB-BUILD-022's live re-derivation, a cosmetic-carry rule across power
//    families, anything else), both sides move with it — the harness is not
//    pinned to any of it.
//
//  * The CANONICAL wizard — the one row with a real 2019 ground truth (the
//    nine bundle GIFs; its combo identified by round-1 `find-canonical.mjs`,
//    its palette FITTED from those renders by round-1 check A). Its identity
//    is PRE-REGISTERED in PREREGISTRATION.md §3 and is INJECTED here into
//    both sides verbatim. It is deliberately NOT inferred from a wizard
//    record: since CB-BUILD-022/R74/§18 the read path derives identity from
//    the characterId alone and never consults `character.traits` /
//    `character.palette`, so a recorded combo would be silently ignored and
//    the run would compare a different wizard than the declaration (and than
//    the 2019 renders) describes. The declaration is the authority for this
//    row; §8 of the declaration states the consequence — the id→identity
//    derivation is outside this row's comparison, and what the read path
//    WOULD derive for the id is recorded beside it, never implied to match.
import fs from 'node:fs';
import path from 'node:path';
import { REPO, __dirname } from './paths.mjs';
import { wizardIdentity, parseComboKey, animationUrl, affinityCapeUrl, elementToken } from '../../app/engine/wizardRig.js';
import { recolorAnimation } from '../../app/engine/rigRecolor.js';
import { DUEL_STATES } from '../../app/ui/components/battle/rigAssets.js';

export const RIG_ASSETS_SOURCE = 'app/ui/components/battle/rigAssets.js';

/** The declaration value §3 must carry for the canonical row to run at all. */
export const DECLARED_INJECTION = 'both-sides-declared';

/**
 * The canonical wizard, built from the DECLARATION — never from a record.
 * Returns a character carrying `declaredIdentity`; `identityFor()` below is
 * what turns that into the identity both sides use.
 */
export function canonicalWizard(prereg) {
  const decl = prereg.canonicalWizard;
  if (decl.identityInjection !== DECLARED_INJECTION) {
    throw new Error(
      `identity: PREREGISTRATION.md §3 must declare "identityInjection": "${DECLARED_INJECTION}" for the canonical wizard `
      + `(found ${JSON.stringify(decl.identityInjection)}). The canonical row's identity is honoured by injection or not at all — `
      + 'the engine read path derives identity from the characterId and would ignore a recorded combo.',
    );
  }
  const parsed = parseComboKey(decl.comboKey);
  if (!parsed) throw new Error(`identity: the pre-registered canonical combo '${decl.comboKey}' is not a combo key`);
  const checkA = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'check-a-gifs.json'), 'utf8'));
  const palette = checkA.paletteFit && checkA.paletteFit.palette;
  if (!palette || Object.keys(palette).length === 0) {
    throw new Error('identity: results/check-a-gifs.json carries no .paletteFit.palette — the canonical wizard has no declared palette to inject');
  }
  // The game element key does NOT pick this wizard's combo (the declared
  // combo is injected whole; its library token is NEUTRAL). It selects only
  // the affinity-cape family and, if the bucket were unreachable, the
  // vendored fallback shape family — both recorded in the run either way.
  const element = 'fire';
  return {
    id: decl.id,
    element,
    tier: 0,
    kind: 'canonical',
    declaredIdentity: {
      characterId: decl.id,
      element,
      comboKey: decl.comboKey,
      traits: { head: parsed.head, cape: parsed.cape, hat: parsed.hat, wand: parsed.wand, power: parsed.power, comboKey: decl.comboKey },
      palette,
    },
    provenance: { combo: decl.comboKeySource, palette: decl.paletteSource, declaration: `${prereg.sourceFile} §3 (${DECLARED_INJECTION})` },
  };
}

/**
 * THE identity both sides of the comparison run on, for one character.
 *  - a character with `declaredIdentity` → that declaration, verbatim;
 *  - anything else → the shipped read path's derivation for the id.
 * Either way the record carries `source` and what the engine's read path
 * derives for the id (`engineDerived`), so a divergence is on the record.
 */
export function identityFor(character) {
  const derived = wizardIdentity(character);
  const engineDerived = { comboKey: derived.comboKey, traits: derived.traits, palette: derived.palette };
  if (!character.declaredIdentity) {
    return { ...derived, source: 'derived', engineDerived };
  }
  const d = character.declaredIdentity;
  return {
    characterId: character.id,
    element: d.element || character.element,
    comboKey: d.comboKey,
    traits: d.traits,
    palette: d.palette,
    source: 'declared',
    engineDerived,
    matchesEngineDerivation: d.comboKey === derived.comboKey,
  };
}

// ---- the engine side for an identity the read path cannot produce ----------
//
// The sampled rows go through the shipped loadout (`createRigLoadout`)
// untouched. The canonical row cannot: `createRigLoadout` resolves identity
// internally from the characterId, so there is no seam to hand it a declared
// identity. This is the shipped loadout's OWN sequence — library URL from
// `wizardRig.animationUrl`, the same vendored-fallback rule on a failed
// fetch, the same `rigRecolor.recolorAnimation` live recolour, the same
// "no slot classes ⇒ unslotted, recorded not hidden" guard — over a given
// identity instead of a derived one. Nothing is re-implemented beyond that
// sequencing: every step calls the shipped function.
//
// `app/tests/parity-harness.test.js` pins this to `createRigLoadout` — for a
// character whose declared identity IS its derived identity, the two produce
// byte-identical documents for every duel state and cape, so this path can
// only differ from the shipped one by the identity it was handed.

/** The shipped loadout's fallback base, PARSED from the shipped source (never
 * retyped here — if the loadout stops declaring it, this stops). */
export function parseLoadoutFallbackBase(file = RIG_ASSETS_SOURCE) {
  const src = fs.readFileSync(path.join(REPO, file), 'utf8');
  const m = /const FALLBACK_BASE = '([^']+)'/.exec(src);
  if (!m) throw new Error(`identity: ${file} no longer declares FALLBACK_BASE — the declared-identity loadout mirrors the shipped one and stops rather than guess`);
  return { base: m[1], source: file };
}

async function fetchJson(url, fetchImpl, cache) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`rig fetch failed: ${res.status}`);
  const json = await res.json();
  cache.set(url, json);
  return json;
}

/**
 * The loadout for ONE declared identity, loadout-shaped (`get(side, state)`,
 * `getCape`, `identities`, `report`, `ready`) so callers cannot tell which
 * path produced it. Side 'p1' only — a per-wizard dump needs one combatant.
 */
export function createDeclaredIdentityLoadout({ identity, fetchImpl, cache = new Map(), fallbackBase = null }) {
  const doFetch = fetchImpl || ((url) => fetch(url));
  const FALLBACK_BASE = (fallbackBase || parseLoadoutFallbackBase()).base;
  const side = { fallbackStates: [], fallbackCapes: [], unslottedStates: [] };
  const report = { p1: side, p2: { fallbackStates: [], fallbackCapes: [], unslottedStates: [] } };
  const store = { states: {}, capes: {} };
  const tasks = [];
  let loaded = 0;

  for (const state of DUEL_STATES) {
    tasks.push((async () => {
      let raw;
      try {
        raw = await fetchJson(animationUrl(state, identity.comboKey), doFetch, cache);
      } catch {
        side.fallbackStates.push(state);
        raw = await fetchJson(`${FALLBACK_BASE}/fallback/${elementToken(identity.element)}/${state}.json`, doFetch, cache);
      }
      const { animation, stats } = recolorAnimation(raw, identity.palette);
      if (stats.recoloured === 0) side.unslottedStates.push(state);
      store.states[state] = animation;
      loaded++;
    })());
  }
  for (const kind of ['win', 'lose']) {
    tasks.push((async () => {
      let raw;
      const url = affinityCapeUrl(kind, identity.element, identity.traits.power);
      try {
        if (!url) throw new Error('no cape in manifest');
        raw = await fetchJson(url, doFetch, cache);
      } catch {
        side.fallbackCapes.push(kind);
        raw = await fetchJson(`${FALLBACK_BASE}/fx/affinitycape${kind}-${elementToken(identity.element)}.json`, doFetch, cache);
      }
      store.capes[kind] = recolorAnimation(raw, identity.palette).animation;
      loaded++;
    })());
  }

  const total = DUEL_STATES.length + 2;
  return {
    identities: { p1: identity, p2: identity },
    report,
    ready: Promise.all(tasks).then(() => undefined),
    progress: () => ({ loaded, total }),
    get: (_side, state) => store.states[state] || null,
    getCape: (_side, kind) => store.capes[kind] || null,
  };
}
