// app/ui/components/battle/assets.js — R74/R78: the incumbent's battle
// visuals come from the bundle's arena/FX sources and the parametric rig
// (rig.js/shapes.js/player.js — CB-BUILD-005/006); the bundle's nine
// canonical GIFs are PARITY REFERENCE ONLY and are never loaded at runtime.
// The two alternate treatments have no bundled character art (R12: art
// sources are theme-bound), so they render a clean treatment-colored stage
// with inline, currentColor-tinted SVG element glyphs instead (a
// placeholder-art alternate, acceptable for this artifact per the brief, so
// long as the timeline/states/copy stay treatment-correct). All paths are
// relative to the HTML document (app/index.html or app/console.html), never
// absolute "/" (GitHub Pages subpath safety).

const BUNDLE_BASE = '../assets/cw-asset-bundle/';
const ICON_BASE = '../assets/cw-asset-bundle/ui-icons/affinity/colour/';
const PORTRAIT_BASE = '../assets/cw-asset-bundle/client-static/img/wizards/';

// ---- CB-BUILD-005: the arena composite sources ------------------------------

/** The treatment's arena art (R74: composited on the treatment's arena,
 * never a bare or white field). The incumbent's is the bundle's fight-scene
 * background; an alternate (no bundled art, R12/CB-BUILD-007) returns null
 * and the stage renders its provisional treatment-colored field instead —
 * dark treatment chrome, still never bare/white. */
export function arenaSources(treatment) {
  if (treatment.id === 'incumbent') {
    return {
      background: `${BUNDLE_BASE}client-static/img/fightScene/fightBG.svg`,
      gridPattern: `${BUNDLE_BASE}client-static/img/general/gridPattern.svg`,
      loader: `${BUNDLE_BASE}client-static/img/fightScene/loader.gif`,
    };
  }
  return { background: null, gridPattern: null, loader: null, provisional: true };
}

// ---- CB-BUILD-005: the element/affinity FX pass sources ----------------------
// R74: "Element and affinity effects render to the fidelity of the bundle's
// FX sources, not a flat color fill." The pass is layered from three real
// sources: the per-element backdrop art (client-static/img/duel/), the
// element flag animation (lottie/), and the per-element/per-tier affinity
// cape overlay from the shape library (see rig.js#affinityCapeObjectName).

const ELEMENT_TO_BUNDLE_KEY = { fire: 'fire', water: 'water', air: 'wind' }; // the bundle files say "wind"; all COPY says Air (R74)

export function elementBackdropUrl(elementKey, won = true) {
  const key = ELEMENT_TO_BUNDLE_KEY[elementKey] || 'neutral';
  return `${BUNDLE_BASE}client-static/img/duel/wizard-bg-${key}-${won ? 'win' : 'lose'}.svg`;
}

export function elementFlagUrl(elementKey) {
  const key = ELEMENT_TO_BUNDLE_KEY[elementKey];
  return `${BUNDLE_BASE}lottie/${key ? `${key}Flag` : 'neutralFlag'}.json`;
}

const ELEMENT_TO_ICON_FILE = { fire: 'fire.png', water: 'water.png', air: 'wind.png' };

/** The incumbent's bundled element icon (fire/water/wind.png -- "wind" is
 * the bundle's file-naming for the Air element, R74). */
export function incumbentElementIconUrl(elementKey) {
  return ICON_BASE + (ELEMENT_TO_ICON_FILE[elementKey] || ELEMENT_TO_ICON_FILE.fire);
}

// A16/R76: the incumbent's bundled full-body element portraits (the bundle's
// client-static/img/wizards/{fire,water,wind}.svg), used as the tug-bar
// portrait for the incumbent treatment -- "wind" is again the bundle's
// file-naming for Air (R74's existing convention, reused here rather than
// inventing a second naming scheme for the same three elements).
const ELEMENT_TO_PORTRAIT_FILE = { fire: 'fire.svg', water: 'water.svg', air: 'wind.svg' };

export function incumbentPortraitUrl(elementKey) {
  return PORTRAIT_BASE + (ELEMENT_TO_PORTRAIT_FILE[elementKey] || 'neutral.svg');
}

// A16: the two alternate treatments have no bundled character art at all
// (R12: art sources are theme-bound); a bare element glyph (elementSvgMarkup
// above) reads as an icon, not a portrait, so the tug bar instead gets a
// clean treatment-colored MONOGRAM portrait -- a rounded-square card with
// the character's initial, tinted in the treatment's own accent color. This
// is a placeholder the treatment's own art would replace, but it is
// visually portrait-shaped (a framed face card), not a bare icon.
export function monogramPortraitMarkup(name, colorHex, size = 40) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const bg = colorHex || '#3ABCBC';
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="38" height="38" rx="8" fill="${bg}" fill-opacity="0.22" stroke="${bg}" stroke-width="2"/>
    <circle cx="20" cy="15" r="6" fill="${bg}"/>
    <path d="M8 33c0-7 5.4-11 12-11s12 4 12 11" fill="${bg}"/>
    <text x="20" y="19" text-anchor="middle" font-size="8" font-family="monospace" fill="#fff" opacity="0.001">${initial}</text>
  </svg>`;
}

// Generic, currentColor-tinted inline glyphs for the two alternate
// treatments (no bundled iconography exists for them). Simple enough to
// read at rail-icon size, distinct enough not to be mistaken for each
// other.
const ELEMENT_SVG_PATHS = {
  fire: '<path d="M12 2c1 3-2 4-2 7a3 3 0 0 0 6 0c0-1-.5-2-1-2.5.7 2 .3 3.5-1 4.5a4 4 0 1 1-5-6C10 4 11 3 12 2z"/>',
  water: '<path d="M12 2c3 4.5 6 8.2 6 11.5A6 6 0 1 1 6 13.5C6 10.2 9 6.5 12 2z"/>',
  air: '<path d="M3 8h11a2.5 2.5 0 1 0-2.2-3.6M3 12h15a2.5 2.5 0 1 1-2.2 3.6M3 16h9a2 2 0 1 1-1.8 2.8" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
};

/** An inline SVG markup string for an element glyph, tinted with the
 * current text color (set colored borders/text around it via CSS). */
export function elementSvgMarkup(elementKey, size = 20) {
  const path = ELEMENT_SVG_PATHS[elementKey] || ELEMENT_SVG_PATHS.fire;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">${path}</svg>`;
}

export function soundUrl(name) {
  return `../assets/cw-asset-bundle/sound/${name}`;
}
