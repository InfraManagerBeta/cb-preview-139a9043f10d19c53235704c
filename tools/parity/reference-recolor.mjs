// tools/parity/reference-recolor.mjs — CB-BUILD-015, the REFERENCE side's
// recolour: the wizard's colours applied "from its portrait colour slots",
// derived from the 2019 artifacts and NOT from app/engine/rigRecolor.js.
//
// Where the slots come from: the production portrait SVGs
// (assets/cw/client-static/img/wizards/*.svg) carry the colour-slot system
// as CSS custom properties (--hat-base, --cape-base, --medallion-base, …)
// routed onto named part groups (#hat01 #base { fill: var(--hat-base); }).
// This module PARSES that stylesheet at run time for the slot vocabulary,
// then resolves each shape-library `cl` class onto a slot by the rules
// pre-registered in PREREGISTRATION.md §1.1 — exact, singular/plural,
// part-only, and the one declared alias (collar-button -> medallion-base).
//
// The point of writing it twice: if the engine's CLASS_TO_SLOT table and the
// portrait's own routing ever disagree, the harness SEES it (the comparer
// reports slot-map disagreements per state, tolerance 0) instead of both
// sides making the same mistake in unison.
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './paths.mjs';

export const PORTRAIT_DIR = path.join(REPO, 'assets', 'cw', 'client-static', 'img', 'wizards');
export const PORTRAIT_SVG = path.join(PORTRAIT_DIR, 'fire.svg');

// The one spelling the portrait and the shape library do not share a word
// for. Pre-registered (PREREGISTRATION.md §1.1 rule 4) before the run.
export const DECLARED_ALIASES = Object.freeze({ 'collar-button': 'medallion-base' });

const ROLES = ['base', 'accent'];

/**
 * Parse the portraits' colour-slot system: every `--slot` custom property
 * the portraits declare OR reference, and every part-group selector routed
 * to it. The whole portrait set is read (one element's portrait can omit a
 * slot its stylesheet still routes), so the vocabulary is the system's, not
 * one file's. Returns { slots: [name…], routes: { slot: [groupId…] }, files }.
 */
