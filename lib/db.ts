/**
 * Storage. One SQLite file, same shape as LifeOS on the same Pi.
 *
 * A card's whole Scryfall payload is kept as JSON rather than shredded into
 * columns: their schema grows, and the fields worth querying are few enough
 * to project alongside it. Cards are stored once and referenced by lists, so
 * the same card in four decks is one row and one copy of the art.
 *
 * Lists belong to a profile, as LifeOS's records do, so friends sharing the
 * app keep separate decks. Cards are shared: a card's Scryfall data is the
 * same whoever added it. This is separation, not security - anyone who can
 * reach the app can pick any profile, which is fine on a private tailnet.
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
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);
  // Lists made before profiles existed were all DK's.
  const columns = db.all('PRAGMA table_info(lists)') as Array<{ name: string }>;
  if (!columns.some((c) => c.name === 'profileId')) {
    db.run(`ALTER TABLE lists ADD COLUMN profileId TEXT NOT NULL DEFAULT '${LEGACY_PROFILE}'`);
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_lists_profile ON lists (profileId);`);
  // A deck is a list with a commander. Same table, so it gets profiles,
  // quantities, prices and the list filter without a second copy of each.
  if (!columns.some((c) => c.name === 'kind')) {
    db.run(`ALTER TABLE lists ADD COLUMN kind TEXT NOT NULL DEFAULT 'list'`);
  }
  if (!columns.some((c) => c.name === 'commanderId')) {
    db.run('ALTER TABLE lists ADD COLUMN commanderId TEXT');
  }
  return db;
}

const LEGACY_PROFILE = 'dk';

const now = () => new Date().toISOString();

// --- profiles ------------------------------------------------------------

export interface Profile {
  id: string;
  name: string;
}

export function listProfiles(): Profile[] {
  return open().all('SELECT id, name FROM profiles ORDER BY createdAt') as unknown as Profile[];
}

/** The profile id if it exists, else null - so a typo cannot create lists nobody can see. */
export function knownProfile(id: string | null): string | null {
  if (!id) return null;
  const row = open().get('SELECT id FROM profiles WHERE id = ?', [id]) as { id: string } | null;
  return row?.id ?? null;
}

export function addProfile(id: string, name: string): Profile {
  open().run('INSERT INTO profiles (id, name, createdAt) VALUES (?, ?, ?)', [id, name, now()]);
  return { id, name };
}

/**
 * A new profile from just a display name, as the app's "Add a profile"
 * does. The id is made from the name - "Kevin" is `kevin` - and a second
 * "Kevin" becomes `kevin-2` rather than joining the first one's lists.
 */
export function createProfile(name: string): Profile {
  const base = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
  let id = base;
  for (let n = 2; knownProfile(id); n++) id = `${base}-${n}`;
  return addProfile(id, name);
}

// --- lists ---------------------------------------------------------------

export type ListKind = 'list' | 'deck';

export interface List {
  id: string;
  kind: ListKind;
  name: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  cardCount: number;
  totalCards: number;
  totalValue: number;
  /** A deck's commander, stored like any other card. Not counted in the totals. */
  commander: ScryfallCard | null;
}

/** A profile's lists, or only its decks or only its plain lists. */
export function listLists(profileId: string, kind?: ListKind): List[] {
  const rows = open().all(`
    SELECT l.id, l.kind, l.name, l.note, l.createdAt, l.updatedAt,
           cm.data                                            AS commanderData,
           COUNT(lc.cardId)                                   AS cardCount,
           COALESCE(SUM(lc.quantity), 0)                      AS totalCards,
           COALESCE(SUM(lc.quantity * COALESCE(c.usd, 0)), 0) AS totalValue
    FROM lists l
    LEFT JOIN list_cards lc ON lc.listId = l.id
    LEFT JOIN cards c       ON c.id = lc.cardId
    LEFT JOIN cards cm      ON cm.id = l.commanderId
    WHERE l.profileId = ? AND (? IS NULL OR l.kind = ?)
    GROUP BY l.id
    ORDER BY l.createdAt
  `, [profileId, kind ?? null, kind ?? null]) as unknown as Array<Omit<List, 'commander'> & { commanderData: string | null }>;
  return rows.map(({ commanderData, ...row }) => ({
    ...row,
    commander: commanderData ? (JSON.parse(commanderData) as ScryfallCard) : null,
  }));
}

export function createList(
  profileId: string, name: string, note = '',
  { kind = 'list', commander = null }: { kind?: ListKind; commander?: ScryfallCard | null } = {},
): List {
  const id = randomUUID();
  const stamp = now();
  if (commander) storeCard(commander);
  open().run(
    'INSERT INTO lists (id, profileId, kind, name, note, commanderId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, profileId, kind, name, note, commander?.id ?? null, stamp, stamp],
  );
  return { id, kind, name, note, createdAt: stamp, updatedAt: stamp, cardCount: 0, totalCards: 0, totalValue: 0, commander };
}

/** Set or clear a deck's commander. */
export function setCommander(listId: string, commander: ScryfallCard | null): void {
  if (commander) storeCard(commander);
  open().run('UPDATE lists SET commanderId = ?, updatedAt = ? WHERE id = ?', [commander?.id ?? null, now(), listId]);
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

/** A list, only if it belongs to this profile - every route that touches a list checks this first. */
export function getList(id: string, profileId: string): List | null {
  return listLists(profileId).find((l) => l.id === id) ?? null;
}

// --- cards ---------------------------------------------------------------

export interface ListedCard {
  card: ScryfallCard;
  quantity: number;
  addedAt: string;
}

/** Store (or refresh) a card's whole Scryfall record. */
function storeCard(card: ScryfallCard): void {
  const usd = card.prices?.usd ?? card.prices?.usd_foil ?? null;
  open().run(
    `INSERT INTO cards (id, name, setCode, rarity, usd, data, fetchedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, setCode = excluded.setCode, rarity = excluded.rarity,
       usd = excluded.usd, data = excluded.data, fetchedAt = excluded.fetchedAt`,
    [card.id, card.name, card.set ?? null, card.rarity ?? null,
     usd === null ? null : Number(usd), JSON.stringify(card), now()],
  );
}

/** Store (or refresh) a card, then put it in a list. */
export function addCardToList(listId: string, card: ScryfallCard, quantity = 1): void {
  const database = open();
  storeCard(card);

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

/** Which of this profile's lists already hold a card, so the search results can say so. */
export function listsHolding(cardIds: string[], profileId: string | null): Record<string, string[]> {
  if (!cardIds.length || !profileId) return {};
  const marks = cardIds.map(() => '?').join(',');
  const rows = open().all(
    `SELECT lc.cardId, l.name FROM list_cards lc
     JOIN lists l ON l.id = lc.listId
     WHERE l.profileId = ? AND lc.cardId IN (${marks})`,
    [profileId, ...cardIds],
  ) as unknown as Array<{ cardId: string; name: string }>;

  const out: Record<string, string[]> = {};
  for (const row of rows) (out[row.cardId] ??= []).push(row.name);
  return out;
}
