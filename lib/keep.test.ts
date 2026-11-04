import { describe, expect, it } from 'vitest';

import { cleanKeep, describeKeep, keepOdds, keeps, withMulligans, type KeepCard } from './keep';

const deck = (lands: number, ramp: number, rest: number): KeepCard[] => [
  ...Array.from({ length: lands }, () => ({ land: true, tags: [] })),
  ...Array.from({ length: ramp }, () => ({ land: false, tags: ['Ramp'] })),
  ...Array.from({ length: rest }, () => ({ land: false, tags: [] })),
];

describe('the keep rule', () => {
  it('keeps a seven inside the land range with everything it needs', () => {
    const rule = { lands: [2, 4] as [number, number], needs: [{ tag: 'Ramp', atLeast: 1 }] };
    expect(keeps(deck(3, 1, 3), rule)).toBe(true);
    expect(keeps(deck(3, 0, 4), rule)).toBe(false);
    expect(keeps(deck(5, 1, 1), rule)).toBe(false);
    expect(describeKeep(rule)).toBe('2–4 lands + 1 Ramp');
  });

  it('works out land-only odds exactly, and counts the rest close to the true figure', () => {
    const d = deck(37, 10, 52);
    const lands = keepOdds(d, { lands: [2, 5], needs: [] });
    expect(lands.exact).toBe(true);
    expect(lands.odds).toBeCloseTo(0.8038, 4);
    // A needed ramp card cuts it; counted, so roughly - and the same every time.
    const ramp = keepOdds(d, { lands: [2, 5], needs: [{ tag: 'Ramp', atLeast: 1 }] });
    expect(ramp.exact).toBe(false);
    // Exactly 0.4094 (37 lands, 10 ramp, 52 others); counted over 20,000 hands, within a point.
    expect(Math.abs(ramp.odds - 0.4094)).toBeLessThan(0.01);
    expect(keepOdds(d, { lands: [2, 5], needs: [{ tag: 'Ramp', atLeast: 1 }] }).odds).toBe(ramp.odds);
    expect(withMulligans(0.5, 1)).toBe(0.75);
  });

  it('keeps sent rules to what makes sense', () => {
    expect(cleanKeep({ lands: [5, 2], needs: [{ tag: ' Ramp ', atLeast: 1 }, { tag: '', atLeast: 1 }, { tag: 'X', atLeast: 9 }] }))
      .toEqual({ lands: [2, 5], needs: [{ tag: 'Ramp', atLeast: 1 }] });
  });
});
