/**
 * Which of a deck's tags name a job every deck needs, not a theme.
 */

import { describe, expect, it } from 'vitest';

import { isJobTag } from './tags';

describe('job tags', () => {
  it('are the jobs every deck needs, by name', () => {
    for (const n of ['Ramp', 'Draw', 'Card draw', 'Removal', 'Boardwipe', 'Board wipes', 'Protection', 'Recursion', 'Tutor', 'Counterspells']) expect(isJobTag(n)).toBe(true);
    for (const n of ['Lifegain', 'Discard Payoffs', 'Wheels', 'Treasure']) expect(isJobTag(n)).toBe(false);
  });
  it('or by their cards: most of them one job\'s cards', () => {
    expect(isJobTag('Rocks and dorks', ['A', 'B', 'C', 'D', 'E'], [{ id: 'ramp', cards: ['A', 'B', 'C', 'D', 'Z'] }])).toBe(true);
    expect(isJobTag('Wheels', ['A', 'B', 'C', 'D'], [{ id: 'draw', cards: ['A', 'B'] }])).toBe(false);
  });
});
