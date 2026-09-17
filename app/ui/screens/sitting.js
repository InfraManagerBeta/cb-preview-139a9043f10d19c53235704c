// app/ui/screens/sitting.js — R60/R61/R63/R68: the three SITTING choices.
import { mountScreen, el, money, cheddar } from '../components/dom.js';
import * as economy from '../../engine/economy.js';
import { bottomNav, truthBadge, cashPill } from '../components/chrome.js';
import { loadOverrides, effectiveHypothesisId } from '../../engine/overrides.js';
import { hypothesisCard } from '../../engine/hypotheses.js';
import { openLoadFundsSheet } from '../components/money-sheets.js';
import { renderReserveOffer } from '../components/reserveOffer.js';
import { soundToggleButton, releaseAudioForRoute } from '../components/battle/sound.js';
import { renderKillStopBanner } from '../components/chrome.js';

// Round-4 fix g4 (CB-BUILD-016/AC0, final-gate tester CRUCIAL): the same
// stationary kill poll bracket-board.js carries -- duel.js's "C16/AC0: the
// kill switch must stop an in-flight duel -- not just gate navigation between
// screens" principle, applied to the last bracket-context screen that lacked
// it. A player parked here with the bed carried in kept hearing it
// indefinitely on a kill; now the screen itself detects the kill within one
// poll interval, silences everything, and lands the stop banner -- no
// navigation required. Module-level handle: renderReserveOffer's refresh and
// this file's own re-mount callbacks re-call mountSitting IN PLACE (no
// unmount runs) -- the re-mount clears the previous poll, never stacks.
const KILL_POLL_MS = 500; // duel.js's own tick()/showIntermission() cadence
let killPollTimer = null;

/** A19: the cash-out toast amount -- `cashUSD` (computed once, before the
 * cash-out call, from the character's pre-cash-out stake) is always the
 * right figure to show; a character is ALWAYS zeroed by cashOutCharacter,
 * so branching on `stakeCheddar === 0` (the old dead ternary, `res.stakeCheddar
 * === 0 ? cashUSD : cashUSD`) could never do anything but return `cashUSD`
 * either way. Extracted to a pure function so it's testable without a DOM. */
export function cashOutToastMessage(cashUSD) {
  return `Cashed out ${money(cashUSD)}.`;
}

