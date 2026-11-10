import { describe, expect, it } from 'vitest';

import { nameRank, rankNames } from './quick-names';

const named = (...names: string[]) => names.map((name) => ({ name }));

describe('adding by name', () => {
  it('puts the exact name first, then names starting with it, then words, then anywhere', () => {
    const cards = named('Sol Ring', 'Solemn Simulacrum', 'Arcane Signet', 'Soldevi Sentry', 'Cryptolith Rite', 'Sol Talisman', 'Ring of Ma\'rûf');
    expect(rankNames(cards, 'sol ring').map((c) => c.name)).toEqual(['Sol Ring']);
    expect(rankNames(cards, 'sol').map((c) => c.name)).toEqual(['Sol Ring', 'Sol Talisman', 'Soldevi Sentry', 'Solemn Simulacrum']);
    expect(rankNames(cards, 'ring').map((c) => c.name)).toEqual(["Ring of Ma'rûf", 'Sol Ring']);
  });

  it('matches double-faced cards by either face, and words in any order', () => {
    expect(nameRank('Fell the Profane // Fell Mire', 'fell mire')).toBe(3);
    expect(nameRank('Fell the Profane // Fell Mire', 'fell the')).toBe(1);
    expect(nameRank('Lightning Bolt', 'bolt light')).toBe(4);
    expect(nameRank('Lightning Bolt', 'bolt x')).toBeNull();
  });

  it('ignores accents and curly apostrophes', () => {
    expect(nameRank('Lim-Dûl the Necromancer', 'lim-dul')).toBe(1);
    expect(nameRank("Narset's Reversal", 'narset’s')).toBe(1);
  });
});
