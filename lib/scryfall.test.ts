/**
 * Reading a card.
 *
 * Most of Magic's awkwardness lives in double-faced cards: the image, the
 * mana cost and the type line all move onto the faces, and code that only
 * looks at the top level shows a blank where half the card should be.
 */

import { describe, expect, it, vi } from 'vitest';

import { imageOf, manaCostOf, priceOf, typeLineOf, type ScryfallCard } from './scryfall';

const card = (over: Partial<ScryfallCard>): ScryfallCard => ({ id: 'x', name: 'Card', ...over }) as ScryfallCard;

const normal = card({
  mana_cost: '{1}{R}', type_line: 'Instant',
  image_uris: { small: 's.jpg', normal: 'n.jpg', large: 'l.jpg' },
  prices: { usd: '2.50' },
});

const doubleFaced = card({
  name: 'Delver of Secrets // Insectile Aberration',
  card_faces: [
    { name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard',
      image_uris: { normal: 'front.jpg' } },
    { name: 'Insectile Aberration', mana_cost: '', type_line: 'Creature — Human Insect',
      image_uris: { normal: 'back.jpg' } },
  ],
  prices: { usd: null, usd_foil: '4.00' },
});

describe('imageOf', () => {
  it('takes the top-level image when there is one', () => {
    expect(imageOf(normal)).toBe('n.jpg');
    expect(imageOf(normal, 'large')).toBe('l.jpg');
  });

  it('falls back to the front face', () => {
    expect(imageOf(doubleFaced)).toBe('front.jpg');
  });

  it('returns null rather than undefined when there is no art', () => {
    expect(imageOf(card({}))).toBeNull();
  });
});

describe('manaCostOf', () => {
  it('reads a plain cost', () => {
    expect(manaCostOf(normal)).toBe('{1}{R}');
  });

  it('joins the faces of a split card', () => {
    expect(manaCostOf(card({ card_faces: [{ name: 'A', mana_cost: '{R}' }, { name: 'B', mana_cost: '{G}' }] })))
      .toBe('{R} // {G}');
  });

  it('is empty rather than undefined for a land', () => {
    expect(manaCostOf(card({ type_line: 'Land' }))).toBe('');
  });
});

describe('typeLineOf', () => {
  it('joins both halves when the card has faces', () => {
    expect(typeLineOf(doubleFaced)).toBe('Creature — Human Wizard // Creature — Human Insect');
  });
});

describe('priceOf', () => {
  it('prefers the non-foil price', () => {
    expect(priceOf(normal)).toBe(2.5);
  });

  // A card with no normal printing still has a value worth totalling.
  it('falls back to foil', () => {
    expect(priceOf(doubleFaced)).toBe(4);
  });

  it('is null when Scryfall has no price, so totals can skip it', () => {
    expect(priceOf(card({ prices: { usd: null } }))).toBeNull();
    expect(priceOf(card({}))).toBeNull();
  });

  it('refuses a price that is not a number', () => {
    expect(priceOf(card({ prices: { usd: 'lots' } }))).toBeNull();
  });
});

describe('printingsOf', () => {
  it('asks for every printing, not one per card', async () => {
    const { printingsOf } = await import('./scryfall');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'a', name: 'Cultivate' }], total_cards: 1, has_more: false })));
    vi.stubGlobal('fetch', fetchMock);
    await printingsOf('0e0f2a9e-9a9c-4a47-b2b5-8b8cf1a0c1f1');
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get('unique')).toBe('prints');
    expect(url.searchParams.get('q')).toContain('oracleid:');
    vi.unstubAllGlobals();
  });
});

describe('throttle', () => {
  it('spaces the starts of requests 100ms apart but lets them overlap', async () => {
    const { throttle, MIN_GAP_MS } = await import('./scryfall');
    const starts: number[] = [];
    const t0 = Date.now();
    // Each takes 300ms: run one after another, three would take 900ms.
    const slow = () => { starts.push(Date.now() - t0); return new Promise((r) => setTimeout(r, 300)); };
    await Promise.all([throttle(slow), throttle(slow), throttle(slow)]);
    const elapsed = Date.now() - t0;
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(MIN_GAP_MS - 5);
    expect(elapsed).toBeLessThan(700);
  });
});