export function mountSitting(ctx) {
  const { treatment, tunables } = ctx;
  const session = ctx.refreshSession();
  const character = ctx.game.snapshot().characters[session.activeCharacterId];

  // g4: an in-place re-mount (renderReserveOffer's refresh / this file's own
  // remount callbacks) arrives without any unmount -- clear before restarting.
  clearInterval(killPollTimer);
  killPollTimer = null;

  // Fix round f5/R78a [LAW]: an eliminated player lands HERE from the loss
  // result card with the bed still sounding (the bed plays through the
  // bracket, including post-elimination spectating -- the "Watch the
  // bracket live" door below leads back to the board). So this screen is
  // part of the bracket audio context too: leaving it for a NON-bracket
  // route (wallet, lobby-entry, ...) stops the bed; the board carries it.
  // Round-3 fix g2 (reviewer CRUCIAL): registered BEFORE the no-character
  // guard clause below -- that guard navigates to lobby-entry, and when the
  // registration came after it, the redirect left NO teardown to run, so a
  // carried bed kept sounding on lobby-entry.
  // g4: the kill poll rides in the SAME registration (router.onUnmount
  // REPLACES the registered callback, so two separate calls would drop one).
  if (ctx.router && typeof ctx.router.onUnmount === 'function') {
    ctx.router.onUnmount(() => {
      clearInterval(killPollTimer);
      killPollTimer = null;
      releaseAudioForRoute(ctx.router.current());
    });
  }

  if (!character) { ctx.router.navigate('lobby-entry'); return; }

  // g4 (CB-BUILD-016/AC0): detect the kill WHILE MOUNTED, on both branches
  // below (the emptied card and the three-choice screen are equally
  // stationary). renderKillStopBanner stopAll()s before rendering and never
  // touches soundEnabled (a pre-kill mute survives); the poll clears itself
  // before rendering -- it must never keep firing under the banner.
  killPollTimer = setInterval(() => {
    if (!ctx.game.isKilled()) return;
    clearInterval(killPollTimer);
    killPollTimer = null;
    renderKillStopBanner(ctx);
  }, KILL_POLL_MS);
  // Never hold a Node process open (same discipline as sound.js's timers).
  if (killPollTimer && typeof killPollTimer.unref === 'function') killPollTimer.unref();

  if (economy.isEmptied(character)) {
    // f4/N2 fix: a topped-out (T6) champion also lands here -- its stake
    // was cashed out by the R62 payout, so it's an emptied character just
    // like any other, but the generic "Holds nothing" line reads wrong
    // for a character that just won everything and got paid; a
    // champion-specific, theme-voiced line covers that case (projection.js
    // sets `toppedOutChampion` on replay).
    //
    // A2: also requires `stakeCheddar === 0` directly (not just the flag)
    // -- belt-and-braces. Game#reenterCharacter now refuses re-entry for
    // any emptied character (R61: RETIRE is the only action), so a
    // toppedOut champion can never legally reach a later ordinary loss
    // with stake > 0 while still carrying a stale `toppedOutChampion` flag
    // (see projection.js's CHARACTER_REENTERED comment) -- but should a
    // future change ever make that reachable, this line still only fires
    // while the character genuinely holds nothing.
    const emptiedLine = character.toppedOutChampion && character.stakeCheddar === 0 && treatment.copy.emptiedChampionLine
      ? treatment.copy.emptiedChampionLine
      : treatment.copy.emptiedCardLine;
    mountScreen([
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark), soundToggleButton()]),
      el('div', { class: 'cb-card', style: 'text-align:center;' }, [
        el('div', { class: 'cb-display', style: 'font-size:22px;' }, character.name),
        el('p', { class: 'cb-emptied-line' }, emptiedLine),
        el('button', {
          class: 'cb-btn danger block',
          style: 'margin-top:12px;',
          onClick: () => { ctx.game.retireEmptyCharacter(character.id); ctx.toast('Retired to the ledger.'); ctx.router.navigate('lobby-entry'); },
        }, treatment.copy.emptiedCardAction),
      ]),
      renderReserveOffer(ctx, () => mountSitting(ctx)),
      bottomNav(ctx, null),
    ]);
    return;
  }

  const reentry = economy.reentryForTier(tunables, character.tier);
  const cashUSD = economy.cheddarToUsd(tunables, character.stakeCheddar);
  const account = ctx.game.snapshot().account;
  let reenterSubmitting = false;

  // CB-BUILD-012/R67: insufficient CASH at re-entry is a funds wall exactly
  // like summon's -- open Load Funds INLINE and retry this exact re-entry
  // on a completed deposit, instead of a toast (was: `game.js`'s
  // `reenterCharacter` throw at the insufficient-CASH check, surfaced here
  // as "Not enough CASH — load funds first.").
  //
  // C4/R67+R83 fix: states the shortfall in player language too (money-
  // sheets.js's `shortfall` option), computed from the SAME reentry.usd
  // figure the Re-enter button already displays -- never a raw error.
  function attemptReenter() {
    const freshAccount = ctx.game.snapshot().account;
    if (freshAccount.cashUSD < reentry.usd) {
      openLoadFundsSheet(ctx, { onDeposited: attemptReenter, shortfall: { actionLabel: 'Re-entering', costUSD: reentry.usd } });
      return;
    }
    if (reenterSubmitting) return; // C1/R83: control disables until resolution
    reenterSubmitting = true;
    // C1/R83: capture the sitting-epoch ONCE, before the press, and
    // reuse it on any retry -- see Game#peekSittingEpoch.
    const sittingEpoch = ctx.game.peekSittingEpoch(character.id);
    ctx.game.reenterCharacter(character.id, Date.now(), { sittingEpoch });
    ctx.toast('Re-entered.');
    ctx.router.navigate('lobby-entry');
  }

  mountScreen([
    // Fix round f5/R78a: the bed can still be sounding here (the loss path
    // arrives straight from the result card) -- the visible mute rides in
    // the topbar.
    el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark), cashPill(ctx), soundToggleButton()]),
    el('h2', {}, treatment.copy.sittingHeading),
    el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-display', style: 'font-size:20px;' }, character.name),
      el('div', { class: 'cb-micro' }, `TIER ${character.tier} · ${cheddar(character.stakeCheddar)}`),
      el('p', { class: 'cb-legal' }, treatment.copy.sittingBody),
    ]),
    truthBadge(ctx),
    el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-display', style: 'font-size:18px;' }, 'Re-enter'),
      el('p', { class: 'cb-legal' }, `Pay ${money(reentry.usd)}, receive +${cheddar(reentry.bonusCheddar)}.`),
      // C3/R67+\u00a712/R83: this control is NEVER actually inert when
      // short on CASH -- its own onClick (attemptReenter) opens Load Funds
      // inline, exactly the funds wall's live door (R67). Dressing it
      // aria-disabled + greyed + cursor:not-allowed (the el() aria-disabled
      // fix made this dressing render on the VERY FIRST paint, not just
      // after interaction) made a live door look dead: a player reading
      // the control correctly would never press it. Only a GENUINELY inert
      // state (reenterSubmitting -- a request already in flight, and
      // attemptReenter's own reenterSubmitting guard returns before
      // opening anything) still dresses as disabled; the funds-short case
      // reads as the actionable route it is, labeled accordingly so the
      // route is legible, not just undisabled.
      el('button', {
        class: 'cb-btn block',
        'aria-disabled': reenterSubmitting,
        onClick: () => attemptReenter(),
      }, account.cashUSD < reentry.usd ? 'Load Funds to re-enter' : `Re-enter (${money(reentry.usd)})`),
    ]),
    el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-display', style: 'font-size:18px;' }, treatment.copy.cashOutHeading),
      el('p', { class: 'cb-legal' }, `${treatment.copy.cashOutBody} You'd receive ${money(cashUSD)}.`),
      el('button', {
        class: 'cb-btn win block',
        onClick: () => {
          ctx.game.cashOutCharacter(character.id);
          ctx.toast(cashOutToastMessage(cashUSD));
          ctx.router.navigate('wallet');
        },
      }, `${treatment.copy.cashOutButton} (${money(cashUSD)})`),
    ]),
    el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-display', style: 'font-size:18px;' }, 'Sit')  ,
      el('p', { class: 'cb-legal' }, 'Free, indefinitely. Come back whenever.'),
      el('button', { class: 'cb-btn secondary block', onClick: () => ctx.router.navigate('lobby-entry') }, 'Sit for now'),
    ]),
    renderReserveOffer(ctx, () => mountSitting(ctx)),
    renderSpectateCard(ctx, session),
    bottomNav(ctx, null),
  ]);
}

