// Property checks on the R53/R54/R55 math (model-side runs of invariants 1, 4, 5 of R86)
// plus the two mechanics tables quoted in docs/risk-dossier.md:
//   (a) T0 zero-out rate for equal 100C stacks at floor 50C (PRD R55 says ~57% intended);
//   (b) the 7x clamp / exponent asymmetry table for mismatched stacks.
'use strict';
const { duelScore, powerTransfer, sampleMoves, mulberry32, WEIGHT_SUM } = require('./r53');

const rng = mulberry32(424);
const UNIFORM = [1 / 3, 1 / 3, 1 / 3];

// ---- Invariant-style property sweep (1e6 random duels) ----
let n = 0, maxTransferViolation = 0, zeroScoreTransfers = 0, negLoserStake = 0;
for (let t = 0; t < 1_000_000; t++) {
  const a1 = Math.floor(rng() * 3), a2 = Math.floor(rng() * 3);
  const p1 = 50 + Math.floor(rng() * 2000), p2 = 50 + Math.floor(rng() * 2000);
  const floor = 50;
  const s = duelScore(sampleMoves(UNIFORM, rng), sampleMoves(UNIFORM, rng), a1, a2);
  const tr = powerTransfer(s, p1, p2, floor);
  n++;
  if (s === 0 && tr !== 0) zeroScoreTransfers++;
  if (tr > 0 && tr > p2) maxTransferViolation++;          // winner p1: transfer from p2
  if (tr < 0 && -tr > p1) maxTransferViolation++;         // winner p2: transfer from p1
  if (tr > 0 && p2 - tr < 0) negLoserStake++;
  if (tr < 0 && p1 + tr < 0) negLoserStake++;
}
console.log(`[P1/P5] duels checked: ${n}`);
console.log(`[P1] transfer > loser pre-duel stake: ${maxTransferViolation} (must be 0)`);
console.log(`[P1] loser stake driven negative: ${negLoserStake} (must be 0)`);
console.log(`[P5] zero score with nonzero transfer: ${zeroScoreTransfers} (must be 0)`);

// ---- Invariant 4: win rate independent of stake ----
let winsBig = 0, decisive = 0;
const rng2 = mulberry32(86);
for (let t = 0; t < 1_000_000; t++) {
  const a1 = Math.floor(rng2() * 3), a2 = Math.floor(rng2() * 3);
  const s = duelScore(sampleMoves(UNIFORM, rng2), sampleMoves(UNIFORM, rng2), a1, a2);
  if (s !== 0) { decisive++; if (s > 0) winsBig++; } // "p1" is the high-stake side by construction
}
console.log(`[P4] high-stake-side win rate over ${decisive} decisive duels: ${(100 * winsBig / decisive).toFixed(3)}% (expect 50% +/- sampling error; stake never enters duelScore)`);

// ---- (a) T0 zero-out rate, equal 100C stacks, floor 50C ----
const rng3 = mulberry32(55);
let zeroOuts = 0, decided = 0, ties = 0;
for (let t = 0; t < 1_000_000; t++) {
  const a1 = Math.floor(rng3() * 3), a2 = Math.floor(rng3() * 3);
  const s = duelScore(sampleMoves(UNIFORM, rng3), sampleMoves(UNIFORM, rng3), a1, a2);
  if (s === 0) { ties++; continue; }
  decided++;
  const tr = powerTransfer(s, 100, 100, 50);
  const loserAfter = 100 - Math.abs(tr);
  if (loserAfter === 0) zeroOuts++;
}
console.log(`[R55] T0 equal 100C stacks, floor 50C, uniform-random play: zero-out on ${(100 * zeroOuts / decided).toFixed(1)}% of decided duels (ties ${(100 * ties / 1e6).toFixed(1)}%; PRD R55 states ~57% intended)`);

// ---- (b) 7x clamp / exponent asymmetry table ----
console.log('\n[R53] transfer table (winner stake vs loser stake, floor 0 to isolate the formula):');
console.log('score/424=0.25 (ratio 0.5) and score/424=1.0 (ratio 1.0)');
console.log('p_winner p_loser | tr@r=0.5 (%loser) | tr@r=1.0 (%loser)');
for (const [pw, pl] of [[100, 100], [100, 700], [100, 1000], [100, 5000], [700, 100], [1000, 100], [5000, 100]]) {
  const t1 = powerTransfer(106, pw, pl, 0);   // score 106 -> ratio 0.5
  const t2 = powerTransfer(424, pw, pl, 0);   // score 424 -> ratio 1.0
  console.log(`${String(pw).padStart(8)} ${String(pl).padStart(7)} | ${String(t1).padStart(9)} (${(100 * t1 / pl).toFixed(1)}%) | ${String(t2).padStart(9)} (${(100 * t2 / pl).toFixed(1)}%)`);
}
