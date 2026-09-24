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

import type { Board } from './decklist';
import type { Finish, ScryfallCard } from './scryfall';

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
  if (!columns.some((c) => c.name === 'commanderFinish')) {
    db.run(`ALTER TABLE lists ADD COLUMN commanderFinish TEXT NOT NULL DEFAULT 'nonfoil'`);
  }
  // Foil and etched copies, so "*F*" in an import survives a round trip
  // and prices use what the card actually is.
  const cardColumns = db.all('PRAGMA table_info(list_cards)') as Array<{ name: string }>;
  if (!cardColumns.some((c) => c.name === 'finish')) {
    db.run(`ALTER TABLE list_cards ADD COLUMN finish TEXT NOT NULL DEFAULT 'nonfoil'`);
  }
  // Main, sideboard or maybeboard. A card sits on one board at a time.
  if (!cardColumns.some((c) => c.name === 'board')) {
    db.run(`ALTER TABLE list_cards ADD COLUMN board TEXT NOT NULL DEFAULT 'main'`);
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
  /** A deck's commander, stored like any other card. Counted in the totals. */
  commander: ScryfallCard | null;
  commanderFinish: Finish;
}

/** A card's price for a finish, in SQL - the same fallbacks as priceOf in scryfall.ts. */
const PRICE = (finish: string, card: string) => `COALESCE(CAST(CASE ${finish}
    WHEN 'foil'   THEN COALESCE(json_extract(${card}.data, '$.prices.usd_foil'), json_extract(${card}.data, '$.prices.usd'))
    WHEN 'etched' THEN COALESCE(json_extract(${card}.data, '$.prices.usd_etched'), json_extract(${card}.data, '$.prices.usd_foil'), json_extract(${card}.data, '$.prices.usd'))
    ELSE COALESCE(json_extract(${card}.data, '$.prices.usd'), json_extract(${card}.data, '$.prices.usd_foil'))
  END AS REAL), 0)`;

/**
 * A profile's lists, or only its decks or only its plain lists.
 * Counts and value are the main board plus the commander: a Commander deck
 * is 100 cards, and the sideboard and maybeboard are not in it.
 */