/**
 * C13/O3/R26 card 3 ("Spectate after elimination"): only rendered when that
 * hypothesis is ACTIVE (O3), and only while the character's bracket is
 * still in progress. "verify what t1 shipped" (the brief): bracket-board.js
 * itself was already reachable/readable regardless of character state --
 * what was MISSING was a route TO it from the eliminated player's own
 * screen (sitting.js), so this adds exactly that link plus the one
 * spectate-view ledger event (§13 "spectate rate").
 */
function renderSpectateCard(ctx, session) {
  if (effectiveHypothesisId(loadOverrides()) !== 'spectate') return null;
  if (!session.bracket || session.bracket.complete) return null;
  const card = hypothesisCard('spectate');
  let submitting = false; // f4/A-a: submitting guard -- attempt keying (recordSpectateView's own idempotency key) stays the source of truth; this only stops a double-tap from firing the call twice before the first press's navigation lands.
  return el('div', { class: 'cb-card' }, [
    el('div', { class: 'cb-display', style: 'font-size:18px;' }, 'Spectate'),
    el('p', { class: 'cb-legal' }, card.fairTestLine),
    el('button', {
      class: 'cb-btn secondary block',
      'aria-disabled': submitting,
      onClick: () => {
        if (submitting) return;
        submitting = true;
        ctx.game.recordSpectateView(session.bracketId);
        ctx.router.navigate('bracket-board');
      },
    }, 'Watch the bracket live'),
  ]);
}
