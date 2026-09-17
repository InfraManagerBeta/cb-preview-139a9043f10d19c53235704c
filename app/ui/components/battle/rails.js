// app/ui/components/battle/rails.js — R77: spell rails flanking the stage
// (per character, one element square per resolved round, win/lose/draw
// colors, affinity marks) and round cards stacking newest-on-top with
// WIN/LOSS/DRAW + BIG/CRITICAL badges. Result card: CLAIMED/DRAINED header,
// before/after/delta, score string with draws, verbatim tie line.
import { el, cheddar } from '../dom.js';
import { incumbentElementIconUrl, elementSvgMarkup } from './assets.js';

function squareIcon(elementKey, treatment) {
  if (treatment.id === 'incumbent') {
    return el('img', { src: incumbentElementIconUrl(elementKey), alt: '', width: 14, height: 14 });
  }
  return el('span', { html: elementSvgMarkup(elementKey, 14) });
}

/** One rail (one character's column of resolved-round squares), shown up to
 * `throughRound` (rails only show rounds already revealed on the timeline). */
export function renderRail({ treatment, rounds, throughRound, perspective }) {
  const shown = rounds.filter((r) => r.round <= throughRound);
  return el('div', { class: 'cb-spell-rail' }, shown.map((r) => {
    const result = perspective === 'p1' ? r.result : (r.result === 'WIN' ? 'LOSS' : r.result === 'LOSS' ? 'WIN' : 'DRAW');
    const cls = result === 'WIN' ? 'win' : result === 'LOSS' ? 'loss' : 'draw';
    const move = perspective === 'p1' ? r.move1 : r.move2;
    const hasAffinity = perspective === 'p1' ? r.p1Affinity : r.p2Affinity;
    return el('div', { class: `cb-rail-square ${cls}${hasAffinity ? ' affinity' : ''}` }, [squareIcon(move, treatment)]);
  }));
}

/** Round cards, newest on top, with WIN/LOSS/DRAW + BIG/CRITICAL badges. */
export function renderRoundCards({ rounds, throughRound, treatment }) {
  const shown = rounds.filter((r) => r.round <= throughRound).slice().reverse();
  return el('div', { class: 'cb-round-cards' }, shown.map((r) => {
    const cls = r.result === 'WIN' ? 'win' : r.result === 'LOSS' ? 'loss' : 'draw';
    const badgeLabel = r.result;
    const tagLabel = r.tag === 'CRITICAL' ? `CRITICAL ${r.result}` : r.tag === 'BIG' ? `BIG ${r.result}` : null;
    return el('div', { class: `cb-round-card ${cls}` }, [
      el('span', { class: 'cb-micro' }, `ROUND ${r.round}`),
      el('span', {}, [
        el('span', { class: `cb-badge ${cls}` }, badgeLabel),
        tagLabel ? el('span', { class: 'cb-badge big' }, tagLabel) : null,
      ]),
    ]);
  }));
}

/** The result card: CLAIMED/DRAINED header, BOTH combatants' before/after/
 * delta (C8/R77 -- `lastOutcome.combatants` carries both sides' data, and
 * the card now shows both, not just the human's own), score string with
 * draws, verbatim tie line (from the active treatment's copy). */
export function renderResultCard({ treatment, humanWon, outcome, p1Name, p2Name, stakeBefore, stakeAfter, opponentStakeBefore, opponentStakeAfter, floorDrain }) {
  const headerClass = humanWon ? 'claimed' : 'drained';
  const header = humanWon ? treatment.copy.resultClaimedHeader : treatment.copy.resultDrainedHeader;
  const scoreString = `${outcome.won}-${outcome.lost}${outcome.draws ? ` (${outcome.draws} draw${outcome.draws === 1 ? '' : 's'})` : ''}`;
  const delta = stakeAfter - stakeBefore;
  const opponentDelta = (opponentStakeAfter != null && opponentStakeBefore != null) ? opponentStakeAfter - opponentStakeBefore : null;

  function combatantRow(name, before, after, isHuman) {
    if (before == null || after == null) return null;
    const d = after - before;
    return el('p', { class: 'cb-result-line' }, [
      el('span', {}, `${name}${isHuman ? ' (you)' : ''}: `),
      `${cheddar(before)} \u2192 ${cheddar(after)} `,
      el('span', { style: d >= 0 ? 'color:var(--cb-green);' : 'color:var(--cb-red);' }, `${d >= 0 ? '+' : ''}${cheddar(d)}`),
    ]);
  }

  return el('div', { class: `cb-card cb-result-card ${headerClass}${floorDrain ? ' floor-drain' : ''}` }, [
    el('div', { class: 'cb-result-header' }, header),
    outcome.trueTie
      // N-C6/R11 [LAW] re-probe fix: `copy.tieLine` is a full, verbatim
      // sentence ("All square — coin flip. You advance. No cheddar
      // transferred.") from the active treatment's own data, not a
      // figure/tag -- the C6 sweep only ever inspected literal JS string
      // children, so a data-driven (treatment.copy.*) sentence like this
      // one was invisible to it entirely. `cb-prose` rides alongside
      // `cb-result-line` (a compound-selector CSS override, base.css) so
      // this ONE row moves to the prose face while the card's other two
      // `cb-result-line` rows (the combatant before/after figures, the
      // "Score: W-L" line -- genuine data, not sentences) stay put.
      ? el('p', { class: 'cb-result-line cb-prose' }, treatment.copy.tieLine.replace('{ADVANCE_OR_ELIMINATED}', humanWon ? treatment.copy.tieLineAdvance : treatment.copy.tieLineEliminated))
      : null,
    el('p', { class: 'cb-result-line' }, `Score: ${scoreString}`),
    combatantRow(p1Name || 'You', stakeBefore, stakeAfter, true),
    combatantRow(p2Name || 'Opponent', opponentStakeBefore, opponentStakeAfter, false),
    el('p', { class: 'cb-result-delta', style: humanWon ? 'color:var(--cb-green);' : 'color:var(--cb-red);' }, `${delta >= 0 ? '+' : ''}${cheddar(delta)}`),
  ]);
}
