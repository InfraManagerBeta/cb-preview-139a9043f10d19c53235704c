// app/ui/screens/bracket-board.js — R56/R81: the live bracket board, wins-
// to-the-top countdown, NPC tags on every seat that has one.
import { mountScreen, el, cheddar } from '../components/dom.js';
import * as bracketEngine from '../../engine/bracket.js';
import { computeWinsToTop } from '../../engine/economy.js';
import { truthBadge } from '../components/chrome.js';

export function mountBracketBoard(ctx) {
  const { treatment, tunables } = ctx;
  const session = ctx.refreshSession();
  const { bracket, humanSeatIndex, activeCharacterId } = session;
  if (!bracket) { ctx.router.navigate('lobby-entry'); return; }

  const character = ctx.game.snapshot().characters[activeCharacterId];

  function seatLabel(seatIndex) {
    if (seatIndex == null) return '—';
    const seat = bracket.seats[seatIndex];
    return seat ? seat.name : '—';
  }

  const roundBlocks = bracket.rounds.map((round, ri) => el('div', {}, [
    el('div', { class: 'cb-bracket-round-label' }, bracketEngine.bracketRoundName(ri).toUpperCase()),
    ...round.map((m) => {
      const decided = m.winnerSeat !== null;
      return el('div', { class: 'cb-bracket-match' }, [
        el('span', { class: `seat ${decided ? (m.winnerSeat === m.seatA ? 'winner' : 'loser') : ''}` }, [
          seatLabel(m.seatA),
          m.seatA != null && bracket.seats[m.seatA] && bracket.seats[m.seatA].kind === 'npc' ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
        ]),
        el('span', { class: 'cb-micro' }, 'vs'),
        el('span', { class: `seat ${decided ? (m.winnerSeat === m.seatB ? 'winner' : 'loser') : ''}` }, [
          seatLabel(m.seatB),
          m.seatB != null && bracket.seats[m.seatB] && bracket.seats[m.seatB].kind === 'npc' ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
        ]),
      ]);
    }),
  ]));

  const winsToTop = character ? computeWinsToTop(tunables, character.tier) : null;

  mountScreen([
    el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
    el('h2', {}, treatment.copy.bracketBoardHeading),
    truthBadge(ctx),
    character ? el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-micro' }, `${character.name} · TIER ${character.tier} · ${cheddar(character.stakeCheddar)}`),
      winsToTop != null ? el('div', { class: 'cb-data', style: 'margin-top:6px;color:var(--cb-yellow);' }, `${winsToTop} wins to the top`) : null,
    ]) : null,
    el('div', { class: 'cb-bracket-tree' }, roundBlocks),
    el('button', {
      class: 'cb-btn block',
      onClick: () => {
        if (!character) { ctx.router.navigate('lobby-entry'); return; }
        if (character.state === 'ACTIVE') { ctx.router.navigate('duel'); return; }
        if (character.state === 'SITTING') { ctx.router.navigate('sitting'); return; }
        ctx.router.navigate('wallet');
      },
    }, character && character.state === 'ACTIVE' ? 'Continue' : character && character.state === 'SITTING' ? `Manage ${treatment.nouns.character}` : 'Wallet'),
  ]);
}
