/**
 * Storage. One SQLite file, same shape as LifeOS on the same Pi.
 *
 * A card's whole Scryfall payload is kept as JSON rather than shredded into
 * columns: their schema grows, and the fields worth querying are few enough
 * to project alongside it. Cards are stored once and referenced by lists, so
 * the same card in four decks is one row and one copy of the art.
 *
 * WASM SQLite, not the native addon: better-sqlite3 segfaults on this
 * hardware (Debian 13 aarch64), prebuilt and from source alike.
 */

import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

import { Database } from 'node-sqlite3-wasm';

import type { ScryfallCard } from './scryfall';

const DB_PATH = process.env.MTG_DB_PATH || `${process.cwd()}/data/mtg.db`;

let db: Database | null = null;

function open(): Database {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.run(`
    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      setCode TEXT,
      rarity TEXT,
      usd REAL,
      data TEXT NOT NULL,
      fetchedAt TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS list_cards (
      listId TEXT NOT NULL,
      cardId TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      addedAt TEXT NOT NULL,
      PRIMARY KEY (listId, cardId)
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_list_cards_list ON list_cards (listId);`);
  return db;
}

const now = () => new Date().toISOString();

// --- lists ---------------------------------------------------------------

export interface List {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  cardCount: number;
  totalCards: number;
  totalValue: number;
}

export function listLists(): List[] {
  const rows = open().all(`
    SELECT l.id, l.name, l.note, l.createdAt, l.updatedAt,
           COUNT(lc.cardId)                                   AS cardCount,
           COALESCE(SUM(lc.quantity), 0)                      AS totalCards,
           COALESCE(SUM(lc.quantity * COALESCE(c.usd, 0)), 0) AS totalValue
    FROM lists l
    LEFT JOIN list_cards lc ON lc.listId = l.id
    LEFT JOIN cards c       ON c.id = lc.cardId
    GROUP BY l.id
    ORDER BY l.createdAt
  `) as unknown as List[];
  return rows;
}

export function createList(name: string, note = ''): List {
  const id = randomUUID();
  const stamp = now();
  open().run('INSERT INTO lists (id, name, note, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
    [id, name, note, stamp, stamp]);
  return { id, name, note, createdAt: stamp, updatedAt: stamp, cardCount: 0, totalCards: 0, totalValue: 0 };
}

export function renameList(id: string, name: string, note?: string): void {
  const database = open();
  if (note === undefined) {
    database.run('UPDATE lists SET name = ?, updatedAt = ? WHERE id = ?', [name, now(), id]);
  } else {
    database.run('UPDATE lists SET name = ?, note = ?, updatedAt = ? WHERE id = ?', [name, note, now(), id]);
  }
}

export function deleteList(id: string): void {
  const database = open();
  // The membership rows are meaningless without the list; the cards
  // themselves stay, since other lists may hold them.
  database.run('DELETE FROM list_cards WHERE listId = ?', [id]);
  database.run('DELETE FROM lists WHERE id = ?', [id]);
}

export function getList(id: string): List | null {
  return listLists().find((l) => l.id === id) ?? null;
}

// --- cards ---------------------------------------------------------------

export interface ListedCard {
  card: ScryfallCard;
  quantity: number;
  addedAt: string;
}

/** Store (or refresh) a card, then put it in a list. */
export function addCardToList(listId: string, card: ScryfallCard, quantity = 1): void {
  const database = open();
  const usd = card.prices?.usd ?? card.prices?.usd_foil ?? null;

  database.run(
    `INSERT INTO cards (id, name, setCode, rarity, usd, data, fetchedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, setCode = excluded.setCode, rarity = excluded.rarity,
       usd = excluded.usd, data = excluded.data, fetchedAt = excluded.fetchedAt`,
    [card.id, card.name, card.set ?? null, card.rarity ?? null,
     usd === null ? null : Number(usd), JSON.stringify(card), now()],
  );

  // Adding a card already in the list adds a copy rather than erroring -
  // wanting a second Lightning Bolt is the common case, not a mistake.
  database.run(
    `INSERT INTO list_cards (listId, cardId, quantity, addedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(listId, cardId) DO UPDATE SET quantity = quantity + excluded.quantity`,
    [listId, card.id, quantity, now()],
  );
  database.run('UPDATE lists SET updatedAt = ? WHERE id = ?', [now(), listId]);
}

export function setQuantity(listId: string, cardId: string, quantity: number): void {
  const database = open();
  if (quantity <= 0) {
    database.run('DELETE FROM list_cards WHERE listId = ? AND cardId = ?', [listId, cardId]);
  } else {
    database.run('UPDATE list_cards SET quantity = ? WHERE listId = ? AND cardId = ?',
      [quantity, listId, cardId]);
  }
  database.run('UPDATE lists SET updatedAt = ? WHERE id = ?', [now(), listId]);
}

export function removeCardFromList(listId: string, cardId: string): void {
  setQuantity(listId, cardId, 0);
}

export function cardsInList(listId: string): ListedCard[] {
  const rows = open().all(
    `SELECT c.data, lc.quantity, lc.addedAt
     FROM list_cards lc
     JOIN cards c ON c.id = lc.cardId
     WHERE lc.listId = ?
     ORDER BY c.name`,
    [listId],
  ) as unknown as Array<{ data: string; quantity: number; addedAt: string }>;

  return rows.map((row) => ({
    card: JSON.parse(row.data) as ScryfallCard,
    quantity: row.quantity,
    addedAt: row.addedAt,
  }));
}

/** Which lists already hold a card, so the search results can say so. */
export function listsHolding(cardIds: string[]): Record<string, string[]> {
  if (!cardIds.length) return {};
  const marks = cardIds.map(() => '?').join(',');
  const rows = open().all(
    `SELECT lc.cardId, l.name FROM list_cards lc
     JOIN lists l ON l.id = lc.listId
     WHERE lc.cardId IN (${marks})`,
    cardIds,
  ) as unknown as Array<{ cardId: string; name: string }>;

  const out: Record<string, string[]> = {};
  for (const row of rows) (out[row.cardId] ??= []).push(row.name);
  return out;
}
