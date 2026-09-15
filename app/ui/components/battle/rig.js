// app/ui/components/battle/rig.js — CB-BUILD-006 / §18 / R74: the
// reconstructed parametric wizard rig, ported from the shipped 2019 system.
//
// How the 2019 product animated (§18, corrected in CB-BUILD-006's root
// cause): no wizard was ever pre-rendered. The per-combo animation library
// (public bucket, Lottie v5.5.2, 30fps, 1720×1400, ten duel states) is the
// SHAPE layer, keyed to the cosmetic combo (element/power/head/cape/hat/
// wand), never to a specific wizard; a wizard's identity is its own colours
// filling that shape set's named colour slots — the same slot system the
// portrait SVGs expose as CSS custom properties (--hat-base, --hat-accent,
// --medallion-base, --collar-base, --cape-base, --pants-base, --boot-base,
// --boot-accent, --hands-base, --hands-accent, --wand-accent).
//
// This module is the pure core of that rig, DOM-free so node --test can
// exercise it end to end:
//   traits   — a summoned wizard's identity deterministically selects an
//              EXISTING cosmetic shape set (shape-manifest.js, listed from
//              the real bucket);
//   palette  — the same identity deterministically fills the eleven colour
//              slots from the canonical pool (palette-pool.js, sampled from
//              real 2019 portraits);
//   recolour — a shape document is deep-cloned and its slot-mapped fills are
//              replaced with the wizard's palette (the source document is
//              never mutated: no palette ever leaks between wizards);
//   composite— traits + palette + state → the wizard's own parametric
//              document, ready for the runtime player (player.js).
//
// A wizard the system has never seen animates as itself: its identity is
// enough to derive traits and palette, and the shape library covers every
// combo the manifest lists. The bundle's nine GIFs / PNG sequences are
// parity references only and are never touched at runtime (CB-BUILD-005).
import { SHAPE_MANIFEST } from './shape-manifest.js';
import { PALETTE_POOL, PALETTE_SLOTS } from './palette-pool.js';

export { PALETTE_POOL, PALETTE_SLOTS };

// ---- the library's state set and the timeline mapping ----------------------

// The ten duel states every combo ships in the 2019 library (§18).
export const LIBRARY_STATES = Object.freeze([
  'idle', 'charge', 'chargeloop', 'attack', 'hit', 'reset', 'cancel',
  'win', 'lose', 'draw',
]);

// Timeline state (engine/presentationTimeline.js, R75) → library shape
// state. Mapping choices follow the reference implementation
// (assets/cw-asset-bundle/reference/DuelPlayer/DuelPlayer.js), not taste:
//  - battleIdle → idle: the library's idle IS the in-battle idle (the
//    reference's HOME_IDLE/AWAY_IDLE loop).
//  - hitSuccess → reset: the reference plays RESET for the round winner
//    ("isHomeResetPlaying: isHomeRoundWinner || isDraw") and HIT for the
//    loser — the library has no separate hitsuccess entry; the winner's
//    beat is the reset animation.
//  - draw (round-level) never reaches the library: R75 returns both to
//    Battle Idle (the timeline emits p1State/p2State = battleIdle). The
//    library's 'draw' entry is the duel-level draw the reference plays on
//    a drawn duel (isDrawPlaying), kept mapped for completeness.
//  - power → win: the library has no power entry (Power exists only in the
//    bundle renders); the reference ends on WIN/LOSE. The winner's Power
//    beat plays the win shapes over the stake counter.
export const TIMELINE_TO_LIBRARY_STATE = Object.freeze({
  idle: 'idle',
  battleIdle: 'idle',
  charge: 'charge',
  chargeLoop: 'chargeloop',
  attack: 'attack',
  hit: 'hit',
  hitSuccess: 'reset',
  reset: 'reset',
  draw: 'draw',
  win: 'win',
  lose: 'lose',
  power: 'win',
  cancel: 'cancel',
});

// Game element → library element key. The game's Air is the library's WIND
// (R74: "Wind is Air in all copy" — copy says Air, the asset key stays WIND).
export const ELEMENT_TO_LIBRARY = Object.freeze({ fire: 'FIRE', water: 'WATER', air: 'WIND' });

// ---- bucket addressing ------------------------------------------------------

export const BUCKET_NAME = 'cheeze-wizards-production';
export const PRIMARY_CONTRACT = '0x0d8c864da1985525e0af0acbeef6562881827bd5';

/** The object name of one combo+state shape document in the bucket. */
export function shapeObjectName(traits, state) {
  return `${PRIMARY_CONTRACT}/wizard-animations/${state}-${traits.element}-${traits.power}-head${traits.head}-cape${traits.cape}-hat${traits.hat}-wand${traits.wand}.json`;
}

/** The affinity cape overlay object (per element and power tier, win/lose). */
export function affinityCapeObjectName(elementKey, power, won) {
  const lib = ELEMENT_TO_LIBRARY[elementKey] || elementKey;
  return `${PRIMARY_CONTRACT}/wizard-animations/affinitycape${won ? 'win' : 'lose'}-${lib}-${power}.json`;
}