export function listLists(profileId: string, kind?: ListKind): List[] {
  const rows = open().all(`
    SELECT l.id, l.kind, l.name, l.note, l.createdAt, l.updatedAt, l.commanderFinish,
           cm.data                                            AS commanderData,
           COUNT(CASE WHEN lc.board = 'main' THEN 1 END) + (l.commanderId IS NOT NULL) AS cardCount,
           COALESCE(SUM(CASE WHEN lc.board = 'main' THEN lc.quantity END), 0) + (l.commanderId IS NOT NULL) AS totalCards,
           COALESCE(SUM(CASE WHEN lc.board = 'main' THEN lc.quantity * ${PRICE('lc.finish', 'c')} END), 0)
             + COALESCE(MAX(${PRICE('l.commanderFinish', 'cm')}), 0) AS totalValue
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
  { kind = 'list', commander = null, commanderFinish = 'nonfoil' }:
    { kind?: ListKind; commander?: ScryfallCard | null; commanderFinish?: Finish } = {},
): List {
  const id = randomUUID();
  const stamp = now();
  if (commander) storeCard(commander);
  open().run(
    'INSERT INTO lists (id, profileId, kind, name, note, commanderId, commanderFinish, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, profileId, kind, name, note, commander?.id ?? null, commanderFinish, stamp, stamp],
  );
  return {
    id, kind, name, note, createdAt: stamp, updatedAt: stamp, commander, commanderFinish,
    cardCount: commander ? 1 : 0, totalCards: commander ? 1 : 0, totalValue: 0,
  };
}

/**
 * Make a card already in the deck its commander: it leaves the 99 (one
 * copy of it) and takes the commander slot with its finish. For a flat
 * decklist, where the commander is one line among the rest.
 */
export function promoteToCommander(listId: string, cardId: string): boolean {
  const database = open();
  const row = database.get(
    `SELECT c.data, lc.quantity, lc.finish FROM list_cards lc JOIN cards c ON c.id = lc.cardId
     WHERE lc.listId = ? AND lc.cardId = ?`, [listId, cardId],
  ) as { data: string; quantity: number; finish: Finish } | null;
  if (!row) return false;
  database.run('BEGIN');
  try {
    if (row.quantity > 1) {
      database.run('UPDATE list_cards SET quantity = quantity - 1 WHERE listId = ? AND cardId = ?', [listId, cardId]);
    } else {
      database.run('DELETE FROM list_cards WHERE listId = ? AND cardId = ?', [listId, cardId]);
    }
    setCommander(listId, JSON.parse(row.data) as ScryfallCard, row.finish);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
  return true;
}

/** Set or clear a deck's commander. */
export function setCommander(listId: string, commander: ScryfallCard | null, finish: Finish = 'nonfoil'): void {
  if (commander) storeCard(commander);
  open().run('UPDATE lists SET commanderId = ?, commanderFinish = ?, updatedAt = ? WHERE id = ?',
    [commander?.id ?? null, finish, now(), listId]);
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
  finish: Finish;
  board: Board;
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
export function addCardToList(
  listId: string, card: ScryfallCard, quantity = 1, finish: Finish = 'nonfoil', board: Board = 'main',
): void {
  const database = open();
  storeCard(card);

  // Adding a card already in the list adds a copy rather than erroring -
  // wanting a second Lightning Bolt is the common case, not a mistake.
  // Adding to the board it is already on adds a copy; adding to another
  // board moves it there, as a card sits on one board at a time.
  database.run(
    `INSERT INTO list_cards (listId, cardId, quantity, finish, board, addedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(listId, cardId) DO UPDATE SET
       quantity = CASE WHEN board = excluded.board THEN quantity + excluded.quantity ELSE excluded.quantity END,
       board = excluded.board`,
    [listId, card.id, quantity, finish, board, now()],
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

/**
 * Make a list hold exactly these cards, in one transaction - for a deck
 * edited as text and saved back. Either all of it applies or none does.
 */
export function replaceListCards(
  listId: string, items: Array<{ card: ScryfallCard; quantity: number; finish?: Finish; board?: Board }>,
): void {
  const database = open();
  database.run('BEGIN');
  try {
    database.run('DELETE FROM list_cards WHERE listId = ?', [listId]);
    for (const { card, quantity, finish = 'nonfoil', board = 'main' } of items) {
      storeCard(card);
      database.run(
        `INSERT INTO list_cards (listId, cardId, quantity, finish, board, addedAt) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(listId, cardId) DO UPDATE SET quantity = quantity + excluded.quantity`,
        [listId, card.id, quantity, finish, board, now()],
      );
    }
    database.run('UPDATE lists SET updatedAt = ? WHERE id = ?', [now(), listId]);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

/** Move a card to another board, or change its printing or finish. */
export function updateListCard(
  listId: string, cardId: string,
  change: { board?: Board; finish?: Finish; printing?: ScryfallCard },
): boolean {
  const database = open();
  const row = database.get('SELECT quantity FROM list_cards WHERE listId = ? AND cardId = ?', [listId, cardId]);
  if (!row) return false;
  database.run('BEGIN');
  try {
    if (change.board) database.run('UPDATE list_cards SET board = ? WHERE listId = ? AND cardId = ?', [change.board, listId, cardId]);
    if (change.finish) database.run('UPDATE list_cards SET finish = ? WHERE listId = ? AND cardId = ?', [change.finish, listId, cardId]);
    if (change.printing && change.printing.id !== cardId) {
      storeCard(change.printing);
      // The new printing takes over the row; one already in the list absorbs it.
      const existing = database.get('SELECT 1 FROM list_cards WHERE listId = ? AND cardId = ?', [listId, change.printing.id]);
      if (existing) {
        database.run(
          `UPDATE list_cards SET quantity = quantity + (SELECT quantity FROM list_cards WHERE listId = ? AND cardId = ?)
           WHERE listId = ? AND cardId = ?`, [listId, cardId, listId, change.printing.id],
        );
        database.run('DELETE FROM list_cards WHERE listId = ? AND cardId = ?', [listId, cardId]);
      } else {
        database.run('UPDATE list_cards SET cardId = ? WHERE listId = ? AND cardId = ?', [change.printing.id, listId, cardId]);
      }
    }
    database.run('UPDATE lists SET updatedAt = ? WHERE id = ?', [now(), listId]);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
  return true;
}

export function removeCardFromList(listId: string, cardId: string): void {
  setQuantity(listId, cardId, 0);
}

export function cardsInList(listId: string): ListedCard[] {
  const rows = open().all(
    `SELECT c.data, lc.quantity, lc.finish, lc.board, lc.addedAt
     FROM list_cards lc
     JOIN cards c ON c.id = lc.cardId
     WHERE lc.listId = ?
     ORDER BY c.name`,
    [listId],
  ) as unknown as Array<{ data: string; quantity: number; finish: Finish; board: Board; addedAt: string }>;

  return rows.map((row) => ({
    card: JSON.parse(row.data) as ScryfallCard,
    quantity: row.quantity,
    finish: row.finish,
    board: row.board,
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
