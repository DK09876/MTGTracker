/**
 * Scryfall's card data kept on the Pi, refreshed every night.
 *
 * Scryfall publishes its whole card list and its community tags as daily
 * files. The nightly refresh reads both and:
 *   - works out every card's roles (ramp, draw, removal...) from the tag
 *     file, so a new deck's roles are there at once instead of taking a
 *     hundred-odd searches;
 *   - keeps a slim copy of every card, so a card can be looked up by name
 *     without asking Scryfall;
 *   - refreshes the prices of the printings the app holds (Scryfall updates
 *     prices once a day).
 * Search still asks Scryfall live: copying its search syntax is not worth it.
 * A failed refresh keeps yesterday's data and goes in the error log.
 * Server only.
 */

import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import { createGunzip } from 'zlib';

import { Database } from 'node-sqlite3-wasm';

import { database, getSetting, saveRoles, setSetting, storeCard } from './db';
import { recordError } from './errors';
import { recentJobs, startJob, type Job } from './jobs';
import { ROLES, ROLES_VERSION, tagSets } from './roles';
import { collection, type ScryfallCard } from './scryfall';

const HEADERS = { 'User-Agent': 'MTGTracker/0.1 (https://github.com/DK09876/MTGTracker)', Accept: 'application/json' };

interface BulkEntry { type: string; jsonl_download_uri?: string; download_uri?: string; updated_at: string }

/** Each line of one of Scryfall's gzipped JSON-lines files, read as it downloads. */
async function* lines(url: string): AsyncGenerator<Record<string, unknown>> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok || !res.body) throw new Error(`Scryfall's file did not download (${res.status})`);
  const text = Readable.fromWeb(res.body as never).pipe(createGunzip());
  for await (const line of createInterface({ input: text, crlfDelay: Infinity })) {
    if (line.trim()) yield JSON.parse(line) as Record<string, unknown>;
  }
}

async function bulkFiles(): Promise<Map<string, string>> {
  const res = await fetch('https://api.scryfall.com/bulk-data', { headers: HEADERS });
  if (!res.ok) throw new Error(`Scryfall's file list did not load (${res.status})`);
  const { data } = await res.json() as { data: BulkEntry[] };
  return new Map(data.filter((d) => d.jsonl_download_uri).map((d) => [d.type, d.jsonl_download_uri!]));
}

// Tags are matched the way Scryfall's search matches them: "board-wipe"
// finds the tag "sweeper" through its alias "boardwipe".
const tagKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Oracle id -> the role ids its tags put it in, for every tagged card. */
export async function rolesFromTags(rows: AsyncIterable<Record<string, unknown>>): Promise<Map<string, string[]>> {
  const slugOf = new Map<string, string>();
  // Searches take a tag's aliases too: otag:board-wipe finds "sweeper".
  const aliasOf = new Map<string, string>();
  const children = new Map<string, string[]>();
  const tagged = new Map<string, string[]>();
  for await (const t of rows) {
    const id = String(t.id);
    slugOf.set(id, String(t.slug));
    for (const a of (t.aliases as string[] | undefined) ?? []) aliasOf.set(tagKey(a), id);
    children.set(id, (t.child_ids as string[] | undefined) ?? []);
    tagged.set(id, ((t.taggings as Array<{ oracle_id: string }> | undefined) ?? []).map((x) => x.oracle_id));
  }
  const idOf = new Map([...aliasOf, ...[...slugOf].map(([id, slug]) => [tagKey(slug), id] as [string, string])]);
  // A search for a tag finds cards tagged with anything under it too.
  const cardsUnder = (slug: string): Set<string> => {
    const out = new Set<string>();
    const stack = [idOf.get(tagKey(slug))].filter((x): x is string => !!x);
    const seen = new Set<string>();
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const o of tagged.get(id) ?? []) out.add(o);
      stack.push(...(children.get(id) ?? []));
    }
    return out;
  };
  const found = new Map<string, string[]>();
  for (const role of ROLES) {
    if (!role.tag) continue;
    const { any, none } = tagSets(role.tag);
    const out = new Set<string>();
    for (const slug of none) for (const o of cardsUnder(slug)) out.add(o);
    for (const slug of any) {
      for (const o of cardsUnder(slug)) {
        if (out.has(o)) continue;
        found.set(o, [...new Set([...(found.get(o) ?? []), role.id])]);
      }
    }
  }
  return found;
}

/** The parts of a card the app reads, so the copy of every card stays small. */
function slim(c: Record<string, unknown>): Partial<ScryfallCard> {
  const keep = ['id', 'oracle_id', 'name', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'colors', 'color_identity',
    'keywords', 'power', 'toughness', 'loyalty', 'rarity', 'set', 'set_name', 'collector_number', 'image_uris', 'card_faces',
    'prices', 'edhrec_rank', 'game_changer', 'scryfall_uri', 'layout'] as const;
  const out: Record<string, unknown> = {};
  for (const k of keep) if (c[k] !== undefined) out[k] = c[k];
  const legal = (c.legalities as Record<string, string> | undefined)?.commander;
  if (legal) out.legalities = { commander: legal };
  return out as Partial<ScryfallCard>;
}

