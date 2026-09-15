// app/ui/components/battle/tugbar.js — R76: the tug-of-war bar, pinned at
// the top for the whole duel. Facing portraits + element icons at each end
// of a split bar showing stake shares; a fixed start tick; floor lines both
// sides, pulsing in the danger color when a projection crosses; duel math
// only (no prize appears here, ever).
import { el } from '../dom.js';
import { incumbentElementIconUrl, elementSvgMarkup, incumbentPortraitUrl, monogramPortraitMarkup } from './assets.js';

function elementIcon(elementKey, treatment) {
  if (treatment.id === 'incumbent') {
    return el('img', { class: 'cb-tugbar-icon', src: incumbentElementIconUrl(elementKey), alt: '', width: 18, height: 18 });
  }
  return el('span', { class: 'cb-tugbar-icon cb-svg-icon', html: elementSvgMarkup(elementKey, 18) });
}

// A16/R76: the facing portrait for one side of the bar. Incumbent uses the
// bundle's full-body element portrait art; the two alternates (no bundled
// character art -- R12) get a clean treatment-colored monogram portrait
// instead of a bare icon (see assets.js:monogramPortraitMarkup).
function combatantPortrait(name, element, treatment) {
  if (treatment.id === 'incumbent') {
    return el('img', { class: 'cb-tugbar-portrait', src: incumbentPortraitUrl(element), alt: '', width: 32, height: 32 });
  }
  const accent = (treatment.colors && (treatment.colors.narratorAccent || treatment.colors.fire)) || '#3ABCBC';
  return el('span', { class: 'cb-tugbar-portrait cb-svg-portrait', html: monogramPortraitMarkup(name, accent, 32) });
}

/**
 * @param {object} args
 * @param {object} args.treatment active treatment
 * @param {object} args.p1 { name, element, isNpc }  args.p2 { name, element, isNpc }
 * @param {number} args.p1SharePct 0-100  args.p2SharePct 0-100
 * @param {number} args.startPct the fixed start tick position (pre-duel share, 0-100)
 * @param {number} args.floor the tier floor (Cheddar/SCRAP/PURSE units)
 * @param {number} args.p1Stake args.p2Stake current projected stakes (for floor-line placement)
 */
export function renderTugBar({ treatment, p1, p2, p1SharePct, p2SharePct, startPct, floor, p1Stake, p2Stake }) {
  const total = Math.max(1, p1Stake + p2Stake);
  const floorPct1 = Math.min(100, (floor / total) * 100);
  const floorPct2 = Math.min(100, (floor / total) * 100);
  const dangerP1 = p1Stake < floor;
  const dangerP2 = p2Stake < floor;

  return el('div', { class: 'cb-tugbar' }, [
    el('div', { class: 'cb-tugbar-side' }, [
      combatantPortrait(p1.name, p1.element, treatment),
      elementIcon(p1.element, treatment),
      el('span', { class: 'cb-tugbar-name cb-data' }, [
        p1.name,
        // C6/§15.8/R80: the permanent, visible NPC tag on the tug bar too.
        p1.isNpc ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
      ]),
    ]),
    el('div', { class: 'cb-tugbar-track' }, [
      el('div', { class: 'cb-tugbar-fill p1', style: `width:${p1SharePct}%;` }),
      el('div', { class: 'cb-tugbar-fill p2', style: `width:${p2SharePct}%;` }),
      el('div', { class: 'cb-tugbar-tick', style: `left:${startPct}%;` }),
      el('div', { class: `cb-tugbar-floor p1${dangerP1 ? ' danger' : ''}`, style: `left:${floorPct1}%;` }),
      el('div', { class: `cb-tugbar-floor p2${dangerP2 ? ' danger' : ''}`, style: `right:${floorPct2}%;` }),
    ]),
    el('div', { class: 'cb-tugbar-side right' }, [
      el('span', { class: 'cb-tugbar-name cb-data' }, [
        p2.isNpc ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
        p2.name,
      ]),
      elementIcon(p2.element, treatment),
      combatantPortrait(p2.name, p2.element, treatment),
    ]),
  ]);
}
