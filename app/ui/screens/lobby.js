// app/ui/screens/lobby.js — §11/R80: humans seat first, NPCs fill with
// natural join delays, then a 30s countdown to the board.
//
// DEMO_SPEED_MULTIPLIER accelerates only the wall-clock playback of this
// screen so the build is playable in a session; the tunable values it reads
// (lobbyHumanWaitSec, npcJoinDelayRangeSec, boardCountdownSec) are the real
// R80/tunables.json numbers, unmodified — see app/README.md.
import { mountScreen, el } from '../components/dom.js';
import * as sync from '../../engine/sync.js';

const DEMO_SPEED_MULTIPLIER = 12;

export function mountLobby(ctx) {
  const { treatment } = ctx;
  let session = ctx.refreshSession();
  let lobby = session.lobby;
  if (!lobby) { ctx.router.navigate('lobby-entry'); return; }

  const realStart = Date.now();
  const virtualNow = () => lobby.createdAt + (Date.now() - realStart) * DEMO_SPEED_MULTIPLIER;

  let timer = null;

  function seatRow(seat, i) {
    if (!seat) {
      const waitingForHuman = lobby.reservedForHumanSeats && lobby.reservedForHumanSeats.includes(i);
      return el('div', { class: 'cb-round-row' }, [
        el('span', {}, `Seat ${i + 1}`),
        // N-C6/R11 [LAW] re-probe fix: the O7 line is a full sentence a
        // player reads ("…waiting for a 2nd human (O7)…"); the C6 sweep
        // only ever inspected `cb-micro` literal-string children, missing
        // this ternary's true branch entirely. Moved to the prose face
        // (the plain "…waiting…" false branch renders on the SAME element/
        // class either way, so both branches move together).
        el('span', { class: 'cb-prose' }, waitingForHuman ? '…waiting for a 2nd human (O7)…' : '…waiting…'),
      ]);
    }
    return el('div', { class: 'cb-round-row' }, [
      el('span', { class: 'cb-tag-row' }, [
        seat.name,
        seat.kind === 'npc' ? el('span', { class: 'cb-npc-tag' }, treatment.copy.npcTagLabel) : null,
      ]),
      el('span', { class: 'cb-micro' }, treatment.elements[seat.element] ? treatment.elements[seat.element].label : ''),
    ]);
  }

  function render() {
    mountScreen([
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
      el('h2', {}, treatment.copy.lobbyWaiting),
      el('div', { class: 'cb-round-list' }, lobby.seats.map(seatRow)),
      // N-C6/R11 [LAW] re-probe fix: both ternary branches here are full
      // sentences ("All seated. Locking the bracket…" / "Seating humans
      // first, NPCs fill the rest — every NPC seat is tagged.") -- moved
      // off the data face (was `cb-micro`) onto the prose face.
      el('p', { class: 'cb-prose' }, lobby.phase === 'COUNTDOWN' ? 'All seated. Locking the bracket…' : 'Seating humans first, NPCs fill the rest — every NPC seat is tagged.'),
    ]);
  }

  function tick() {
    if (ctx.game.isKilled()) {
      // C16/AC0: freeze -- no new bracket is created/locked after a kill.
      // No characters have been staked into a bracket yet at this phase
      // (NPCs mint at LOCK time), so there's nothing to void; just stop.
      clearInterval(timer);
      ctx.router.navigate('landing');
      return;
    }
    const now = virtualNow();
    const before = lobby.seats.map((s) => !!s);
    // C14/O7: pass the active treatment + tunables through so the
    // wait-deadline fallback (any seat reserved for a 2nd human that never
    // showed) can mint an NPC for it, same as every other seat.
    sync.advanceLobby(lobby, now, { treatment: ctx.treatment, tunables: ctx.tunables });
    // C18: SYNC_NPC_SEATED -- a lobby seat being filled by an NPC during the
    // countdown (distinct from the ledger's NPC_SEATED, minted once the
    // bracket locks).
    for (let i = 0; i < lobby.seats.length; i++) {
      if (!before[i] && lobby.seats[i]) {
        ctx.game.recordNpcSeatedInLobby({ lobbyCreatedAt: lobby.createdAt, tier: lobby.tier, seatIndex: i, name: lobby.seats[i].name, element: lobby.seats[i].element }, now);
      }
    }
    ctx.patchSession({ lobby });
    render();
    if (sync.isReadyForBoard(lobby, now)) {
      clearInterval(timer);
      const { bracketId, bracket } = ctx.game.lockBracketFromLobby(lobby, now);
      const humanSeatIndex = lobby.seats.findIndex((s) => s.kind === 'human');
      ctx.patchSession({ bracketId, bracket, humanSeatIndex, lobby });
      ctx.router.navigate('duel');
    }
  }

  render();
  timer = setInterval(tick, 300);
  // A4: unmounting the lobby screen (navigating away, back/forward, or a
  // reload) must stop this 300ms tick -- same class of bug f4/A-i already
  // fixed for duel.js's timers. Without this, `tick()` kept firing in the
  // background after leaving the screen and would still append
  // SYNC_NPC_SEATED ledger events AND force-navigate to 'duel' (or
  // 'landing' on a kill) out from under whatever screen the player had
  // actually navigated to.
  ctx.router.onUnmount(() => clearInterval(timer));
  tick();
}
