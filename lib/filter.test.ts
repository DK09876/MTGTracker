/**
 * List filtering.
 *
 * The risk here is silent wrongness: a filter that quietly drops a card you
 * own is worse than one that refuses the query, which is why unsupported
 * operators are reported rather than ignored.
 */

import { describe, expect, it } from 'vitest';

import { filterCards, parseQuery } from './filter';
import type { ScryfallCard } from './scryfall';

const card = (over: Partial<ScryfallCard>): ScryfallCard => ({
  id: over.name ?? 'x', name: 'Nameless', ...over,
}) as ScryfallCard;

const bolt = card({
  name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  colors: ['R'], color_identity: ['R'], cmc: 1, rarity: 'common', set: 'lea',
  set_name: 'Limited Edition Alpha', artist: 'Christopher Rush', prices: { usd: '2.50' },
});
const goblin = card({
  name: 'Goblin Guide', type_line: 'Creature — Goblin Scout', oracle_text: 'Haste',
  colors: ['R'], color_identity: ['R'], cmc: 1, rarity: 'rare', set: 'zen',
  power: '2', toughness: '2', keywords: ['Haste'], prices: { usd: '12.00' },
});
const oracle = card({
  name: 'Oracle of Mul Daya', type_line: 'Creature — Elf Shaman', oracle_text: 'You may play an additional land.',
  colors: ['G'], color_identity: ['G'], cmc: 4, rarity: 'rare', set: 'zen',
  power: '2', toughness: '2', prices: { usd: '20.00' },
});
const hybrid = card({
  name: 'Manamorphose', type_line: 'Instant', oracle_text: 'Add two mana. Draw a card.',
  colors: ['R', 'G'], color_identity: ['R', 'G'], cmc: 2, rarity: 'common', set: 'shm',
});

const all = [bolt, goblin, oracle, hybrid].map((c) => ({ card: c }));
const names = (q: string) => filterCards(all, q).results.map((r) => r.card.name);

describe('bare words search the name', () => {
  it('matches a partial, case-insensitively', () => {
    expect(names('bolt')).toEqual(['Lightning Bolt']);
    expect(names('GOBLIN')).toEqual(['Goblin Guide']);
  });

  it('ands multiple words together', () => {
    expect(names('lightning bolt')).toEqual(['Lightning Bolt']);
    expect(names('lightning goblin')).toEqual([]);
  });
});

describe('type and text', () => {
  it('filters by type line', () => {
    expect(names('t:creature').sort()).toEqual(['Goblin Guide', 'Oracle of Mul Daya']);
    expect(names('t:goblin')).toEqual(['Goblin Guide']);
  });

  it('filters by oracle text, including phrases', () => {
    expect(names('o:haste')).toEqual(['Goblin Guide']);
    expect(names('o:"draw a card"')).toEqual(['Manamorphose']);
  });
});

describe('colours', () => {
  it('matches a single colour', () => {
    expect(names('c:g').sort()).toEqual(['Manamorphose', 'Oracle of Mul Daya']);
  });

  // c:rg means "contains both", which is how Scryfall reads it.
  it('requires every named colour', () => {
    expect(names('c:rg')).toEqual(['Manamorphose']);
  });

  it('understands multicolour and colourless', () => {
    expect(names('c:m')).toEqual(['Manamorphose']);
    expect(names('c:c')).toEqual([]);
  });
});

describe('numeric comparisons', () => {
  it('compares mana value', () => {
    expect(names('cmc<=1').sort()).toEqual(['Goblin Guide', 'Lightning Bolt']);
    expect(names('cmc>2')).toEqual(['Oracle of Mul Daya']);
    expect(names('mv=2')).toEqual(['Manamorphose']);
  });

  it('compares price, skipping cards without one', () => {
    expect(names('usd>10').sort()).toEqual(['Goblin Guide', 'Oracle of Mul Daya']);
    expect(names('usd<5')).toEqual(['Lightning Bolt']);
  });

  it('compares power and toughness', () => {
    expect(names('pow>=2').sort()).toEqual(['Goblin Guide', 'Oracle of Mul Daya']);
  });
});

describe('rarity, set and artist', () => {
  it('filters by rarity and set', () => {
    expect(names('r:rare').sort()).toEqual(['Goblin Guide', 'Oracle of Mul Daya']);
    expect(names('set:zen').sort()).toEqual(['Goblin Guide', 'Oracle of Mul Daya']);
  });

  it('matches a set by its full name too', () => {
    expect(names('set:alpha')).toEqual(['Lightning Bolt']);
  });

  it('filters by artist', () => {
    expect(names('a:rush')).toEqual(['Lightning Bolt']);
  });
});

describe('negation', () => {
  it('excludes matches with a leading dash', () => {
    expect(names('-t:creature').sort()).toEqual(['Lightning Bolt', 'Manamorphose']);
  });

  it('combines with other terms', () => {
    expect(names('c:r -t:creature').sort()).toEqual(['Lightning Bolt', 'Manamorphose']);
  });
});

describe('robustness', () => {
  it('returns everything for an empty query', () => {
    expect(filterCards(all, '   ').results).toHaveLength(4);
  });

  // Silently returning everything for a filter you do not understand is how
  // people end up trusting a wrong answer.
  it('reports operators it does not support instead of ignoring them', () => {
    const { unsupported } = filterCards(all, 'layout:split t:instant');
    expect(unsupported).toEqual(['layout:split']);
  });

  it('still applies the terms it does understand', () => {
    expect(filterCards(all, 'layout:split t:instant').results.map((r) => r.card.name).sort())
      .toEqual(['Lightning Bolt', 'Manamorphose']);
  });

  it('does not crash on a nonsense numeric value', () => {
    expect(filterCards(all, 'cmc>banana').results).toEqual([]);
  });

  it('parses a quoted phrase as one term', () => {
    expect(parseQuery('o:"draw a card"').terms).toHaveLength(1);
  });
});
