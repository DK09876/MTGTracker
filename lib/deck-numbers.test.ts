/**
 * The numbers every page shows for a deck, from made-up cards.
 */

import { describe, expect, it } from 'vitest';

import { drawKind, isImpulse, isRepeatableRemoval, jobs, karstenLands, landNumber, rampRange, sourceWeight, withJobs } from './deck-numbers';
import type { RoleCount } from './roles';
import type { ScryfallCard } from './scryfall';

const card = (name: string, type_line: string, oracle_text = '', extra: Partial<ScryfallCard> = {}) =>
  ({ id: name, oracle_id: `o-${name}`, name, type_line, oracle_text, cmc: 2, ...extra }) as ScryfallCard;
const deck = (...cards: ScryfallCard[]) => cards.map((c) => ({ card: c, quantity: 1 }));
const role = (id: string, cards: string[]): RoleCount => ({ id, label: id, group: 'mana', target: null, count: cards.length, cards });
const job = (list: ReturnType<typeof jobs>, id: string) => list.find((j) => j.id === id)!;

describe('lands', () => {
  it('follows the formula, never below 37', () => {
    expect(karstenLands(3, 10)).toBe(38);
    expect(karstenLands(1.5, 20)).toBe(37);
    expect(karstenLands(4.2, 4)).toBe(43);
  });

  it('counts cheap ramp and draw, a land on the back of a card as part of one, and says how', () => {
    const cards = deck(
      card('Sol Ring', 'Artifact', '{T}: Add {C}{C}.', { cmc: 1 }),
      card('Night\'s Whisper', 'Sorcery', 'You draw two cards and you lose 2 life.', { cmc: 2 }),
      card('Big Thing', 'Creature', '', { cmc: 6 }),
      card('Valakut Awakening', 'Instant', 'Put any number of cards from your hand on the bottom.', { cmc: 3, card_faces: [{ name: 'Valakut Awakening', type_line: 'Instant' }, { name: 'Valakut Stoneforge', type_line: 'Land' }] as never }),
      card('Mountain', 'Basic Land — Mountain', '', { cmc: 0 }),
    );
    const roles = (c: ScryfallCard) => (c.name === 'Sol Ring' ? ['ramp'] : c.name === 'Night\'s Whisper' ? ['draw'] : []);
    const n = landNumber(cards, roles);
    expect(n.cheap).toBe(2);
    expect(n.averageMv).toBe(3);
    expect(n.want).toBe(karstenLands(3, 2));
    expect(n.have).toBeCloseTo(1.38, 2);
    expect(n.range).toEqual([n.want, n.want + 1]);
    expect(n.how.steps[0]).toMatch(/31\.42 \+ 3\.13 × 3\.00 − 0\.28 × 2/);
    expect(landNumber(cards, roles, [40, 41]).range).toEqual([40, 41]);
  });
});

