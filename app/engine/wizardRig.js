// app/engine/wizardRig.js — CB-BUILD-006 / §18 / R74: the parametric wizard
// identity. The 2019 system pre-rendered no wizard: every wizard is unique
// and generated, and the duel presentation animates the ACTUAL summoned
// wizard — a per-combo SHAPE set (selected by the wizard's cosmetic traits:
// head/cape/hat/wand + element + power) recoloured live to the wizard's own
// palette (one colour per named slot, per the portraits' colour-slot
// system). This module is the pure identity layer: deterministic trait and
// palette derivation, keyed by characterId, computed at READ time
// (CB-BUILD-022/R74/§18 — the rig's derivation is the authority; the ledger
// only records history) — the same derivation game.js calls once, additively,
// to WRITE an audit record at summon, so a character resolves to a real
// shape set in the library manifest whether or not that record is present or
// intact. No DOM, no fetch; Node-testable.
//
// Provenance: shapes/manifest from the public production bucket (§18
// location 1, derived by tools/rig/build-manifest.mjs); palette from the
// bundle's canonical palette source cross-checked against production
// portraits (tools/rig/build-palette.mjs); slot semantics from the portrait
// SVGs' CSS colour variables, which the shape library mirrors as fill/stroke
// classes (see app/engine/rigRecolor.js).
import { RIG_BUCKET_BASE, RIG_STATES, RIG_COMBOS, RIG_AFFINITY_TIERS } from '../data/rigManifest.js';
import { SLOT_NAMES, SLOT_COLOURS } from '../data/rigPalette.js';

export { RIG_STATES };

// Game element key -> the library's element token ("Wind is Air" in all
// copy, R74; the library keeps the 2019 file naming).
const ELEMENT_TOKEN = { fire: 'FIRE', water: 'WATER', air: 'WIND' };

// ---- deterministic hashing --------------------------------------------------
// FNV-1a 32-bit over a string; cheap, stable across platforms, and good
// enough to spread trait/palette picks. NEVER a math/economy input — this
// seeds presentation identity only (which shapes and colours a wizard gets),
// assigned once at summon and recorded on the ledger.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function pick(list, seed) {
  return list[seed % list.length];
}

// ---- trait assignment -------------------------------------------------------

const COMBO_RE = /^(FIRE|WATER|WIND|NEUTRAL)-(\d+)-(head\d+)-(cape\d+)-(hat\d+)-(wand\d+)$/;

/** Parse a manifest combo key into its fields. */
export function parseComboKey(comboKey) {
  const m = COMBO_RE.exec(comboKey);
  if (!m) return null;
  return { element: m[1], power: Number(m[2]), head: m[3], cape: m[4], hat: m[5], wand: m[6] };
}

const combosByElement = {};
for (const key of RIG_COMBOS) {
  const p = parseComboKey(key);
  if (!p) continue;
  (combosByElement[p.element] = combosByElement[p.element] || []).push({ key, ...p });
}

/** The power tiers the library actually carries for an element. */
function availablePowers(elementToken) {
  return [...new Set((combosByElement[elementToken] || []).map((c) => c.power))].sort((a, b) => a - b);
}

/** Map a game tier (0-based ladder) to the nearest available library power
 * tier for the element (the library's numeric tiers are sparse). */
export function powerForTier(elementToken, tier) {
  const powers = availablePowers(elementToken);
  if (powers.length === 0) return 1;
  const want = (Number(tier) || 0) + 1; // tier 0 -> power 1
  let best = powers[0];
  for (const p of powers) {
    if (Math.abs(p - want) < Math.abs(best - want)) best = p;
  }
  return best;
}

/** The eligible pool for one element token + power family, with the same
 * total fallback chain the summon derivation has always used: the power
 * family, else the whole element, else the whole library. */
