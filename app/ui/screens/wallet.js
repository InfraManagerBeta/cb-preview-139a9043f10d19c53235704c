// app/ui/screens/wallet.js — R58/R67-R69: CASH + characters, Load Funds,
// Withdraw, and per-character SITTING/emptied handling.
import { mountScreen, el, money, cheddar } from '../components/dom.js';
import { bottomNav, truthBadge } from '../components/chrome.js';
import { openLoadFundsSheet, openWithdrawSheet } from '../components/money-sheets.js';
import * as economy from '../../engine/economy.js';

export function mountWallet(ctx) {
  const { treatment } = ctx;
  const snap = ctx.game.snapshot();
  const characters = Object.values(snap.characters).filter((c) => c.kind === 'human' && !c.retired);
  const retired = Object.values(snap.characters).filter((c) => c.kind === 'human' && c.retired);

  function characterCard(c) {
    if (economy.isEmptied(c) && c.state !== 'RETIRED') {
      return el('div', { class: 'cb-card' }, [
        el('div', { class: 'cb-display', style: 'font-size:18px;' }, c.name),
        el('p', { class: 'cb-emptied-line' }, treatment.copy.emptiedCardLine),
        el('button', { class: 'cb-btn danger block', onClick: () => { ctx.game.retireEmptyCharacter(c.id); render(); } }, treatment.copy.emptiedCardAction),
      ]);
    }
    return el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-display', style: 'font-size:18px;' }, c.name),
      el('div', { class: 'cb-micro' }, `${c.state} · TIER ${c.tier} · ${cheddar(c.stakeCheddar)} · ${treatment.elements[c.element] ? treatment.elements[c.element].label.toUpperCase() : ''}`),
      c.state === 'SITTING' ? el('button', { class: 'cb-btn secondary block', style: 'margin-top:8px;', onClick: () => { ctx.patchSession({ activeCharacterId: c.id }); ctx.router.navigate('sitting'); } }, 'Manage') : null,
      c.state === 'ACTIVE' ? el('button', { class: 'cb-btn secondary block', style: 'margin-top:8px;', onClick: () => { ctx.patchSession({ activeCharacterId: c.id }); ctx.router.navigate('lobby-entry'); } }, 'Play') : null,
    ]);
  }

  function render() {
    const account = ctx.game.snapshot().account;
    mountScreen([
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
      el('h2', {}, treatment.copy.walletHeading),
      truthBadge(ctx),
      el('div', { class: 'cb-card', style: 'text-align:center;' }, [
        el('div', { class: 'cb-micro' }, 'CASH') ,
        el('div', { class: 'cb-display', style: 'font-size:36px;' }, money(account.cashUSD)),
        el('div', { style: 'display:flex;gap:8px;margin-top:10px;' }, [
          el('button', { class: 'cb-btn block', onClick: () => openLoadFundsSheet(ctx, { onDeposited: render }) }, 'Load Funds'),
          el('button', { class: 'cb-btn secondary block', onClick: () => openWithdrawSheet(ctx) }, treatment.copy.withdrawHeading),
        ]),
      ]),
      el('div', { class: 'cb-micro', style: 'margin-top:8px;' }, 'CHARACTERS'),
      ...(characters.length ? characters.map(characterCard) : [el('p', { class: 'cb-prose' }, 'No characters yet.')]),
      retired.length ? el('div', { class: 'cb-micro' }, 'RETIRED') : null,
      ...retired.map((c) => el('div', { class: 'cb-card' }, [el('div', {}, c.name), el('div', { class: 'cb-micro' }, 'Retired to the ledger.')])),
      el('div', { style: 'height:56px;' }),
      bottomNav(ctx, 'wallet'),
    ]);
  }

  render();
}
