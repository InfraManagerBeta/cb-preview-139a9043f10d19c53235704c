// app/engine/duel.js
// The duel — R53/R54, verbatim to the PRD's pseudocode. Pure functions only;
// no I/O, importable from the browser or from Node.

export const ELEMENTS = Object.freeze({ FIRE: 0, WATER: 1, AIR: 2 });
export const ELEMENT_NAMES = Object.freeze(['fire', 'water', 'air']);

export function elementIndex(name) {
  const i = ELEMENT_NAMES.indexOf(String(name).toLowerCase());
  if (i === -1) throw new Error(`unknown element: ${name}`);
  return i;
}

/**
 * roundWinner(m1, m2): if m1 == m2 -> 0; d = m1 - m2; if d*d == 4 -> d = -(d >> 1); return sign(d)
 * Returns 1 if m1 wins the round, -1 if m2 wins, 0 on a draw.
 */
export function roundWinner(m1, m2) {
  if (m1 === m2) return 0;
  let d = m1 - m2;
  if (d * d === 4) d = -(d >> 1);
  return Math.sign(d);
}

/**
 * duelScore(mv1, mv2, aff1, aff2) — R53 verbatim.
 * mv1, mv2: arrays of 5 elements (0/1/2), one per round.
 * aff1, aff2: each character's affinity element (0/1/2).
 * Returns a float score; positive favors character 1, negative favors character 2.
 */