/**
 * A browser-fetchable URL for a bucket object. Deliberately the GCS JSON-API
 * media endpoint, NOT the plain `storage.googleapis.com/<bucket>/<object>`
 * form: the bucket has no CORS configuration, so the plain form is
 * fetch()-blocked from any static-app origin, while the JSON-API media
 * endpoint serves Access-Control-Allow-Origin and works cross-origin.
 * (Verified against the live bucket; discovery recorded in the patch notes.)
 */
export function mediaUrlForObject(objectName) {
  return `https://storage.googleapis.com/download/storage/v1/b/${BUCKET_NAME}/o/${encodeURIComponent(objectName)}?alt=media`;
}

export function shapeUrlFor(traits, state) {
  return mediaUrlForObject(shapeObjectName(traits, state));
}

// ---- deterministic identity → traits + palette ------------------------------

/** FNV-1a 32-bit — tiny, stable, dependency-free. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function identityKey(identity) {
  return `${identity.id || ''}|${identity.name || ''}`;
}

/**
 * The wizard's cosmetic traits: its identity deterministically selects one
 * EXISTING shape set of its element from the manifest. The combo encodes
 * power-head-cape-hat-wand exactly as the bucket names it.
 */
export function traitsForIdentity(identity, manifest = SHAPE_MANIFEST) {
  const lib = ELEMENT_TO_LIBRARY[identity.element];
  if (!lib) throw new Error(`traitsForIdentity: unknown element "${identity.element}"`);
  const combos = manifest[lib];
  const combo = combos[hashString(`${identityKey(identity)}|combo`) % combos.length];
  const [power, head, cape, hat, wand] = combo.split('-');
  return { element: lib, power, head, cape, hat, wand, combo };
}

/**
 * The wizard's own palette: one canonical-pool colour per slot, each drawn
 * by an independent hash of the identity (plus an optional salt — used only
 * by the distinctness guard below, never for a lone wizard).
 */
export function paletteForIdentity(identity, { salt = 0 } = {}) {
  const key = identityKey(identity);
  const palette = {};
  for (const slot of PALETTE_SLOTS) {
    const pool = PALETTE_POOL[slot];
    palette[slot] = pool[hashString(`${key}|${slot}|${salt}`) % pool.length];
  }
  return palette;
}

function sameRig(a, b) {
  if (!a || !b) return false;
  if (a.traits.combo !== b.traits.combo || a.traits.element !== b.traits.element) return false;
  return PALETTE_SLOTS.every((s) => a.palette[s] === b.palette[s]);
}

/**
 * The full rig keying for one wizard: traits + palette, both derived from
 * the identity alone (deterministic — the same character always animates as
 * the same wizard). `distinctFrom` is R74's "visually distinct" guard: in
 * the astronomically-unlikely event two combatants derive an identical
 * combo AND identical palette, the second wizard's palette re-derives with
 * a deterministic salt until it differs (bounded; still a pure function of
 * the two identities).
 */
export function wizardRigFor(identity, { distinctFrom = null } = {}) {
  const traits = traitsForIdentity(identity);
  let palette = paletteForIdentity(identity);
  let rig = { identity: identityKey(identity), traits, palette };
  let salt = 0;
  while (distinctFrom && sameRig(rig, distinctFrom) && salt < 8) {
    salt += 1;
    palette = paletteForIdentity(identity, { salt });
    rig = { identity: identityKey(identity), traits, palette };
  }
  return rig;
}

// ---- the recolour pass ------------------------------------------------------

// Part classification: a shape layer's name → which portrait slot family it
// belongs to. Matches the shape library's own layer naming (hat01…, cape04,
// collar, body/bodyBack, boot, hand, wand01…, leg01Left…) — the same part
// vocabulary as CW_Main_v09's part vectors and the portrait CSS selectors.
const PART_RULES = [
  { re: /^hat\d+/i, part: 'hat' },
  { re: /^cape\d+/i, part: 'cape' },
  { re: /^collar/i, part: 'collar' },
  { re: /^body(back)?$/i, part: 'body' },
  { re: /^boot/i, part: 'boot' },
  { re: /^hand$/i, part: 'hand' },
  { re: /^wand\d+/i, part: 'wand' },
  { re: /^leg\d+/i, part: 'leg' },
];

// (part, nearest named group) → palette slot. Mirrors the portrait CSS:
//   #hatNN #base → --hat-base, #hatNN #accent → --hat-accent, cape #base →
//   --cape-base, collar #base → --collar-base, the collar's button is the
//   medallion (--medallion-base), #legs/#body #pants → --pants-base, boot
//   base/accent, hand base/accent, wand #accent → --wand-accent (the wand's
//   base is wood and keeps its shipped colour, as in the portraits).
const SLOT_BY_PART_GROUP = {
  'hat/base': 'hatBase',
  'hat/accent': 'hatAccent',
  'cape/base': 'capeBase',
  'collar/base': 'collarBase',
  'collar/button': 'medallionBase',
  'body/pants': 'pantsBase',
  'boot/base': 'bootBase',
  'boot/accent': 'bootAccent',
  'hand/base': 'handsBase',
  'hand/accent': 'handsAccent',
  'wand/accent': 'wandAccent',
};

