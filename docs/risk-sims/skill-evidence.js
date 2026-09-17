// Skill-evidence pack: equilibrium mixes per affinity matchup (fictitious play on the
// per-round expected-score game), then win rates for uniform-random vs equilibrium vs
// best-exploit policies (AC3 skill-evidence; §7 R52 skill posture).
'use strict';
const { duelScore, sampleMoves, mulberry32 } = require('./r53');

// Per-round payoff for p1 (score units): p1 plays i, p2 plays j, affinities a1, a2.
function roundPayoff(i, j, a1, a2) {
  if (i === j) return 0;
  let d = i - j;
  if (d * d === 4) d = -(d >> 1);
  d *= 100;
  if (i === a1) d = Math.floor(d * 1.3);
  if (j === a2) d = Math.floor(d * 1.3);
  return d; // weight factors scale all rounds identically for mix purposes
}

// Fictitious play for the zero-sum 3x3 game.
function fictitiousPlay(a1, a2, iters = 2_000_000) {
  const c1 = [1, 1, 1], c2 = [1, 1, 1];
  for (let t = 0; t < iters; t++) {
    // best response of p1 to p2's empirical mix
    let b1 = 0, best1 = -Infinity;
    for (let i = 0; i < 3; i++) {
      let v = 0;
      for (let j = 0; j < 3; j++) v += c2[j] * roundPayoff(i, j, a1, a2);
      if (v > best1) { best1 = v; b1 = i; }
    }
    let b2 = 0, best2 = Infinity;
    for (let j = 0; j < 3; j++) {
      let v = 0;
      for (let i = 0; i < 3; i++) v += c1[i] * roundPayoff(i, j, a1, a2);
      if (v < best2) { best2 = v; b2 = j; }
    }
    c1[b1]++; c2[b2]++;
  }
  const s1 = c1[0] + c1[1] + c1[2], s2 = c2[0] + c2[1] + c2[2];
  return { mix1: c1.map(x => x / s1), mix2: c2.map(x => x / s2) };
}

const EL = ['Fire', 'Water', 'Air'];
const eqCache = {};
function eqMix(a1, a2) {
  const k = `${a1},${a2}`;
  if (!eqCache[k]) eqCache[k] = fictitiousPlay(a1, a2);
  return eqCache[k];
}

console.log('Equilibrium mixes (per-round expected-score game, fictitious play, 2e6 iters)');
console.log('own affinity vs opp affinity -> own mix [Fire, Water, Air]');
for (let a1 = 0; a1 < 3; a1++) {
  for (let a2 = 0; a2 < 3; a2++) {
    const { mix1 } = eqMix(a1, a2);
    console.log(`  ${EL[a1].padEnd(5)} vs ${EL[a2].padEnd(5)} -> [${mix1.map(x => x.toFixed(3)).join(', ')}]`);
  }
}

// Monte-Carlo a matchup of two per-round mixes; returns win rates and mean score.
function race(mixA, mixB, a1, a2, N, seed) {
  const rng = mulberry32(seed);
  let wa = 0, wb = 0, ties = 0, sum = 0;
  for (let t = 0; t < N; t++) {
    const s = duelScore(sampleMoves(mixA, rng), sampleMoves(mixB, rng), a1, a2);
    sum += s;
    if (s > 0) wa++; else if (s < 0) wb++; else ties++;
  }
  return { wa: wa / N, wb: wb / N, ties: ties / N, meanScore: sum / N };
}

const UNIFORM = [1 / 3, 1 / 3, 1 / 3];
const N = 2_000_000;

console.log('\nPolicy race, both affinities Fire (symmetric), 2e6 duels per cell:');
const eqFF = eqMix(0, 0).mix1;
let r = race(UNIFORM, eqFF, 0, 0, N, 1);
console.log(`  uniform vs equilibrium : uniform wins ${(100 * r.wa).toFixed(2)}%, eq wins ${(100 * r.wb).toFixed(2)}%, ties ${(100 * r.ties).toFixed(2)}%, mean score ${r.meanScore.toFixed(2)}`);
r = race(eqFF, eqFF, 0, 0, N, 2);
console.log(`  equilibrium vs itself  : A ${(100 * r.wa).toFixed(2)}%, B ${(100 * r.wb).toFixed(2)}%, ties ${(100 * r.ties).toFixed(2)}%, mean score ${r.meanScore.toFixed(2)}`);

// Best exploit vs a LEAKED mix (all-in on the counter of the opponent's most-played element).
function bestPureVs(mixB, a1, a2, N, seed) {
  let best = null;
  for (let i = 0; i < 3; i++) {
    const pure = [0, 0, 0]; pure[i] = 1;
    const res = race(pure, mixB, a1, a2, N, seed + i);
    if (!best || res.wa - res.wb > best.res.wa - best.res.wb) best = { i, res };
  }
  return best;
}
const leaky = [0.5, 0.25, 0.25]; // a 50% Fire-heavy habit
let b = bestPureVs(leaky, 0, 0, N, 10);
console.log(`\n  best-exploit (pure ${EL[b.i]}) vs leaky [0.50,0.25,0.25] Fire-affinity habit: exploiter wins ${(100 * b.res.wa).toFixed(2)}%, loses ${(100 * b.res.wb).toFixed(2)}%, ties ${(100 * b.res.ties).toFixed(2)}%`);
b = bestPureVs(UNIFORM, 0, 0, N, 20);
console.log(`  best-exploit (pure ${EL[b.i]}) vs uniform-random: exploiter wins ${(100 * b.res.wa).toFixed(2)}%, loses ${(100 * b.res.wb).toFixed(2)}%, ties ${(100 * b.res.ties).toFixed(2)}%`);
b = bestPureVs(eqFF, 0, 0, N, 30);
console.log(`  best-exploit (pure ${EL[b.i]}) vs equilibrium: exploiter wins ${(100 * b.res.wa).toFixed(2)}%, loses ${(100 * b.res.wb).toFixed(2)}%, ties ${(100 * b.res.ties).toFixed(2)}% (equilibrium is unexploitable up to sampling error)`);

module.exports = { eqMix, race, roundPayoff };