// The copy of every card lives in its own file beside the app's database
// (data/cards.db): it is large, and can always be downloaded again, so the
// nightly backups leave it out.
let cardsDb: Database | null = null;
function table(): Database {
  if (!cardsDb) {
    const main = process.env.MTG_DB_PATH || `${process.cwd()}/data/mtg.db`;
    const path = process.env.MTG_CARDS_DB_PATH || join(dirname(main), 'cards.db');
    mkdirSync(dirname(path), { recursive: true });
    cardsDb = new Database(path);
    cardsDb.run(`CREATE TABLE IF NOT EXISTS oracle_cards (oracleId TEXT PRIMARY KEY, name TEXT NOT NULL, nameKey TEXT NOT NULL, data TEXT NOT NULL)`);
    cardsDb.run('CREATE INDEX IF NOT EXISTS idx_oracle_cards_name ON oracle_cards (nameKey)');
  }
  return cardsDb;
}

const nameKey = (name: string) => name.split(' // ')[0].trim().toLowerCase();

/** Cards by name from the copy on the Pi; names it does not have are left out. */
export function localCards(names: string[]): ScryfallCard[] {
  if (!names.length) return [];
  const keys = [...new Set(names.map(nameKey))];
  const out: ScryfallCard[] = [];
  for (let i = 0; i < keys.length; i += 500) {
    const part = keys.slice(i, i + 500);
    const rows = table().all(`SELECT data FROM oracle_cards WHERE nameKey IN (${part.map(() => '?').join(',')})`, part) as Array<{ data: string }>;
    out.push(...rows.map((r) => JSON.parse(r.data) as ScryfallCard));
  }
  return out;
}

export interface CardDataStatus {
  refreshedAt: string | null;
  error: string | null;
  cards: number;
  tagged: number;
  prices: number;
}

export function cardDataStatus(): CardDataStatus {
  const d = table();
  const stats = JSON.parse(getSetting('cards.refreshStats') ?? '{}') as Partial<CardDataStatus>;
  return {
    refreshedAt: getSetting('cards.refreshedAt'),
    error: getSetting('cards.refreshError'),
    cards: (d.get('SELECT COUNT(*) AS n FROM oracle_cards') as { n: number }).n,
    tagged: stats.tagged ?? 0,
    prices: stats.prices ?? 0,
  };
}

const BATCH = 1_000;
const PRICE_BATCH = 75;

/** The whole refresh. `progress` hears what it is on. */
export async function refreshCardData(progress: (detail: string, done?: number, total?: number) => void = () => {}): Promise<CardDataStatus> {
  try {
    progress('Finding the newest files');
    const files = await bulkFiles();
    const tagsUrl = files.get('oracle_tags');
    const cardsUrl = files.get('oracle_cards');
    if (!tagsUrl || !cardsUrl) throw new Error('Scryfall did not list its card or tag file');

    progress('Reading card tags');
    const roles = await rolesFromTags(lines(tagsUrl));

    progress('Reading every card');
    const d = table();
    const seen: string[] = [];
    let pending: Array<[string, string, string, string]> = [];
    const flush = () => {
      d.run('BEGIN');
      try {
        for (const row of pending) {
          d.run(`INSERT INTO oracle_cards (oracleId, name, nameKey, data) VALUES (?, ?, ?, ?)
            ON CONFLICT(oracleId) DO UPDATE SET name = excluded.name, nameKey = excluded.nameKey, data = excluded.data`, row);
        }
        d.run('COMMIT');
      } catch (error) {
        d.run('ROLLBACK');
        throw error;
      }
      pending = [];
    };
    for await (const c of lines(cardsUrl)) {
      const oracleId = (c.oracle_id ?? (c.card_faces as Array<{ oracle_id?: string }> | undefined)?.[0]?.oracle_id) as string | undefined;
      if (!oracleId) continue;
      seen.push(oracleId);
      pending.push([oracleId, String(c.name), nameKey(String(c.name)), JSON.stringify(slim(c))]);
      if (pending.length >= BATCH) {
        flush();
        progress('Reading every card', seen.length);
      }
    }
    if (pending.length) flush();

    progress('Saving roles', seen.length, seen.length);
    // Every card is saved as looked up, roles or none, so no deck searches for it.
    saveRoles(new Map(seen.map((id) => [id, roles.get(id) ?? []])), ROLES_VERSION);

    // Today's prices for the printings in lists, decks and the collection.
    const held = (database().all('SELECT id FROM cards') as Array<{ id: string }>).map((r) => r.id);
    let prices = 0;
    for (let i = 0; i < held.length; i += PRICE_BATCH) {
      progress('Updating prices', i, held.length);
      const { cards } = await collection(held.slice(i, i + PRICE_BATCH).map((id) => ({ id })));
      for (const card of cards) storeCard(card);
      prices += cards.length;
    }

    const stats = { tagged: [...roles.keys()].length, prices };
    setSetting('cards.refreshStats', JSON.stringify(stats));
    setSetting('cards.refreshedAt', new Date().toISOString());
    database().run(`DELETE FROM settings WHERE key = 'cards.refreshError'`);
    return cardDataStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setSetting('cards.refreshError', message.slice(0, 300));
    recordError({ source: 'Nightly card refresh', message: `${message}. Yesterday's data is kept.`, detail: error });
    throw error;
  }
}

/** The refresh as a background job, for the nightly timer and Settings' Refresh now. */
export function startCardRefresh(): Job {
  const running = recentJobs(null).find((j) => j.kind === 'refresh' && j.status === 'running');
  if (running) return running;
  return startJob({ kind: 'refresh', label: 'Refreshing card data', subject: 'Scryfall', profileId: null, listId: null, errorLevel: () => 'warn' },
    async ({ progress }) => refreshCardData(progress));
}


