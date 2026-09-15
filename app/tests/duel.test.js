// app/tests/duel.test.js — R53 pseudocode, pinned against hand-computed vectors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { roundWinner, duelScore, powerTransfer, resolveDuel, reorientOutcome, ELEMENTS, sha256Hex, generateFlipSeed, deterministicFlipFromSeed } from '../engine/duel.js';

test('roundWinner: cyclic dominance Fire > Air > Water > Fire', () => {
  assert.equal(roundWinner(ELEMENTS.FIRE, ELEMENTS.AIR), 1);
  assert.equal(roundWinner(ELEMENTS.AIR, ELEMENTS.FIRE), -1);
  assert.equal(roundWinner(ELEMENTS.AIR, ELEMENTS.WATER), 1);
  assert.equal(roundWinner(ELEMENTS.WATER, ELEMENTS.AIR), -1);
  assert.equal(roundWinner(ELEMENTS.WATER, ELEMENTS.FIRE), 1);
  assert.equal(roundWinner(ELEMENTS.FIRE, ELEMENTS.WATER), -1);
});

test('roundWinner: draws on identical moves', () => {
  for (const m of [0, 1, 2]) assert.equal(roundWinner(m, m), 0);
});

test('duelScore: hand-computed vector — all-fire vs all-air, no affinity', () => {
  const mv1 = [0, 0, 0, 0, 0];
  const mv2 = [2, 2, 2, 2, 2];
  // Every round: d = 0-2=-2, d*d=4, d=-(d>>1)=1, *100=100, *WEIGHTS[i], sum/100
  // WEIGHTS sum = 424, so score = 424*100/100 = 424
  assert.equal(duelScore(mv1, mv2, 9, 9), 424);
});

test('duelScore: hand-computed vector — with affinity multiplier on rounds matching character 1\'s element', () => {
  const mv1 = [0, 1, 2, 0, 1]; // fire, water, air, fire, water
  const mv2 = [2, 0, 1, 2, 0]; // air,  fire,  water, air, fire
  // Every round is won by mv1 under the cyclic table (fire>air, water>fire,
  // air>water), each by the smallest step (d=+1 after the R53 transform), so
  // with no affinity the score is the full weight sum: 424.
  assert.equal(duelScore(mv1, mv2, 9, 9), 424);
  // With character 1's affinity set to fire, BOTH rounds where mv1 plays
  // fire (round 1 and round 4 — mv1 = [0,1,2,0,1]) get the 1.3x multiplier;
  // the other three rounds (2,3,5) are unmodified.
  const WEIGHTS = [78, 79, 81, 86, 100];
  const boosted = (i) => Math.floor(100 * 1.3) * WEIGHTS[i];
  const plain = (i) => 100 * WEIGHTS[i];
  const expected = (boosted(0) + plain(1) + plain(2) + boosted(3) + plain(4)) / 100;
  assert.equal(expected, 473.2);
  assert.equal(duelScore(mv1, mv2, 0, 9), expected);
});

test('duelScore: draws contribute nothing', () => {
  assert.equal(duelScore([0, 1, 2, 0, 1], [0, 1, 2, 0, 1], 9, 9), 0);
});

test('powerTransfer: full-score (424) equal stakes drains loser to floor exactly (100 == 100)', () => {
  // ratio = sqrt(424/424) = 1; cp1=cp2=100 (no clamp needed); transfer = round(100 * 1^(1)) = 100
  assert.equal(powerTransfer(424, 100, 100, 50), 100);
});

test('powerTransfer: 7x cap clamps the stronger side', () => {
  // p1=1000, p2=100: cp2>7*cp1? 100>7000 no. cp1>7*cp2? 1000>700 yes -> cp1=700.
  // ratio = sqrt(212/424)=sqrt(0.5); transfer=round(100*ratio^(100/700))
  const score = 212;
  const ratio = Math.sqrt(0.5);
  const expected = Math.round(100 * Math.pow(ratio, 100 / 700));
  assert.equal(powerTransfer(score, 1000, 100, 1), expected);
});

test('powerTransfer: floor rule forces a full drain', () => {
  // p2=60, floor=50: any transfer that would leave p2 under 50 drains it to 0.
  const t = powerTransfer(424, 100, 60, 50);
  assert.equal(t, 60);
});

test('powerTransfer: negative score negates and swaps p1/p2 symmetrically', () => {
  const pos = powerTransfer(300, 100, 80, 10);
  const neg = powerTransfer(-300, 80, 100, 10);
  assert.equal(neg, -pos);
});

test('powerTransfer: zero score transfers nothing', () => {
  assert.equal(powerTransfer(0, 100, 100, 10), 0);
});

test('resolveDuel: true tie on identical move sequences (score 0) flips a coin, transfers nothing', () => {
  const out = resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [0, 1, 2, 0, 1], aff1: 9, aff2: 9, p1: 100, p2: 100, floor: 10, random: () => 0.1 });
  assert.equal(out.trueTie, true);
  assert.equal(out.transfer, 0);
  assert.equal(out.coinFlipWinner, 1); // random()=0.1 < 0.5 -> 1
});

test('resolveDuel: BIG tag when exactly one side plays its affinity in a decisive round', () => {
  const out = resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [2, 0, 1, 2, 0], aff1: 0, aff2: 9, p1: 100, p2: 100, floor: 10 });
  assert.equal(out.rounds[0].tag, 'BIG');
});

test('resolveDuel: CRITICAL tag when both sides play affinity in the same decisive round', () => {
  const out = resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [2, 0, 1, 2, 0], aff1: 0, aff2: 2, p1: 100, p2: 100, floor: 10 });
  assert.equal(out.rounds[0].tag, 'CRITICAL');
});