describe('jobs', () => {
  const cmd = card('Ramp Boss', 'Legendary Creature', '{T}: Add {G}.', { cmc: 4 });

  it('leaves impulse draw out of card draw and counts it on its own', () => {
    const cards = deck(
      card('Divination', 'Sorcery', 'Draw two cards.'),
      card('Light Up the Stage', 'Sorcery', 'Exile the top two cards of your library. Until the end of your next turn, you may play those cards.'),
      card('Opt', 'Instant', 'Scry 1. Draw a card.'),
    );
    const list = jobs({ cards, roles: [role('draw', ['Divination', 'Light Up the Stage'])], commander: null, commanderRoles: [], flip: 4 });
    expect(job(list, 'draw').count).toBe(1);
    expect(job(list, 'impulse').cards).toEqual(['Light Up the Stage']);
    expect(job(list, 'impulse').range).toBeNull();
  });

  it('counts removal, counterspells and wipes as interaction, repeatable removal twice', () => {
    const cards = deck(
      card('Swords', 'Instant', 'Exile target creature.'),
      card('Counterspell', 'Instant', 'Counter target spell.'),
      card('Wrath', 'Sorcery', 'Destroy all creatures.', { cmc: 4 }),
      card('Royal Assassin', 'Creature — Human Assassin', '{T}: Destroy target tapped creature.', { cmc: 3 }),
    );
    const roles = [role('removal', ['Swords', 'Royal Assassin']), role('counter', ['Counterspell']), role('wipe', ['Wrath'])];
    const list = jobs({ cards, roles, commander: null, commanderRoles: [], flip: 4 });
    expect(job(list, 'interaction').cards).toHaveLength(4);
    expect(job(list, 'interaction').count).toBe(5);
    expect(job(list, 'interaction').how.inputs[0]).toMatch(/1 counterspell/);
    // Few creatures: one more wipe is fine.
    expect(job(list, 'wipe').range).toEqual([1, 3]);
  });

  it('counts slow ramp half and a ramping commander as one, with a range from the flip turn', () => {
    const cards = deck(
      card('Rock', 'Artifact', '{T}: Add {C}.', { cmc: 2 }),
      card('Big Ramp', 'Sorcery', 'Search for two lands.', { cmc: 5 }),
    );
    const list = jobs({ cards, roles: [role('ramp', ['Rock', 'Big Ramp'])], commander: cmd, commanderRoles: ['ramp'], flip: 4 });
    expect(job(list, 'ramp').count).toBe(2.5);
    expect(job(list, 'ramp').range).toEqual([11, 13]);
    expect(rampRange(6)).toEqual([13, 15]);
    expect(rampRange(2)).toEqual([9, 11]);
  });

  it('uses the plan\'s ranges when given, and moves ranges off the plain roles', () => {
    const list = jobs({ cards: [], roles: [role('ramp', [])], commander: null, commanderRoles: [], flip: 4, ranges: { draw: [14, 16] } });
    expect(job(list, 'draw').range).toEqual([14, 16]);
    expect(job(list, 'protection').range).toEqual([2, 3]);
    const rows = withJobs([{ ...role('removal', []), target: [9, 11] }], list);
    expect(rows.find((r) => r.id === 'removal')!.target).toBeNull();
    expect(rows.find((r) => r.id === 'interaction')!.target).toEqual([10, 12]);
  });
});

describe('card tests', () => {
  it('tells impulse draw from real draw', () => {
    expect(isImpulse(card('Outpost Siege', 'Enchantment', 'At the beginning of your upkeep, exile the top card of your library. Until end of turn, you may play that card.'))).toBe(true);
    expect(isImpulse(card('Big Draw', 'Sorcery', 'Exile the top card of your library. You may play it this turn. Draw two cards.'))).toBe(false);
  });

  it('finds removal that can be used again', () => {
    expect(isRepeatableRemoval(card('Royal Assassin', 'Creature', '{T}: Destroy target tapped creature.'))).toBe(true);
    expect(isRepeatableRemoval(card('Murder', 'Instant', 'Destroy target creature.'))).toBe(false);
  });
});

describe('colour sources', () => {
  it('weighs what is not a land by kind and by the spell it helps cast', () => {
    const rock = card('Signet', 'Artifact', '{1}, {T}: Add {B}{R}.', { cmc: 2, produced_mana: ['B', 'R'] });
    const dork = card('Elf', 'Creature — Elf', '{T}: Add {G}.', { cmc: 1, produced_mana: ['G'] });
    const ritual = card('Dark Ritual', 'Instant', 'Add {B}{B}{B}.', { cmc: 1, produced_mana: ['B'] });
    const cultivate = card('Rampant Growth', 'Sorcery', 'Search your library for a basic land card, put it onto the battlefield tapped.', { cmc: 2 });
    const treasure = card('Big Score', 'Instant', 'Draw two cards and create two Treasure tokens.', { cmc: 4 });
    expect(sourceWeight(rock, 4)).toBe(0.75);
    expect(sourceWeight(rock, 2)).toBe(0);
    expect(sourceWeight(dork, 2)).toBe(0.5);
    expect(sourceWeight(ritual, 4)).toBe(0);
    expect(sourceWeight(cultivate, 3)).toBe(0.75);
    expect(sourceWeight(treasure, 3)).toBe(0.25);
  });
});

