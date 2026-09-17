// app/ui/screens/bracket-board.js — R56/R81: the live bracket board, wins-
// to-the-top countdown, NPC tags on every seat that has one.
import { mountScreen, el, cheddar } from '../components/dom.js';
import * as bracketEngine from '../../engine/bracket.js';
import { computeWinsToTop } from '../../engine/economy.js';
import { truthBadge } from '../components/chrome.js';
import { renderReserveOffer } from '../components/reserveOffer.js';
import { soundToggleButton, releaseAudioForRoute } from '../components/battle/sound.js';

export function mountBracketBoard(ctx) {
  const { treatment, tunables } = ctx;
  const session = ctx.refreshSession();
  const { bracket, humanSeatIndex, activeCharacterId } = session;
  if (!bracket) { ctx.router.navigate('lobby-entry'); return; }

  // Fix round f5/R78a [LAW]: the §18 bed carries onto this board (it plays
  // through the bracket as the 2019 client played it) -- so this screen is
  // part of the bracket audio context: leaving it for a NON-bracket route
  // stops the bed; moving on to the duel/sitting carries it.
  if (ctx.router && typeof ctx.router.onUnmount === 'function') {
    ctx.router.onUnmount(() => releaseAudioForRoute(ctx.router.current()));
  }

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
    // Fix round f5/R78a: a mute control visible wherever sound plays -- the
    // bed now reaches this board.
    el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark), soundToggleButton()]),
    el('h2', {}, treatment.copy.bracketBoardHeading),
    truthBadge(ctx),
    character ? el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-micro' }, `${character.name} · TIER ${character.tier} · ${cheddar(character.stakeCheddar)}`),
      winsToTop != null ? el('div', { class: 'cb-data', style: 'margin-top:6px;color:var(--cb-yellow);' }, `${winsToTop} wins to the top`) : null,
    ]) : null,
    // N-C5/R49a [LAW] re-probe fix: this is the ONE surface every
    // bracket-completing path actually reaches (duel.js's result screen
    // routes both the ordinary WINNER -- state ACTIVE, "View Bracket" ->
    // here -- and the topped-out champion -- state SITTING, same button --
    // to `bracket-board`; a reload/remount with no pending match and an
    // ACTIVE character redirects here too, `duel.js`'s own mount-time
    // check). Placed right after the character's own post-completion
    // summary card, before the bracket tree, so it reads as this run's
    // own concluding step -- not a second screen bolted onto the door.
    // sitting.js keeps rendering the SAME offer (shared component,
    // `reserveOffer.js`) for the ELIMINATED path, which never transits
    // this screen at all, and as a fallback for a topped-out champion who
    // continues on to `sitting` without pressing it here.
    renderReserveOffer(ctx, () => mountBracketBoard(ctx)),
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
