/**
 * The collection and the copies decks take from it. Each test gets its own
 * database file, as in db.test.ts.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-col-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const load = async () => ({ db: await import('./db'), col: await import('./collection') });

/** A printing: same oracle id for every printing of a card. */
const printing = (id: string, oracle: string, name: string, set = 'abc', usd = '1.00') =>
  ({ id, oracle_id: oracle, name, set, collector_number: '1', prices: { usd } }) as ScryfallCard;
const solRingC21 = printing('sol-c21', 'sol', 'Sol Ring', 'c21', '1.50');
const solRingSld = printing('sol-sld', 'sol', 'Sol Ring', 'sld', '12.00');
const opt = printing('opt-1', 'opt', 'Opt');
const hearthhull = printing('hh-1', 'hh', 'Hearthhull, the Worldseed', 'eoc', '3.00');

async function setup() {
  const { db, col } = await load();
  const deck = db.createList('dk', 'World Shaper', '', { kind: 'deck', commander: hearthhull });
  const other = db.createList('dk', 'Vorthos', '', { kind: 'deck' });
  return { db, col, deck, other };
}

const holding = (col: typeof import('./collection'), listId: string, key: string) =>
  col.ownership({ id: listId }).cards.find((h) => h.key === key)!;

describe('the collection', () => {
  it('keeps copies by printing, finish and box, and counts boxes', async () => {
    const { col } = await load();
    col.addToCollection('dk', solRingC21, 2, 'nonfoil', 'Binder');
    col.addToCollection('dk', solRingC21, 1, 'foil');
    col.addToCollection('dk', opt, 4);
    expect(col.locations('dk').map((l) => [l.name, l.count])).toEqual([['', 5], ['Binder', 2]]);
    col.moveCopies('dk', { cardId: 'opt-1', finish: 'nonfoil', location: '' }, { location: 'Binder' }, 3);
    expect(col.locations('dk').map((l) => [l.name, l.count])).toEqual([['', 2], ['Binder', 5]]);
    col.setCollectionCount('dk', 'opt-1', 'nonfoil', 'Binder', 0);
    expect(col.boxCopies('dk').map((c) => `${c.card.id} ${c.finish} ${c.location || '-'} ${c.quantity}`).sort()).toEqual([
      'opt-1 nonfoil - 1', 'sol-c21 foil - 1', 'sol-c21 nonfoil Binder 2',
    ]);
  });
});

