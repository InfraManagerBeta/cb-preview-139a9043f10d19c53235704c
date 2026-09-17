// R53 duel math, implemented exactly as specified in docs/PRD.md §7 (R53).
// Moves: Fire 0, Water 1, Air 2. Fire beats Air, Air beats Water, Water beats Fire.
// Weights by round [78, 79, 81, 86, 100] (sum 424). Affinity multiplier 1.3.
'use strict';

const WEIGHTS = [78, 79, 81, 86, 100];
const WEIGHT_SUM = 424;

// roundWinner(m1, m2): if m1 == m2 -> 0; d = m1 - m2; if d^2 == 4 -> d = -(d >> 1); return sign(d)
function roundWinner(m1, m2) {
  if (m1 === m2) return 0;
  let d = m1 - m2;
  if (d * d === 4) d = -(d >> 1);
  return Math.sign(d);
}

// duelScore(mv1, mv2, aff1, aff2) per R53 pseudocode, verbatim semantics.
function duelScore(mv1, mv2, aff1, aff2) {
  let score = 0;
  for (let i = 0; i < 5; i++) {
    if (mv1[i] === mv2[i]) continue;
    let d = mv1[i] - mv2[i];
    if (d * d === 4) d = -(d >> 1);
    d *= 100;
    if (mv1[i] === aff1) d = Math.floor(d * 1.3);
    if (mv2[i] === aff2) d = Math.floor(d * 1.3);
    score += d * WEIGHTS[i];
  }
  return score / 100;
}

// powerTransfer(score, p1, p2, floor) per R53 pseudocode, verbatim semantics.
// Positive return = amount moving from p2 (loser) to p1 (winner).
function powerTransfer(score, p1, p2, floor) {
  if (score < 0) return -powerTransfer(-score, p2, p1, floor);
  if (score === 0) return 0;
  const ratio = Math.sqrt(Math.min(score / WEIGHT_SUM, 1.0));
  let cp1 = p1, cp2 = p2;
  if (cp2 > 7 * cp1) cp2 = 7 * cp1;
  else if (cp1 > 7 * cp2) cp1 = 7 * cp2;
  let transfer = Math.round(cp2 * Math.pow(ratio, cp2 / cp1));
  if (p2 - transfer < floor) transfer = p2; // floor rule: full drain (R55)
  return transfer;
}

// Sample a 5-move sequence from a per-round mix [pF, pW, pA].
function sampleMoves(mix, rng) {
  const mv = new Array(5);
  for (let i = 0; i < 5; i++) {
    const r = rng();
    mv[i] = r < mix[0] ? 0 : r < mix[0] + mix[1] ? 1 : 2;
  }
  return mv;
}

// Deterministic PRNG (mulberry32) so every quoted number reproduces.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { WEIGHTS, WEIGHT_SUM, roundWinner, duelScore, powerTransfer, sampleMoves, mulberry32 };
