import { describe, expect, it } from 'vitest';

import { extrasOf } from './deck-extras';
import type { ScryfallCard } from './scryfall';

const part = (id: string, component: string, name: string, type_line: string) => ({ object: 'related_card', id, component, name, type_line });
const card = (name: string, parts: ReturnType<typeof part>[]) => ({ id: name, name, all_parts: [part(`self-${name}`, 'combo_piece', name, 'Creature'), ...parts] }) as unknown as ScryfallCard;

describe('a deck’s tokens and extras', () => {
  it('groups tokens, emblems and game pieces, once each, with the cards that make them', () => {
    const extras = extrasOf([
      card('Smothering Tithe', [part('t1', 'token', 'Treasure', 'Token Artifact — Treasure')]),
      card('Dockside Extortionist', [part('t2', 'token', 'Treasure', 'Token Artifact — Treasure')]),
      card('Queen Marchesa', [part('m1', 'combo_piece', 'The Monarch', 'Card'), part('t3', 'token', 'Assassin', 'Token Creature — Assassin')]),
      card('Jace, Unraveler of Secrets', [part('e1', 'token', 'Jace, Unraveler of Secrets Emblem', 'Emblem — Jace')]),
      card('Opt', [part('c1', 'combo_piece', 'Brainstorm', 'Instant')]),
    ]);
    expect(extras.map((e) => [e.kind, e.name, e.from])).toEqual([
      ['token', 'Assassin', ['Queen Marchesa']],
      ['emblem', 'Jace, Unraveler of Secrets Emblem', ['Jace, Unraveler of Secrets']],
      ['other', 'The Monarch', ['Queen Marchesa']],
      ['token', 'Treasure', ['Smothering Tithe', 'Dockside Extortionist']],
    ]);
  });

  it('leaves out a related card that is already in the deck, or is the card itself', () => {
    expect(extrasOf([
      card('Urza, Lord Protector', [part('u2', 'meld_part', 'The Mightstone and Weakstone', 'Legendary Artifact'), part('u3', 'meld_result', 'Urza, Planeswalker', 'Legendary Planeswalker — Urza')]),
      card('The Mightstone and Weakstone', []),
    ]).map((e) => e.name)).toEqual(['Urza, Planeswalker']);
  });
});
