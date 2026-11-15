/**
 * Which intent a deck's state points to, and how many cuts fit before 100.
 */

import { describe, expect, it } from 'vitest';

import { placeOf } from './deck-tabs';
import { capToHundred, cutsLeft, suggestedIntent } from './tune-shared';

describe('the suggested intent', () => {
  it('follows the deck\'s size and what waits to go in', () => {
    expect(suggestedIntent(2, 0)).toBe('finish');
    expect(suggestedIntent(59, 0)).toBe('finish');
    expect(suggestedIntent(80, 0)).toBe('finish');
    expect(suggestedIntent(80, 60)).toBe('finish');
    expect(suggestedIntent(99, 0)).toBe('finish');
    expect(suggestedIntent(100, 9)).toBe('upgrades');
    expect(suggestedIntent(108, 5)).toBe('cuts');
    expect(suggestedIntent(116, 24)).toBe('cuts');
    expect(suggestedIntent(128, 0)).toBe('cuts');
  });
});

describe('cuts stop at 100', () => {
  it('takes only what the deck is over', () => {
    expect(cutsLeft(103)).toBe(3);
    expect(cutsLeft(100)).toBe(0);
    expect(cutsLeft(97)).toBe(0);
    expect(capToHundred(['a', 'b', 'c', 'd', 'e'], 103)).toEqual(['a', 'b', 'c']);
    expect(capToHundred(['a', 'b'], 100)).toEqual([]);
  });
});

describe('old tabs', () => {
  it('lead to where they live now', () => {
    expect(placeOf('tags')).toEqual({ tab: 'tags' });
    expect(placeOf('health')).toEqual({ tab: 'check', check: 'health' });
    expect(placeOf('playtest')).toEqual({ tab: 'check', check: 'playtest' });
    expect(placeOf('collection')).toMatchObject({ tab: 'cards', copies: true });
    expect(placeOf('suggestions')).toEqual({ tab: 'tune' });
    expect(placeOf('tune')).toEqual({ tab: 'tune' });
    expect(placeOf('nonsense')).toEqual({ tab: 'cards' });
  });
});
