// PvE house exposure (R57): house opponents play the equilibrium mix with a 3% drift
// toward one element chosen per session; rake 5% on player wins only; no floor rule in PvE.
// Question reproduced: does the 3% drift + 5% rake keep house exposure bounded against a
// perfect exploiter (a player who knows the drifted element and best-responds)?
'use strict';
const { duelScore, powerTransfer, sampleMoves, mulberry32 } = require('./r53');
const { eqMix } = require('./skill-evidence');

const EL = ['Fire', 'Water', 'Air'];

function driftMix(eq, e, amt = 0.03) {
  const q = eq.slice();
  q[e] += amt;
  for (let j = 0; j < 3; j++) if (j !== e) q[j] -= amt / 2;
  const s = q.map(x => Math.max(0, x));
  const tot = s[0] + s[1] + s[2];
  return s.map(x => x / tot);
}

// Player p1 vs house p2. Returns player's expected net C per duel after rake.
function pveEV(mixP, mixH, aP, aH, pP, pH, N, seed, rake = 0.05) {
  const rng = mulberry32(seed);
  let net = 0, wins = 0, losses = 0, ties = 0;
  for (let t = 0; t < N; t++) {
    const s = duelScore(sampleMoves(mixP, rng), sampleMoves(mixH, rng), aP, aH);
    const tr = powerTransfer(s, pP, pH, 0); // floor rule absent in PvE (R57)
    if (tr > 0) { net += tr * (1 - rake); wins++; }
    else if (tr < 0) { net += tr; losses++; }
    else ties++;
  }
  return { evPerDuel: net / N, winRate: wins / N, lossRate: losses / N, tieRate: ties / N };
}

const N = 2_000_000;
console.log('PvE exposure, player 100C vs house 150C (T0 hard cap 1.5x entry par, R57), 2e6 duels per cell, 5% rake on wins:');

let worst = null;
for (let aH = 0; aH < 3; aH++) {
  const eq = eqMix(0, aH); // house equilibrium mix given its own affinity (opponent affinity Fire placeholder below)
  for (let drift = 0; drift < 3; drift++) {
    const houseMix = driftMix(eqMix(drift === 0 ? 0 : 0, aH).mix2, drift); // house mix from its matchup solution, drifted
    // exploiter: try each pure counter and each own-affinity choice
    for (let aP = 0; aP < 3; aP++) {
      for (let mv = 0; mv < 3; mv++) {
        const pure = [0, 0, 0]; pure[mv] = 1;
        const r = pveEV(pure, houseMix, aP, aH, 100, 150, 200_000, 7000 + aH * 100 + drift * 10 + aP * 3 + mv);
        if (!worst || r.evPerDuel > worst.r.evPerDuel) worst = { aH, drift, aP, mv, r };
      }
    }
  }
}
// re-run the worst cell at full N for a tight estimate
const houseMix = driftMix(eqMix(0, worst.aH).mix2, worst.drift);
const pure = [0, 0, 0]; pure[worst.mv] = 1;
const tight = pveEV(pure, houseMix, worst.aP, worst.aH, 100, 150, N, 99);
console.log(`  worst cell for the house: house affinity ${EL[worst.aH]}, session drift toward ${EL[worst.drift]},`);
console.log(`  exploiter plays pure ${EL[worst.mv]} with own affinity ${EL[worst.aP]}:`);
console.log(`    player win rate ${(100 * tight.winRate).toFixed(2)}%, loss rate ${(100 * tight.lossRate).toFixed(2)}%, tie ${(100 * tight.tieRate).toFixed(2)}%`);
console.log(`    player EV per duel (net of 5% rake on wins): ${tight.evPerDuel.toFixed(3)}C on a 100C stack (${(tight.evPerDuel).toFixed(3)}% of stack per duel)`);

// baseline: honest equilibrium player, no drift knowledge
const eqP = eqMix(0, 0).mix1;
const base = pveEV(eqP, driftMix(eqMix(0, 0).mix2, 0), 0, 0, 100, 150, N, 101);
console.log(`  baseline equilibrium player vs drifted house: EV per duel ${base.evPerDuel.toFixed(3)}C, win rate ${(100 * base.winRate).toFixed(2)}%`);

// uniform-random player (the R51 comparison population)
const uni = pveEV([1/3,1/3,1/3], driftMix(eqMix(0, 0).mix2, 0), 0, 0, 100, 150, N, 102);
console.log(`  uniform-random player vs drifted house: EV per duel ${uni.evPerDuel.toFixed(3)}C, win rate ${(100 * uni.winRate).toFixed(2)}%`);
