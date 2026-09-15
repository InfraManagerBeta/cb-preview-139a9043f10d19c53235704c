// app/ui/screens/landing.js — R8a truth line up front, the tested acquisition
// message, into the screener. R19/R22/O2: the door-arm displayed price is
// what a player arriving through that door actually pays.
//
// C15/f2 fix: this used to say the summon cost "always runs through R58's
// fixed $10->100C peg regardless of this badge" -- true before f2, no
// longer true: `Game#summonCharacter` (app/engine/game.js) now charges
// EXACTLY the active price arm's displayed price ($5/$10/$25/$0), always
// minting the same 100C stake (R19's door semantics: the arm varies the
// DISPLAYED PRICE for an identical summon, never the stake). The peg
// (20C=$1) only holds at the $10 default arm; away from it the door price
// is simply what the arm charges for the same 100C, not a 20C/$1
// conversion -- an honest implication of R19, not a bug, stated here and at
// the point of charge (app/engine/game.js's summonCharacter doc comment).
import { mountScreen, el } from '../components/dom.js';

export function mountLanding(ctx) {
  const { treatment, tunables } = ctx;
  const doorPrice = tunables.priceDoorArms.displayedEntryPriceDefaultUSD;
  const doorPriceLabel = doorPrice === 0 ? 'Free to play' : `$${doorPrice} to play`;
  mountScreen([
    el('div', { class: 'cb-topbar' }, [
      el('span', { class: 'cb-logo' }, treatment.logoMark),
      // CB-BUILD-fix-round-1 #4: this badge shows the door-arm's DISPLAYED
      // PRICE (R19/O2), not the CASH balance — it must not wear the
      // cash-pill class (R67 makes the CASH balance a control; a price
      // badge on the pre-account landing screen is not one). Same pill
      // styling via its own class.
      el('span', { class: 'cb-price-pill cb-data' }, doorPriceLabel),
    ]),
    el('div', { class: 'cb-card', style: 'text-align:center;padding:32px 20px;' }, [
      el('h1', { class: 'cb-hero-face', style: 'font-size:40px;color:var(--cb-yellow);' }, treatment.workingTitle),
      el('h2', { style: 'font-size:24px;' }, treatment.copy.acquisitionMessage),
      el('p', { class: 'cb-prose' }, treatment.copy.landingSubhead),
    ]),
    el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-truth-badge', style: 'margin-bottom:10px;' }, ['\u24D8 PLAY MONEY']),
      el('p', { class: 'cb-prose' }, treatment.copy.truthLine),
    ]),
    el('button', {
      class: 'cb-btn block',
      style: 'font-size:22px;',
      onClick: () => {
        const snap = ctx.game.snapshot();
        if (snap.account.screener && snap.account.screener.passed) {
          const hasChar = Object.keys(snap.characters).length > 0;
          ctx.router.navigate(hasChar ? 'lobby-entry' : 'summon');
        } else {
          ctx.router.navigate('screener');
        }
      },
    }, 'Play'),
  ]);
}

