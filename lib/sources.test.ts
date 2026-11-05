/**
 * Reading Commander Spellbook.
 *
 * It is stubbed: the shapes below are trimmed from real responses
 * (2026-09-24), so a change on their side shows up here as a readable
 * failure rather than as an empty page.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

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
      price: 55.87,
      url: 'https://commanderspellbook.com/combo/1369-6586',
    });
  });

  it('treats a missing price as unknown rather than free', () => {
    expect(toCombo({ ...variant, prices: { tcgplayer: null } }).price).toBeNull();
  });

  it('sends the query without popularity ordering, fewest pieces first', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [variant] })));
    vi.stubGlobal('fetch', fetchMock);
    await searchCombos('card:"Vivi Ornitier"');
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get('q')).toBe('card:"Vivi Ornitier"');
    expect(url.searchParams.get('ordering')).toBeNull();
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
