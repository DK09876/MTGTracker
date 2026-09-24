/**
 * Turning a pasted list into cards, with Scryfall's collection endpoint
 * stood in for: it finds what `known` holds, by printing or by name.
 */

import { describe, expect, it, vi } from 'vitest';

import { canLead, resolveDecklist } from './import';
import type { Identifier, ScryfallCard } from './scryfall';

const card = (name: string, set: string, number: string, over: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({ id: `${set}-${number}`, name, set, collector_number: number, type_line: 'Instant', legalities: { commander: 'legal' }, ...over }) as ScryfallCard;

const kratos = card('Kratos, God of War', 'sld', '2207', { type_line: 'Legendary Creature — God Warrior' });
const bolt = card('Lightning Bolt', 'pf19', '1');
const boltDefault = card('Lightning Bolt', 'lea', '161');
const mountain = card('Mountain', 'acr', '107', { type_line: 'Basic Land — Mountain' });
const known = [kratos, bolt, boltDefault, mountain];

function fakeCollection() {
  return vi.fn(async (identifiers: Identifier[]) => {
    const cards: ScryfallCard[] = [];
    const notFound: Identifier[] = [];
    for (const id of identifiers) {
      const hit = 'set' in id
        ? known.find((c) => c.set === id.set && c.collector_number === id.collector_number)
        // By name Scryfall gives its default printing - the first here.
        : known.find((c) => c.name === id.name);
      if (hit) cards.push(hit); else notFound.push(id);
    }
    return { cards, notFound };
  });
}

describe('resolveDecklist', () => {
  it('finds exact printings, and takes the first card as commander when it can be one', async () => {
    const text = '1x Kratos, God of War (SLD) 2207\n1x Lightning Bolt (PF19) 1 *F*\n33x Mountain (ACR) 107';
    const result = await resolveDecklist(text, fakeCollection(), { commanderPicked: null });

    expect(result.commander?.name).toBe('Kratos, God of War');
    expect(result.cards.map((c) => [c.card.id, c.quantity])).toEqual([['pf19-1', 1], ['acr-107', 33]]);
    expect(result.missing).toEqual([]);
  });

  it('falls back to the name when the printing is unknown, and reports what is still missing', async () => {
    const text = '1 Lightning Bolt (XYZ) 999\n1 Made Up Card (ABC) 1';
    const result = await resolveDecklist(text, fakeCollection(), { commanderPicked: null });

    expect(result.cards.map((c) => c.card.id)).toEqual(['pf19-1']);
    expect(result.missing).toEqual(['1 Made Up Card (ABC) 1']);
  });

  it('does not make a commander of a first card that cannot be one', async () => {
    const result = await resolveDecklist('1 Lightning Bolt\n1 Mountain', fakeCollection(), { commanderPicked: null });
    expect(result.commander).toBeNull();
    expect(result.cards).toHaveLength(2);
  });

  it('uses a Commander section wherever it is', async () => {
    const text = 'Deck\n1 Lightning Bolt\nCommander\n1 Kratos, God of War';
    const result = await resolveDecklist(text, fakeCollection(), { commanderPicked: null });
    expect(result.commander?.name).toBe('Kratos, God of War');
    expect(result.cards.map((c) => c.card.name)).toEqual(['Lightning Bolt']);
  });

  it('leaves a commander picked separately out of the 99', async () => {
    const text = '1 Kratos, God of War\n1 Lightning Bolt';
    const result = await resolveDecklist(text, fakeCollection(), { commanderPicked: 'Kratos, God of War' });
    expect(result.commander).toBeNull();
    expect(result.cards.map((c) => c.card.name)).toEqual(['Lightning Bolt']);
  });

  it('adds up repeats and leaves the sideboard out', async () => {
    const text = '1 Lightning Bolt\n2 Lightning Bolt\nSideboard\n1 Mountain';
    const result = await resolveDecklist(text, fakeCollection(), { commanderPicked: null });
    expect(result.cards.map((c) => [c.card.name, c.quantity])).toEqual([['Lightning Bolt', 3]]);
    expect(result.skipped).toBe(1);
  });

  it('makes one request per pass, not one per card', async () => {
    const collection = fakeCollection();
    await resolveDecklist('1 Lightning Bolt (XYZ) 1\n33 Mountain (ACR) 107\n1 Kratos, God of War (SLD) 2207', collection, { commanderPicked: null });
    expect(collection).toHaveBeenCalledTimes(2);
  });
});

describe('canLead', () => {
  it('takes legendary creatures and cards that say so, legal in Commander', () => {
    expect(canLead(kratos)).toBe(true);
    expect(canLead(card('Teferi', 'x', '1', { type_line: 'Legendary Planeswalker — Teferi', oracle_text: 'Teferi can be your commander.' }))).toBe(true);
    expect(canLead(card('Urza\'s Saga', 'x', '2', { type_line: 'Legendary Enchantment Land — Urza\'s Saga' }))).toBe(false);
    expect(canLead({ ...kratos, legalities: { commander: 'banned' } })).toBe(false);
  });

  // Legendary Vehicles and Spacecraft with power and toughness can lead a deck.
  it('takes a legendary Spacecraft with a body, but not one without', () => {
    const hearthhull = card('Hearthhull, the Worldseed', 'eoc', '1', { type_line: 'Legendary Artifact — Spacecraft', power: '6', toughness: '7' });
    expect(canLead(hearthhull)).toBe(true);
    expect(canLead(card('Some Station', 'x', '3', { type_line: 'Legendary Artifact — Spacecraft' }))).toBe(false);
  });
});
