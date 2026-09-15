// app/engine/rng.js
// A small seedable PRNG (mulberry32) so simulations, drift, and NPC decisions
// can be made reproducible in tests while defaulting to real randomness
// (Math.random) at runtime everywhere the engine doesn't need reproducibility.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  return typeof seed === 'number' ? mulberry32(seed) : Math.random;
}

/** Weighted pick from a {key: weight} distribution using an injected random(). */
export function weightedChoice(distribution, random = Math.random) {
  const entries = Object.entries(distribution);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = random() * total;
  for (const [key, w] of entries) {
    if (r < w) return key;
    r -= w;
  }
  return entries[entries.length - 1][0];
}

export function randInt(min, max, random = Math.random) {
  return Math.floor(random() * (max - min + 1)) + min;
}

export function randFloat(min, max, random = Math.random) {
  return random() * (max - min) + min;
}
