/**
 * Scryfall's card data kept on the Pi, refreshed once a week (early Sunday; Settings has Refresh now).
 *
 * Scryfall publishes its whole card list and its community tags as daily
 * files. The weekly refresh reads both and:
 *   - works out every card's roles (ramp, draw, removal...) from the tag
 *     file, so a new deck's roles are there at once instead of taking a
 *     hundred-odd searches;
 *   - keeps every community tag on every card (about 5,000 tags), so what a
 *     card does can be read without asking Scryfall - themes and the like;
 *   - keeps a slim copy of every card, so a card can be looked up by name
 *     without asking Scryfall;
 *   - refreshes the prices of the printings the app holds (as of the refresh).
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
import { canLead } from './import';
import { rankNames } from './quick-names';
import { ROLES, ROLES_VERSION, tagSets } from './roles';
import { collection, normalizeCard, type ScryfallCard } from './scryfall';

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

/** Scryfall's tag file, read: each tag's slug, aliases, child tags and the cards tagged with it. */
export interface TagFile {
  slugOf: Map<string, string>;
  aliasOf: Map<string, string>;
  children: Map<string, string[]>;
  tagged: Map<string, string[]>;
}

export async function readTagFile(rows: AsyncIterable<Record<string, unknown>>): Promise<TagFile> {
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
  return { slugOf, aliasOf, children, tagged };
}

/** Oracle id -> the role ids its tags put it in, for every tagged card. */
export async function rolesFromTags(rows: AsyncIterable<Record<string, unknown>> | TagFile): Promise<Map<string, string[]>> {
  const { slugOf, aliasOf, children, tagged } = 'tagged' in rows ? rows as TagFile : await readTagFile(rows as AsyncIterable<Record<string, unknown>>);
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

/**
 * The parts of a card the app reads, so the copy of every card stays small.
 * Normalized like every other card (normalizeCard): today's oracle file gives
 * reversible cards a normal record, but if it ever sends the faces only, the
 * copy still has a type line.
 */
export function slim(raw: Record<string, unknown>): Partial<ScryfallCard> {
  const c = normalizeCard(raw as unknown as ScryfallCard) as unknown as Record<string, unknown>;
  const keep = ['id', 'oracle_id', 'name', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'colors', 'color_identity',
    'keywords', 'power', 'toughness', 'loyalty', 'rarity', 'set', 'set_name', 'collector_number', 'image_uris', 'card_faces',
    'prices', 'game_changer', 'scryfall_uri', 'layout', 'produced_mana'] as const;
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
    // Every community tag: one row per tag (its slug and the tags directly
    // above it), and one row per card listing its tags' numbers - compact,
    // a few MB for every card in Magic.
    cardsDb.run('CREATE TABLE IF NOT EXISTS oracle_tag_names (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, parents TEXT NOT NULL)');
    cardsDb.run('CREATE TABLE IF NOT EXISTS oracle_card_tags (oracleId TEXT PRIMARY KEY, tags TEXT NOT NULL)');
  }
  return cardsDb;
}

/** Keep every tag on every card from Scryfall's file, replacing what was there. Exported for tests. */
export function saveTags(file: TagFile, d: Database = table()): { tags: number; cards: number } {
  const ids = [...file.slugOf.keys()];
  const numberOf = new Map(ids.map((id, i) => [id, i + 1]));
  const parents = new Map<string, number[]>();
  for (const [id, kids] of file.children) for (const kid of kids) if (numberOf.has(id)) parents.set(kid, [...(parents.get(kid) ?? []), numberOf.get(id)!]);
  const byCard = new Map<string, number[]>();
  for (const [id, cards] of file.tagged) for (const o of cards) byCard.set(o, [...(byCard.get(o) ?? []), numberOf.get(id)!]);
  d.run('BEGIN');
  try {
    d.run('DELETE FROM oracle_tag_names');
    d.run('DELETE FROM oracle_card_tags');
    for (const id of ids) d.run('INSERT INTO oracle_tag_names (id, slug, parents) VALUES (?, ?, ?)', [numberOf.get(id)!, file.slugOf.get(id)!, (parents.get(id) ?? []).join(',')]);
    for (const [o, nums] of byCard) d.run('INSERT INTO oracle_card_tags (oracleId, tags) VALUES (?, ?)', [o, [...new Set(nums)].join(',')]);
    d.run('COMMIT');
  } catch (error) {
    d.run('ROLLBACK');
    throw error;
  }
  tagIndex = null;
  tagTotals.clear();
  return { tags: ids.length, cards: byCard.size };
}

