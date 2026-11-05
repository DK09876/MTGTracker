import { describe, expect, it } from 'vitest';

import { gameChangerLimit, gameChangerLine } from './brackets';
import { capCuts } from './cut-review-shared';

describe('Game Changers against the bracket', () => {
  it('allows none in 1 and 2, three in 3, any in 4 and 5', () => {
    expect([1, 2, 3, 4, 5].map(gameChangerLimit)).toEqual([0, 0, 3, Infinity, Infinity]);
    expect(gameChangerLimit(null)).toBeNull();
  });

  it('says how many and flags too many', () => {
    expect(gameChangerLine(4, 3)).toEqual({ text: '4 Game Changers, bracket 3 allows 3', over: true });
    expect(gameChangerLine(1, 2)).toEqual({ text: '1 Game Changer, bracket 2 allows none', over: true });
    expect(gameChangerLine(2, 3).over).toBe(false);
    expect(gameChangerLine(9, 4).over).toBe(false);
    expect(gameChangerLine(2, null)).toEqual({ text: '2 Game Changers. Set the bracket you\'re aiming for on Plan to check it.', over: false });
  });
});

describe('capCuts', () => {
  it('takes no more than the deck is over, best first, and none at 100', () => {
    expect(capCuts(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'b', 'c']);
    expect(capCuts(['a', 'b'], 5)).toEqual(['a', 'b']);
    expect(capCuts(['a', 'b'], 0)).toEqual([]);
    expect(capCuts(['a'], -2)).toEqual([]);
  });
});
