// Exact equilibrium of the WIN game (AC3 skill-evidence, complement to skill-evidence.js).
// A duel between fixed 5-move sequences is deterministic (R53), so the duel is a finite
// zero-sum game over 243 pure sequences per side. Payoff = sign(duelScore). We solve it by
// fictitious play on the full 243x243 matrix and measure exploitability of the result.
'use strict';
const { duelScore } = require('./r53');

function seqOf(n) { const s = new Array(5); for (let i = 0; i < 5; i++) { s[i] = n % 3; n = (n / 3) | 0; } return s; }

function solveWinGame(a1, a2, iters = 4_000_000) {
  const S = 243;
  const seqs = []; for (let n = 0; n < S; n++) seqs.push(seqOf(n));
  // payoff[i][j] = sign of score for p1 (a1) playing seqs[i] vs p2 (a2) playing seqs[j]
  const pay = new Array(S);
  for (let i = 0; i < S; i++) {
    pay[i] = new Int8Array(S);
    for (let j = 0; j < S; j++) pay[i][j] = Math.sign(duelScore(seqs[i], seqs[j], a1, a2));
  }
  const c1 = new Float64Array(S).fill(1), c2 = new Float64Array(S).fill(1);
  const v1 = new Float64Array(S), v2 = new Float64Array(S); // running payoff sums
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) { v1[i] += pay[i][j]; v2[j] += pay[i][j]; }
  for (let t = 0; t < iters; t++) {
    let b1 = 0; for (let i = 1; i < S; i++) if (v1[i] > v1[b1]) b1 = i;
    let b2 = 0; for (let j = 1; j < S; j++) if (v2[j] < v2[b2]) b2 = j;
    c1[b1]++; c2[b2]++;
    for (let i = 0; i < S; i++) v1[i] += pay[i][b2];
    for (let j = 0; j < S; j++) v2[j] += pay[b1][j];
  }
  const t1 = c1.reduce((a, b) => a + b, 0), t2 = c2.reduce((a, b) => a + b, 0);
  const mix1 = Array.from(c1, x => x / t1), mix2 = Array.from(c2, x => x / t2);
  // exploitability: best pure response value against each mix
  let bestVs2 = -Infinity, bestVs2i = 0;
  for (let i = 0; i < S; i++) { let v = 0; for (let j = 0; j < S; j++) v += mix2[j] * pay[i][j]; if (v > bestVs2) { bestVs2 = v; bestVs2i = i; } }
  let bestVs1 = Infinity;
  for (let j = 0; j < S; j++) { let v = 0; for (let i = 0; i < S; i++) v += mix1[i] * pay[i][j]; if (v < bestVs1) bestVs1 = v; }
  // per-round marginals of mix1
  const marg = [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]];
  for (let n = 0; n < S; n++) { const s = seqs[n]; for (let r = 0; r < 5; r++) marg[r][s[r]] += mix1[n]; }
  return { mix1, mix2, bestVs2, bestVs1, bestVs2i, marg, pay, seqs };
}

const EL = ['Fire', 'Water', 'Air'];
for (const [a1, a2, label] of [[0, 0, 'Fire vs Fire'], [0, 1, 'Fire vs Water']]) {
  const g = solveWinGame(a1, a2);
  console.log(`WIN-game equilibrium, affinities ${label} (4e6 fictitious-play iters over 243x243):`);
  console.log(`  exploitability of solved mix: best pure response earns ${(100 * g.bestVs2).toFixed(2)} net win-pts per 100 duels (0 = exact equilibrium)`);
  console.log(`  guaranteed value of solved mix: >= ${(100 * g.bestVs1).toFixed(2)} net win-pts per 100 duels for the opponent's best response`);
  console.log('  per-round marginals of the solved mix [Fire, Water, Air]:');
  g.marg.forEach((m, r) => console.log(`    round ${r + 1} (weight ${[78,79,81,86,100][r]}): [${m.map(x => x.toFixed(3)).join(', ')}]`));
  // how the naive policies fare against it
  const uni = new Array(243).fill(1 / 243);
  let vUni = 0; for (let i = 0; i < 243; i++) for (let j = 0; j < 243; j++) vUni += uni[i] * g.mix2[j] * g.pay[i][j];
  console.log(`  uniform-random vs solved mix: net ${(100 * vUni).toFixed(2)} win-pts per 100 duels`);
  console.log('');
}
