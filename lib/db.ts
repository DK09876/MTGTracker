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
import type { CardTag, DeckTags, Tag, TagKind, TagStatus } from './tags';

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
  // What each card does - ramp, removal... - from Scryfall's tags, by
  // oracle id so every printing shares the answer. `checkedAt` records that
  // a card was looked up, so one with no roles is not looked up again.
  db.run(`CREATE TABLE IF NOT EXISTS card_roles (oracleId TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY (oracleId, role))`);
  db.run(`CREATE TABLE IF NOT EXISTS card_roles_checked (oracleId TEXT PRIMARY KEY, checkedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)`);
  const roleColumns = db.all('PRAGMA table_info(card_roles_checked)') as Array<{ name: string }>;
  if (!roleColumns.some((c) => c.name === 'version')) {
    db.run('ALTER TABLE card_roles_checked ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  }
  // Main, sideboard or maybeboard. A card sits on one board at a time.
  if (!cardColumns.some((c) => c.name === 'board')) {
    db.run(`ALTER TABLE list_cards ADD COLUMN board TEXT NOT NULL DEFAULT 'main'`);
  }
  // A deck's own tags, and which cards carry them - by oracle id, so a new
  // printing keeps its tags. A row with isOn = 0 is the owner taking a tag
  // off a card, kept so the model does not put it back.
  db.run(`
    CREATE TABLE IF NOT EXISTS deck_tags (
      id TEXT PRIMARY KEY,
      listId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL,
      kind TEXT,
      status TEXT NOT NULL,
      origin TEXT NOT NULL,
      position INTEGER NOT NULL,
      examples TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_deck_tags_list ON deck_tags (listId);`);
  db.run(`
    CREATE TABLE IF NOT EXISTS deck_card_tags (
      listId TEXT NOT NULL,
      cardKey TEXT NOT NULL,
      tagId TEXT NOT NULL,
      source TEXT NOT NULL,
      isOn INTEGER NOT NULL DEFAULT 1,
      reason TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (listId, cardKey, tagId)
    );
  `);
  // What the owner wants the deck to do, and the model's reading of it.
  if (!columns.some((c) => c.name === 'tagBrief')) {
    db.run(`ALTER TABLE lists ADD COLUMN tagBrief TEXT NOT NULL DEFAULT ''`);
  }
  if (!columns.some((c) => c.name === 'tagOverview')) {
    db.run(`ALTER TABLE lists ADD COLUMN tagOverview TEXT NOT NULL DEFAULT ''`);
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
  database.run('DELETE FROM deck_card_tags WHERE listId = ?', [id]);
  database.run('DELETE FROM deck_tags WHERE listId = ?', [id]);
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

// --- card roles ----------------------------------------------------------

/** Roles already known for these cards, and which were looked up since `since` under this `version` of the roles. */
export function cachedRoles(oracleIds: string[], since: string, version: number): { roles: Map<string, string[]>; checked: Set<string> } {
  const roles = new Map<string, string[]>();
  const checked = new Set<string>();
  if (!oracleIds.length) return { roles, checked };
  const database = open();
  const marks = oracleIds.map(() => '?').join(',');
  const current = database.all(
    `SELECT oracleId FROM card_roles_checked WHERE checkedAt >= ? AND version = ? AND oracleId IN (${marks})`,
    [since, version, ...oracleIds],
  ) as Array<{ oracleId: string }>;
  for (const row of current) {
    checked.add(row.oracleId);
  }
  for (const row of database.all(`SELECT oracleId, role FROM card_roles WHERE oracleId IN (${marks})`, oracleIds) as Array<{ oracleId: string; role: string }>) {
    roles.set(row.oracleId, [...(roles.get(row.oracleId) ?? []), row.role]);
  }
  return { roles, checked };
}

/** Record what was found for cards just looked up - including finding nothing. */
export function saveRoles(found: Map<string, string[]>, version: number): void {
  const database = open();
  database.run('BEGIN');
  try {
    for (const [oracleId, roles] of found) {
      database.run('DELETE FROM card_roles WHERE oracleId = ?', [oracleId]);
      for (const role of roles) database.run('INSERT INTO card_roles (oracleId, role) VALUES (?, ?)', [oracleId, role]);
      database.run(
        `INSERT INTO card_roles_checked (oracleId, checkedAt, version) VALUES (?, ?, ?)
         ON CONFLICT(oracleId) DO UPDATE SET checkedAt = excluded.checkedAt, version = excluded.version`,
        [oracleId, now(), version],
      );
    }
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

// --- deck tags -----------------------------------------------------------

type TagRow = Omit<Tag, 'examples'> & { examples: string };

/** A deck's tags, its brief, and every card's tags - on or taken off. */
export function deckTags(listId: string): DeckTags {
  const database = open();
  const list = database.get('SELECT tagBrief, tagOverview FROM lists WHERE id = ?', [listId]) as { tagBrief: string; tagOverview: string } | null;
  const tags = (database.all(
    `SELECT id, name, description, color, kind, status, origin, position, examples
     FROM deck_tags WHERE listId = ? ORDER BY position, createdAt`, [listId],
  ) as unknown as TagRow[]).map((t) => ({ ...t, examples: JSON.parse(t.examples) as string[] }));
  const cardTags = (database.all(
    'SELECT cardKey, tagId, source, isOn, reason FROM deck_card_tags WHERE listId = ?', [listId],
  ) as Array<{ cardKey: string; tagId: string; source: CardTag['source']; isOn: number; reason: string }>)
    .map((r) => ({ key: r.cardKey, tagId: r.tagId, source: r.source, on: r.isOn === 1, reason: r.reason }));
  return { brief: list?.tagBrief ?? '', overview: list?.tagOverview ?? '', tags, cardTags };
}

export function setTagBrief(listId: string, brief: string): void {
  open().run('UPDATE lists SET tagBrief = ? WHERE id = ?', [brief, listId]);
}

export interface NewTag {
  name: string;
  description?: string;
  color: string;
  kind?: TagKind | null;
  status: TagStatus;
  origin: Tag['origin'];
  examples?: string[];
}

export function createTag(listId: string, tag: NewTag): Tag {
  const database = open();
  const id = randomUUID();
  const { position } = database.get('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM deck_tags WHERE listId = ?', [listId]) as { position: number };
  const row: Tag = {
    id, name: tag.name, description: tag.description ?? '', color: tag.color, kind: tag.kind ?? null,
    status: tag.status, origin: tag.origin, position, examples: tag.examples ?? [],
  };
  database.run(
    `INSERT INTO deck_tags (id, listId, name, description, color, kind, status, origin, position, examples, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, listId, row.name, row.description, row.color, row.kind, row.status, row.origin, position, JSON.stringify(row.examples), now()],
  );
  return row;
}

/** Change a tag's words, colour, kind or status. False if it is not this deck's. */
export function updateTag(
  listId: string, tagId: string,
  change: Partial<Pick<Tag, 'name' | 'description' | 'color' | 'kind' | 'status'>>,
): boolean {
  const database = open();
  if (!database.get('SELECT 1 FROM deck_tags WHERE id = ? AND listId = ?', [tagId, listId])) return false;
  for (const field of ['name', 'description', 'color', 'kind', 'status'] as const) {
    if (change[field] !== undefined) {
      database.run(`UPDATE deck_tags SET ${field} = ? WHERE id = ? AND listId = ?`, [change[field] ?? null, tagId, listId]);
    }
  }
  return true;
}

/** Put the deck's tags in this order; any not named keep their place after. */
export function reorderTags(listId: string, ids: string[]): void {
  const database = open();
  const all = (database.all('SELECT id FROM deck_tags WHERE listId = ? ORDER BY position, createdAt', [listId]) as Array<{ id: string }>).map((r) => r.id);
  const order = [...ids.filter((id) => all.includes(id)), ...all.filter((id) => !ids.includes(id))];
  database.run('BEGIN');
  try {
    order.forEach((id, i) => database.run('UPDATE deck_tags SET position = ? WHERE id = ?', [i, id]));
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

export function deleteTag(listId: string, tagId: string): void {
  const database = open();
  database.run('DELETE FROM deck_card_tags WHERE listId = ? AND tagId = ?', [listId, tagId]);
  database.run('DELETE FROM deck_tags WHERE listId = ? AND id = ?', [listId, tagId]);
}

/**
 * Fold one tag into another: its cards move across, and it goes. A card
 * stays off the merged tag only if the owner had taken off both.
 */
export function mergeTags(listId: string, fromId: string, intoId: string): boolean {
  const database = open();
  const both = database.all('SELECT id FROM deck_tags WHERE listId = ? AND id IN (?, ?)', [listId, fromId, intoId]) as Array<{ id: string }>;
  if (fromId === intoId || both.length !== 2) return false;
  database.run('BEGIN');
  try {
    database.run(
      `INSERT INTO deck_card_tags (listId, cardKey, tagId, source, isOn, reason)
       SELECT listId, cardKey, ?, source, isOn, reason FROM deck_card_tags WHERE listId = ? AND tagId = ?
       ON CONFLICT(listId, cardKey, tagId) DO UPDATE SET
         isOn = MAX(isOn, excluded.isOn),
         source = CASE WHEN excluded.source = 'manual' THEN 'manual' ELSE source END`,
      [intoId, listId, fromId],
    );
    database.run('DELETE FROM deck_card_tags WHERE listId = ? AND tagId = ?', [listId, fromId]);
    database.run('DELETE FROM deck_tags WHERE listId = ? AND id = ?', [listId, fromId]);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
  return true;
}

/**
 * New suggestions replace the last unreviewed ones; accepted and turned-down
 * tags stay. The overview is the model's reading of the deck that came with them.
 */
export function replaceProposals(listId: string, overview: string, proposals: Array<Omit<NewTag, 'status' | 'origin'>>): Tag[] {
  const database = open();
  database.run('BEGIN');
  try {
    const stale = database.all(`SELECT id FROM deck_tags WHERE listId = ? AND status = 'proposed'`, [listId]) as Array<{ id: string }>;
    for (const { id } of stale) database.run('DELETE FROM deck_card_tags WHERE listId = ? AND tagId = ?', [listId, id]);
    database.run(`DELETE FROM deck_tags WHERE listId = ? AND status = 'proposed'`, [listId]);
    const created = proposals.map((p) => createTag(listId, { ...p, status: 'proposed', origin: 'ai' }));
    database.run('UPDATE lists SET tagOverview = ? WHERE id = ?', [overview, listId]);
    database.run('COMMIT');
    return created;
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

/**
 * The owner puts a tag on a card or takes it off. Taking off a tag the
 * model applied is remembered; taking off one the owner applied forgets it.
 */
export function setCardTag(listId: string, cardKey: string, tagId: string, on: boolean): boolean {
  const database = open();
  if (!database.get('SELECT 1 FROM deck_tags WHERE id = ? AND listId = ?', [tagId, listId])) return false;
  const row = database.get('SELECT source FROM deck_card_tags WHERE listId = ? AND cardKey = ? AND tagId = ?', [listId, cardKey, tagId]) as { source: string } | null;
  if (on) {
    database.run(
      `INSERT INTO deck_card_tags (listId, cardKey, tagId, source, isOn, reason) VALUES (?, ?, ?, 'manual', 1, '')
       ON CONFLICT(listId, cardKey, tagId) DO UPDATE SET source = 'manual', isOn = 1`,
      [listId, cardKey, tagId],
    );
  } else if (row?.source === 'ai') {
    database.run(
      `UPDATE deck_card_tags SET source = 'manual', isOn = 0 WHERE listId = ? AND cardKey = ? AND tagId = ?`,
      [listId, cardKey, tagId],
    );
  } else {
    database.run('DELETE FROM deck_card_tags WHERE listId = ? AND cardKey = ? AND tagId = ?', [listId, cardKey, tagId]);
  }
  return true;
}

/**
 * The model's tags for these cards replace its earlier ones on them. What
 * the owner set by hand - tags on and tags taken off - is left alone.
 */
export function applyModelTags(listId: string, cardKeys: string[], found: Array<{ key: string; tagId: string; reason: string }>): number {
  const database = open();
  let added = 0;
  database.run('BEGIN');
  try {
    for (const key of cardKeys) {
      database.run(`DELETE FROM deck_card_tags WHERE listId = ? AND cardKey = ? AND source = 'ai'`, [listId, key]);
    }
    for (const { key, tagId, reason } of found) {
      if (database.get('SELECT 1 FROM deck_card_tags WHERE listId = ? AND cardKey = ? AND tagId = ?', [listId, key, tagId])) continue;
      database.run(
        `INSERT INTO deck_card_tags (listId, cardKey, tagId, source, isOn, reason) VALUES (?, ?, ?, 'ai', 1, ?)`,
        [listId, key, tagId, reason],
      );
      added++;
    }
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
  return added;
}

/** An audit's findings: add where nothing is set, remove only what the model applied. */
export function applyModelAudit(
  listId: string, changes: Array<{ key: string; tagId: string; action: 'add' | 'remove'; reason: string }>,
): { added: number; removed: number } {
  const database = open();
  let added = 0;
  let removed = 0;
  database.run('BEGIN');
  try {
    for (const { key, tagId, action, reason } of changes) {
      if (action === 'add') {
        if (database.get('SELECT 1 FROM deck_card_tags WHERE listId = ? AND cardKey = ? AND tagId = ?', [listId, key, tagId])) continue;
        database.run(
          `INSERT INTO deck_card_tags (listId, cardKey, tagId, source, isOn, reason) VALUES (?, ?, ?, 'ai', 1, ?)`,
          [listId, key, tagId, reason],
        );
        added++;
      } else {
        if (!database.get(`SELECT 1 FROM deck_card_tags WHERE listId = ? AND cardKey = ? AND tagId = ? AND source = 'ai'`, [listId, key, tagId])) continue;
        database.run(`DELETE FROM deck_card_tags WHERE listId = ? AND cardKey = ? AND tagId = ? AND source = 'ai'`, [listId, key, tagId]);
        removed++;
      }
    }
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
  return { added, removed };
}
