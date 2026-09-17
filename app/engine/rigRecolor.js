// app/engine/rigRecolor.js — CB-BUILD-006 / §18: recolour a per-combo SHAPE
// set to one wizard's own palette. Never bakes: the recolour happens live,
// per wizard, at load time in memory (and in the parity harness), on the
// Lottie interchange JSON — geometry, motion, timing and every non-slot
// colour pass through untouched.
//
// How the slots are wired (derived from the sources, not invented): the
// portrait SVGs carry the colour-slot system as CSS variables (--hat-base,
// --cape-base, --medallion-base, …) applied to named part groups; the shape
// library mirrors exactly that wiring as `cl` classes on its fill/stroke
// items ("hat-base", "cape-base", "collar-button", …) — including the rig's
// RubberHose leg strokes, which carry "body-pants" (the portraits route
// legs to --pants-base the same way). Fixed classes ("black", "black-str*",
// "head-base", "head-accent", "wand-base") are the outlines, the head skin
// and the wand wood — the portraits bake those with the part, not the
// wizard, so the recolour leaves them alone. Unclassed colours are the
// element FX and hidden rig guides: source fidelity, untouched.
//
// Pure module: no DOM, no fetch; Node-testable.

// Lottie fill/stroke class -> palette slot name. Both sides use the
// portraits' own slot vocabulary; the two spellings that differ are mapped
// here ("hand-*" vs "hands-*", "collar-button" vs "medallion-base",
// "CAPE-base" on the affinity-cape overlays vs "cape-base").
export const CLASS_TO_SLOT = Object.freeze({
  'hat-base': 'hat-base',
  'hat-accent': 'hat-accent',
  'cape-base': 'cape-base',
  'CAPE-base': 'cape-base',
  'collar-base': 'collar-base',
  'collar-accent': 'collar-accent',
  'collar-button': 'medallion-base',
  'body-pants': 'pants-base',
  'boot-base': 'boot-base',
  'boot-accent': 'boot-accent',
  'hand-base': 'hands-base',
  'hand-accent': 'hands-accent',
  'wand-accent': 'wand-accent',
});

// Classes that must NEVER recolour (outline ink, head skin, wand wood):
// listed so the tests can assert the boundary, and so a future class added
// to the library fails loudly here instead of silently recolouring.
export const FIXED_CLASSES = Object.freeze([
  'black', 'black-str', 'black-str-2x', 'black-str-4x', 'black-str-lg',
  'head-base', 'head-accent', 'wand-base',
]);

function hexToLottie(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`rigRecolor: bad colour ${hex}`);
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

export function lottieToHex(k) {
  return '#' + k.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const LEG_LAYER_RE = /^leg/i;

/**
 * Recolour one animation JSON to a wizard's palette. Returns a deep copy;
 * the source object is never mutated (so a cached fetch can serve both
 * combatants). `palette` maps slot name -> '#RRGGBB'.
 */
export function recolorAnimation(animJson, palette) {
  const copy = JSON.parse(JSON.stringify(animJson));
  const stats = { recoloured: 0, byClass: {}, legHoses: 0 };

  function recolourItem(item, slot) {
    const hex = palette[slot];
    if (!hex || !item.c || item.c.a === 1) return; // no palette entry / animated colour: leave source
    item.c.k = hexToLottie(hex);
    stats.recoloured++;
    stats.byClass[item.cl] = (stats.byClass[item.cl] || 0) + 1;
  }

  function walkShapes(items, inLegLayer) {
    for (const s of items || []) {
      if (s.ty === 'gr') { walkShapes(s.it, inLegLayer); continue; }
      if (s.ty !== 'fl' && s.ty !== 'st') continue;
      if (s.cl && CLASS_TO_SLOT[s.cl]) {
        recolourItem(s, CLASS_TO_SLOT[s.cl]);
        if (inLegLayer && s.ty === 'st') stats.legHoses++;
      }
    }
  }

  function walkLayers(layers) {
    for (const layer of layers || []) {
      const inLegLayer = LEG_LAYER_RE.test(layer.nm || '');
      if (layer.shapes) walkShapes(layer.shapes, inLegLayer);
      // Some precomp instances carry their own inline `layers` copy (the
      // library's files are self-contained); lottie-web renders those, so
      // they recolour too.
      if (layer.layers) walkLayers(layer.layers);
    }
  }

  walkLayers(copy.layers);
  for (const asset of copy.assets || []) walkLayers(asset.layers);

  return { animation: copy, stats };
}

/**
 * A geometry digest: the animation JSON with every colour value blanked,
 * serialized. Two recolourings of the same shape set MUST digest equal (the
 * recolour changes colours and nothing else) — used by the tests and the
 * parity harness, not by the runtime.
 */
export function geometryDigest(animJson) {
  return JSON.stringify(animJson, (key, value) => {
    if (key === 'c' && value && typeof value === 'object' && 'k' in value) return '<COLOUR>';
    return value;
  });
}

/** Every static fill/stroke colour in the JSON with its class, flattened —
 * test/harness helper. */
export function colourInventory(animJson) {
  const out = [];
  (function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') {
      if ((o.ty === 'fl' || o.ty === 'st') && o.c && Array.isArray(o.c.k) && typeof o.c.k[0] === 'number') {
        out.push({ cl: o.cl || null, ty: o.ty, hex: lottieToHex(o.c.k) });
      }
      for (const k in o) walk(o[k]);
    }
  })(animJson);
  return out;
}
