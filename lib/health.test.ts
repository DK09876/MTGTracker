/** Reading a deck as a whole. */

import { describe, expect, it } from 'vitest';

import { analyse, copyLimit, deckFlags, fetchedColors, pips } from './health';
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

  it('warns only about what makes the deck not legal: colours, copies, bans', () => {
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
    // The size is the deck's state, not a warning (lib/hard-checks.ts).
    expect(byTitle['29 cards, not 100']).toBeUndefined();
    expect(byTitle["2 cards outside Hearthhull's colours"].cards).toEqual(['Counterspell', 'Rhystic Study']);
    expect(byTitle['More than one copy of a card'].cards).toEqual(['2× Lightning Bolt']);
    expect(byTitle['Banned in Commander'].cards).toEqual(['Mana Crypt']);
    // Game Changers are counted with the bracket, not warned about.
    expect(byTitle['1 Game Changer']).toBeUndefined();
    expect(h.gameChangers).toEqual(['Rhystic Study']);
    expect(h.warnings.every((w) => w.level === 'critical')).toBe(true);
  });

  it('asks for a commander when there is none, and does not count basics as duplicates', () => {
    const h = analyse({ commander: null, cards: deck });
    expect(h.warnings.map((w) => w.title)).toEqual(['No commander']);
  });
});

describe('fetchedColors', () => {
  const basics = new Set(['G', 'B'] as const);
  const lands = new Set(['G', 'B', 'R'] as const);
  const text = (oracle_text: string) => card('x', { oracle_text });

  it.each([
    ['Wooded Foothills', 'Search your library for a Mountain or Forest card, put it onto the battlefield, then shuffle.', ['R', 'G']],
    ['Farseek', 'Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped.', ['W', 'U', 'B', 'R']],
    ['Cabaretti Courtyard', 'When you do, search your library for a basic Mountain, Forest, or Plains card, put it onto the battlefield tapped.', ['W', 'R', 'G']],
    ['Cultivate', 'Search your library for up to two basic land cards, reveal those cards.', ['B', 'G']],
    ['Myriad Landscape', '{2}, {T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type.', ['B', 'G']],
    ['Crop Rotation', 'Search your library for a land card, put that card onto the battlefield, then shuffle.', ['B', 'R', 'G']],
    ['Lightning Bolt', 'Lightning Bolt deals 3 damage to any target.', []],
  ])('%s fetches %j', (_name, oracle, expected) => {
    const order = ['W', 'U', 'B', 'R', 'G'];
    expect([...fetchedColors(text(oracle), basics, lands)].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(expected);
  });

  it('counts fetch lands and land-fetching spells as colour sources', () => {
    const h = analyse({
      commander: hull,
      cards: [
        { card: land('Forest', ['G'], { type_line: 'Basic Land — Forest' }), quantity: 5 },
        { card: land('Swamp', ['B'], { type_line: 'Basic Land — Swamp' }), quantity: 3 },
        { card: card('Evolving Wilds', { type_line: 'Land', oracle_text: '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card.' }), quantity: 1 },
        { card: card('Cultivate', { type_line: 'Sorcery', mana_cost: '{2}{G}', oracle_text: 'Search your library for up to two basic land cards.' }), quantity: 1 },
      ],
    });
    const green = h.colors.find((c) => c.color === 'G')!;
    const black = h.colors.find((c) => c.color === 'B')!;
    expect([green.landSources, green.otherSources]).toEqual([6, 1]);
    expect(green.fetchLandSources).toBe(1);
    expect([black.landSources, black.otherSources]).toEqual([4, 1]);
    // No basic Mountain, so fetching "a basic land" cannot find red.
    expect(h.colors.find((c) => c.color === 'R')!.landSources).toBe(0);
  });
});

describe('colour sources', () => {
  it('reads Karsten\'s table, one more for gold', async () => {
    const { sourcesNeeded } = await import('./health');
    expect(sourcesNeeded(1, 1)).toBe(19);
    expect(sourcesNeeded(2, 3)).toBe(28);
    expect(sourcesNeeded(3, 3)).toBe(36);
    expect(sourcesNeeded(1, 9)).toBe(14);
    expect(sourcesNeeded(2, 2, true)).toBe(31);
    // Two pips on a one-drop cannot happen; the first column that exists is used.
    expect(sourcesNeeded(2, 1)).toBe(30);
  });
});

describe('copyLimit', () => {
  it('allows one, any number of basics and Rats, and the number a card names', () => {
    expect(copyLimit(card('Sol Ring'))).toBe(1);
    expect(copyLimit(card('Mountain', { type_line: 'Basic Land — Mountain' }))).toBe(Infinity);
    expect(copyLimit(card('Relentless Rats', { oracle_text: 'A deck can have any number of cards named Relentless Rats.' }))).toBe(Infinity);
    expect(copyLimit(card('Seven Dwarves', { oracle_text: 'A deck can have up to seven cards named Seven Dwarves.' }))).toBe(7);
    expect(copyLimit(card('Nazgûl', { oracle_text: 'A deck can have up to nine cards named Nazgûl.' }))).toBe(9);
  });
});

describe('deckFlags', () => {
  const tymna = card('Tymna the Weaver', { color_identity: ['W', 'B'], type_line: 'Legendary Creature — Human Cleric' });
  const kraum = card('Kraum, Ludevic\'s Opus', { color_identity: ['U', 'R'], type_line: 'Legendary Creature — Zombie Horror' });
  const bolt = card('Lightning Bolt', { color_identity: ['R'] });
  const growth = card('Rampant Growth', { color_identity: ['G'] });

  it('flags extra copies, colours outside both commanders, banned and not legal cards', () => {
    const flags = deckFlags({
      commander: tymna,
      cards: [
        { card: kraum, quantity: 1, slot: 'partner' },
        { card: bolt, quantity: 1 },
        { card: growth, quantity: 1 },
        { card: card('Sol Ring'), quantity: 2 },
        { card: card('Seven Dwarves', { color_identity: ['R'], oracle_text: 'A deck can have up to seven cards named Seven Dwarves.' }), quantity: 7 },
        { card: card('Dockside Extortionist', { color_identity: ['R'], legalities: { commander: 'banned' } }), quantity: 1 },
        { card: card('Chaos Orb', { legalities: { commander: 'not_legal' } }), quantity: 1 },
      ],
    });
    // Bolt is red: Kraum brings red. Rampant Growth is green: neither commander does.
    expect(flags.map((f) => [f.kind, f.name])).toEqual([
      ['colours', 'Rampant Growth'],
      ['copies', 'Sol Ring'],
      ['banned', 'Dockside Extortionist'],
      ['not-legal', 'Chaos Orb'],
    ]);
    expect(flags.find((f) => f.kind === 'copies')).toMatchObject({ quantity: 2, limit: 1 });
  });

  it('flags a banned commander, without a move to fix it', () => {
    const flags = deckFlags({ commander: card('Golos, Tireless Pilgrim', { legalities: { commander: 'banned' } }), cards: [] });
    expect(flags).toEqual([expect.objectContaining({ kind: 'banned', commander: true })]);
  });

  it('counts a second commander in the 100 but not in the library', () => {
    const lands = { card: card('Plains', { type_line: 'Basic Land — Plains' }), quantity: 97 };
    const health = analyse({ commander: tymna, cards: [{ card: kraum, quantity: 1, slot: 'partner' }, lands, { card: bolt, quantity: 1 }] });
    expect(health.size).toBe(100);
    expect(health.hand.library).toBe(98);
    expect(health.warnings.some((w) => /outside/.test(w.title))).toBe(false);
  });
});
