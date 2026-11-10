/**
 * Only hard failures are warnings: no draw, lands far under. A little under
 * a range is a number, not a warning.
 */

import { describe, expect, it } from 'vitest';

import { hardWarnings, landsFarUnder, LANDS_FAR_UNDER } from './hard-checks';

describe('hard warnings', () => {
  it('warns on lands only at four or more under the low end', () => {
    expect(LANDS_FAR_UNDER).toBe(4);
    expect(landsFarUnder(34, [37, 38])).toBe(false);
    expect(landsFarUnder(33, [37, 38])).toBe(true);
    expect(hardWarnings({ lands: { have: 35, range: [37, 38] }, draw: 9, nearlyBuilt: true })).toEqual([]);
    expect(hardWarnings({ lands: { have: 32, range: [37, 38] }, draw: 9, nearlyBuilt: true }).map((w) => w.title)).toEqual(['32 lands, far under 37–38']);
  });

  it('warns on no card draw at all, not on a little', () => {
    expect(hardWarnings({ lands: null, draw: 0, nearlyBuilt: true }).map((w) => w.title)).toEqual(['No card draw']);
    expect(hardWarnings({ lands: null, draw: 2, nearlyBuilt: true })).toEqual([]);
    // Not known yet is not zero.
    expect(hardWarnings({ lands: null, draw: null, nearlyBuilt: true })).toEqual([]);
  });

  it('says nothing about a deck still being built', () => {
    expect(hardWarnings({ lands: { have: 5, range: [37, 38] }, draw: 0, nearlyBuilt: false })).toEqual([]);
  });
});