export function duelScore(mv1, mv2, aff1, aff2) {
  const WEIGHTS = [78, 79, 81, 86, 100];
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

/**
 * powerTransfer(score, p1, p2, floor) — R53 verbatim, including the 7x clamp,
 * the ratio^(cp2/cp1) transfer, and the floor full-drain rule.
 * Returns a signed transfer: positive = from p2 to p1, negative = from p1 to p2.
 */
export function powerTransfer(score, p1, p2, floor) {
  if (score < 0) return -powerTransfer(-score, p2, p1, floor);
  if (score === 0) return 0;
  // A1: a zero-(or-negative-)stake side has nothing to transfer either way.
  // Without this guard the 7x clamp below can drive BOTH cp1 and cp2 to 0
  // (e.g. powerTransfer(424, 100, 0, 50): cp1>7*cp2 clamps cp1 to 0 too),
  // making the exponent cp2/cp1 = Infinity and Math.pow(1, Infinity) is NaN
  // by spec -- the reported bug. Guard before any of that math runs.
  if (p1 <= 0 || p2 <= 0) return 0;
  const ratio = Math.sqrt(Math.min(score / 424, 1.0));
  let cp1 = p1, cp2 = p2;
  if (cp2 > 7 * cp1) cp2 = 7 * cp1;
  else if (cp1 > 7 * cp2) cp1 = 7 * cp2;
  const exponent = cp1 === 0 ? Infinity : cp2 / cp1;
  let transfer = Math.round(cp2 * Math.pow(ratio, exponent));
  if (p2 - transfer < floor) transfer = p2; // floor rule: full drain
  return transfer;
}

/**
 * Deterministic coin flip helper. Callers supply a random() in [0,1) —
 * default Math.random, but tests/simulations can inject a seeded RNG so
 * "provably fair" is reproducible.
 */
export function coinFlip(random = Math.random) {
  return random() < 0.5 ? 1 : -1; // 1 => player1 advances, -1 => player2 advances
}

// ---- C22/R54: provably-fair commit-reveal coin flip ------------------------
// The bare `Math.random()` coin flip above cannot be verified after the
// fact. The fix is a commit-reveal scheme:
//   1. BEFORE the flip is used to decide anything, a random seed is
//      generated and its SHA-256 commitment is recorded (the ledger/event
//      "commit" -- see Game#resolveMatch, which appends COIN_FLIP_COMMITTED
//      before ever calling resolveDuel with the seed).
//   2. The flip itself is `deterministicFlipFromSeed(seed)` -- a PURE
//      function of the seed alone. Anyone holding the seed recomputes the
//      exact same flip, every time.
//   3. AFTER the flip, the seed is revealed (carried on the DUEL_RESOLVED
//      event's payload alongside the commitment) so a verifier can
//      recompute sha256(seed) and check it against the earlier commitment
//      (proves the seed wasn't changed after it was locked in) and
//      recompute the flip from the seed (proves the flip wasn't picked
//      after seeing the seed).
//
// The commitment hash is plain SHA-256 -- computed here with a small,
// dependency-free, SYNCHRONOUS implementation so resolveDuel (called
// throughout the engine and every existing test, synchronously) does not
// need to become async just to flip one coin. The one-tap "re-verify"
// surface in the UI (app/ui/screens/duel.js) independently recomputes the
// same SHA-256 using the browser's real Web Crypto (`crypto.subtle.digest`)
// -- both are the same standard algorithm, so they agree byte-for-byte.

const SHA256_K = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256, hex-encoded. Pure/synchronous -- see the note above on why this
 * isn't Web Crypto's (async-only) `crypto.subtle.digest`. */
export function sha256Hex(message) {
  let H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bytes = new TextEncoder().encode(String(message));
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(chunk + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H).map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** Generate a fresh flip seed (32 hex chars) from the injectable random(). */
export function generateFlipSeed(random = Math.random) {
  let seed = '';
  for (let i = 0; i < 32; i++) seed += Math.floor(random() * 16).toString(16);
  return seed;
}

/** The flip: a pure, deterministic function of the revealed seed alone --
 * anyone can recompute this once the seed is revealed (R54 "provably fair"). */
export function deterministicFlipFromSeed(seed) {
  const digest = sha256Hex(seed);
  return parseInt(digest[0], 16) % 2 === 0 ? 1 : -1;
}

/**
 * f6/crucial-1: BIG/CRITICAL round tagging is a pure function of the
 * round's own result + affinity flags -- shared here (rather than inlined
 * once in resolveDuel below) so game.js's ledger-reconstruction path
 * (Game#_reconstructResolveMatchFromLedger, which persists only move1/
 * move2/result/p1Affinity/p2Affinity per round, not `tag`) can recompute
 * the EXACT SAME tag a live resolveDuel call would have produced, instead
 * of a second, potentially-diverging inline copy of this rule.
 */
export function deriveRoundTag(result, p1Affinity, p2Affinity) {
  if (result === 'DRAW') return null;
  if (p1Affinity && p2Affinity) return 'CRITICAL';
  if (p1Affinity || p2Affinity) return 'BIG';
  return null;
}

/**
 * Presentational reorientation: resolveDuel's outcome is always reported
 * from mv1/aff1/p1's ("seat A") perspective. When the seat you want to show
 * a result card for was seat B, flip everything so `outcome.won` etc. read
 * from THAT seat's own perspective instead. Pure/no side effects.
 */
export function reorientOutcome(outcome, isSeatA) {
  if (isSeatA) return outcome;
  const flip = (r) => (r === 'WIN' ? 'LOSS' : r === 'LOSS' ? 'WIN' : 'DRAW');
  return {
    ...outcome,
    // f7/N1: a legacy (pre-f6) reconstructed outcome carries `rounds: null`
    // (game.js#hydrateRoundsFromLedger found no per-round record to expand
    // -- see its header comment) -- reorienting a per-round array that
    // doesn't exist is meaningless, so pass the absence straight through
    // instead of throwing on `.map` of null. Every OTHER field below still
    // flips exactly as before; only the round-by-round detail is affected.
    rounds: outcome.rounds ? outcome.rounds.map((r) => ({
      ...r,
      move1: r.move2,
      move2: r.move1,
      p1Affinity: r.p2Affinity,
      p2Affinity: r.p1Affinity,
      result: flip(r.result),
    })) : null,
    won: outcome.lost,
    lost: outcome.won,
    winner: outcome.trueTie ? outcome.winner : -outcome.winner,
    coinFlipWinner: outcome.coinFlipWinner == null ? null : -outcome.coinFlipWinner,
    transfer: -outcome.transfer,
  };
}

/**
 * Full duel resolution: round-by-round outcomes, the R53/R54 score and
 * transfer, the true-tie coin flip, and per-round affinity/BIG/CRITICAL tags
 * (R77) used by both the result card and the R72 narrator data shape.
 *
 * @param {object} args
 * @param {number[]} args.mv1 five moves for character 1
 * @param {number[]} args.mv2 five moves for character 2
 * @param {number} args.aff1 character 1's affinity element
 * @param {number} args.aff2 character 2's affinity element
 * @param {number} args.p1 character 1's pre-duel stake
 * @param {number} args.p2 character 2's pre-duel stake
 * @param {number} args.floor the bracket tier's floor
 * @param {function} [args.random] injectable RNG for the true-tie coin flip
 * @param {string} [args.flipSeed] C22: when provided, a true tie resolves via
 *   the deterministic, provably-fair commit-reveal flip (deterministicFlipFromSeed)
 *   instead of the legacy bare coinFlip(random). Callers (Game#resolveMatch)
 *   commit sha256(flipSeed) to the ledger BEFORE passing it in here.
 */
export function resolveDuel({ mv1, mv2, aff1, aff2, p1, p2, floor, random = Math.random, flipSeed = null }) {
  if (mv1.length !== 5 || mv2.length !== 5) throw new Error('resolveDuel: exactly 5 moves per side');

  const rounds = [];
  let won = 0, lost = 0, draws = 0;
  for (let i = 0; i < 5; i++) {
    const w = roundWinner(mv1[i], mv2[i]);
    const p1Affinity = mv1[i] === aff1;
    const p2Affinity = mv2[i] === aff2;
    let result;
    if (w === 1) { won++; result = 'WIN'; }
    else if (w === -1) { lost++; result = 'LOSS'; }
    else { draws++; result = 'DRAW'; }

    const tag = deriveRoundTag(result, p1Affinity, p2Affinity);
    rounds.push({
      round: i + 1,
      move1: ELEMENT_NAMES[mv1[i]],
      move2: ELEMENT_NAMES[mv2[i]],
      result, // from character 1's perspective: WIN / LOSS / DRAW
      p1Affinity,
      p2Affinity,
      tag, // null | 'BIG' | 'CRITICAL'
    });
  }

  const score = duelScore(mv1, mv2, aff1, aff2);
  const trueTie = score === 0;
  let transfer = 0;
  let coinFlipWinner = null; // 1 | -1, only set on a true tie
  let coinFlip_ = null; // C22: { seed, commitment } when the seed-based flip was used
  if (trueTie) {
    if (flipSeed != null) {
      coinFlipWinner = deterministicFlipFromSeed(flipSeed);
      coinFlip_ = { seed: flipSeed, commitment: sha256Hex(flipSeed) };
    } else {
      coinFlipWinner = coinFlip(random); // legacy path -- no seed supplied
    }
  } else {
    transfer = powerTransfer(score, p1, p2, floor);
  }

  // winner: 1 => character 1 advances/wins the duel, -1 => character 2 does.
  let winner;
  if (trueTie) winner = coinFlipWinner;
  else winner = score > 0 ? 1 : -1;

  // The floor rule forces transfer === the loser's full pre-duel stake,
  // leaving them at exactly 0. Detect that condition directly rather than
  // re-deriving the internal ratio math.
  const loserStakeBefore = winner === 1 ? p2 : p1;
  const transferMagnitude = Math.abs(transfer);
  const floorDrain = !trueTie && loserStakeBefore > 0 && loserStakeBefore - transferMagnitude === 0;

  const bigCount = rounds.filter((r) => r.tag === 'BIG').length;
  const criticalCount = rounds.filter((r) => r.tag === 'CRITICAL').length;
  // f5/crucial-4 fix (pre-existing bug): R73's static bypass is for "both
  // characters commit the IDENTICAL ELEMENT all five rounds" -- i.e. mv1
  // and mv2 are both the SAME ONE element for all five rounds (a true
  // all-Fire-vs-all-Fire duel, say). The old check --
  // `mv1.every((m, i) => m === mv2[i])` -- only tests ROUND-BY-ROUND
  // matching (each round's two moves agree with EACH OTHER that round),
  // which is also true of a mixed-but-matched sequence like
  // fire,water,air,fire,water vs fire,water,air,fire,water -- five
  // different elements, never the SAME one all five rounds -- which wrongly
  // fired the bypass (whose [ELEMENT]/[EEEEE] substitution then names
  // whichever round-0 element happened to be first, a factually false
  // "both committed to [ELEMENT] all five rounds" claim for a duel that
  // never did). Fixed: mv1 must itself be constant (the same element every
  // round), AND mv2 must match that same constant round-by-round -- so
  // both sides commit the identical SINGLE element for all five rounds.
  // A mixed matched sequence now correctly falls through to the normal
  // (non-bypass) narration/tie path instead.
  const identicalAllFive = mv1.every((m) => m === mv1[0]) && mv2.every((m, i) => m === mv1[i]);
  // Coup de grâce: only one round in the whole duel was decisive (four draws,
  // one winner) — "four rounds produced nothing, one round produced everything".
  const coupDeGrace = draws === 4 && (won === 1 || lost === 1);
  // Upset: the lower-stake side (the presumed underdog) wins the duel.
  const upset = !trueTie && ((winner === 1 && p1 < p2) || (winner === -1 && p2 < p1));

  return {
    rounds,
    won, lost, draws,
    score,
    trueTie,
    coinFlipWinner,
    coinFlip: coinFlip_,
    transfer, // signed: + means p2 -> p1
    winner, // 1 or -1
    floorDrain,
    bigCount,
    criticalCount,
    identicalAllFive,
    coupDeGrace,
    upset,
  };
}
