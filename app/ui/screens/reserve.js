// app/ui/screens/reserve.js — R49a: RESERVE action, once per account, with
// timestamp/day index/tier/character state; copy states the notification-
// list truth and that play money is free (R8a).
//
// CB-BUILD-003: R22 says the character-recall open response is asked only
// AFTER the player's first bracket concludes (post-anchor) -- never before
// a staked duel exists. The delivered build rendered
// `renderOpenResponsePrompt()` for any account that hadn't answered yet,
// with no check for a concluded bracket, so a player could see "What do
// you remember about your last match?" before playing a single match.
// Fixed: the recall card is now gated on `retention.computeAnchor(...)`
// (R43: the timestamp the player's first bracket concludes, elimination or
// win) returning non-null. Until an anchor exists, RESERVE stays pressable
// and shows notification-list copy only -- no last-match question.
import { mountScreen, el } from '../components/dom.js';
import { bottomNav, truthBadge } from '../components/chrome.js';
import { computeAnchor } from '../../engine/retention.js';

export function mountReserve(ctx) {
  const { treatment } = ctx;
  const snap = ctx.game.snapshot();
  const characters = Object.values(snap.characters).filter((c) => c.kind === 'human');
  const active = characters.find((c) => c.state === 'ACTIVE') || characters[0];

  function render() {
    const account = ctx.game.snapshot().account;
    // R22/R43: only after the player's first bracket has actually
    // concluded (an anchor) does the recall question exist at all.
    const anchorTs = computeAnchor(ctx.game.ledger.all(), ctx.game.playerId);
    mountScreen([
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
      el('h2', {}, treatment.copy.reserveHeading),
      truthBadge(ctx),
      el('div', { class: 'cb-card' }, [el('p', {}, treatment.copy.reserveBody)]),
      account.reservation
        ? el('div', { class: 'cb-card', style: 'text-align:center;border-color:var(--cb-green);' }, [
            el('p', {}, treatment.copy.reserveConfirmed),
            el('p', { class: 'cb-micro' }, new Date(account.reservation.ts).toLocaleString()),
          ])
        : el('button', {
            class: 'cb-btn block',
            onClick: () => {
              ctx.game.pressReserve({ tier: active ? active.tier : 0, characterState: active ? active.state : null });
              render();
            },
          }, treatment.copy.reserveButton),
      // C18/R22: a minimal, ONCE-per-account, optional open-response prompt
      // so the character-recall metric (R22) has an actual data source.
      // CB-BUILD-003: gated on an anchor (a concluded first bracket) -- no
      // last-match question can exist before a staked duel does.
      (anchorTs != null && !account.openResponse) ? renderOpenResponsePrompt() : null,
      el('div', { style: 'height:56px;' }),
      bottomNav(ctx, 'reserve'),
    ]);
  }

  function renderOpenResponsePrompt() {
    return el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-micro' }, 'ONE QUESTION (OPTIONAL, ASKED ONCE)'),
      el('p', { class: 'cb-legal' }, 'What do you remember about your last match?'),
      el('textarea', { id: 'cb-open-response-input', rows: 3, style: 'width:100%;box-sizing:border-box;' }),
      el('button', {
        class: 'cb-btn secondary block',
        onClick: () => {
          const node = document.getElementById('cb-open-response-input');
          const text = node && node.value ? node.value.trim() : '';
          if (!text) return;
          ctx.game.submitOpenResponse(text);
          render();
        },
      }, 'Submit'),
    ]);
  }

  render();
}
