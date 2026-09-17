// app/ui/components/battle/moments.js — R75 coverage-gap moments: the
// incumbent's canonical GIF set has no floor-drain, coin-flip, or
// prize-award animation. Two candidates are built for each (docs/
// presentation-candidates.md carries the full ranking + reasons); the
// console's O-item-style switch (consoleOverrides.presentationMoments)
// picks candidate 1 or 2 per moment, default = candidate 1 (this module's
// #1 ranking in every case).
import { el, cheddar, money } from '../dom.js';

/** Floor drain (R55/R75): "an erasure treatment in the Narrator-accent
 * color composed from Lose and the bundle's mold material." */
export function renderFloorDrain({ candidate = 1, loserName, treatment }) {
  if (candidate === 2) {
    // Candidate 2: "Ledger Stamp" -- a rubber-stamp slam, Narrator-accent ink.
    return el('div', { class: 'cb-moment cb-moment-floordrain cb-moment-candidate-2' }, [
      el('div', { class: 'cb-stamp' }, 'VOID'),
      el('p', { class: 'cb-moment-caption' }, `${loserName} — struck from the ledger.`),
    ]);
  }
  // Candidate 1 (default): "Erosion Wipe" -- desaturate + wipe in the
  // Narrator-accent color, composed with the Lose state.
  return el('div', { class: 'cb-moment cb-moment-floordrain cb-moment-candidate-1' }, [
    el('div', { class: 'cb-erosion-wipe' }),
    el('p', { class: 'cb-moment-caption' }, `${loserName} — drained to nothing.`),
  ]);
}

/** True-tie coin flip (R54/R75): "a coin-flip presentation and the
 * advancing character's Win." */
export function renderCoinFlip({ candidate = 1, p1Name, p2Name, winnerName }) {
  if (candidate === 2) {
    // Candidate 2: "Split-Screen Flash" -- alternating strobe settling on the winner.
    return el('div', { class: 'cb-moment cb-moment-coinflip cb-moment-candidate-2' }, [
      el('div', { class: 'cb-strobe-split' }, [
        el('div', { class: 'cb-strobe-half left' }, p1Name),
        el('div', { class: 'cb-strobe-half right' }, p2Name),
      ]),
      el('p', { class: 'cb-moment-caption' }, `${winnerName} advances — coin flip.`),
    ]);
  }
  // Candidate 1 (default): "Spinning Coin" -- a 3D-flipping disc.
  return el('div', { class: 'cb-moment cb-moment-coinflip cb-moment-candidate-1' }, [
    el('div', { class: 'cb-coin' }, [el('div', { class: 'cb-coin-face front' }, 'H'), el('div', { class: 'cb-coin-face back' }, 'T')]),
    el('p', { class: 'cb-moment-caption' }, `${winnerName} advances — coin flip.`),
  ]);
}

/** Prize award (R56/R75): the headline prize entered as a fact separate
 * from the duel.
 *
 * f4/N1 fix: takes `winOutcome` (the SAME payload the CHARACTER_ADVANCED
 * ledger event carries, app/engine/game.js#resolveMatch ->
 * app/engine/economy.js#bracketWinOutcome) instead of a bare
 * `prizeCheddar` looked up independently from tierLadder.tiers[...] -- for
 * a topped-out (T6) win that lookup showed 20,000,000C while the ledger
 * actually paid $999,999.92 CASH + stake at 20:1, prizeCheddar 0. The
 * topped-out case now renders BOTH figures as separate lines (R56: "the
 * win screen shows DUEL WON and the prize as separate lines" -- R62's
 * payout itself is two numbers, cash + converted stake, so it gets two
 * lines here, not one). */
export function renderPrizeAward({ candidate = 1, treatment, winOutcome }) {
  const prizeNoun = treatment.nouns.headlinePrize;
  const toppedOut = !!(winOutcome && winOutcome.toppedOut);
  const prizeCheddar = winOutcome ? winOutcome.prizeCheddar : 0;

  if (toppedOut) {
    const cashLine = money(winOutcome.payoutCashUSD);
    const stakeLine = `${cheddar(winOutcome.stakeCashedOutCheddar)} @ 20:1 = ${money(winOutcome.stakeCashUSD)}`;
    if (candidate === 2) {
      // Candidate 2: "Trophy Card Flip" -- the card's back carries both R56 lines.
      return el('div', { class: 'cb-moment cb-moment-prize cb-moment-candidate-2' }, [
        el('div', { class: 'cb-trophy-flip' }, [
          el('div', { class: 'cb-trophy-face front' }, prizeNoun),
          el('div', { class: 'cb-trophy-face back' }, [
            el('div', {}, cashLine),
            el('div', { class: 'cb-micro' }, stakeLine),
          ]),
        ]),
      ]);
    }
    // Candidate 1 (default): "Rising Counter" -- the cash figure counts
    // up; the stake-conversion line sits beside it, not folded in.
    return el('div', { class: 'cb-moment cb-moment-prize cb-moment-candidate-1' }, [
      el('div', { class: 'cb-prize-banner' }, prizeNoun),
      el('div', { class: 'cb-prize-counter', 'data-target': winOutcome.payoutCashUSD }, cashLine),
      el('div', { class: 'cb-micro' }, stakeLine),
    ]);
  }

  if (candidate === 2) {
    // Candidate 2: "Trophy Card Flip" -- a card flip revealing the prize.
    return el('div', { class: 'cb-moment cb-moment-prize cb-moment-candidate-2' }, [
      el('div', { class: 'cb-trophy-flip' }, [
        el('div', { class: 'cb-trophy-face front' }, prizeNoun),
        el('div', { class: 'cb-trophy-face back' }, cheddar(prizeCheddar)),
      ]),
    ]);
  }
  // Candidate 1 (default): "Rising Counter" -- the amount counts up.
  return el('div', { class: 'cb-moment cb-moment-prize cb-moment-candidate-1' }, [
    el('div', { class: 'cb-prize-banner' }, prizeNoun),
    el('div', { class: 'cb-prize-counter', 'data-target': prizeCheddar }, cheddar(prizeCheddar)),
  ]);
}