// The tag names, read once and kept: about 5,000 small rows.
let tagIndex: { slug: Map<number, string>; id: Map<string, number>; parents: Map<number, number[]>; children: Map<number, number[]> } | null = null;
function tags(d: Database) {
  if (!tagIndex) {
    const slug = new Map<number, string>();
    const id = new Map<string, number>();
    const parents = new Map<number, number[]>();
    const children = new Map<number, number[]>();
    for (const r of d.all('SELECT id, slug, parents FROM oracle_tag_names') as Array<{ id: number; slug: string; parents: string }>) {
      slug.set(r.id, r.slug);
      id.set(r.slug, r.id);
      const ps = r.parents ? r.parents.split(',').map(Number) : [];
      parents.set(r.id, ps);
      for (const p of ps) children.set(p, [...(children.get(p) ?? []), r.id]);
    }
    tagIndex = { slug, id, parents, children };
  }
  return tagIndex;
}

/**
 * Each card's community tags, by oracle id: the tags it carries and every
 * tag above them ("hexproof-granter" is under "protection"), the way a
 * Scryfall search for a tag finds cards tagged with anything under it.
 */
export function cardTags(oracleIds: string[], d: Database = table()): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const t = tags(d);
  for (let i = 0; i < oracleIds.length; i += 500) {
    const part = oracleIds.slice(i, i + 500);
    if (!part.length) continue;
    for (const r of d.all(`SELECT oracleId, tags FROM oracle_card_tags WHERE oracleId IN (${part.map(() => '?').join(',')})`, part) as Array<{ oracleId: string; tags: string }>) {
      const seen = new Set<number>();
      const stack = r.tags.split(',').map(Number);
      while (stack.length) {
        const n = stack.pop()!;
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(...(t.parents.get(n) ?? []));
      }
      out.set(r.oracleId, [...seen].map((n) => t.slug.get(n)).filter((x): x is string => !!x).sort());
    }
  }
  return out;
}

// How many cards carry each tag, folded by families (see foldedTags), across every tagged card: read once per family list and kept.
const tagTotals = new Map<string, { cards: number; bySlug: Map<string, number> }>();

/** A card's tags, folded: a tag inside a family counts as the family; any other tag as itself. */
function fold(own: number[], t: ReturnType<typeof tags>, families: Set<string>): string[] {
  const out = new Set<string>();
  for (const id of own) {
    const seen = new Set<number>();
    const stack = [id];
    let inFamily = false;
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      const slug = t.slug.get(n);
      if (slug && families.has(slug)) { out.add(slug); inFamily = true; }
      stack.push(...(t.parents.get(n) ?? []));
    }
    const slug = t.slug.get(id);
    if (slug && !inFamily) out.add(slug);
  }
  return [...out].sort();
}

/**
 * Each card's tags for the Tags tab's suggestions, by oracle id. The tags the
 * app already reads as a whole family (\`families\`: ramp, counterspell...)
 * count with every tag under them, and the tags inside them are not listed
 * on their own; every other tag is the card's own.
 */
export function foldedTags(oracleIds: string[], families: Set<string>, d: Database = table()): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const t = tags(d);
  for (let i = 0; i < oracleIds.length; i += 500) {
    const part = oracleIds.slice(i, i + 500);
    if (!part.length) continue;
    for (const r of d.all(`SELECT oracleId, tags FROM oracle_card_tags WHERE oracleId IN (${part.map(() => '?').join(',')})`, part) as Array<{ oracleId: string; tags: string }>) {
      out.set(r.oracleId, fold(r.tags.split(',').map(Number), t, families));
    }
  }
  return out;
}

/**
 * Across every card the card data tags: how many cards there are, and how
 * many carry each tag, folded as foldedTags folds them. For telling which
 * tags stand out in a deck (lib/tag-suggest.ts).
 */
export function tagCounts(families: Set<string>, d: Database = table()): { cards: number; bySlug: Map<string, number> } {
  const key = [...families].sort().join(',');
  const hit = tagTotals.get(key);
  if (hit) return hit;
  const t = tags(d);
  const counts = new Map<string, number>();
  let cards = 0;
  for (const r of d.all('SELECT tags FROM oracle_card_tags') as Array<{ tags: string }>) {
    cards++;
    for (const s of fold(r.tags.split(',').map(Number), t, families)) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const out = { cards, bySlug: counts };
  // Two family lists are asked for per Tags load (lib/tag-suggest.ts): keep a few.
  if (tagTotals.size > 8) tagTotals.clear();
  tagTotals.set(key, out);
  return out;
}

/** Oracle ids of every card with this tag, or with a tag under it. */
export function cardsTagged(slug: string, d: Database = table()): string[] {
  const t = tags(d);
  const start = t.id.get(slug);
  if (start === undefined) return [];
  const want = new Set<number>();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop()!;
    if (want.has(n)) continue;
    want.add(n);
    stack.push(...(t.children.get(n) ?? []));
  }
  const out: string[] = [];
  for (const r of d.all('SELECT oracleId, tags FROM oracle_card_tags') as Array<{ oracleId: string; tags: string }>) {
    if (r.tags.split(',').some((x) => want.has(Number(x)))) out.push(r.oracleId);
  }
  return out;
}

const nameKey = (name: string) => name.split(' // ')[0].trim().toLowerCase();

