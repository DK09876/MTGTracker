/**
 * Cut candidates and their reasons, from a made-up deck.
 */

import { describe, expect, it } from 'vitest';

import { cutCandidates } from './cut-score';
import { fitProfile } from './fit';
import type { RoleCount } from './roles';
import type { ScryfallCard } from './scryfall';

const card = (name: string, type_line: string, oracle_text = '', extra: Record<string, unknown> = {}) =>
  ({ card: { id: `id-${name}`, oracle_id: `o-${name}`, name, type_line, oracle_text, cmc: 2, edhrec_rank: 100, ...extra } as ScryfallCard, quantity: 1 });
const role = (id: string, cards: string[], target: [number, number] | null = null): RoleCount =>
  ({ id, label: id, group: 'mana', target, count: cards.length, cards });

const commander = { name: 'Spell Boss', type_line: 'Legendary Creature', oracle_text: 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.' } as ScryfallCard;

describe('cutCandidates', () => {
  const cards = [
    card('Rock A', 'Artifact', '{T}: Add {C}.'), card('Rock B', 'Artifact', '{T}: Add {C}.'), card('Rock C', 'Artifact', '{T}: Add {C}.'),
    card('Bolt', 'Instant', 'Deal 3 damage.'),
    card('Big Dumb Beast', 'Creature — Beast', 'Trample', { cmc: 8, edhrec_rank: 30_000 }),
    card('Engine', 'Creature — Wizard', 'Whenever you cast an instant or sorcery spell, draw a card.'),
    card('Island', 'Basic Land — Island'),
  ];
  const roles = [role('ramp', ['Rock A', 'Rock B', 'Rock C'], [1, 2]), role('removal', ['Bolt'], [2, 4])];

  it('puts cards in roles the deck is over on, and cards that fit nothing, first - and spares what is short', () => {
    const { candidates, type } = cutCandidates({ cards, roles, fit: fitProfile(commander), commander, commanderRoles: [], tags: null, keep: new Set(), stats: null, lands: { have: 36, want: 37 } });
    expect(type.type).toBe('A');
    const names = candidates.map((c) => c.name);
    expect(names[0]).toBe('Big Dumb Beast');
    expect(candidates[0].reasons.join(' ')).toMatch(/Nothing Spell Boss cares about.*Low floor: a body with little else.*Costs 8.*Rarely played/);
    expect(names).toContain('Rock A');
    expect(candidates.find((c) => c.name === 'Rock A')!.reasons[0]).toMatch(/ramp: 3, more than 1–2/);
    // Removal is short: Bolt is not offered.
    expect(names).not.toContain('Bolt');
    expect(names).not.toContain('Island');
  });

  it('never offers what the owner tagged as an engine, and offers a basic when over on lands', () => {
    const tags = {
      brief: '', overview: '',
      tags: [{ id: 't1', name: 'Engines', kind: 'engine', status: 'accepted' }] as never,
      cardTags: [{ key: 'o-Engine', tagId: 't1', source: 'manual', on: true, reason: '' }] as never,
    };
    const { candidates, protectedCards } = cutCandidates({ cards, roles, fit: null, commander: null, commanderRoles: [], tags, keep: new Set(['o-Bolt']), stats: null, lands: { have: 40, want: 37 } });
    // Tagged as an engine, or starred to keep: never offered.
    expect(protectedCards).toEqual(['Bolt', 'Engine']);
    expect(candidates.map((c) => c.name)).toContain('Island');
  });

  it('reads a deck packed with one narrow theme as Type B, and keeps its theme cards', () => {
    const slivers = { name: 'Sliver Queen', type_line: 'Legendary Creature — Sliver', oracle_text: 'Sliver creatures you control get +1/+1.' } as ScryfallCard;
    const deck = [
      ...Array.from({ length: 22 }, (_, i) => card(`Sliver ${i}`, 'Creature — Sliver', 'Sliver creatures you control have haste.', { edhrec_rank: 20_000 })),
      card('Random Beast', 'Creature — Beast', 'Trample'),
    ];
    const { type, candidates } = cutCandidates({ cards: deck, roles: [], fit: fitProfile(slivers), commander: slivers, commanderRoles: [], tags: null, keep: new Set(), stats: null, lands: { have: 37, want: 37 } });
    expect(type.type).toBe('B');
    // Weak but on theme: kept; off theme: first to go.
    expect(candidates[0].name).toBe('Random Beast');
    expect(candidates.some((c) => c.name.startsWith('Sliver'))).toBe(false);
  });

  it('trims interaction first, then ramp when the commander is cheap', () => {
    const cheap = { name: 'Cheap Boss', type_line: 'Legendary Creature', oracle_text: '', cmc: 2 } as ScryfallCard;
    const removal = Array.from({ length: 10 }, (_, i) => card(`Snipe ${i}`, 'Instant', 'Destroy target creature with power 2 or less.'));
    const flex = card('Beast Within', 'Instant', 'Destroy target permanent.');
    const ramp = Array.from({ length: 12 }, (_, i) => card(`Rock ${i}`, 'Artifact', '{T}: Add {C}.'));
    const r = [role('removal', [...removal.map((c) => c.card.name), 'Beast Within'], [8, 12]), role('ramp', ramp.map((c) => c.card.name), [10, 12])];
    const { candidates } = cutCandidates({ cards: [...removal, flex, ...ramp], roles: r, fit: null, commander: cheap, commanderRoles: [], tags: null, keep: new Set(), stats: null, lands: { have: 37, want: 37 } });
    const snipe = candidates.find((c) => c.name === 'Snipe 0')!;
    expect(snipe.reasons).toContain('Narrow removal: interaction is the first utility to trim');
    expect(candidates.find((c) => c.name === 'Rock 0')!.reasons.join(' ')).toMatch(/Cheap Boss is cheap: ramp is the next to trim/);
    // Flexible removal ranks below narrow removal.
    const flexScore = candidates.find((c) => c.name === 'Beast Within')?.score ?? 0;
    expect(flexScore).toBeLessThan(snipe.score);
  });
});
