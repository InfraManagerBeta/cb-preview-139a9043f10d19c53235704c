// app/ui/components/money-sheets.js — R67 Load Funds, R69 Withdraw. Both are
// the shipped "PLAY CASH ONLY" sheet skeleton, differing only in direction.
// R8a: every surface that mentions money states the truth up front.
import { el, money } from './dom.js';
import { randomId } from '../../engine/id.js';
import { getOrCreateSessionNumber } from '../session.js';

function closeOverlay(overlay) {
  overlay.remove();
}

export function openLoadFundsSheet(ctx, { onDeposited } = {}) {
  const { treatment, tunables } = ctx;
  // f4/A-f fix: O8's own note says "multiples of the ENTRY FEE" -- that's
  // the ACTIVE price-door arm's displayed price (O2: $5/$10/$25/$0, per
  // C15/f2's summonCharacter fix), not the fixed tunables.economy.summonUSD
  // constant (which stays $10 regardless of which arm O2 has switched to).
  // `tunables` here is already the effective (override-applied) object, so
  // this single read tracks a live O2 switch exactly like the summon
  // screen's own displayed price does.
  //
  // f5/crucial-1 fix (R67/O8, from f4's A-f regression): the read above is
  // right EXCEPT at the free-play door (O2='freePlay'), where the active
  // arm's displayed entry price is $0 -- and O8 defines presets as
  // MULTIPLES OF THE ENTRY FEE, so a $0 door has no meaningful multiples
  // (0 * anything is still 0). A $0 basis silently produced `[0, 0]`
  // presets, a $0 default amount, and let a participant "deposit" nothing.
  // So: use the active arm's price as the basis only when it's POSITIVE;
  // otherwise fall back to the fixed tunables.economy.summonUSD constant
  // (the $10 par) as the basis, same as pre-f4 behavior, but ONLY for this
  // one degenerate arm. Console-facing note for O2: at the free-play door,
  // Load Funds presets show entry-fee multiples of the $10 par (not $0),
  // since a $0 entry fee has no multiples worth presenting.
  const activeEntryUSD = tunables.priceDoorArms.displayedEntryPriceDefaultUSD;
  const entryUSD = activeEntryUSD > 0 ? activeEntryUSD : tunables.economy.summonUSD;
  const preset = tunables.loadFundsPresets.default;
  const presetAmounts = preset.multiples.map((m) => entryUSD * m);
  let amount = presetAmounts[presetAmounts.length - 1] || entryUSD;
  let selectedPreset = amount;
  // C1/R83: the UI mints ONE idempotency intent per press, before ever
  // calling Game#loadFunds, and reuses it on retry -- the control disables
  // immediately so a double-fired press can't mint (or send) a second one.
  // (The reviewer's repro: the same $100 deposit fired twice credited $200.)
  const intentId = randomId();
  let submitting = false;
  // A11/R67 fix (f2): the deposit figure is now tap-to-edit -- tapping it
  // swaps the static "$N" display for an inline <input type="number"
  // step="0.01"> so a participant can type a CUSTOM amount TO THE CENT
  // (e.g. "$47.63"), not just whole-dollar increments. The +/- steppers
  // stay whole-dollar (per the brief: "steppers can stay whole-dollar").
  let editingAmount = false;

  const overlay = el('div', { class: 'cb-sheet-overlay' });

  function commitEdit(rawValue) {
    const parsed = Math.round(parseFloat(rawValue) * 100) / 100; // to the cent
    if (Number.isFinite(parsed) && parsed > 0) {
      amount = parsed;
      selectedPreset = null; // a hand-typed amount is a custom amount, not a preset
    }
    editingAmount = false;
    render();
  }

  function render() {
    const account = ctx.game.snapshot().account;
    overlay.innerHTML = '';

    const amountFigure = editingAmount
      ? el('input', {
        type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal',
        class: 'cb-amount-figure cb-amount-input',
        value: amount.toFixed(2),
        onBlur: (e) => commitEdit(e.target.value),
        onKeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      })
      : el('button', {
        class: 'cb-amount-figure cb-amount-figure-tappable',
        'aria-label': 'Tap to edit the deposit amount to the cent',
        onClick: () => { editingAmount = true; render(); focusAmountInput(); },
      }, `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`);

    overlay.appendChild(el('div', { class: 'cb-sheet' }, [
      el('div', { class: 'cb-sheet-top' }, [
        el('span', { class: 'cb-micro' }, `BALANCE ${money(account.cashUSD)}`),
        el('button', { class: 'cb-sheet-back', onClick: () => closeOverlay(overlay) }, treatment.copy.loadFundsBack),
      ]),
      el('h2', { style: 'font-size:18px;' }, treatment.copy.loadFundsHeading),
      el('div', { class: 'cb-amount-card' }, [
        el('button', { class: 'cb-stepper', onClick: () => { amount = Math.max(1, Math.round(amount) - 1); selectedPreset = null; render(); } }, '−'),
        amountFigure,
        el('button', { class: 'cb-stepper', onClick: () => { amount = Math.round(amount) + 1; selectedPreset = null; render(); } }, '+'),
      ]),
      el('div', { class: 'cb-preset-row' }, presetAmounts.map((p) =>
        el('button', {
          class: `cb-pill${selectedPreset === p ? ' selected' : ''}`,
          onClick: () => { amount = p; selectedPreset = p; editingAmount = false; render(); },
        }, `$${p}`)
      )),
      el('button', {
        // CB-BUILD-fix-round-1 #1: the deposit skin is a class variant now,
        // not an inline style — an inline `background` beat EVERY stylesheet
        // rule, including the disabled treatment, so a disabled Continue
        // looked fully actionable. The `.cb-btn.deposit` rule (base.css)
        // carries the same colors; the variant-qualified disabled rule wins
        // over it by specificity.
        class: 'cb-btn block deposit',
        'aria-disabled': submitting,
        onClick: () => {
          if (submitting) return; // R83: control disables until resolution
          submitting = true;
          const sessionNumber = getOrCreateSessionNumber();
          ctx.game.loadFunds({ amountUSD: amount, presetOrCustom: selectedPreset != null ? 'preset' : 'custom', intentId, sessionNumber });
          closeOverlay(overlay);
          ctx.toast(`Deposited ${money(amount)}.`);
          if (onDeposited) onDeposited();
        },
      }, treatment.copy.loadFundsContinue),
      el('p', { class: 'cb-prose cb-prose-small' }, treatment.copy.loadFundsLegal),
    ]));
  }

  function focusAmountInput() {
    const input = overlay.querySelector('.cb-amount-input');
    if (input) { input.focus(); input.select(); }
  }

  render();
  document.body.appendChild(overlay);
}

export function openWithdrawSheet(ctx) {
  const { treatment } = ctx;
  const account = ctx.game.snapshot().account;
  const overlay = el('div', { class: 'cb-sheet-overlay' }, [
    el('div', { class: 'cb-sheet' }, [
      el('div', { class: 'cb-sheet-top' }, [
        el('span', { class: 'cb-micro' }, `BALANCE ${money(account.cashUSD)}`),
        el('button', { class: 'cb-sheet-back', onClick: () => closeOverlay(overlay) }, treatment.copy.loadFundsBack),
      ]),
      el('h2', { style: 'font-size:18px;' }, treatment.copy.withdrawHeading),
      el('p', { class: 'cb-prose' }, treatment.copy.withdrawBody),
      el('div', { class: 'cb-amount-card' }, [el('div', { class: 'cb-amount-figure' }, money(account.cashUSD))]),
      el('p', { class: 'cb-prose cb-prose-small' }, treatment.copy.loadFundsLegal),
    ]),
  ]);
  document.body.appendChild(overlay);
}