// Not cards you put in a deck: art cards, tokens, emblems, planes and the like
// share names with real cards ("Fire Lord Azula // Fire Lord Azula").
const NOT_PLAYABLE = new Set(['art_series', 'token', 'double_faced_token', 'emblem', 'planar', 'scheme', 'vanguard', 'front_card']);

/**
 * Cards by name from the copy on the Pi, one per name - the playable card
 * when an art card or token shares its name; names it does not have are
 * left out.
 */
export function localCards(names: string[]): ScryfallCard[] {
  if (!names.length) return [];
  const keys = [...new Set(names.map(nameKey))];
  const best = new Map<string, ScryfallCard>();
  const playable = (c: ScryfallCard) => !NOT_PLAYABLE.has((c as { layout?: string }).layout ?? '');
  for (let i = 0; i < keys.length; i += 500) {
    const part = keys.slice(i, i + 500);
    const rows = table().all(`SELECT nameKey, data FROM oracle_cards WHERE nameKey IN (${part.map(() => '?').join(',')})`, part) as Array<{ nameKey: string; data: string }>;
    for (const r of rows) {
      const card = JSON.parse(r.data) as ScryfallCard;
      const had = best.get(r.nameKey);
      if (!had || (!playable(had) && playable(card))) best.set(r.nameKey, card);
    }
  }
  return [...best.values()].filter(playable);
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
    const tagFile = await readTagFile(lines(tagsUrl));
    const roles = await rolesFromTags(tagFile);
    saveTags(tagFile);

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
    recordError({ source: 'Card data refresh', message: `${message}. The last data is kept.`, detail: error });
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



/**
 * Cards that can lead a deck whose name contains what was typed, from the
 * copy on the Pi - names starting with it first, then the shortest names
 * (the closest match to what was typed), then A to Z.
 * Instant, where asking Scryfall waits on its rate limit every keystroke.
 */
export function localCommanders(typed: string, max = 8): ScryfallCard[] {
  const key = typed.trim().toLowerCase();
  if (key.length < 2) return [];
  const rows = table().all('SELECT data FROM oracle_cards WHERE nameKey LIKE ? LIMIT 400', [`%${key.replace(/[%_]/g, '')}%`]) as Array<{ data: string }>;
  const starts = (c: ScryfallCard) => (nameKey(c.name).startsWith(key) ? 0 : 1);
  return rows.map((r) => JSON.parse(r.data) as ScryfallCard)
    .filter((c) => canLead(c) && !NOT_PLAYABLE.has((c as { layout?: string }).layout ?? ''))
    .sort((a, b) => starts(a) - starts(b) || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, max);
}

/** Cards by oracle id from the copy on the Pi. */
export function localCardsByOracle(ids: string[]): ScryfallCard[] {
  const out: ScryfallCard[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    if (!part.length) continue;
    const rows = table().all(`SELECT data FROM oracle_cards WHERE oracleId IN (${part.map(() => '?').join(',')})`, part) as Array<{ data: string }>;
    out.push(...rows.map((r) => JSON.parse(r.data) as ScryfallCard));
  }
  return out;
}

/** Every kept card whose rules text matches, for roles read from text (finishers). */
export function searchLocalText(test: RegExp): ScryfallCard[] {
  // A rough first cut in SQL, then the real test.
  const rows = table().all(`SELECT data FROM oracle_cards WHERE data LIKE '%opponent%' OR data LIKE '%gain control%' OR data LIKE '%target player%'`) as Array<{ data: string }>;
  return rows.map((r) => JSON.parse(r.data) as ScryfallCard)
    .filter((c) => test.test([c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n')));
}

/** Every kept card - for building a starter list. A few seconds; call rarely. */
export function allLocalCards(): ScryfallCard[] {
  return (table().all('SELECT data FROM oracle_cards') as Array<{ data: string }>).map((r) => JSON.parse(r.data) as ScryfallCard);
}

/**
 * Cards whose name matches what was typed, for adding by name: from the
 * copy on the Pi, so every keystroke answers at once. Only cards a
 * Commander deck can play, inside the colours given (none: any colours).
 */
export function quickCards(typed: string, colors: string[] | null, max = 8): ScryfallCard[] {
  const t = typed.trim().toLowerCase().replace(/[%_]/g, '');
  if (t.length < 2) return [];
  const words = t.split(/\s+/).filter(Boolean);
  // A rough cut in SQL on the longest word, then the real order.
  const longest = [...words].sort((a, b) => b.length - a.length)[0];
  const rows = table().all('SELECT data FROM oracle_cards WHERE nameKey LIKE ? OR name LIKE ? LIMIT 1500', [`%${longest}%`, `%${longest}%`]) as Array<{ data: string }>;
  const allowed = colors ? new Set(colors) : null;
  const cards = rows.map((r) => JSON.parse(r.data) as ScryfallCard)
    .filter((c) => !NOT_PLAYABLE.has((c as { layout?: string }).layout ?? ''))
    .filter((c) => c.legalities?.commander !== 'not_legal')
    .filter((c) => !allowed || (c.color_identity ?? []).every((x) => allowed.has(x)));
  return rankNames(cards, typed, max);
}
