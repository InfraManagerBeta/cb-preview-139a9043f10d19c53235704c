// app/ui/components/reserveOffer.js — R49a [LAW]: "Reserve is offered in the
// played funnel's reserve step"; R51 gates on reservation rate per
// FIRST-BRACKET COMPLETER.
//
// N-C5 re-probe fix: this card originally lived ONLY on sitting.js
// (C5/F1), reached by the ELIMINATED path (CHARACTER_ELIMINATED -> SITTING)
// and the topped-out-champion path (CHARACTER_ADVANCED toppedOut ->
// SITTING). But `duel.js`'s result screen routes a bracket WINNER --
// the FIRST-BRACKET COMPLETER metric's most engaged population -- to
// `bracket-board` (state stays ACTIVE; see projection.js's
// CHARACTER_ADVANCED handler), a screen that never rendered this offer at
// all. That path never met the reserve step, so R51's own gate metric
// under-counted its primary population.
//
// Extracted here (from sitting.js) so `bracket-board.js` can render the
// IDENTICAL offer -- same copy, same anchor gate, same idempotent
// pressReserve call -- rather than a second, drifting implementation.
// `bracket-board.js` is the one surface EVERY bracket-completing path
// actually reaches on its way onward (see bracket-board.js's own header
// comment for the routing proof): the ordinary winner (ACTIVE, "Continue"/
// mount-redirect) and the topped-out champion (SITTING, "Manage
// <character>") both pass through it after `duel.js`'s result screen
// (bracketComplete/`!match`-redirect); sitting.js keeps rendering it too
// for the ELIMINATED path (which never transits bracket-board) and as a
// second chance for anyone who declined it on the board. Same
// "keep offering until pressed or already reserved" shape as before --
// showing it on an additional post-anchor surface is not a repeat-ask
// violation of "already-reserved -> not re-asked" (that rule is about
// STOPPING after a real reservation, not about a single surface).
import { el } from './dom.js';
import { computeAnchor } from '../../engine/retention.js';

/**
 * @param {object} ctx the app context.
 * @param {() => void} rerender called after a successful press so the
 *   caller's OWN screen re-renders in place (the offer card then
 *   disappears, since `account.reservation` is now set) -- each screen
 *   supplies its own remount function (e.g. `() => mountSitting(ctx)` /
 *   `() => mountBracketBoard(ctx)`) rather than this shared module
 *   importing every possible caller.
 */
export function renderReserveOffer(ctx, rerender) {
  const account = ctx.game.snapshot().account;
  if (account.reservation) return null; // already reserved -- no repeat ask
  const anchorTs = computeAnchor(ctx.game.ledger.all(), ctx.game.playerId);
  if (anchorTs == null) return null; // R43: no concluded bracket yet (pre-anchor)
  const character = ctx.game.snapshot().characters[ctx.refreshSession().activeCharacterId];
  return el('div', { class: 'cb-card', style: 'border-color:var(--cb-yellow);' }, [
    el('div', { class: 'cb-display', style: 'font-size:18px;' }, ctx.treatment.copy.reserveHeading),
    el('p', { class: 'cb-legal' }, ctx.treatment.copy.reserveBody),
    el('button', {
      class: 'cb-btn block',
      onClick: () => {
        ctx.game.pressReserve({ tier: character ? character.tier : 0, characterState: character ? character.state : null });
        ctx.toast('Reserved.');
        rerender();
      },
    }, ctx.treatment.copy.reserveButton),
  ]);
}
