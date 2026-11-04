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
    const { candidates } = cutCandidates({ cards, roles, fit: fitProfile(commander), tags: null, stats: null, lands: { have: 36, want: 37 } });
    const names = candidates.map((c) => c.name);
    expect(names[0]).toBe('Big Dumb Beast');
    expect(candidates[0].reasons.join(' ')).toMatch(/Nothing Spell Boss cares about.*Rarely played.*Costs 8/);
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
    const { candidates, protectedCards } = cutCandidates({ cards, roles, fit: null, tags, stats: null, lands: { have: 40, want: 37 } });
    expect(protectedCards).toEqual(['Engine']);
    expect(candidates.map((c) => c.name)).toContain('Island');
  });
});
