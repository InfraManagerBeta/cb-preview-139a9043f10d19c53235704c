// app/tests/cross-check-r53.test.js — A12: the risk-dossier's simulation
// (docs/risk-sims/r53.js) and the shipped engine (app/engine/duel.js) must
// agree, so the dossier's evidence actually attaches to what ships. Cross-
// checks duelScore and powerTransfer across >=10k random cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as r53 from '../../docs/risk-sims/r53.js';
import { duelScore, powerTransfer, roundWinner } from '../engine/duel.js';
import { mulberry32 } from '../engine/rng.js';

const N = 10_000;

test('A12: duelScore agrees with docs/risk-sims/r53.js across 10k random move/affinity cases', () => {
  const rng = mulberry32(2026);
  for (let i = 0; i < N; i++) {
    const mv1 = [0, 0, 0, 0, 0].map(() => Math.floor(rng() * 3));
    const mv2 = [0, 0, 0, 0, 0].map(() => Math.floor(rng() * 3));
    const aff1 = Math.floor(rng() * 3);
    const aff2 = Math.floor(rng() * 3);
    const shipped = duelScore(mv1, mv2, aff1, aff2);
    const dossier = r53.duelScore(mv1, mv2, aff1, aff2);
    assert.equal(shipped, dossier, `mismatch at case ${i}: mv1=${mv1} mv2=${mv2} aff1=${aff1} aff2=${aff2}`);
  }
});

test('A12: powerTransfer agrees with docs/risk-sims/r53.js across 10k random score/stake/floor cases (both sides strictly positive stake -- the A1 zero-stake guard is a deliberate, documented shipped-engine-only fix, not a cross-check discrepancy)', () => {
  const rng = mulberry32(4242);
  for (let i = 0; i < N; i++) {
    const score = Math.round((rng() * 848) - 424); // roughly the real duelScore range
    const p1 = 1 + Math.floor(rng() * 1_000_000);
    const p2 = 1 + Math.floor(rng() * 1_000_000);
    const floor = Math.floor(rng() * Math.min(p1, p2));
    const shipped = powerTransfer(score, p1, p2, floor);
    const dossier = r53.powerTransfer(score, p1, p2, floor);
    assert.equal(shipped, dossier, `mismatch at case ${i}: score=${score} p1=${p1} p2=${p2} floor=${floor}`);
  }
});

test('A12: roundWinner agrees with docs/risk-sims/r53.js for all 9 move pairs', () => {
  for (let m1 = 0; m1 < 3; m1++) {
    for (let m2 = 0; m2 < 3; m2++) {
      assert.equal(roundWinner(m1, m2), r53.roundWinner(m1, m2), `mismatch at (${m1},${m2})`);
    }
  }
});
