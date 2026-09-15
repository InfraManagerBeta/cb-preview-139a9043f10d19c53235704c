// app/engine/duelProjection.js — R76: the tug-of-war bar's "projected
// all-remaining-draws result." Reuses duel.js's exported duelScore/
// powerTransfer verbatim (no re-implementation of the R53 math) over only
// the rounds resolved so far, treating every not-yet-shown round as a draw
// (which duelScore already scores as a zero contribution) -- exactly what
// "the projected result if all remaining rounds draw" means.
import { duelScore, powerTransfer, elementIndex } from './duel.js';

/**
 * @param {Array} rounds resolveDuel()'s outcome.rounds (already reoriented
 *   to the perspective the bar renders p1/p2 as)
 * @param {number} uptoRoundNumber how many rounds (1-5) have been shown so
 *   far on the bar; 0 = before round one
 */
export function projectedAfterRound(rounds, uptoRoundNumber, aff1, aff2, p1, p2, floor) {
  const mv1 = [0, 0, 0, 0, 0];
  const mv2 = [0, 0, 0, 0, 0];
  for (const r of rounds) {
    if (r.round > uptoRoundNumber) continue; // not yet shown -> treated as a draw (0 contribution)
    mv1[r.round - 1] = elementIndex(r.move1);
    mv2[r.round - 1] = elementIndex(r.move2);
  }
  const score = duelScore(mv1, mv2, aff1, aff2);
  // Deliberately the RAW (non-floor-adjusted) transfer: R76 withholds the
  // drain from the bar until the result card, so the bar never snaps to a
  // full wipeout early -- only the result card applies the floor's
  // full-drain override.
  const transfer = score === 0 ? 0 : powerTransfer(score, p1, p2, floor);
  const p1Projected = p1 + transfer;
  const p2Projected = p2 - transfer;
  const total = p1Projected + p2Projected;
  return {
    score,
    transfer,
    p1Projected: Math.max(0, p1Projected),
    p2Projected: Math.max(0, p2Projected),
    p1SharePct: total > 0 ? (Math.max(0, p1Projected) / total) * 100 : 50,
    p2SharePct: total > 0 ? (Math.max(0, p2Projected) / total) * 100 : 50,
  };
}
