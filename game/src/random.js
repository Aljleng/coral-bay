// A small seeded random number generator (mulberry32): the same seed gives the same game,
// which is what makes the screenshot scenes repeatable. Every helper takes the rng
// function FIRST and the data second — pick(rng, arr), never pick(arr, rng).

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One element of arr, chosen uniformly. rng first, array second. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** A new array with arr's elements in shuffled order (Fisher-Yates). The input is untouched. */
export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** A float in [min, max). rng first, bounds second. */
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

/** An integer in [min, max] inclusive. rng first, bounds second. */
export function int(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** True with probability p (0..1). rng first, probability second. */
export function chance(rng, p) {
  return rng() < p;
}
