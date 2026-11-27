import { describe, expect, it } from 'vitest';

import { extrasOf, piecesToAsk } from './deck-extras';
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

  it('finds face-down reminder cards Scryfall files as combo pieces, and leaves out real cards linked the same way', () => {
    const deck = [
      card('Etrata, Deadly Fugitive', [part('a1', 'combo_piece', 'A Mysterious Creature', 'Creature')]),
      card('Ruthless Ripper', [part('m1', 'combo_piece', 'Morph', 'Creature')]),
      card('Cyber Conversion', [part('y1', 'combo_piece', 'Cyberman', 'Artifact Creature — Cyberman')]),
      card('Command Tower', [part('w1', 'combo_piece', 'Tower Winder', 'Creature — Snake')]),
    ];
    const pieces = new Set(['A Mysterious Creature', 'Morph', 'Cyberman']);
    expect(extrasOf(deck, pieces).map((e) => [e.kind, e.name, e.from])).toEqual([
      ['facedown', 'A Mysterious Creature', ['Etrata, Deadly Fugitive']],
      ['token', 'Cyberman', ['Cyber Conversion']],
      ['facedown', 'Morph', ['Ruthless Ripper']],
    ]);
    // Before the server answers, a bare "Creature" type is taken as a reminder card; a typed creature isn't.
    expect(extrasOf(deck).map((e) => e.name)).toEqual(['A Mysterious Creature', 'Morph']);
    expect(piecesToAsk(deck)).toEqual(['A Mysterious Creature', 'Cyberman', 'Morph', 'Tower Winder']);
  });

  it('reads the rules text for face-down creatures and tokens Scryfall has not linked', () => {
    const text = (name: string, oracle_text: string) => ({ ...card(name, []), oracle_text }) as ScryfallCard;
    const extras = extrasOf([
      text('Some Cloaker', 'Whenever this creature attacks, cloak the top card of your library. (To cloak a card, put it onto the battlefield face down as a 2/2 creature with ward {2}.)'),
      text('New Maker', 'When this creature enters, create a 2/2 green Wolf creature token.'),
      text('Grizzly Bears', ''),
      // Reminder text alone makes nothing; a "nontoken" mention isn't a token.
      text('Plain Fellow', 'Whenever a nontoken creature you control dies, draw a card. (Like a token, it is gone.)'),
    ]);
    expect(extrasOf([]).length).toBe(0);
    expect(extras.map((e) => [e.kind, e.name, e.words ?? null])).toEqual([
      ['facedown', 'A Mysterious Creature', null],
      ['token', 'New Maker', 'When this creature enters, create a 2/2 green Wolf creature token.'],
    ]);
  });

  it('reads what a card does, not its own name or what it reacts to', () => {
    const text = (name: string, oracle_text: string) => ({ ...card(name, []), oracle_text }) as ScryfallCard;
    expect(extrasOf([
      // "Disguise" here is only the card's name.
      text('Chameleon, Master of Disguise', 'You may have Chameleon enter as a copy of a creature you control, except his name is Chameleon, Master of Disguise.'),
      // It reacts to tokens; it makes none.
      text('Tchotchke Elemental', 'Whenever you create a token or put a counter or a sticker on another permanent, put a knickknack counter on this creature.'),
      // A replacement doubles tokens; it makes none of its own.
      text('Doubling Season', 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.'),
    ])).toEqual([]);
    // A condition first, then a token made: that one counts.
    expect(extrasOf([text('Token Echo', 'Whenever you create a token, create a 1/1 white Spirit creature token with flying.')]).map((e) => e.name)).toEqual(['Token Echo']);
    // A card that really has disguise still gets its reminder card.
    expect(extrasOf([text('Forum Familiar', 'Disguise {1}{W} (You may cast this card face down for {3} as a 2/2 creature with ward {2}.)')]).map((e) => e.name)).toEqual(['A Mysterious Creature']);
  });
});
