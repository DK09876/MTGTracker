/**
 * Profiles keep lists apart.
 *
 * Each test gets its own database file. DB_PATH is read when the module
 * loads, so the module is re-imported after pointing it somewhere new.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Database } from 'node-sqlite3-wasm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-db-'));
  path = join(dir, 'mtg.db');
  vi.stubEnv('MTG_DB_PATH', path);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const load = () => import('./db');
const card = (id: string, name: string) => ({ id, name, prices: { usd: '1.00' } }) as ScryfallCard;

describe('profiles', () => {
  it('keeps each profile\'s lists to itself', async () => {
    const db = await load();
    db.addProfile('dk', 'DK');
    db.addProfile('kevin', 'Kevin');
    const mine = db.createList('dk', 'Azula');
    db.createList('kevin', 'Vivi');

    expect(db.listLists('dk').map((l) => l.name)).toEqual(['Azula']);
    expect(db.listLists('kevin').map((l) => l.name)).toEqual(['Vivi']);
    // Another profile's list reads as missing, not as someone else's.
    expect(db.getList(mine.id, 'kevin')).toBeNull();
    expect(db.getList(mine.id, 'dk')?.name).toBe('Azula');
  });

  it('marks search results with only your own lists', async () => {
    const db = await load();
    db.addProfile('dk', 'DK');
    db.addProfile('kevin', 'Kevin');
    const mine = db.createList('dk', 'Azula');
    const theirs = db.createList('kevin', 'Burn');
    db.addCardToList(mine.id, card('bolt', 'Lightning Bolt'));
    db.addCardToList(theirs.id, card('bolt', 'Lightning Bolt'));

    expect(db.listsHolding(['bolt'], 'dk')).toEqual({ bolt: ['Azula'] });
    expect(db.listsHolding(['bolt'], 'kevin')).toEqual({ bolt: ['Burn'] });
    expect(db.listsHolding(['bolt'], null)).toEqual({});
  });

  it('knows only profiles that exist', async () => {
    const db = await load();
    db.addProfile('dk', 'DK');
    expect(db.knownProfile('dk')).toBe('dk');
    expect(db.knownProfile('nobody')).toBeNull();
    expect(db.knownProfile(null)).toBeNull();
    expect(db.listProfiles()).toEqual([{ id: 'dk', name: 'DK' }]);
  });

  it('gives lists made before profiles existed to DK', async () => {
    // The shape of the database as deployed before this change.
    const old = new Database(path);
    old.run(`CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    old.run(`INSERT INTO lists VALUES ('old-1', 'My deck', '', '2026-09-22', '2026-09-22')`);
    old.close();

    const db = await load();
    expect(db.listLists('dk').map((l) => l.name)).toEqual(['My deck']);
    expect(db.listLists('kevin')).toEqual([]);
  });

  it('makes a profile from a name, and never merges two people with the same one', async () => {
    const db = await load();
    expect(db.createProfile('Kevin')).toEqual({ id: 'kevin', name: 'Kevin' });
    expect(db.createProfile('kevin')).toEqual({ id: 'kevin-2', name: 'kevin' });
    expect(db.createProfile('Zoë R.')).toEqual({ id: 'zoe-r', name: 'Zoë R.' });
    expect(db.createProfile('!!!').id).toBe('player');
  });
});

describe('decks', () => {
  const kratos = { id: 'kratos', name: 'Kratos, God of War', prices: { usd: '5.00' } } as ScryfallCard;

  it('are lists with a commander, kept apart from plain lists', async () => {
    const db = await load();
    db.addProfile('dk', 'DK');
    db.createList('dk', 'Trade binder');
    const deck = db.createList('dk', 'Kratos', '', { kind: 'deck', commander: kratos });
    db.addCardToList(deck.id, card('bolt', 'Lightning Bolt'), 1);

    expect(db.listLists('dk', 'list').map((l) => l.name)).toEqual(['Trade binder']);
    const [stored] = db.listLists('dk', 'deck');
    expect(stored).toMatchObject({ name: 'Kratos', kind: 'deck', commander: { name: 'Kratos, God of War' } });
    // A Commander deck is 100 cards with the commander: it counts, and its price with it.
    expect(stored.totalCards).toBe(2);
    expect(stored.totalValue).toBeCloseTo(6);
    expect(db.listLists('dk').map((l) => l.name)).toEqual(['Trade binder', 'Kratos']);
  });

  it('can change or clear their commander', async () => {
    const db = await load();
    db.addProfile('dk', 'DK');
    const deck = db.createList('dk', 'Deck', '', { kind: 'deck' });
    expect(db.getList(deck.id, 'dk')?.commander).toBeNull();
    db.setCommander(deck.id, kratos);
    expect(db.getList(deck.id, 'dk')?.commander?.name).toBe('Kratos, God of War');
    db.setCommander(deck.id, null);
    expect(db.getList(deck.id, 'dk')?.commander).toBeNull();
  });

  it('prices foil and etched copies as what they are', async () => {
    const db = await load();
    db.addProfile('dk', 'DK');
    const list = db.createList('dk', 'Binder');
    const priced = (id: string, prices: object) => ({ id, name: id, prices }) as ScryfallCard;
    db.addCardToList(list.id, priced('a', { usd: '1.00', usd_foil: '5.00' }), 2, 'foil');
    db.addCardToList(list.id, priced('b', { usd: '1.00', usd_etched: '9.00' }), 1, 'etched');
    db.addCardToList(list.id, priced('c', { usd: null, usd_foil: '3.00' }), 1);
    expect(db.getList(list.id, 'dk')!.totalValue).toBeCloseTo(2 * 5 + 9 + 3);
    expect(db.cardsInList(list.id).map((c) => c.finish)).toEqual(['foil', 'etched', 'nonfoil']);
  });

  it('can promote a card in the deck to commander, taking it out of the 99', async () => {
    const db = await load();
    db.addProfile('dk', 'DK');
    const deck = db.createList('dk', 'Flat import', '', { kind: 'deck' });
    db.addCardToList(deck.id, kratos, 1, 'foil');
    db.addCardToList(deck.id, card('bolt', 'Lightning Bolt'), 1);

    expect(db.promoteToCommander(deck.id, 'kratos')).toBe(true);
    const after = db.getList(deck.id, 'dk')!;
    expect([after.commander?.name, after.commanderFinish, after.totalCards]).toEqual(['Kratos, God of War', 'foil', 2]);
    expect(db.cardsInList(deck.id).map((c) => c.card.name)).toEqual(['Lightning Bolt']);
    expect(db.promoteToCommander(deck.id, 'not-in-deck')).toBe(false);
  });
});
