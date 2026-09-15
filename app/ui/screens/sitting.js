// app/ui/screens/sitting.js — R60/R61/R63/R68: the three SITTING choices.
// CB-BUILD-012/R67: re-entry's insufficient-CASH funds wall opens Load
// Funds inline (same pattern as summon.js), instead of a dead-end toast.
import { mountScreen, el, money, cheddar } from '../components/dom.js';
import * as economy from '../../engine/economy.js';
import { topBar, bottomNav, truthBadge } from '../components/chrome.js';
import { loadOverrides, effectiveHypothesisId } from '../../engine/overrides.js';
import { hypothesisCard } from '../../engine/hypotheses.js';
import { openLoadFundsSheet } from '../components/money-sheets.js';

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
  if (!character) { ctx.router.navigate('lobby-entry'); return; }

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
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
      el('div', { class: 'cb-card', style: 'text-align:center;' }, [
        el('div', { class: 'cb-display', style: 'font-size:22px;' }, character.name),
        el('p', { class: 'cb-emptied-line' }, emptiedLine),
        el('button', {
          class: 'cb-btn danger block',
          style: 'margin-top:12px;',
          onClick: () => { ctx.game.retireEmptyCharacter(character.id); ctx.toast('Retired to the ledger.'); ctx.router.navigate('lobby-entry'); },
        }, treatment.copy.emptiedCardAction),
      ]),
      bottomNav(ctx, null),
    ]);
    return;
  }

  const reentry = economy.reentryForTier(tunables, character.tier);
  const cashUSD = economy.cheddarToUsd(tunables, character.stakeCheddar);
  let reenterSubmitting = false;

  /**
   * CB-BUILD-012/R67: re-entry's insufficient-CASH funds wall -- same
   * inline-Load-Funds-and-return pattern as summon.js's attemptSummon:
   * open Load Funds and retry this exact blocked action (re-entry) once
   * the deposit lands, instead of a dead-end toast.
   */
  function attemptReenter() {
    const liveAccount = ctx.game.snapshot().account;
    if (liveAccount.cashUSD < reentry.usd) {
      openLoadFundsSheet(ctx, { onDeposited: attemptReenter });
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
    // CB-BUILD-fix-round-1 #4 (R67): the CASH balance is itself a CONTROL.
    // This screen rendered its own dead `<span class="cb-cash-pill">` while
    // only summon.js used chrome.js's button pill — now it renders the same
    // shared topBar, whose pill is a real button that opens Load Funds.
    topBar(ctx),
    el('h2', {}, treatment.copy.sittingHeading),
    el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-display', style: 'font-size:20px;' }, character.name),
      el('div', { class: 'cb-micro' }, `TIER ${character.tier} · ${cheddar(character.stakeCheddar)}`),
      el('p', { class: 'cb-prose' }, treatment.copy.sittingBody),
    ]),
    truthBadge(ctx),
    el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-display', style: 'font-size:18px;' }, 'Re-enter'),
      el('p', { class: 'cb-prose' }, `Pay ${money(reentry.usd)}, receive +${cheddar(reentry.bonusCheddar)}.`),
      el('button', {
        class: 'cb-btn block',
        'aria-disabled': reenterSubmitting,
        onClick: attemptReenter,
      }, `Re-enter (${money(reentry.usd)})`),
    ]),
    el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-display', style: 'font-size:18px;' }, treatment.copy.cashOutHeading),
      el('p', { class: 'cb-prose' }, `${treatment.copy.cashOutBody} You'd receive ${money(cashUSD)}.`),
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
      el('p', { class: 'cb-prose' }, 'Free, indefinitely. Come back whenever.'),
      el('button', { class: 'cb-btn secondary block', onClick: () => ctx.router.navigate('lobby-entry') }, 'Sit for now'),
    ]),
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
    el('p', { class: 'cb-prose cb-prose-small' }, card.fairTestLine),
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