test('resolveDuel: transfer never exceeds the loser pre-duel stake', () => {
  const random = () => 0.42;
  for (let trial = 0; trial < 200; trial++) {
    const mv1 = [0, 1, 2, 0, 1].map((_, i) => (i + trial) % 3);
    const mv2 = [2, 0, 1, 2, 0].map((_, i) => (i + trial * 2) % 3);
    const p1 = 10 + (trial % 50) * 7;
    const p2 = 10 + (trial % 37) * 11;
    const out = resolveDuel({ mv1, mv2, aff1: trial % 3, aff2: (trial + 1) % 3, p1, p2, floor: 10, random });
    const loserStake = out.winner === 1 ? p2 : p1;
    assert.ok(Math.abs(out.transfer) <= loserStake, `transfer ${out.transfer} exceeded loser stake ${loserStake}`);
  }
});

test('reorientOutcome: flips won/lost/winner/transfer/rounds for the seat-B perspective', () => {
  const out = resolveDuel({ mv1: [0, 1, 2, 0, 1], mv2: [2, 0, 1, 2, 0], aff1: 0, aff2: 9, p1: 100, p2: 100, floor: 10 });
  const flipped = reorientOutcome(out, false);
  assert.equal(flipped.won, out.lost);
  assert.equal(flipped.lost, out.won);
  assert.equal(flipped.winner, -out.winner);
  assert.equal(flipped.transfer, -out.transfer);
  assert.equal(flipped.rounds[0].move1, out.rounds[0].move2);
  assert.equal(flipped.rounds[0].result, out.rounds[0].result === 'WIN' ? 'LOSS' : out.rounds[0].result === 'LOSS' ? 'WIN' : 'DRAW');
  const identity = reorientOutcome(out, true);
  assert.equal(identity, out);
});

// ---- A1: powerTransfer must never produce NaN on a zero-stake side --------
test('A1: powerTransfer(424, 100, 0, 50) does not produce NaN (the reported boundary case)', () => {
  const t = powerTransfer(424, 100, 0, 50);
  assert.equal(Number.isNaN(t), false);
  assert.equal(t, 0); // nothing to transfer -- the loser side already holds 0
});

test('A1: powerTransfer boundary — either side at (or below) zero stake transfers nothing, never NaN', () => {
  assert.equal(powerTransfer(424, 0, 100, 50), 0); // zero-stake winner
  assert.ok(powerTransfer(-424, 100, 0, 50) === 0); // negative-score branch negates/swaps (may be -0, that's fine)
  assert.equal(powerTransfer(212, 0, 0, 50), 0); // both sides zero
  assert.equal(Number.isNaN(powerTransfer(424, 100, 0, 50)), false);
});

// ---- C22: provably-fair commit-reveal coin flip ----------------------------
test('C22: sha256Hex matches known SHA-256 test vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('C22: sha256Hex agrees byte-for-byte with Node\'s (and the browser\'s Web-Crypto-backed) SHA-256, across random inputs', () => {
  for (let i = 0; i < 200; i++) {
    const msg = `seed-${i}-${'x'.repeat(i % 40)}`;
    const expected = crypto.createHash('sha256').update(msg).digest('hex');
    assert.equal(sha256Hex(msg), expected, `mismatch for "${msg}"`);
  }
});

test('C22: generateFlipSeed is deterministic given the same injected random() sequence', () => {
  const seq = [0.1, 0.2, 0.3, 0.9, 0.05, 0.42, 0.77, 0.11, 0.33, 0.66];
  const makeRandom = () => { let i = 0; return () => seq[i++ % seq.length]; };
  const a = generateFlipSeed(makeRandom());
  const b = generateFlipSeed(makeRandom());
  assert.equal(a, b);
  assert.equal(a.length, 32);
});

test('C22: deterministicFlipFromSeed is a pure function of the seed (recompute matches)', () => {
  const seed = generateFlipSeed(() => 0.314159);
  const flip1 = deterministicFlipFromSeed(seed);
  const flip2 = deterministicFlipFromSeed(seed);
  assert.equal(flip1, flip2);
  assert.ok(flip1 === 1 || flip1 === -1);
});

test('C22: a tampered seed is detected -- its commitment no longer matches', () => {
  const seed = generateFlipSeed(() => 0.5);
  const commitment = sha256Hex(seed);
  const tampered = seed.slice(0, -1) + (seed.slice(-1) === '0' ? '1' : '0');
  assert.notEqual(sha256Hex(tampered), commitment);
});

test('C22: resolveDuel with flipSeed uses the deterministic commit-reveal flip and records {seed, commitment}; commitment recomputes from the seed', () => {
  const mv = [0, 1, 2, 0, 1];
  const seed = generateFlipSeed(() => 0.777);
  const out = resolveDuel({ mv1: mv, mv2: mv, aff1: 9, aff2: 9, p1: 100, p2: 100, floor: 10, flipSeed: seed });
  assert.equal(out.trueTie, true);
  assert.ok(out.coinFlip);
  assert.equal(out.coinFlip.seed, seed);
  assert.equal(out.coinFlip.commitment, sha256Hex(seed));
  assert.equal(out.coinFlipWinner, deterministicFlipFromSeed(seed));
});

test('C22: resolveDuel without flipSeed keeps the legacy random-based flip (back-compat, existing behavior unchanged)', () => {
  const mv = [0, 1, 2, 0, 1];
  const out = resolveDuel({ mv1: mv, mv2: mv, aff1: 9, aff2: 9, p1: 100, p2: 100, floor: 10, random: () => 0.1 });
  assert.equal(out.trueTie, true);
  assert.equal(out.coinFlip, null);
  assert.equal(out.coinFlipWinner, 1); // random()=0.1 < 0.5 -> 1, same as before this fix
});