const NAMED_GROUPS = new Set(['base', 'accent', 'pants', 'button']);

export function hexToLottieRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function lottieRgbToHex(k) {
  const to = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(k[0])}${to(k[1])}${to(k[2])}`;
}

function isBlack(k) {
  return k[0] === 0 && k[1] === 0 && k[2] === 0;
}

function partForLayerName(nm) {
  if (typeof nm !== 'string') return null;
  for (const rule of PART_RULES) if (rule.re.test(nm)) return rule.part;
  return null;
}

function setColour(prop, rgb, applied, meta) {
  // Static colour: c.k = [r,g,b(,a)]; animated colour: c.k = keyframes with
  // s/e arrays. Both forms recoloured; alpha preserved.
  const c = prop.c;
  if (!c || c.k == null) return;
  const write = (arr) => {
    if (!Array.isArray(arr) || typeof arr[0] !== 'number') return null;
    const from = lottieRgbToHex(arr);
    arr[0] = rgb[0]; arr[1] = rgb[1]; arr[2] = rgb[2];
    return from;
  };
  if (Array.isArray(c.k) && typeof c.k[0] === 'number') {
    if (isBlack(c.k)) return; // outlines/ink are never a colour slot
    const from = write(c.k);
    if (from) applied.push({ ...meta, from });
  } else if (Array.isArray(c.k)) {
    for (const kf of c.k) {
      if (kf && Array.isArray(kf.s) && typeof kf.s[0] === 'number' && !isBlack(kf.s)) {
        const from = write(kf.s);
        if (kf.e) write(kf.e);
        if (from) applied.push({ ...meta, from, keyframed: true });
      }
    }
  }
}

function recolourShapeList(shapes, part, groupStack, palette, applied, layerName) {
  for (const s of shapes || []) {
    if (s.ty === 'gr') {
      const nm = typeof s.nm === 'string' ? s.nm.trim().toLowerCase() : '';
      groupStack.push(NAMED_GROUPS.has(nm) ? nm : (nm === 'basehose' ? 'basehose' : null));
      recolourShapeList(s.it, part, groupStack, palette, applied, layerName);
      groupStack.pop();
    } else if (s.ty === 'fl' || s.ty === 'st') {
      // the nearest NAMED ancestor group decides the slot
      let group = null;
      for (let i = groupStack.length - 1; i >= 0; i--) {
        if (groupStack[i]) { group = groupStack[i]; break; }
      }
      if (!group) continue;
      if (part === 'leg') {
        // RubberHose legs: the hose stroke/fill carries the pants colour
        // (portraits: #legs #base → --pants-base); the *_outline hoses are
        // black ink and stay untouched via the isBlack guard.
        if (group === 'basehose') {
          setColour(s, hexToLottieRgb(palette.pantsBase), applied, { layer: layerName, group: 'BaseHose', slot: 'pantsBase', ty: s.ty });
        }
        continue;
      }
      if (s.ty === 'st' && part !== 'leg') continue; // slots are fills (portrait CSS recolours fill only)
      const slot = SLOT_BY_PART_GROUP[`${part}/${group}`];
      if (!slot) continue;
      setColour(s, hexToLottieRgb(palette[slot]), applied, { layer: layerName, group, slot, ty: s.ty });
    }
  }
}

/**
 * Recolour one shape document to one wizard's palette. Returns a NEW
 * document (deep clone) plus the applied-recolour report; the input
 * document is never mutated, so a shared/cached shape set can serve any
 * number of wizards without palette leakage.
 */
export function recolourShapeDocument(doc, palette) {
  const out = structuredClone(doc);
  const applied = [];
  const walkLayers = (layers) => {
    for (const layer of layers || []) {
      if (!layer.shapes) continue;
      const part = partForLayerName(layer.nm);
      if (!part) continue;
      recolourShapeList(layer.shapes, part, [], palette, applied, layer.nm);
    }
  };
  walkLayers(out.layers);
  for (const asset of out.assets || []) walkLayers(asset.layers);
  return { doc: out, applied };
}

/**
 * The full parametric composite for one wizard in one state: the shape
 * document (the combo's own, or a fallback the loader supplies) recoloured
 * to the wizard's palette and stamped with its rig meta. Every summoned
 * wizard — including one the system has never seen — animates as ITSELF:
 * same identity, same document; different identity, different document.
 */
export function compositeParametricDocument({ rig, state, shapeDoc }) {
  const libraryState = TIMELINE_TO_LIBRARY_STATE[state] || state;
  const { doc, applied } = recolourShapeDocument(shapeDoc, rig.palette);
  doc.meta = {
    ...(doc.meta || {}),
    parametricRig: {
      identity: rig.identity,
      combo: `${rig.traits.element}-${rig.traits.combo}`,
      palette: { ...rig.palette },
      state: libraryState,
    },
  };
  return { doc, applied, rig, state, libraryState };
}
