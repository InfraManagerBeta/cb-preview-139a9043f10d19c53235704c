// app/ui/screens/landing.js — R8a truth line up front, the tested acquisition
// message, into the screener. R19/R22/O2: the door-arm displayed price is
// what a player arriving through that door actually pays.
//
// CB-BUILD-007 track 1/R12/R18/R22: the theme door test needs the landing
// screen to BE the treatment's door -- not just re-skinned colors/fonts
// (already handled by ui/theme.js) but the treatment's own ad/landing
// creative (treatment.adCreative, app/data/treatments/*.json), carried in
// full: working title (unchanged), the R11-fixed acquisition message
// (unchanged, verbatim, LAW), PLUS the treatment's own headline/body/CTA in
// its own register -- the actual door-yield read (R22) is on THIS content,
// not generic app copy. R8a's truth line stays exactly where it was.
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
  // CB-BUILD-007 track 1: adCreative is product data per treatment (every
  // treatment.json carries one -- see treatments-schema tests); the `ad ?`
  // guards below are defensive only (a treatment missing the block still
  // renders the screen exactly as before this patch, falling back to the
  // pre-existing generic subhead/CTA).
  const ad = treatment.adCreative;
  mountScreen([
    el('div', { class: 'cb-topbar' }, [
      el('span', { class: 'cb-logo' }, treatment.logoMark),
      el('span', { class: 'cb-cash-pill cb-data' }, doorPriceLabel),
    ]),
    el('div', { class: 'cb-card', style: 'text-align:center;padding:32px 20px;' }, [
      el('h1', { class: 'cb-hero-face', style: 'font-size:40px;color:var(--cb-yellow);' }, treatment.workingTitle),
      // R11 [LAW]: the acquisition message is FIXED, verbatim, across every
      // treatment -- untouched by this patch.
      el('h2', { style: 'font-size:24px;' }, treatment.copy.acquisitionMessage),
      // CB-BUILD-007 track 1/R12: the treatment's OWN door headline, in its
      // own register and working title -- the theme-bound layer sitting
      // under the fixed message above, not replacing it.
      ad ? el('h3', { class: 'cb-display', style: 'font-size:18px;margin:2px 0 8px;' }, ad.headline) : null,
      el('p', { class: 'cb-legal' }, ad ? ad.body : treatment.copy.landingSubhead),
    ]),
    el('div', { class: 'cb-card' }, [
      el('div', { class: 'cb-truth-badge', style: 'margin-bottom:10px;' }, ['\u24D8 PLAY MONEY']),
      el('p', { class: 'cb-legal' }, treatment.copy.truthLine),
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
      // CB-BUILD-007 track 1: the door's own CTA label, in the treatment's
      // own register, in place of the generic "Play".
    }, ad ? ad.cta : 'Play'),
  ]);
}

