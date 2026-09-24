/** Cut candidates: over-target roles first, least played first. */

import { describe, expect, it } from 'vitest';

import { cutCandidates } from './cuts';

const stats = new Map([
  ['Cultivate', { decks: 1, inclusion: 0.8, synergy: 0 }],
  ['Farseek', { decks: 1, inclusion: 0.3, synergy: 0 }],
  ['Harrow', { decks: 1, inclusion: 0.5, synergy: 0 }],
  ['Beast Within', { decks: 1, inclusion: 0.7, synergy: 0 }],
]);
const ramp = { id: 'ramp', label: 'Ramp', target: [1, 2] as [number, number], count: 4, cards: ['Cultivate', 'Farseek', 'Harrow', 'Pet Rock'] };
const removal = { id: 'removal', label: 'Targeted removal', target: [8, 12] as [number, number], count: 1, cards: ['Beast Within'] };

describe('cutCandidates', () => {
  it('starts with roles over their guideline, rarest first, unlisted before all', () => {
    const [first] = cutCandidates([], stats, [ramp, removal]);
    expect(first.title).toBe('Ramp: 2 over');
    expect(first.cards).toEqual([
      { name: 'Pet Rock', inclusion: null },
      { name: 'Farseek', inclusion: 0.3 },
      { name: 'Harrow', inclusion: 0.5 },
    ]);
  });

  it('leaves out roles within their guideline', () => {
    expect(cutCandidates([], stats, [removal]).map((g) => g.title)).toEqual(['Least played with this commander']);
  });

  it('lists the least played spells overall when EDHREC knows the commander', () => {
    const groups = cutCandidates(['Cultivate', 'Beast Within', 'Farseek'], stats, null);
    expect(groups[0].cards.map((c) => c.name)).toEqual(['Farseek', 'Beast Within', 'Cultivate']);
    expect(cutCandidates(['Cultivate'], null, null)).toEqual([]);
  });
});
