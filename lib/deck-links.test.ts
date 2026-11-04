import { describe, expect, it, vi } from 'vitest';

import { DeckLinkError, fetchDeckLink, fromArchidekt, fromMoxfield, parseDeckLink, readDeckBox } from './deck-links';
import { parseDecklist } from './decklist';

describe('deck links', () => {
  it('reads Moxfield and Archidekt links, and nothing else', () => {
    expect(parseDeckLink('https://moxfield.com/decks/VuAN39a1AEiTQ5j8Okefag')).toMatchObject({ site: 'moxfield', id: 'VuAN39a1AEiTQ5j8Okefag' });
    expect(parseDeckLink('https://www.archidekt.com/decks/123456/my_deck')).toMatchObject({ site: 'archidekt', id: '123456' });
    expect(parseDeckLink('https://tappedout.net/mtg-decks/x/')).toBeNull();
  });

  it('asks the owner to keep one when the box has a link and a list, or two links', () => {
    const link = 'https://moxfield.com/decks/VuAN39a1AEiTQ5j8Okefag';
    expect(readDeckBox('').kind).toBe('empty');
    expect(readDeckBox('1 Sol Ring').kind).toBe('list');
    expect(readDeckBox(`  ${link}  `).kind).toBe('link');
    expect(readDeckBox(`${link}\n1 Sol Ring`).kind).toBe('both');
    expect(readDeckBox(`${link}\nhttps://archidekt.com/decks/1`).kind).toBe('links');
    expect(readDeckBox('https://tappedout.net/mtg-decks/x/').kind).toBe('unknown-link');
  });

  it('turns Moxfield\'s boards into sections the importer reads, with printings and foils', () => {
    const deck = fromMoxfield({
      name: 'ZEEUUUUS',
      boards: {
        commanders: { cards: { a: { quantity: 1, isFoil: true, card: { name: 'Kratos, God of War', set: 'sld', cn: '2207' } } } },
        mainboard: { cards: { b: { quantity: 30, card: { name: 'Mountain', set: 'bro', cn: '274' } }, c: { quantity: 1, card: { name: 'Shadowspear', set: 'plst', cn: 'THB-236' } } } },
        maybeboard: { cards: { d: { quantity: 1, isEtched: true, card: { name: 'Arcane Signet', set: 'plst', cn: 'BLC-127' } } } },
        sideboard: { cards: {} },
      },
    });
    expect(deck.name).toBe('ZEEUUUUS');
    const { entries, unreadable } = parseDecklist(deck.text);
    expect(unreadable).toEqual([]);
    expect(entries.map((e) => [e.section, e.quantity, e.name, e.set, e.collectorNumber, e.finish])).toEqual([
      ['commander', 1, 'Kratos, God of War', 'sld', '2207', 'foil'],
      ['main', 30, 'Mountain', 'bro', '274', 'nonfoil'],
      ['main', 1, 'Shadowspear', 'plst', 'THB-236', 'nonfoil'],
      ['maybe', 1, 'Arcane Signet', 'plst', 'BLC-127', 'etched'],
    ]);
  });

  it('puts Archidekt cards on boards by their first category', () => {
    const card = (name: string, categories: string[], modifier = 'Normal') => ({ quantity: 1, categories, modifier, card: { collectorNumber: '1', edition: { editioncode: 'tsp' }, oracleCard: { name } } });
    const deck = fromArchidekt({
      name: 'Fun With Fungus',
      categories: [{ name: 'Commander', includedInDeck: true }, { name: 'Ramp', includedInDeck: true }, { name: 'Considering', includedInDeck: false }, { name: 'Sideboard', includedInDeck: false }],
      cards: [card('Thelon of Havenwood', ['Commander']), card('Cultivate', ['Ramp'], 'Foil'), card('Doubling Season', ['Considering']), card('Pithing Needle', ['Sideboard'])],
    });
    expect(parseDecklist(deck.text).entries.map((e) => [e.section, e.name, e.finish])).toEqual([
      ['commander', 'Thelon of Havenwood', 'nonfoil'], ['main', 'Cultivate', 'foil'], ['side', 'Pithing Needle', 'nonfoil'], ['maybe', 'Doubling Season', 'nonfoil'],
    ]);
  });

  it('says how to copy the list when the site will not share the deck', async () => {
    const link = parseDeckLink('https://moxfield.com/decks/privateDeck123')!;
    await expect(fetchDeckLink(link, vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch))
      .rejects.toThrow(/may be private[\s\S]*Copy for MTGO/);
    await expect(fetchDeckLink(link, vi.fn(async () => new Response('', { status: 403 })) as unknown as typeof fetch)).rejects.toBeInstanceOf(DeckLinkError);
    const ok = vi.fn(async () => new Response(JSON.stringify({ name: 'X', boards: { mainboard: { cards: { a: { quantity: 1, card: { name: 'Sol Ring' } } } } } }), { status: 200 }));
    await expect(fetchDeckLink(link, ok as unknown as typeof fetch)).resolves.toMatchObject({ name: 'X', text: 'Deck\n1 Sol Ring' });
    expect((ok.mock.calls as unknown as string[][])[0][0]).toBe('https://api2.moxfield.com/v3/decks/all/privateDeck123');
  });
});

describe('the deck box', () => {
  it('passes a list through, fetches a link, and refuses both at once', async () => {
    const { deckText } = await import('./deck-links');
    const never = vi.fn();
    await expect(deckText('1 Sol Ring', never as unknown as typeof fetch)).resolves.toEqual({ text: '1 Sol Ring', name: null, site: null });
    await expect(deckText('https://moxfield.com/decks/abcdefg\n1 Sol Ring', never as unknown as typeof fetch)).rejects.toThrow(/Remove one of them/);
    expect(never).not.toHaveBeenCalled();
    const ok = vi.fn(async () => new Response(JSON.stringify({ name: 'Fungus', cards: [] , categories: [] }), { status: 200 }));
    await expect(deckText('https://archidekt.com/decks/1', ok as unknown as typeof fetch)).rejects.toThrow(/no cards/);
  });
});