function familyPool(token, power) {
  let pool = (combosByElement[token] || []).filter((c) => c.power === power);
  if (pool.length === 0) pool = combosByElement[token] || [];
  if (pool.length === 0) pool = RIG_COMBOS.map((key) => ({ key, ...parseComboKey(key) })).filter(Boolean);
  return pool;
}

/**
 * Deterministic cosmetic-trait assignment: pick, from the shape sets the
 * library actually carries for the wizard's element and power tier, one
 * combo keyed by a hash of the characterId. Total: EVERY characterId — one
 * summoned now or one the system has never seen — resolves to a real,
 * complete (all ten states) shape set.
 */
export function deriveTraits(characterId, elementKey, tier = 0) {
  const token = ELEMENT_TOKEN[elementKey] || 'FIRE';
  const power = powerForTier(token, tier);
  const chosen = pick(familyPool(token, power), fnv1a(`traits:${characterId}`));
  return { head: chosen.head, cape: chosen.cape, hat: chosen.hat, wand: chosen.wand, power: chosen.power, comboKey: chosen.key };
}

// ---- cosmetic carry across power families (N-R74, fix round F3b; wired
// back into the read path by fix round F3 — see the doc comment further
// down by wizardIdentity/deriveIdentity) -------------------------------------

const COMBO_SET = new Set(RIG_COMBOS);
const CARRY_PARTS = ['head', 'cape', 'hat', 'wand'];

/**
 * N-R74 (R74 [LAW] "each combatant is the actual summoned wizard — its
 * parts composited from ITS OWN traits"; §17 AC1 "its own cosmetic set"):
 * carry a wizard's RECORDED cosmetic combo into the power family of its
 * CURRENT tier. The power tier stays a live read (the A-power rule from fix
 * round F2 — one rule for player and NPC) but the wizard's own cosmetic
 * identity is never discarded:
 *
 * 1. Recorded power already matches the live power family → the recorded
 *    traits verbatim (tier-0 behaviour unchanged; parity checks B/D derive
 *    at tier 0 and are untouched).
 * 2. The EXACT recorded head/cape/hat/wand exists in the live power family
 *    (the manifest lists `<ELEMENT>-<livePower>-<head>-<cape>-<hat>-<wand>`
 *    among the eligible combos) → that combo. The wizard keeps its whole
 *    cosmetic set; only the shape family's power changes.
 * 3. Otherwise, the DETERMINISTIC nearest match within the live power
 *    family's eligible pool. The metric: most recorded parts preserved
 *    (head/cape/hat/wand, each weighted equally); ties broken by the
 *    existing summon hash — `fnv1a('traits:' + characterId)` indexes into
 *    the tied candidates sorted lexicographically by combo key (stable
 *    across manifest ordering, same hash the summon derivation uses, so
 *    the fallback is a pure function of the recorded traits + characterId
 *    + tier).
 *
 * Ledger history untouched: this was always the READ path only, and the
 * function itself is unchanged and still exported (existing direct tests of
 * this pure utility — rig-power-tier.test.js, rig-cosmetic-carry.test.js —
 * still call it explicitly with a `recorded` argument they supply). Fix
 * round F3: `deriveIdentity` (below) now calls this too, but never with a
 * ledger-recorded value — the `recorded` argument it passes is itself the
 * output of `deriveTraits(characterId, elementKey, 0)`, the wizard's own
 * canonical tier-0 combo, derived (not read) fresh on every call. So the
 * read path still never looks at `character.traits`/`character.palette` or
 * any other recorded field (CB-BUILD-022 holds), while the wizard's own
 * cosmetic combo carries forward across tiers (N-R74 holds) — the two are
 * simultaneously satisfiable because "the wizard's own combo" was never a
 * ledger fact in the first place; it is fully determined by
 * (characterId, elementKey) alone.
 */
