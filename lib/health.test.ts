/** Reading a deck as a whole. */

import { describe, expect, it } from 'vitest';

import { analyse, pips } from './health';
import type { ScryfallCard } from './scryfall';

const card = (name: string, over: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({ id: name, name, type_line: 'Instant', cmc: 1, color_identity: [], legalities: { commander: 'legal' }, ...over }) as ScryfallCard;
const land = (name: string, produced: string[], over: Partial<ScryfallCard> = {}) =>
  card(name, { type_line: 'Land', cmc: 0, produced_mana: produced, ...over });

const hull = card('Hearthhull, the Worldseed', { type_line: 'Legendary Artifact — Spacecraft', cmc: 4, color_identity: ['B', 'R', 'G'] });

describe('pips', () => {
  it('counts coloured symbols, hybrids by halves', () => {
    expect(pips('{2}{B}{B}{G}')).toEqual({ W: 0, U: 0, B: 2, R: 0, G: 1 });
    expect(pips('{B/G}{R/P}{2/G}')).toEqual({ W: 0, U: 0, B: 0.5, R: 1, G: 1.5 });
  });
});

describe('analyse', () => {
  const deck = [
    { card: card('Cultivate', { type_line: 'Sorcery', cmc: 3, mana_cost: '{2}{G}', color_identity: ['G'] }), quantity: 1 },
    { card: card('Infernal Grasp', { cmc: 2, mana_cost: '{1}{B}', color_identity: ['B'] }), quantity: 1 },
    { card: card('Blasphemous Act', { type_line: 'Sorcery', cmc: 9, mana_cost: '{8}{R}', color_identity: ['R'] }), quantity: 1 },
    { card: card('Sol Ring', { type_line: 'Artifact', cmc: 1, mana_cost: '{1}', produced_mana: ['C'] }), quantity: 1 },
    { card: land('Forest', ['G'], { type_line: 'Basic Land — Forest' }), quantity: 6 },
    { card: land('Command Tower', ['W', 'U', 'B', 'R', 'G']), quantity: 1 },
  ];

  it('builds the curve from spells only, with 7+ at the top', () => {
    const h = analyse({ commander: hull, cards: deck });
    expect(h.curve.map((b) => b.count)).toEqual([0, 1, 1, 1, 0, 0, 0, 1]);
    expect(h.curve[7]).toMatchObject({ label: '7+', cards: ['Blasphemous Act'] });
    expect(h.averageMv).toBeCloseTo((3 + 2 + 9 + 1) / 4);
  });

  it('weighs colour demand against the lands that make it', () => {
    const h = analyse({ commander: hull, cards: deck });
    expect(h.colors.map((c) => [c.color, c.pips, c.landSources])).toEqual([['B', 1, 1], ['R', 1, 1], ['G', 1, 7]]);
    expect(h.colors[2].share).toBeCloseTo(1 / 3);
  });

  it('counts the deck with its commander, and opening hands from the rest', () => {
    const h = analyse({ commander: hull, cards: deck });
    expect([h.size, h.lands, h.hand.library]).toEqual([12, 7, 11]);
    expect(h.hand.distribution.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('warns about size, colours, copies, bans and Game Changers', () => {
    const h = analyse({
      commander: hull,
      cards: [
        ...deck,
        { card: card('Counterspell', { color_identity: ['U'] }), quantity: 1 },
        { card: card('Lightning Bolt', { color_identity: ['R'] }), quantity: 2 },
        { card: card('Relentless Rats', { color_identity: ['B'], oracle_text: 'A deck can have any number of cards named Relentless Rats.' }), quantity: 5 },
        { card: card('Seven Dwarves', { color_identity: ['R'], oracle_text: 'A deck can have up to seven cards named Seven Dwarves.' }), quantity: 7 },
        { card: card('Mana Crypt', { legalities: { commander: 'banned' } }), quantity: 1 },
        { card: card('Rhystic Study', { color_identity: ['U'], game_changer: true }), quantity: 1 },
      ],
    });
    const byTitle = Object.fromEntries(h.warnings.map((w) => [w.title, w]));
    expect(byTitle['29 cards, not 100']).toBeDefined();
    expect(byTitle["2 cards outside Hearthhull's colours"].cards).toEqual(['Counterspell', 'Rhystic Study']);
    expect(byTitle['More than one copy of a card'].cards).toEqual(['2× Lightning Bolt']);
    expect(byTitle['Banned in Commander'].cards).toEqual(['Mana Crypt']);
    expect(byTitle['1 Game Changer']).toMatchObject({ level: 'info', cards: ['Rhystic Study'] });
  });

  it('asks for a commander when there is none, and does not count basics as duplicates', () => {
    const h = analyse({ commander: null, cards: deck });
    expect(h.warnings.map((w) => w.title)).toEqual(['No commander', '11 cards, not 100']);
  });
});