describe('decks taking copies', () => {
  it('satisfies a deck with any printing, preferring the one it lists, and takes it out of the box', async () => {
    const { db, col, deck } = await setup();
    db.addCardToList(deck.id, solRingSld);
    col.addToCollection('dk', solRingC21, 1, 'nonfoil', 'Binder');
    col.addToCollection('dk', solRingSld, 1, 'nonfoil', 'Box 2');
    expect(holding(col, deck.id, 'sol').status).toBe('in-box');
    expect(holding(col, deck.id, 'sol').inBoxes[0]).toMatchObject({ cardId: 'sol-sld', exact: true });

    expect(col.pull(deck.id, 'sol')).toBe(1);
    const h = holding(col, deck.id, 'sol');
    expect(h).toMatchObject({ status: 'in-deck', pulled: 1, short: 0 });
    expect(h.pulledCopies).toEqual([expect.objectContaining({ cardId: 'sol-sld', fromLocation: 'Box 2' })]);
    // Owned is boxes plus decks: the other copy is still in the binder.
    expect(col.boxCopies('dk').map((c) => c.card.id)).toEqual(['sol-c21']);
  });

  it('counts the commander, and a plain list wants nothing', async () => {
    const { db, col, deck } = await setup();
    expect(holding(col, deck.id, 'hh')).toMatchObject({ need: 1, status: 'missing', price: 3 });
    const wishlist = db.createList('dk', 'Ideas', '');
    db.addCardToList(wishlist.id, opt);
    expect(col.ownership({ id: wishlist.id }).cards).toEqual([]);
  });

  it('finds a copy another deck holds, and takes it from there', async () => {
    const { db, col, deck, other } = await setup();
    db.addCardToList(deck.id, solRingC21);
    db.addCardToList(other.id, solRingC21);
    col.addToCollection('dk', solRingC21, 1);
    col.pull(other.id, 'sol');
    expect(holding(col, deck.id, 'sol')).toMatchObject({ status: 'in-other-deck', inDecks: [{ listName: 'Vorthos', quantity: 1 }] });
    expect(col.takeFromDeck(deck.id, other.id, 'sol')).toBe(1);
    expect(holding(col, deck.id, 'sol').status).toBe('in-deck');
    expect(holding(col, other.id, 'sol').status).toBe('in-other-deck');
  });

  it('puts copies back where they came from when the deck stops wanting them', async () => {
    const { db, col, deck } = await setup();
    db.addCardToList(deck.id, opt, 2);
    col.addToCollection('dk', opt, 2, 'nonfoil', 'Blue box');
    col.pull(deck.id, 'opt');
    db.setQuantity(deck.id, 'opt-1', 1);
    expect(col.boxCopies('dk').map((c) => [c.location, c.quantity])).toEqual([['Blue box', 1]]);
    db.updateListCard(deck.id, 'opt-1', { board: 'maybe' });
    expect(col.boxCopies('dk').map((c) => [c.location, c.quantity])).toEqual([['Blue box', 2]]);
  });

  it('gives everything back when a deck is deleted or pasted over', async () => {
    const { db, col, deck } = await setup();
    db.addCardToList(deck.id, opt);
    col.addToCollection('dk', opt, 1, 'nonfoil', 'A');
    col.addToCollection('dk', hearthhull, 1, 'foil', 'B');
    expect(col.pullAll(deck.id)).toBe(2);
    db.replaceListCards(deck.id, []);
    expect(col.boxCopies('dk').map((c) => [c.card.id, c.location])).toEqual([['opt-1', 'A']]);
    db.deleteList(deck.id);
    expect(col.boxCopies('dk').map((c) => [c.card.id, c.location]).sort()).toEqual([['hh-1', 'B'], ['opt-1', 'A']]);
    expect(col.deckCopies('dk')).toEqual([]);
  });

  it('returns the old commander when it changes', async () => {
    const { db, col, deck } = await setup();
    col.addToCollection('dk', hearthhull, 1);
    col.pull(deck.id, 'hh');
    db.setCommander(deck.id, opt);
    expect(col.boxCopies('dk').map((c) => c.card.id)).toEqual(['hh-1']);
  });

  it('lets proxies fill a slot, returning a real copy the deck then has spare', async () => {
    const { db, col, deck } = await setup();
    db.addCardToList(deck.id, opt);
    col.addToCollection('dk', opt, 1);
    col.pull(deck.id, 'opt');
    col.setProxies(deck.id, 'opt-1', 1);
    expect(holding(col, deck.id, 'opt')).toMatchObject({ status: 'proxy', pulled: 0, proxies: 1 });
    expect(col.boxCopies('dk')).toHaveLength(1);
  });

  it('keeps pulled copies attached to a renamed box, and unsorted after one is deleted', async () => {
    const { db, col, deck } = await setup();
    db.addCardToList(deck.id, opt);
    col.addToCollection('dk', opt, 1, 'nonfoil', 'Old');
    col.pull(deck.id, 'opt');
    col.renameLocation('dk', 'Old', 'New');
    expect(holding(col, deck.id, 'opt').pulledCopies[0].fromLocation).toBe('New');
    col.deleteLocation('dk', 'New');
    col.giveBack(deck.id);
    expect(col.boxCopies('dk').map((c) => c.location)).toEqual(['']);
  });

  it('sums what a deck has, can pull, can take, and must buy', async () => {
    const { db, col, deck, other } = await setup();
    db.addCardToList(deck.id, opt);
    db.addCardToList(deck.id, solRingSld);
    db.addCardToList(other.id, opt);
    col.addToCollection('dk', opt, 1, 'nonfoil', 'Blue box');
    col.pull(other.id, 'opt');
    const { summary } = col.ownership({ id: deck.id });
    expect(summary).toMatchObject({ need: 3, inDeck: 0, inBoxes: 0, inOtherDecks: 1, missing: 2, missingCost: 15 });
    const { fetch, buy } = col.fetchList(col.ownership({ id: deck.id }));
    expect(fetch).toContain('In Vorthos:\n1 Opt');
    expect(buy).toBe('1 Hearthhull, the Worldseed\n1 Sol Ring');
  });
});
