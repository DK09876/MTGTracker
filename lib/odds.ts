/**
 * Drawing odds, for "how often does this deck open with 2-4 lands?".
 *
 * Hypergeometric: drawing `draws` cards from `deck` without replacement,
 * where `hits` of them count. Numbers here are tiny (a 99-card library), so
 * plain floating point is exact enough.
 */

/** n choose k. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) result = (result * (n - Math.min(k, n - k) + i)) / i;
  return result;
}

/** Chance of exactly `k` hits in `draws` cards. */
export function exactly(deck: number, hits: number, draws: number, k: number): number {
  return (choose(hits, k) * choose(deck - hits, draws - k)) / choose(deck, draws);
}

/** Chance of each hit count 0..draws. */
export function distribution(deck: number, hits: number, draws: number): number[] {
  return Array.from({ length: draws + 1 }, (_, k) => exactly(deck, hits, draws, k));
}

/** Chance of at least `k` hits. */
export function atLeast(deck: number, hits: number, draws: number, k: number): number {
  let p = 0;
  for (let i = k; i <= draws; i++) p += exactly(deck, hits, draws, i);
  return p;
}
