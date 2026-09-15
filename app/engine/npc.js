// app/engine/npc.js
// NPC roster generation for the sync bracket (§11, R80/R82). Every NPC seat
// carries a name/element/tendency drawn from the treatment's seed roster
// (canonical R82 entries first, then the "extended in the same voice" pool),
// falling back to a procedurally-tendencied entry from the name pool if a
// lobby needs more NPCs than the roster has (e.g. several concurrent
// brackets). NPC brains use the same PvE-policy tendency mixing as pve.js.

import { equilibriumMixWithDrift, pickDriftElement } from './pve.js';
import { ELEMENT_NAMES } from './duel.js';

export function pickNpcFromRoster(treatment, excludeNames, random = Math.random) {
  const pool = treatment.seedRoster.filter((r) => !excludeNames.has(r.name));
  const canonical = pool.filter((r) => r.canonical);
  const extended = pool.filter((r) => !r.canonical);
  const source = canonical.length > 0 ? canonical : extended;
  if (source.length > 0) {
    const idx = Math.floor(random() * source.length);
    return source[idx];
  }
  return null; // roster exhausted; caller falls back to procedural generation
}

/** Procedural fallback NPC once the roster is exhausted: a name-pool name
 * (not currently in use) with an equilibrium+drift tendency, in the same
 * voice as the roster (same tendency shape, just not hand-authored).
 *
 * C20/R57 fix (f2): this used to hardcode a 10% drift, independent of (and
 * inconsistent with) R57's stated 3% drift for house-play tendencies
 * elsewhere (app/engine/pve.js's PvE house opponents, which read
 * `tunables.pve.driftPerSessionPct`, currently 0.03). No stated reason
 * requires the bracket-NPC procedural fallback to drift differently from
 * every other house-play tendency in the build, so this now reads the SAME
 * single source instead of a second, disagreeing literal.
 */
export function proceduralNpc(tunables, treatment, excludeNames, random = Math.random) {
  const candidates = treatment.namePool.filter((n) => !excludeNames.has(n));
  const name = candidates.length > 0
    ? candidates[Math.floor(random() * candidates.length)]
    : `Understudy #${Math.floor(random() * 10000)}`;
  const driftElement = pickDriftElement(random);
  const tendency = equilibriumMixWithDrift(driftElement, tunables.pve.driftPerSessionPct);
  return { name, element: driftElement, tendency, canonical: false, procedural: true };
}

/**
 * Build a full NPC seat entry: name/element/tendency plus a fresh W/L record
 * and the permanent visible NPC tag (R80, invariant #8).
 */
export function generateNpcSeat(tunables, treatment, excludeNames, random = Math.random) {
  const fromRoster = pickNpcFromRoster(treatment, excludeNames, random);
  const base = fromRoster || proceduralNpc(tunables, treatment, excludeNames, random);
  return {
    kind: 'npc',
    npcTag: true, // invariant #8: every NPC-occupied seat renders this on every surface
    name: base.name,
    element: base.element,
    tendency: base.tendency,
    record: { w: 0, l: 0 },
  };
}

export function tendencyLabel(tendency) {
  return ELEMENT_NAMES.map((e) => `${e[0].toUpperCase()}${(tendency[e] * 100).toFixed(0)}`).join('/');
}

/**
 * C20/R51/R82: summarize the CANONICAL seed roster's tendency bias range --
 * "each biased X%-Y% toward one element" -- for the pre-registration's
 * house-play disclosure (app/engine/runSimulator.js:generatePreRegistration),
 * computed live from the treatment's actual data instead of a hand-typed
 * (and driftable) restatement of R82's numbers.
 */
export function rosterBiasRange(treatment) {
  const canonical = (treatment.seedRoster || []).filter((r) => r.canonical);
  const biases = canonical.map((r) => Math.max(r.tendency.fire, r.tendency.water, r.tendency.air));
  return {
    count: canonical.length,
    min: biases.length ? Math.min(...biases) : 0,
    max: biases.length ? Math.max(...biases) : 0,
  };
}
