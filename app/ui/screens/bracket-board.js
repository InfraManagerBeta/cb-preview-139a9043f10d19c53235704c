// app/ui/screens/bracket-board.js — R56/R81: the live bracket board, wins-
// to-the-top countdown, NPC tags on every seat that has one.
import { mountScreen, el, cheddar } from '../components/dom.js';
import * as bracketEngine from '../../engine/bracket.js';
import { computeWinsToTop } from '../../engine/economy.js';
import { truthBadge, renderKillStopBanner } from '../components/chrome.js';
import { renderReserveOffer } from '../components/reserveOffer.js';
import { soundToggleButton, releaseAudioForRoute } from '../components/battle/sound.js';

// Round-4 fix g4 (CB-BUILD-016/AC0, final-gate tester CRUCIAL): duel.js's own
// comment states the principle -- "C16/AC0: the kill switch must stop an
// in-flight duel -- not just gate navigation between screens" -- and its
// tick()/showIntermission() poll ctx.game.isKilled() every 500ms for it. The
// g2 router-level release catches every route TRANSITION, but a player
// already mounted and STATIONARY here, with the bed carried in, kept hearing
// it indefinitely on a kill: nothing on this screen read the kill state, and
// the player's next navigation may never come (AC0's "within a minute" is a
// bound; an unbounded wait for a click is not). Same pattern as duel.js: the
// same ctx.game.isKilled() source, the same 500ms cadence, and the same
// teardown discipline (cleared on unmount, cleared before the banner mounts,
// never left running). Module-level handle: renderReserveOffer's refresh
// callback re-calls mountBracketBoard IN PLACE (no navigation, so no
// onUnmount runs) -- the re-mount must clear the previous poll, never stack.
const KILL_POLL_MS = 500; // duel.js's own tick()/showIntermission() cadence
let killPollTimer = null;

export function mountBracketBoard(ctx) {
  const { treatment, tunables } = ctx;
  const session = ctx.refreshSession();
  const { bracket, humanSeatIndex, activeCharacterId } = session;

  // g4: an in-place re-mount (renderReserveOffer's refresh below) arrives
  // without any unmount -- clear the previous poll before starting anew.
  clearInterval(killPollTimer);
  killPollTimer = null;

  // Fix round f5/R78a [LAW]: the §18 bed carries onto this board (it plays
  // through the bracket as the 2019 client played it) -- so this screen is
  // part of the bracket audio context: leaving it for a NON-bracket route
  // stops the bed; moving on to the duel/sitting carries it.
  // Round-3 fix g2 (reviewer CRUCIAL): registered BEFORE the no-bracket
  // guard clause below -- that guard navigates to lobby-entry, and when the
  // registration came after it, the redirect left NO teardown to run, so a
  // bed carried in from a stale route kept sounding on lobby-entry.
  // g4: the kill poll rides in the SAME registration (router.onUnmount
  // REPLACES the registered callback, so two separate calls would drop one).
  if (ctx.router && typeof ctx.router.onUnmount === 'function') {
    ctx.router.onUnmount(() => {
      clearInterval(killPollTimer);
      killPollTimer = null;
      releaseAudioForRoute(ctx.router.current());
    });
  }

  if (!bracket) { ctx.router.navigate('lobby-entry'); return; }

  // g4 (CB-BUILD-016/AC0): detect the kill WHILE MOUNTED -- no navigation
  // required. renderKillStopBanner (chrome.js, the one shared stop-banner
  // source) stopAll()s before it renders, so one call both silences every
  // sample and lands the banner; it never touches soundEnabled, so a mute
  // set before the kill survives it. The poll clears itself before rendering
  // -- it must never keep firing under the banner.
  killPollTimer = setInterval(() => {
    if (!ctx.game.isKilled()) return;
    clearInterval(killPollTimer);
    killPollTimer = null;
    renderKillStopBanner(ctx);
  }, KILL_POLL_MS);
  // Never hold a Node process open (same discipline as sound.js's timers).
  if (killPollTimer && typeof killPollTimer.unref === 'function') killPollTimer.unref();

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
