// app/ui/screens/reserve.js — R49a: RESERVE action, once per account, with
// timestamp/day index/tier/character state; copy states the notification-
// list truth and that play money is free (R8a). CB-BUILD-003/R49a/R22:
// RESERVE is reachable from a cold start (offered in the played funnel,
// not gated), but the character-recall open-response prompt is asked only
// AFTER the player's first bracket concludes (an anchor) -- never before a
// staked duel exists.
import { mountScreen, el } from '../components/dom.js';
import { bottomNav, truthBadge } from '../components/chrome.js';

export function mountReserve(ctx) {
  const { treatment } = ctx;
  const snap = ctx.game.snapshot();
  const characters = Object.values(snap.characters).filter((c) => c.kind === 'human');
  const active = characters.find((c) => c.state === 'ACTIVE') || characters[0];

  function render() {
    const account = ctx.game.snapshot().account;
    // CB-BUILD-003/R22: an anchor is the timestamp the player's first
    // bracket concludes (elimination or a bracket win) -- see
    // Game#snapshot / retention.computeAnchor. Before that exists, the
    // recall card is hidden entirely; the tab still shows the
    // notification-list copy (reserveBody) and stays pressable.
    const hasAnchor = account.anchorTs != null;
    mountScreen([
      el('div', { class: 'cb-topbar' }, [el('span', { class: 'cb-logo' }, treatment.logoMark)]),
      el('h2', {}, treatment.copy.reserveHeading),
      truthBadge(ctx),
      el('div', { class: 'cb-card' }, [el('p', {}, treatment.copy.reserveBody)]),
      account.reservation
        ? el('div', { class: 'cb-card', style: 'text-align:center;border-color:var(--cb-green);' }, [
            el('p', {}, treatment.copy.reserveConfirmed),
            // CB-BUILD-fix-round-2 (re-review B): a timestamp is a FIGURE —
            // legitimately data-face (CB-BUILD-004's build-forward reserves
            // --font-data for figures/timestamps), so it is not <p> body copy.
            el('div', { class: 'cb-micro' }, new Date(account.reservation.ts).toLocaleString()),
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
      // CB-BUILD-003: gated on an anchor -- hidden entirely (no last-match
      // question) until the player's first bracket has concluded.
      !account.openResponse && hasAnchor ? renderOpenResponsePrompt() : null,
      el('div', { style: 'height:56px;' }),
      bottomNav(ctx, 'reserve'),
    ]);
  }

  function renderOpenResponsePrompt() {
    return el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-micro' }, 'ONE QUESTION (OPTIONAL, ASKED ONCE)'),
      el('p', { class: 'cb-prose' }, 'What do you remember about your last match?'),
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
