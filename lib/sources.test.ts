/**
 * Reading Commander Spellbook and EDHREC.
 *
 * Both are stubbed: the shapes below are trimmed from real responses
 * (2026-09-24), so a change on their side shows up here as a readable
 * failure rather than as an empty page.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { commanderPage, edhrecEnabled, edhrecSlug, edhrecUrl, parseCommanderPage } from './edhrec';
import { combosInDeck, estimateBracket, searchCombos, SpellbookError, toCombo } from './spellbook';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const variant = {
  id: '1369-6586',
  uses: [{ card: { name: 'Vivi Ornitier' } }, { card: { name: 'Quicksilver Elemental' } }],
  produces: [{ feature: { name: 'Infinite red mana' } }, { feature: { name: 'Infinite blue mana' } }],
  description: 'Activate Quicksilver Elemental...\nRepeat.',
  easyPrerequisites: '',
  notablePrerequisites: 'Vivi has power 3 or more.',
  identity: 'UR',
  popularity: 16040,
  prices: { tcgplayer: '55.87', cardmarket: '37.75' },
};

describe('Commander Spellbook', () => {
  it('reads a combo', () => {
    expect(toCombo(variant)).toEqual({
      id: '1369-6586',
      cards: ['Vivi Ornitier', 'Quicksilver Elemental'],
      produces: ['Infinite red mana', 'Infinite blue mana'],
      steps: 'Activate Quicksilver Elemental...\nRepeat.',
      prerequisites: 'Vivi has power 3 or more.',
      identity: 'UR',
      popularity: 16040,
      price: 55.87,
      url: 'https://commanderspellbook.com/combo/1369-6586',
    });
  });

  it('treats a missing price as unknown rather than free', () => {
    expect(toCombo({ ...variant, prices: { tcgplayer: null } }).price).toBeNull();
  });

  it('sends the query, most popular first', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [variant] })));
    vi.stubGlobal('fetch', fetchMock);
    await searchCombos('card:"Vivi Ornitier"');
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get('q')).toBe('card:"Vivi Ornitier"');
    expect(url.searchParams.get('ordering')).toBe('-popularity');
  });

  it('passes Spellbook\'s explanation of a bad query through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ q: ['Invalid search query: unexpected character : at position 6.'] }), { status: 400 },
    )));
    const error = await searchCombos('bogus:thing').catch((e) => e);
    expect(error).toBeInstanceOf(SpellbookError);
    expect(error).toMatchObject({ status: 400, message: 'Invalid search query: unexpected character : at position 6.' });
  });
});

describe('EDHREC', () => {
  it('is off unless switched on', () => {
    vi.stubEnv('MTG_EDHREC', '');
    expect(edhrecEnabled()).toBe(false);
    vi.stubEnv('MTG_EDHREC', 'on');
    expect(edhrecEnabled()).toBe(true);
  });

  it.each([
    ['Fire Lord Azula', 'fire-lord-azula'],
    ['Atraxa, Praetors\' Voice', 'atraxa-praetors-voice'],
    ['The Ur-Dragon', 'the-ur-dragon'],
    ['Lim-Dûl the Necromancer', 'lim-dul-the-necromancer'],
    ['Esika, God of the Tree // The Prismatic Bridge', 'esika-god-of-the-tree'],
  ])('names %s as %s', (name, slug) => {
    expect(edhrecSlug(name)).toBe(slug);
  });

  it('links to the commander page', () => {
    expect(edhrecUrl('Vivi Ornitier')).toBe('https://edhrec.com/commanders/vivi-ornitier');
  });

  it('reads how often each card is played, and EDHREC\'s own lists', () => {
    const page = parseCommanderPage({
      container: { json_dict: {
        card: { num_decks: 37882 },
        cardlists: [
          { header: 'High Synergy Cards', cardviews: [{ name: 'Storm-Kiln Artist', synergy: 0.51, num_decks: 23596, potential_decks: 37882 }] },
          { header: 'Top Cards', cardviews: [
            { name: 'Storm-Kiln Artist', synergy: 0.51, num_decks: 1, potential_decks: 2 },
            { name: 'Sol Ring', synergy: -0.1, num_decks: 30000, potential_decks: 37882 },
          ] },
        ],
      } },
    });
    expect(page?.decks).toBe(37882);
    // A card in two lists keeps the figures from the first.
    expect(page?.stats.get('Storm-Kiln Artist')?.inclusion).toBeCloseTo(0.623, 3);
    expect(page?.stats.size).toBe(2);
    expect(page?.sections).toEqual([
      { header: 'High Synergy Cards', names: ['Storm-Kiln Artist'] },
      { header: 'Top Cards', names: ['Storm-Kiln Artist', 'Sol Ring'] },
    ]);
  });

  it('returns null for a page it does not recognise', () => {
    expect(parseCommanderPage({ something: 'else' })).toBeNull();
  });

  it('asks for each commander at most once while fresh', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      container: { json_dict: { cardlists: [{ cardviews: [{ name: 'Sol Ring', num_decks: 1, potential_decks: 2 }] }] } },
    })));
    vi.stubGlobal('fetch', fetchMock);
    await commanderPage('Cache Test Commander');
    await commanderPage('Cache Test Commander');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('remembers a failure instead of retrying every search', async () => {
    const fetchMock = vi.fn(async () => new Response('<Error/>', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await commanderPage('Unknown Commander')).toBeNull();
    expect(await commanderPage('Unknown Commander')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Commander Spellbook, for a whole deck', () => {
  const deck = { commanders: ['Vivi Ornitier'], main: [{ name: 'Sol Ring', quantity: 1 }, { name: 'Deadeye Navigator', quantity: 1 }] };

  it('sends the deck and names what each near-miss combo lacks', async () => {
    const near = { ...variant, id: '2', uses: [{ card: { name: 'Deadeye Navigator' } }, { card: { name: 'Peregrine Drake' } }] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: { included: [variant], almostIncluded: [near] } })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await combosInDeck(deck);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/find-my-combos$/);
    expect(JSON.parse(init.body as string)).toEqual({
      commanders: [{ card: 'Vivi Ornitier' }],
      main: [{ card: 'Sol Ring', quantity: 1 }, { card: 'Deadeye Navigator', quantity: 1 }],
    });
    expect(result.included.map((c) => c.id)).toEqual(['1369-6586']);
    expect(result.almost[0].missing).toEqual(['Peregrine Drake']);
  });

  it('reads the bracket estimate, keeping only the combos it found relevant', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      bracketTag: 'S',
      cards: [{ card: { name: 'Rhystic Study' }, gameChanger: true, massLandDenial: false, extraTurn: false, banned: false }],
      combos: [
        { combo: variant, relevant: true, definitelyTwoCard: true, speed: 5 },
        { combo: variant, relevant: false, definitelyTwoCard: false, speed: 1 },
      ],
    }))));
    const report = await estimateBracket(deck);
    expect(report.tag).toBe('S');
    expect(report.cards[0]).toMatchObject({ name: 'Rhystic Study', gameChanger: true });
    expect(report.combos).toEqual([{ cards: ['Vivi Ornitier', 'Quicksilver Elemental'], twoCard: true, speed: 5, produces: ['Infinite red mana', 'Infinite blue mana'] }]);
  });
});