export function carryTraits(recorded, characterId, elementKey, tier = 0) {
  const token = ELEMENT_TOKEN[elementKey] || 'FIRE';
  const livePower = powerForTier(token, tier);
  if (recorded.power === livePower) return recorded;
  const exactKey = `${token}-${livePower}-${recorded.head}-${recorded.cape}-${recorded.hat}-${recorded.wand}`;
  if (COMBO_SET.has(exactKey)) {
    return { head: recorded.head, cape: recorded.cape, hat: recorded.hat, wand: recorded.wand, power: livePower, comboKey: exactKey };
  }
  const pool = familyPool(token, livePower);
  let bestScore = -1;
  let best = [];
  for (const c of pool) {
    let score = 0;
    for (const part of CARRY_PARTS) if (c[part] === recorded[part]) score += 1;
    if (score > bestScore) { bestScore = score; best = [c]; }
    else if (score === bestScore) best.push(c);
  }
  best.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const chosen = pick(best, fnv1a(`traits:${characterId}`));
  return { head: chosen.head, cape: chosen.cape, hat: chosen.hat, wand: chosen.wand, power: chosen.power, comboKey: chosen.key };
}

// ---- palette assignment -----------------------------------------------------

/**
 * Deterministic palette assignment: one colour per slot, each drawn from
 * that slot's own canonical value list (what production portraits shipped
 * for that slot), hashed per-slot so two different characterIds disagree on
 * many slots with high probability.
 */
export function derivePalette(characterId) {
  const palette = {};
  for (const slot of SLOT_NAMES) {
    palette[slot] = pick(SLOT_COLOURS[slot], fnv1a(`palette:${slot}:${characterId}`));
  }
  return palette;
}

// ---- the full identity -------------------------------------------------------
//
// CB-BUILD-022 / R74 / §18 (master rule, superseding A-power/N-R74 below):
// "each combatant is the actual character, composited and recoloured by the
// rig. THE RIG'S DERIVATION IS THE AUTHORITY; the ledger records history."
//
// Round-1 (see the superseded A-power/N-R74 doc comment further down, kept
// for provenance on carryTraits) had the read path PREFER traits/palette
// RECORDED on the character (summon-time fields, carried additively on the
// ledger payload) and fall back to derivation only when those fields were
// absent. Two valid designs existed and the spec named neither; with the
// playback engine slated for replacement (R78), binding the ledger to the
// current identity model was the heavier commitment. Build-forward: identity
// is now derived DETERMINISTICALLY from the character id (element, and the
// live tier for the power family) at READ time, ALWAYS — never from
// `character.traits` / `character.palette`, whatever they hold (absent,
// stale, or simply wrong; the ledger is never consulted here at all). Those
// fields stay written at summon (game.js) as an honest audit record of what
// the rig showed at that moment, but nothing downstream reads them anymore.
//
// Fix round F3 (reviewer CRUCIAL, reproduced by the manager at 900/900
// tier0-vs-tier1 differing): the paragraph above is still the rule for
// PALETTE and for the POWER FAMILY, but the naive reading of it —
// re-deriving head/cape/hat/wand from a fresh hash pool at the LIVE tier —
// silently reintroduced the exact bug N-R74/F3b had already fixed: a
// wizard's cosmetic combo has no reason to stay stable across tiers, so it
// (almost) never did (1789/1800 cases changed at least one part; the
// manager's own probe found 900/900). That violates R74 [LAW] ("its parts
// composited from ITS OWN traits") and CB-BUILD-006. The two rules are NOT
// in tension: "never read the ledger" and "the wizard keeps its own combo
// across tiers" are both satisfiable, because the wizard's tier-0 combo is
// ITSELF a pure function of (characterId, elementKey) — nothing on the
// ledger is needed to know what a wizard's "own" combo is. So: derive the
// combo at tier 0 (the wizard's own, canonical cosmetic identity — no
// ledger read, no argument other than characterId/elementKey), then carry
// it into the live tier's power family with `carryTraits` (also no ledger
// read — pure function of the tier-0 traits + characterId + elementKey +
// live tier, restoring the N-R74/F3b guarantee: exact combo wins if it
// exists at the new power, else the deterministic nearest-match fallback).

