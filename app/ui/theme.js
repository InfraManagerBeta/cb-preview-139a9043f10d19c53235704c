// app/ui/theme.js — R79/R12: apply the active treatment's theme-bound
// design-frame VALUES (the semantic color roles + hero face + working
// title + stake-unit abbreviation) over the fixed frame in styles/base.css.
// R11 fixes the ROLES (primary/ground/win/loss/water/fire/air/surfaces/
// Narrator-accent, plus the Bebas Neue/DM Mono/Barlow type roles); R12
// supplies every VALUE per treatment. This is the concrete mechanism behind
// "O1 switches the whole skin" (R14) -- calling this again with a different
// treatment visibly re-skins the running app without a reload.
import { setCheddarUnit } from './components/dom.js';

const CSS_VAR_MAP = {
  primary: '--cb-yellow',
  ground: '--cb-black',
  win: '--cb-green',
  loss: '--cb-red',
  surfaces: '--cb-offwhite',
  narratorAccent: '--cb-teal',
  water: '--cb-water',
  fire: '--cb-fire',
  air: '--cb-air',
};

let _fontLinkEl = null;

export function applyTreatmentTheme(treatment) {
  if (typeof document === 'undefined') return; // no-op outside the browser (tests)
  const root = document.documentElement;
  for (const [colorKey, cssVar] of Object.entries(CSS_VAR_MAP)) {
    const value = treatment.colors?.[colorKey];
    if (value) root.style.setProperty(cssVar, value);
  }
  if (treatment.fonts?.heroFace) {
    root.style.setProperty('--font-hero', `'${treatment.fonts.heroFace}', serif`);
  }

  // Swap the Google Fonts <link> so the theme-bound hero face is available
  // (display/data/prose are fixed and already loaded by the shipped link;
  // this just adds/replaces the hero-face family without dropping them,
  // since each treatment's googleFontsUrl requests all four families).
  if (treatment.fonts?.googleFontsUrl) {
    if (!_fontLinkEl) {
      _fontLinkEl = document.querySelector('link[data-cb-fonts]');
    }
    if (!_fontLinkEl) {
      _fontLinkEl = document.createElement('link');
      _fontLinkEl.rel = 'stylesheet';
      _fontLinkEl.setAttribute('data-cb-fonts', '1');
      document.head.appendChild(_fontLinkEl);
    }
    if (_fontLinkEl.href !== treatment.fonts.googleFontsUrl) {
      _fontLinkEl.href = treatment.fonts.googleFontsUrl;
    }
  }

  if (treatment.workingTitle) document.title = treatment.workingTitle;
  if (treatment.nouns?.stakeUnitAbbrev) setCheddarUnit(treatment.nouns.stakeUnitAbbrev);
}
