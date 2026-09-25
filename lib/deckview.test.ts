/** Grouping and sorting a deck for display. */

import { describe, expect, it } from 'vitest';

import { groupCards, primaryType, type Item } from './deckview';
import type { ScryfallCard } from './scryfall';

const card = (name: string, type_line: string, cmc = 0, usd?: string): ScryfallCard =>
  ({ id: name, name, type_line, cmc, prices: { usd } }) as ScryfallCard;
const item = (c: ScryfallCard, quantity = 1, over: Partial<Item> = {}): Item => ({ card: c, quantity, finish: 'nonfoil', ...over });

describe('primaryType', () => {
  it.each([
    ['Artifact Creature — Golem', 'Creatures'],
    ['Land Creature — Forest Dryad', 'Creatures'],
    ['Legendary Artifact — Spacecraft', 'Artifacts'],
    ['Kindred Instant — Elf', 'Instants'],
    ['Basic Land — Forest', 'Lands'],
    ['Enchantment — Aura', 'Enchantments'],
    ['Conspiracy', 'Other'],
  ])('%s is listed under %s', (type, group) => {
    expect(primaryType(card('x', type))).toBe(group);
  });

  it('uses the front face of a double-faced card', () => {
    expect(primaryType({ ...card('x', 'Sorcery // Land'), card_faces: [{ name: 'a', type_line: 'Sorcery' }, { name: 'b', type_line: 'Land' }] } as ScryfallCard)).toBe('Sorceries');
  });
});

describe('groupCards', () => {
  const hull = item(card('Hearthhull', 'Legendary Artifact — Spacecraft', 4), 1, { commander: true });
  const cultivate = item(card('Cultivate', 'Sorcery', 3, '0.50'));
  const bolt = item(card('Lightning Bolt', 'Instant', 1, '2.00'));
  const cobra = item(card('Lotus Cobra', 'Creature — Snake', 2, '9.00'));
  const forest = item(card('Forest', 'Basic Land — Forest', 0), 6);
  const all = [cultivate, forest, hull, bolt, cobra];

  it('groups by type, commander first, in the usual order, counting copies', () => {
    const groups = groupCards(all, 'type', 'name');
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ['Commander', 1], ['Creatures', 1], ['Instants', 1], ['Sorceries', 1], ['Lands', 6],
    ]);
  });

  it('groups by mana value with lands kept apart', () => {
    const groups = groupCards(all, 'mv', 'name');
    expect(groups.map((g) => g.label)).toEqual(['Commander', 'Mana value 1', 'Mana value 2', 'Mana value 3', 'Lands']);
  });

  it('sorts within a group by price, dearest first', () => {
    const [group] = groupCards([cultivate, bolt, cobra], 'none', 'price');
    expect(group.items.map((i) => i.card.name)).toEqual(['Lotus Cobra', 'Lightning Bolt', 'Cultivate']);
  });

  it('sorts by mana value, then name', () => {
    const [group] = groupCards([cultivate, cobra, bolt], 'none', 'mv');
    expect(group.items.map((i) => i.card.name)).toEqual(['Lightning Bolt', 'Lotus Cobra', 'Cultivate']);
  });
});

describe('grouping by tags', () => {
  const card = (name: string, type = 'Creature') => ({ id: name, name, type_line: type, cmc: 1 }) as ScryfallCard;
  const items = [
    { card: card('Korvold'), quantity: 1, finish: 'nonfoil' as const, commander: true },
    { card: card('Viscera Seer'), quantity: 1, finish: 'nonfoil' as const },
    { card: card('Bitterblossom', 'Enchantment'), quantity: 1, finish: 'nonfoil' as const },
    { card: card('Forest', 'Basic Land'), quantity: 30, finish: 'nonfoil' as const },
  ];
  const categories = {
    of: (c: ScryfallCard) => ({ 'Viscera Seer': ['sac', 'draw'], Bitterblossom: ['tokens', 'gone'] } as Record<string, string[]>)[c.name] ?? [],
    order: [{ key: 'tokens', label: 'Tokens', color: '#fff000' }, { key: 'sac', label: 'Sac outlets' }, { key: 'draw', label: 'Draw' }],
    none: 'Untagged',
  };

  it('lists a card under each of its tags, in tag order, untagged last', () => {
    const groups = groupCards(items, 'tag', 'name', categories);
    expect(groups.map((g) => `${g.label}:${g.items.map((i) => i.card.name).join(',')}`)).toEqual([
      'Commander:Korvold', 'Tokens:Bitterblossom', 'Sac outlets:Viscera Seer', 'Draw:Viscera Seer', 'Untagged:Forest',
    ]);
    expect(groups[1].color).toBe('#fff000');
    expect(groups[4].count).toBe(30);
  });

  it('falls back to one group until the tags arrive', () => {
    expect(groupCards(items, 'tag', 'name').map((g) => g.key)).toEqual(['commander', 'all']);
  });
});