// Real cards from Kevin's and DK's decks, where card draw read 28 and 15 before looting was told apart.
describe('what counts as card draw', () => {
  const real = (name: string, type_line: string, oracle_text: string, extra: Partial<ScryfallCard> = {}) => card(name, type_line, oracle_text, extra);
  it('calls looting and rummaging selection, not draw', () => {
    expect(drawKind(real('Faithless Looting', 'Sorcery', 'Draw two cards, then discard two cards.\nFlashback {2}{R}'))).toBe('selection');
    expect(drawKind(real('Laughing Mad', 'Instant', 'As an additional cost to cast this spell, discard a card.\nDraw two cards.'))).toBe('selection');
    expect(drawKind(real('Cool but Rude', 'Enchantment — Class', 'Whenever you attack, you may discard a card. If you do, draw a card.'))).toBe('selection');
    expect(drawKind(real('Matzalantli, the Great Door', 'Legendary Artifact', '{T}: Draw a card, then discard a card.'))).toBe('selection');
    expect(drawKind(real('Three Steps Ahead', 'Instant', 'Spree\n+ {1}{U} — Counter target spell.\n+ {2} — Draw two cards, then discard a card.'))).toBe('selection');
    expect(drawKind(real('Steal the Show', 'Sorcery', 'Choose one or both —\n• Target player discards any number of cards, then draws that many cards.\n• Steal the Show deals damage equal to the number of instant and sorcery cards in your graveyard to target creature or planeswalker.'))).toBe('selection');
    expect(drawKind(real('Ivora, Insatiable Heir', 'Legendary Creature', 'Trample\nWhen Ivora enters and whenever it deals combat damage to a player, create a Blood token. (It\'s an artifact with "{1}, {T}, Discard a card, Sacrifice this token: Draw a card.")'))).toBe('selection');
    expect(drawKind(real('Magmakin Artillerist', 'Creature', 'Whenever you discard one or more cards, this creature deals that much damage to each opponent.\nCycling {1}{R} ({1}{R}, Discard this card: Draw a card.)', { keywords: ['Cycling'] }))).toBe('selection');
  });
  it('does not count draws an opponent makes', () => {
    expect(drawKind(real('Acolyte Hybrid', 'Creature', 'Whenever this creature attacks, destroy up to one target artifact. If an artifact is destroyed this way, its controller draws a card.'))).toBe('selection');
  });
  it('counts real draw, wheels and refills', () => {
    expect(drawKind(real("Night's Whisper", 'Sorcery', 'You draw two cards and you lose 2 life.'))).toBe('draw');
    expect(drawKind(real('Wheel of Misfortune', 'Sorcery', 'Each player secretly chooses a number of 0 or greater, then all players reveal those numbers simultaneously and determine the highest and lowest numbers revealed this way. Wheel of Misfortune deals damage equal to the highest number to each player who chose that number. Each player who didn\'t choose the lowest number discards their hand, then draws seven cards.'))).toBe('draw');
    expect(drawKind(real('Change of Fortune', 'Sorcery', "Discard your hand, then draw a card for each card you've discarded this turn."))).toBe('draw');
    expect(drawKind(real("Khorvath's Fury", 'Sorcery', 'For each player, choose friend or foe. Each friend discards all cards from their hand, then draws that many cards plus one.'))).toBe('draw');
    expect(drawKind(real('Brainsurge', 'Instant', 'Draw four cards, then put two cards from your hand on top of your library in any order.'))).toBe('draw');
    expect(drawKind(real('Monument to Endurance', 'Artifact', "Whenever you discard a card, choose one that hasn't been chosen this turn —\n• Draw a card.\n• Create a Treasure token.\n• Each opponent loses 3 life."))).toBe('draw');
  });
  it('leaves cards without a draw of their own to their tags', () => {
    expect(drawKind(real('Dig Through Time', 'Instant', 'Delve\nLook at the top seven cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.'))).toBeNull();
  });
});

describe('removal that can be used again', () => {
  it('is not removal that sacrifices itself', () => {
    expect(isRepeatableRemoval(card('Sunset Strikemaster', 'Creature — Human Monk', '{T}: Add {R}.\n{2}{R}, {T}, Sacrifice this creature: It deals 6 damage to target creature with flying.'))).toBe(false);
    expect(isRepeatableRemoval(card('Goblin Tinkerer', 'Creature — Goblin Artificer', '{R}, {T}: Destroy target artifact. That artifact deals damage equal to its mana value to this creature.'))).toBe(true);
  });
});
