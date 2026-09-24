/**
 * "Edit as text", saved: the list becomes exactly the paste - or, if any
 * line cannot be found, nothing changes at all.
 *
 * A real database in a temporary file; Scryfall's collection endpoint is
 * stood in for with a handful of known cards.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Identifier, ScryfallCard } from './scryfall';

const card = (name: string, set: string, number: string, type = 'Instant'): ScryfallCard =>
  ({ id: `${set}-${number}`, name, set, collector_number: number, type_line: type, legalities: { commander: 'legal' } }) as ScryfallCard;

const known = [
  card('Hearthhull, the Worldseed', 'eoc', '1', 'Legendary Artifact — Spacecraft'),
  card('Kratos, God of War', 'sld', '2207', 'Legendary Creature — God'),
  card('Sol Ring', 'soc', '128', 'Artifact'),
  card('Mountain', 'acr', '107', 'Basic Land — Mountain'),
  card('Lightning Bolt', 'pf19', '1'),
];

vi.mock('./scryfall', async (original) => ({
  ...(await original<typeof import('./scryfall')>()),
  collection: async (identifiers: Identifier[]) => {
    const cards: ScryfallCard[] = [];
    for (const id of identifiers) {
      const hit = 'set' in id
        ? known.find((c) => c.set === id.set && c.collector_number === id.collector_number)
        : known.find((c) => c.name === id.name);
      if (hit) cards.push(hit);
    }
    return { cards, notFound: [] };
  },
}));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-replace-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function deckWith(commander: ScryfallCard, cards: Array<[ScryfallCard, number]>) {
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'World Shaper', '', { kind: 'deck', commander });
  for (const [c, n] of cards) db.addCardToList(list.id, c, n);
  return { db, list: db.getList(list.id, 'dk')! };
}

describe('replaceWith', () => {
  it('makes the deck exactly the paste, dropping what is not in it', async () => {
    const { db, list } = await deckWith(known[0], [[known[2], 1], [known[4], 1], [known[3], 2]]);
    const { replaceWith } = await import('./import-into');

    const result = await replaceWith(list, 'Commander\n1 Hearthhull, the Worldseed (EOC) 1\n\nDeck\n1 Sol Ring (SOC) 128\n30 Mountain (ACR) 107');

    expect(result.applied).toBe(true);
    expect(db.cardsInList(list.id).map((c) => [c.card.name, c.quantity])).toEqual([['Mountain', 30], ['Sol Ring', 1]]);
    expect(db.getList(list.id, 'dk')!.commander?.name).toBe('Hearthhull, the Worldseed');
  });

  it('changes nothing when a line cannot be found', async () => {
    const { db, list } = await deckWith(known[0], [[known[2], 1], [known[4], 1]]);
    const { replaceWith } = await import('./import-into');

    const result = await replaceWith(list, '1 Sol Ring (SOC) 128\n1 Lightnig Bolt');

    expect(result.applied).toBe(false);
    expect(result.missing).toEqual(['1 Lightnig Bolt']);
    expect(db.cardsInList(list.id).map((c) => c.card.name)).toEqual(['Lightning Bolt', 'Sol Ring']);
  });

  it('keeps the commander when the paste has no Commander section', async () => {
    const { db, list } = await deckWith(known[0], [[known[2], 1]]);
    const { replaceWith } = await import('./import-into');

    await replaceWith(list, '1 Lightning Bolt (PF19) 1');

    expect(db.getList(list.id, 'dk')!.commander?.name).toBe('Hearthhull, the Worldseed');
    expect(db.cardsInList(list.id).map((c) => c.card.name)).toEqual(['Lightning Bolt']);
  });

  it('switches commander when the Commander section names a new one', async () => {
    const { db, list } = await deckWith(known[0], []);
    const { replaceWith } = await import('./import-into');

    const result = await replaceWith(list, 'Commander\n1 Kratos, God of War (SLD) 2207\nDeck\n1 Sol Ring (SOC) 128');

    expect(result.commander).toBe('Kratos, God of War');
    expect(db.getList(list.id, 'dk')!.commander?.name).toBe('Kratos, God of War');
    expect(db.cardsInList(list.id).map((c) => c.card.name)).toEqual(['Sol Ring']);
  });

  it('round-trips: saving the text it was given changes nothing', async () => {
    const { db, list } = await deckWith(known[0], [[known[2], 1], [known[3], 33]]);
    const { formatDecklist } = await import('./decklist');
    const { replaceWith } = await import('./import-into');
    const before = db.cardsInList(list.id).map((c) => [c.card.id, c.quantity]);

    await replaceWith(list, formatDecklist(list.commander, db.cardsInList(list.id)));

    expect(db.cardsInList(list.id).map((c) => [c.card.id, c.quantity])).toEqual(before);
    expect(db.getList(list.id, 'dk')!.commander?.id).toBe(known[0].id);
  });
});
