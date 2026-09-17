// app/ui/components/chrome.js — top bar (logo + CASH pill) and bottom nav.
import { el, money, mountScreen } from './dom.js';
import { openLoadFundsSheet } from './money-sheets.js';

// CB-BUILD-012/R67: "Load Funds is reachable from every point a player can
// meet a funds wall: the CASH balance is itself a control that opens the
// sheet." The CASH pill used to be a non-interactive `<span>` everywhere it
// appeared -- this is the ONE shared, tappable implementation; screens that
// show a CASH balance render THIS instead of building their own inert span.
export function cashPill(ctx) {
  const snap = ctx.game.snapshot();
  return el('button', {
    class: 'cb-cash-pill cb-data cb-cash-pill-btn',
    'aria-label': 'CASH balance — tap to add funds',
    onClick: () => openLoadFundsSheet(ctx),
  }, `CASH ${money(snap.account.cashUSD)}`);
}

export function topBar(ctx) {
  return el('div', { class: 'cb-topbar' }, [
    el('span', { class: 'cb-logo' }, ctx.treatment.logoMark),
    cashPill(ctx),
  ]);
}


export function truthBadge(ctx) {
  return el('div', { class: 'cb-truth-badge' }, ['\u24D8', ctx.treatment.copy.moneyTruthBadge]);
}

// C7/R8a: a compact, one-line variant of the same truth claim for surfaces
// where the full badge doesn't fit (the tug bar during the live reveal) --
// same meaning (play money is free, lives in the game, reservation = the
// notification list where relevant), same source string
// (treatment.copy.moneyTruthBadge), just laid out smaller. Every screen
// that renders a money figure renders one of these two (see
// app/tests/money-truth-scan.test.js).
export function compactMoneyTruth(ctx) {
  return el('div', { class: 'cb-money-truth-compact cb-micro' }, ['\u24D8 ', ctx.treatment.copy.moneyTruthBadge]);
}

/**
 * f4/A-g/A-h: the kill-switch stop banner, extracted from app.js's
 * `renderKilledBanner` (same markup/copy, now the ONE shared source) so a
 * kill caught MID-ACTION -- during the reveal's `logNarration` call
 * (A-g, duel.js) or during a PvE Fight (A-h, pve.js) -- can render the
 * SAME stop screen a fresh route mount would show, instead of leaving
 * whatever was on screen at the instant of the throw (the reveal's last
 * frame, frozen; or a PvE screen with no feedback at all). Every route
 * still ALSO checks the kill switch fresh before mounting (app.js) --
 * this is the catch-site companion for a kill that lands mid-action,
 * not a replacement for that check.
 */
export function renderKillStopBanner(ctx) {
  mountScreen([
    el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, ctx.treatment.logoMark)]),
    el('div', { class: 'cb-card', style: 'text-align:center;padding:32px 20px;border-color:var(--cb-red);' }, [
      el('h1', { style: 'color:var(--cb-red);' }, 'Run Stopped'),
      el('p', { class: 'cb-legal' }, 'The operator has halted this run. Play is paused; your ledger and balances are preserved exactly as they stood at the stop.'),
      el('p', { class: 'cb-legal' }, 'This is the kill switch (A4/console) in its stopped state — demonstrable both from the operator console and by the ?kill=1 URL parameter, independently of the console UI.'),
    ]),
  ]);
}

export function bottomNav(ctx, active) {
  const items = [
    { route: 'lobby-entry', label: 'PLAY' },
    { route: 'wallet', label: 'WALLET' },
    { route: 'reserve', label: 'RESERVE' },
  ];
  return el('div', { class: 'cb-nav-bottom' }, [
    el('div', { class: 'cb-nav-inner' }, items.map((it) =>
      el('button', {
        class: `cb-nav-btn${active === it.route ? ' active' : ''}`,
        onClick: () => ctx.router.navigate(it.route),
      }, it.label)
    )),
  ]);
}
