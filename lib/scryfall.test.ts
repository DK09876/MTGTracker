/**
 * Reading a card.
 *
 * Most of Magic's awkwardness lives in double-faced cards: the image, the
 * mana cost and the type line all move onto the faces, and code that only
 * looks at the top level shows a blank where half the card should be.
 */

import { describe, expect, it } from 'vitest';

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