/**
 * THE derivation entry point (CB-BUILD-022 + F3): the same traits + palette
 * for the same (characterId, elementKey, tier), every time, in a fresh
 * process, with no ledger read and no in-memory cache seeding the answer —
 * a pure function of its arguments. This is what game.js's summon ceremony
 * writes (tier 0, where the carry below is a no-op) and what every render
 * read path (wizardIdentity below, the duel stage's rig loadout) now calls,
 * directly or indirectly, INSTEAD of consulting any recorded field.
 *
 * Cosmetic parts (head/cape/hat/wand) are derived ONCE at tier 0 — the
 * wizard's own canonical combo, keyed only by characterId/elementKey — and
 * then carried into the live tier's power family via `carryTraits` (N-R74/
 * F3b): the wizard's exact combo if the manifest still carries it at the
 * new power, else the deterministic nearest match. Palette is unaffected
 * (already tier-independent). Nothing here reads `character.traits` /
 * `character.palette` or any other ledger-recorded field — `tier` is a
 * live argument (the caller's current view of the character), not a
 * recorded one. Stable, `derive…(characterId)`-shaped, for a sibling
 * ceremony (CB-BUILD-014's reveal) to call directly.
 */
export function deriveIdentity(characterId, elementKey, tier = 0) {
  const baseTraits = deriveTraits(characterId, elementKey, 0);
  const traits = carryTraits(baseTraits, characterId, elementKey, tier);
  const palette = derivePalette(characterId);
  return { characterId, element: elementKey, traits, palette, comboKey: traits.comboKey };
}

/**
 * The wizard's rig identity: traits + palette + resolved combo key, for a
 * character-shaped object (`{ id, element, tier }`, e.g. a projection
 * snapshot entry). Signature unchanged for backward compatibility, but the
 * body no longer reads `character.traits` / `character.palette` — see
 * `deriveIdentity` above. A character the system has never seen, one whose
 * recorded fields are absent, and one whose recorded fields are stale/wrong
 * all render byte-identically, because none of that is ever consulted —
 * `tier` (the only per-call input besides id/element) is always taken from
 * the caller's live argument, carrying the wizard's own tier-0 combo
 * forward via `deriveIdentity` (F3), never from a recorded combo.
 */
export function wizardIdentity(character) {
  const { id, element, tier = 0 } = character;
  return deriveIdentity(id, element, tier);
}

// ---- library addressing -----------------------------------------------------

/** The library filename for one duel state of one combo. */
export function animationName(state, comboKey) {
  if (!RIG_STATES.includes(state)) throw new Error(`unknown rig state: ${state}`);
  return `${state}-${comboKey}.json`;
}

/** Absolute public-bucket URL for one duel state of one combo. */
export function animationUrl(state, comboKey) {
  return `${RIG_BUCKET_BASE}/${animationName(state, comboKey)}`;
}

/** The affinity-cape FX overlay (win|lose) for an element+power, at the
 * nearest tier the library carries. Returns null when the element has none. */
export function affinityCapeName(kind, elementKey, power = 1) {
  const token = ELEMENT_TOKEN[elementKey] || 'FIRE';
  const tiers = (RIG_AFFINITY_TIERS[token] || {})[kind] || [];
  const numeric = tiers.map(Number).filter((n) => !Number.isNaN(n));
  if (numeric.length === 0) return null;
  let best = numeric[0];
  for (const t of numeric) {
    if (Math.abs(t - power) < Math.abs(best - power)) best = t;
  }
  return `affinitycape${kind}-${token}-${best}.json`;
}

export function affinityCapeUrl(kind, elementKey, power = 1) {
  const name = affinityCapeName(kind, elementKey, power);
  return name ? `${RIG_BUCKET_BASE}/${name}` : null;
}

/** The library's element token for a game element key (exported for the
 * stage's fallback pathing). */
export function elementToken(elementKey) {
  return ELEMENT_TOKEN[elementKey] || 'FIRE';
}