export function parsePortraitSlots(dirOrFile = PORTRAIT_DIR) {
  const files = fs.statSync(dirOrFile).isDirectory()
    ? fs.readdirSync(dirOrFile).filter((f) => f.endsWith('.svg')).sort().map((f) => path.join(dirOrFile, f))
    : [dirOrFile];
  const slots = new Set();
  const routes = {};
  for (const file of files) {
    const svg = fs.readFileSync(file, 'utf8');
    // slots the portrait DECLARES (--slot: #RRGGBB) and slots it USES (var(--slot))
    for (const m of svg.matchAll(/--([a-z][a-z0-9-]*)\s*:\s*#[0-9A-Fa-f]{6}/g)) slots.add(m[1]);
    for (const m of svg.matchAll(/var\(\s*--([a-z][a-z0-9-]*)\s*\)/g)) slots.add(m[1]);
    for (const m of svg.matchAll(/([^{}]+)\{\s*(?:fill|stroke)\s*:\s*var\(\s*--([a-z][a-z0-9-]*)\s*\)\s*;?\s*\}/g)) {
      const slot = m[2];
      const groups = [...m[1].matchAll(/#([A-Za-z0-9_-]+)/g)].map((g) => g[1]);
      routes[slot] = [...new Set([...(routes[slot] || []), ...groups])];
    }
  }
  if (slots.size === 0) throw new Error(`reference-recolor: no colour slots found under ${dirOrFile}`);
  return {
    slots: [...slots].sort(),
    routes,
    files: files.map((f) => path.relative(REPO, f)),
  };
}

/** Split a slot name into its part and role ("hat-base" -> [hat, base]). */
function splitSlot(slot) {
  const i = slot.lastIndexOf('-');
  if (i < 0) return [slot, null];
  const role = slot.slice(i + 1);
  return ROLES.includes(role) ? [slot.slice(0, i), role] : [slot, null];
}

/**
 * Build the reference side's class -> slot resolver from the portrait's own
 * vocabulary. Returns { resolve(cl) -> slot|null, rules, slots }.
 * Rules, in the pre-registered order:
 *   1. exact (case-insensitive) match on a portrait slot name;
 *   2. singular/plural of the part with the same role (hand-base -> hands-base);
 *   3. part-only: no role token, exactly one slot whose part is one of the
 *      class's tokens (body-pants -> pants-base);
 *   4. the declared alias table (collar-button -> medallion-base).
 * Anything else resolves to null: the reference leaves that colour at source.
 */
export function buildReferenceSlotMap(portrait = parsePortraitSlots()) {
  const slots = portrait.slots;
  const lower = new Map(slots.map((s) => [s.toLowerCase(), s]));
  const parts = new Map(); // part -> [slot…]
  for (const slot of slots) {
    const [part] = splitSlot(slot);
    parts.set(part, [...(parts.get(part) || []), slot]);
  }
  const why = new Map();

  function resolve(cl) {
    if (!cl) return null;
    const key = String(cl).toLowerCase();
    // 1. exact
    if (lower.has(key)) { why.set(cl, 'exact'); return lower.get(key); }
    const tokens = key.split('-');
    const role = ROLES.includes(tokens[tokens.length - 1]) ? tokens[tokens.length - 1] : null;
    // 2. singular/plural of the part, same role
    if (role) {
      const part = tokens.slice(0, -1).join('-');
      for (const variant of [part, `${part}s`, part.replace(/s$/, '')]) {
        const cand = `${variant}-${role}`.toLowerCase();
        if (lower.has(cand)) { why.set(cl, 'number'); return lower.get(cand); }
      }
    }
    // 3. part-only (no role token): exactly one slot for that part
    if (!role) {
      const hits = [];
      for (const token of tokens) if (parts.has(token)) hits.push(...parts.get(token));
      if (hits.length === 1) { why.set(cl, 'part-only'); return hits[0]; }
    }
    // 4. declared alias
    if (DECLARED_ALIASES[cl] || DECLARED_ALIASES[key]) {
      why.set(cl, 'declared-alias');
      return DECLARED_ALIASES[cl] || DECLARED_ALIASES[key];
    }
    why.set(cl, 'unmapped');
    return null;
  }

  return { resolve, rule: (cl) => why.get(cl) || null, slots, routes: portrait.routes, portraitFiles: portrait.files };
}

function hexToLottie(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`reference-recolor: bad colour ${hex}`);
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

export function lottieHex(k) {
  return '#' + k.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Every static fill/stroke colour in a document, in document order, with its
 * class — the harness's OWN inventory (the engine has one too; comparing the
 * two documents item-for-item is the point, so this one is independent).
 */
export function staticColours(animJson) {
  const out = [];
  (function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') {
      if ((o.ty === 'fl' || o.ty === 'st') && o.c && Array.isArray(o.c.k) && typeof o.c.k[0] === 'number') {
        out.push({ cl: o.cl || null, ty: o.ty, hex: lottieHex(o.c.k) });
      }
      for (const k in o) walk(o[k]);
    }
  })(animJson);
  return out;
}

/**
 * Recolour one per-combo animation the way the portrait system does: every
 * fill/stroke item whose class routes to a colour slot takes the wizard's
 * colour for that slot. Deep walk (the portrait's CSS applies wherever the
 * element sits); animated colours and unrouted classes pass through.
 * Returns { animation, stats: { recoloured, byClass, unmappedClasses,
 * classesSeen } } — the source object is never mutated.
 */
export function referenceRecolor(animJson, palette, slotMap = buildReferenceSlotMap()) {
  const copy = JSON.parse(JSON.stringify(animJson));
  const stats = { recoloured: 0, byClass: {}, classesSeen: {}, unmappedClasses: [], skippedAnimatedColour: 0 };
  const unmapped = new Set();
  (function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') {
      if ((o.ty === 'fl' || o.ty === 'st') && o.cl) {
        stats.classesSeen[o.cl] = (stats.classesSeen[o.cl] || 0) + 1;
        const slot = slotMap.resolve(o.cl);
        if (!slot) unmapped.add(o.cl);
        else if (o.c && o.c.a === 1) stats.skippedAnimatedColour++;
        else if (o.c && palette[slot]) {
          o.c.k = hexToLottie(palette[slot]);
          stats.recoloured++;
          stats.byClass[o.cl] = (stats.byClass[o.cl] || 0) + 1;
        }
      }
      for (const k in o) walk(o[k]);
    }
  })(copy);
  stats.unmappedClasses = [...unmapped].sort();
  return { animation: copy, stats };
}
