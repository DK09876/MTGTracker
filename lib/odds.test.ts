/** Drawing odds, checked against Python's exact integer arithmetic (math.comb). */

import { describe, expect, it } from 'vitest';

import { atLeast, choose, distribution, exactly } from './odds';

describe('odds', () => {
  it('counts combinations', () => {
    expect(choose(5, 2)).toBe(10);
    expect(choose(99, 7)).toBeCloseTo(14887031544, -2);
    expect(choose(3, 5)).toBe(0);
  });

  // 36 lands in a 99-card library, 7-card hand. Reference values from
  // math.comb: P(0) = 0.0372, P(3) = 0.2857, P(2..4) = 0.7403.
  it('matches exact opening-hand odds', () => {
    expect(exactly(99, 36, 7, 0)).toBeCloseTo(0.0372, 4);
    expect(exactly(99, 36, 7, 3)).toBeCloseTo(0.2857, 4);
    expect([2, 3, 4].reduce((sum, k) => sum + exactly(99, 36, 7, k), 0)).toBeCloseTo(0.7403, 4);
  });

  it('adds up to one', () => {
    expect(distribution(99, 38, 7).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('gives at-least odds', () => {
    expect(atLeast(99, 36, 7, 0)).toBeCloseTo(1, 10);
    expect(atLeast(60, 4, 7, 1)).toBeCloseTo(0.3995, 3);
  });
});
