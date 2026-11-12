/**
 * A deck's categories: one store for the jobs it tracks, tags from the card
 * data, its ways to win, its key cards and the owner's own groups
 * (lib/categories-shared.ts says what each is). The Plan tab's ways to win
 * and key cards and the Tags tab's rows are the same records.
 *
 * Stored in the deck's tags (deck_tags, deck_card_tags in db.ts), with
 *   cat      job | tag | win | key | own
 *   addedBy  owner | cards | ai
 *   jobId    for a job
 *   slugs    for a tag from the card data (several after a merge)
 *   madeOf   what was merged in
 * and a card row per card someone put in (source manual = the owner, ai, or
 * cards = the card data), or took out (isOn 0). A job's cards and a tag's
 * cards are worked out on read, not stored: a card added to the deck later
 * that has the tag joins by itself, a card the owner took out stays out, and
 * a card they added stays in.
 *
 *   deck_category_marks  generated items the owner removed (never suggested
 *                        again) and skipped ones (back on the next run or
 *                        refresh), by a key that outlives the category
 *
 * The migration (migrateAll) runs once, at the first start after this
 * shipped: decks that exist then keep what they had. Server only.
 */

import { randomUUID } from 'node:crypto';

import { cardTags } from './card-store';
import { cardsInList, database, getSetting, setSetting, type List, type ListedCard } from './db';
import { JOB_ROLES } from './deck-numbers';
import { primaryType } from './deckview';
import { SIX_JOBS, identity, type AddedBy, type Category, type CategoryCard, type CategoryKind } from './categories-shared';
import { nextColor, tagKey } from './tags';
import type { JobId } from './deck-numbers';

export * from './categories-shared';

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS deck_category_marks (
      listId TEXT NOT NULL, key TEXT NOT NULL, mark TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', at TEXT NOT NULL,
      PRIMARY KEY (listId, key, mark))`);
    ready = true;
    if (!getSetting('categories.migrated')) migrateAll();
  }
  return d;
}

/** At server start: makes the tables and runs the one-time migration before any new deck is made. */
export function startCategories(): void { db(); }

const now = () => new Date().toISOString();
const parse = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };
const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
const isLand = (c: ListedCard) => primaryType(c.card) === 'Lands';

interface Row { id: string; name: string; description: string; cat: string | null; addedBy: string | null; jobId: string | null; slugs: string; madeOf: string; origin: string; position: number }
interface CardRow { tagId: string; cardKey: string; source: string; isOn: number; reason: string }

const bySource = (s: string): AddedBy => (s === 'ai' ? 'ai' : s === 'cards' ? 'cards' : 'owner');
const sourceOf = (by: AddedBy) => (by === 'owner' ? 'manual' : by);
const kindOf = (r: Row): CategoryKind => (['job', 'tag', 'win', 'key', 'own'].includes(r.cat ?? '') ? r.cat as CategoryKind : 'own');
const whoOf = (r: Row): AddedBy => (r.addedBy === 'owner' || r.addedBy === 'cards' || r.addedBy === 'ai' ? r.addedBy : r.origin === 'ai' ? 'ai' : 'owner');

function rows(listId: string): Row[] {
  return db().all(`SELECT id, name, description, cat, addedBy, jobId, slugs, madeOf, origin, position FROM deck_tags
    WHERE listId = ? AND status = 'accepted' ORDER BY position, createdAt`, [listId]) as unknown as Row[];
}
function cardRows(listId: string): Map<string, CardRow[]> {
  const out = new Map<string, CardRow[]>();
  for (const r of db().all('SELECT tagId, cardKey, source, isOn, reason FROM deck_card_tags WHERE listId = ?', [listId]) as unknown as CardRow[]) {
    out.set(r.tagId, [...(out.get(r.tagId) ?? []), r]);
  }
  return out;
}

/** The deck's cards for working out categories: names by key, and which are non-land, non-commander. */
function deckOf(list: Pick<List, 'id' | 'commander'>, main = cardsInList(list.id).filter((c) => c.board === 'main')) {
  const name = new Map<string, string>();
  for (const c of main) name.set(tagKey(c.card), c.card.name);
  if (list.commander) name.set(tagKey(list.commander), list.commander.name);
  const spells = main.filter((c) => !isLand(c) && c.slot !== 'partner').map((c) => tagKey(c.card));
  return { main, name, spells };
}

/**
 * A job's cards by name, from the deck's roles with the owner's changes to
 * the job applied (deck-roles.ts applies them). Passed in so this module
 * never counts roles itself.
 */
export type JobCards = (listId: string, main: ListedCard[]) => Promise<Map<string, string[]>>;

/** Every category on the deck, with its cards worked out now. */
export async function categories(list: Pick<List, 'id' | 'commander'>, jobCards?: JobCards): Promise<Category[]> {
  const all = rows(list.id);
  const links = cardRows(list.id);
  const deck = deckOf(list);
  const keyByName = new Map([...deck.name].map(([k, n]) => [front(n), k]));
  const jobsNeeded = all.some((r) => kindOf(r) === 'job');
  const jobs = jobsNeeded && jobCards ? await jobCards(list.id, deck.main).catch(() => new Map<string, string[]>()) : new Map<string, string[]>();
  const tagsNeeded = all.some((r) => kindOf(r) === 'tag');
  const tagsOf = tagsNeeded ? (() => { try { return cardTags(deck.spells); } catch { return new Map<string, string[]>(); } })() : new Map<string, string[]>();
  const nameOf = (key: string, reason = '') => deck.name.get(key) ?? (reason || key);
  return all.map((r) => {
    const kind = kindOf(r);
    const slugs = parse<string[]>(r.slugs, []);
    const mine = links.get(r.id) ?? [];
    const on = new Map(mine.filter((x) => x.isOn).map((x) => [x.cardKey, bySource(x.source)]));
    const off = new Set(mine.filter((x) => !x.isOn).map((x) => x.cardKey));
    const live = new Map<string, AddedBy>();
    if (kind === 'job' && r.jobId) {
      for (const n of jobs.get(r.jobId) ?? []) { const k = keyByName.get(front(n)); if (k) live.set(k, 'cards'); }
    } else if (kind === 'tag' && slugs.length) {
      for (const k of deck.spells) if ((tagsOf.get(k) ?? []).some((t) => slugs.includes(t))) live.set(k, 'cards');
    }
    const cards: CategoryCard[] = [];
    const seen = new Set<string>();
    for (const [k, by] of [...live, ...on]) {
      if (seen.has(k) || off.has(k) || !deck.name.has(k)) continue;
      seen.add(k);
      cards.push({ key: k, name: nameOf(k), by: on.get(k) ?? by });
    }
    const gone = kind === 'win' || kind === 'key' ? mine.filter((x) => x.isOn && !deck.name.has(x.cardKey)).map((x) => nameOf(x.cardKey, x.reason)) : [];
    return {
      id: r.id, name: r.name, kind, by: whoOf(r), jobId: (r.jobId as JobId | null) ?? null, slugs, how: r.description, madeOf: parse<string[]>(r.madeOf, []),
      cards: cards.sort((a, b) => a.name.localeCompare(b.name)),
      out: [...off].map((k) => ({ key: k, name: nameOf(k, mine.find((x) => x.cardKey === k)?.reason), by: 'owner' as AddedBy })),
      gone,
    };
  });
}

// --- marks: removed (gone for good) and skipped (until the next run) ---------------

export type MarkScope = 'plan' | 'cards' | 'ai';

export function goneKeys(listId: string): Set<string> {
  return new Set((db().all(`SELECT key FROM deck_category_marks WHERE listId = ? AND mark = 'gone'`, [listId]) as Array<{ key: string }>).map((r) => r.key));
}
export function markGone(listId: string, key: string): void {
  db().run(`INSERT OR IGNORE INTO deck_category_marks (listId, key, mark, scope, at) VALUES (?, ?, 'gone', '', ?)`, [listId, key, now()]);
}
export function skippedKeys(listId: string, scope: MarkScope): Set<string> {
  return new Set((db().all(`SELECT key FROM deck_category_marks WHERE listId = ? AND mark = 'skip' AND scope = ?`, [listId, scope]) as Array<{ key: string }>).map((r) => r.key));
}
export function markSkipped(listId: string, scope: MarkScope, key: string, on = true): void {
  if (on) db().run(`INSERT OR IGNORE INTO deck_category_marks (listId, key, mark, scope, at) VALUES (?, ?, 'skip', ?, ?)`, [listId, key, scope, now()]);
  else db().run(`DELETE FROM deck_category_marks WHERE listId = ? AND key = ? AND mark = 'skip'`, [listId, key]);
}
/** A new run or a refresh brings back what was skipped. */
export function clearSkips(listId: string, scope: MarkScope): void {
  db().run(`DELETE FROM deck_category_marks WHERE listId = ? AND mark = 'skip' AND scope = ?`, [listId, scope]);
}
/** The key a generated card in a category is remembered by once the owner takes it out. */
export const cardMark = (categoryIdentity: string, cardKey: string) => `card:${categoryIdentity}|${cardKey}`;

// --- changes -------------------------------------------------------------------------

export interface NewCategory {
  kind: CategoryKind;
  name: string;
  by: AddedBy;
  jobId?: JobId | null;
  slugs?: string[];
  how?: string;
  cards?: Array<{ key: string; name: string; by: AddedBy }>;
}

const identityOf = (r: Row) => identity(kindOf(r), r.name, r.jobId, parse<string[]>(r.slugs, []));

/** Find a category on the deck the same as this one would be: the same job, tag, or kind and name. */
function sameAs(listId: string, c: Pick<NewCategory, 'kind' | 'name' | 'jobId' | 'slugs'>): Row | null {
  const want = identity(c.kind, c.name, c.jobId, c.slugs);
  return rows(listId).find((r) => identityOf(r) === want || (kindOf(r) === c.kind && r.name.trim().toLowerCase() === c.name.trim().toLowerCase())) ?? null;
}

/** Put a category on the deck, or add to the one already there. Answers its id. */
export function addCategory(listId: string, c: NewCategory): string {
  const d = db();
  const name = c.name.trim().slice(0, 80);
  if (!name) throw new Error('A category needs a name');
  let id = sameAs(listId, c)?.id ?? null;
  if (!id) {
    id = randomUUID();
    const used = (d.all('SELECT color FROM deck_tags WHERE listId = ?', [listId]) as Array<{ color: string }>).map((r) => r.color);
    const { position } = d.get('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM deck_tags WHERE listId = ?', [listId]) as { position: number };
    d.run(`INSERT INTO deck_tags (id, listId, name, description, color, kind, status, origin, position, examples, createdAt, cat, addedBy, jobId, slugs, madeOf)
      VALUES (?, ?, ?, ?, ?, NULL, 'accepted', ?, ?, '[]', ?, ?, ?, ?, ?, '[]')`,
    [id, listId, name, (c.how ?? '').slice(0, 400), nextColor(used), c.by === 'ai' ? 'ai' : 'manual', position, now(), c.kind, c.by, c.jobId ?? null, JSON.stringify(c.slugs ?? [])]);
  }
  for (const card of c.cards ?? []) putCard(listId, id, card.key, card.name, card.by);
  return id;
}

function rowOf(listId: string, id: string): Row | null {
  return rows(listId).find((r) => r.id === id) ?? null;
}

/** The deck's one key-cards category, made when first needed. */
export function keyCategoryId(listId: string): string {
  return rows(listId).find((r) => kindOf(r) === 'key')?.id ?? addCategory(listId, { kind: 'key', name: 'Key cards', by: 'owner' });
}

function putCard(listId: string, catId: string, key: string, name: string, by: AddedBy): void {
  db().run(`INSERT INTO deck_card_tags (listId, cardKey, tagId, source, isOn, reason) VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(listId, cardKey, tagId) DO UPDATE SET source = excluded.source, isOn = 1, reason = excluded.reason`,
  [listId, key, catId, sourceOf(by), name.slice(0, 120)]);
}

/**
 * Put a card in a category or take it out. Taking a card out of a job or a
 * live tag is remembered, so it stays out; taking out a card AI or the card
 * data put in is remembered too, so it is not suggested again.
 */
export function setCategoryCard(listId: string, catId: string, card: { key: string; name: string }, on: boolean, by: AddedBy = 'owner'): boolean {
  const r = rowOf(listId, catId);
  if (!r) return false;
  const d = db();
  if (on) { putCard(listId, catId, card.key, card.name, by); return true; }
  const had = d.get('SELECT source, isOn FROM deck_card_tags WHERE listId = ? AND cardKey = ? AND tagId = ?', [listId, card.key, catId]) as { source: string; isOn: number } | null;
  const kind = kindOf(r);
  if (had && had.source !== 'manual') markGone(listId, cardMark(identityOf(r), card.key));
  if (kind === 'job' || kind === 'tag') {
    // Live: a card taken out is kept as taken out, or the card data would put it back.
    if (kind === 'tag' && !had) markGone(listId, cardMark(identityOf(r), card.key));
    d.run(`INSERT INTO deck_card_tags (listId, cardKey, tagId, source, isOn, reason) VALUES (?, ?, ?, 'manual', 0, ?)
      ON CONFLICT(listId, cardKey, tagId) DO UPDATE SET source = 'manual', isOn = 0`, [listId, card.key, catId, card.name.slice(0, 120)]);
  } else {
    d.run('DELETE FROM deck_card_tags WHERE listId = ? AND cardKey = ? AND tagId = ?', [listId, card.key, catId]);
  }
  return true;
}

/**
 * Take a category off the deck. Key cards keep their slot (the Plan tab's
 * list) and only empty. A generated category the owner removes is not
 * suggested again; a job can be accepted again from the Tags tab.
 */
export function removeCategory(listId: string, catId: string): boolean {
  const r = rowOf(listId, catId);
  if (!r) return false;
  const d = db();
  const kind = kindOf(r);
  for (const x of d.all(`SELECT cardKey FROM deck_card_tags WHERE listId = ? AND tagId = ? AND isOn = 1 AND source != 'manual'`, [listId, catId]) as Array<{ cardKey: string }>) {
    markGone(listId, cardMark(identityOf(r), x.cardKey));
  }
  d.run('DELETE FROM deck_card_tags WHERE listId = ? AND tagId = ?', [listId, catId]);
  if (kind === 'key') return true;
  if (whoOf(r) !== 'owner' && kind !== 'job') markGone(listId, identityOf(r));
  d.run('DELETE FROM deck_tags WHERE listId = ? AND id = ?', [listId, catId]);
  return true;
}

/** Change a category's name or its how line. */
export function editCategory(listId: string, catId: string, change: { name?: string; how?: string }): boolean {
  const r = rowOf(listId, catId);
  if (!r) return false;
  if (change.name?.trim()) db().run('UPDATE deck_tags SET name = ? WHERE id = ? AND listId = ?', [change.name.trim().slice(0, 80), catId, listId]);
  if (change.how !== undefined) db().run('UPDATE deck_tags SET description = ? WHERE id = ? AND listId = ?', [change.how.slice(0, 400), catId, listId]);
  return true;
}

/**
 * Merge one category into another: its cards move across (a tag's stay live,
 * by its tags joining the other's), what was merged is recorded, and the
 * source goes. A merged generated category is not suggested again. Key cards
 * can take cards in but are never merged away.
 */
export function mergeCategory(listId: string, from: Category, intoId: string): boolean {
  const into = rowOf(listId, intoId);
  const src = rowOf(listId, from.id);
  if (!into || !src || into.id === src.id || from.kind === 'key') return false;
  const d = db();
  const intoKind = kindOf(into);
  const intoSlugs = parse<string[]>(into.slugs, []);
  if (intoKind === 'tag' && from.kind === 'tag') {
    d.run('UPDATE deck_tags SET slugs = ? WHERE id = ?', [JSON.stringify([...new Set([...intoSlugs, ...from.slugs])]), into.id]);
    // The owner's own changes to the merged tag come along.
    for (const x of d.all('SELECT cardKey, source, isOn, reason FROM deck_card_tags WHERE listId = ? AND tagId = ?', [listId, from.id]) as unknown as CardRow[]) {
      d.run('INSERT OR IGNORE INTO deck_card_tags (listId, cardKey, tagId, source, isOn, reason) VALUES (?, ?, ?, ?, ?, ?)', [listId, x.cardKey, into.id, x.source, x.isOn, x.reason]);
    }
  } else {
    for (const c of from.cards) {
      const has = d.get('SELECT isOn FROM deck_card_tags WHERE listId = ? AND cardKey = ? AND tagId = ?', [listId, c.key, into.id]) as { isOn: number } | null;
      if (!has?.isOn) putCard(listId, into.id, c.key, c.name, c.by);
    }
  }
  d.run('UPDATE deck_tags SET madeOf = ? WHERE id = ?', [JSON.stringify([...new Set([...parse<string[]>(into.madeOf, []), from.name, ...from.madeOf])]), into.id]);
  d.run('DELETE FROM deck_card_tags WHERE listId = ? AND tagId = ?', [listId, from.id]);
  d.run('DELETE FROM deck_tags WHERE listId = ? AND id = ?', [listId, from.id]);
  if (from.by !== 'owner' && from.kind !== 'job') markGone(listId, identityOf(src));
  return true;
}

/** Which of the six jobs are on the deck: only these are counted and checked. */
export function jobsOnDeck(listId: string): Set<string> {
  return new Set(rows(listId).filter((r) => kindOf(r) === 'job' && r.jobId).map((r) => r.jobId!));
}

/** Cards the owner added to or took out of each job on the deck, by job id and card key. Read by deck-roles.ts. */
export function jobChanges(listId: string): Map<string, { add: Array<{ key: string; name: string }>; out: Set<string> }> {
  const out = new Map<string, { add: Array<{ key: string; name: string }>; out: Set<string> }>();
  const jobRows = rows(listId).filter((r) => kindOf(r) === 'job' && r.jobId);
  if (!jobRows.length) return out;
  const links = cardRows(listId);
  for (const r of jobRows) {
    const mine = links.get(r.id) ?? [];
    out.set(r.jobId!, { add: mine.filter((x) => x.isOn).map((x) => ({ key: x.cardKey, name: x.reason })), out: new Set(mine.filter((x) => !x.isOn).map((x) => x.cardKey)) });
  }
  return out;
}

/** Copy a deck's categories, card rows and marks to its duplicate (the rows themselves are copied with the deck's tags in db.ts). */
export function copyCategoryMarks(fromId: string, toId: string): void {
  db().run('INSERT OR IGNORE INTO deck_category_marks (listId, key, mark, scope, at) SELECT ?, key, mark, scope, at FROM deck_category_marks WHERE listId = ?', [toId, fromId]);
}

// --- the migration -------------------------------------------------------------------

/** What the migration did to one deck, for the report and the tests. */
export interface Migrated { listId: string; own: number; dropped: number; jobs: number; corrections: number; wins: number; keys: number; planText: boolean }

const OLD_ROLE: Record<string, string> = { Multiplier: 'multiplier', Enabler: 'enabler', 'Covers a weakness': 'counter-weight' };

/**
 * Run once, at the first start after categories shipped. For every deck that
 * exists then: the owner's and the tagger's accepted tags become their own
 * categories ("yours" or "AI" by origin); unreviewed suggestions go, and
 * turned-down ones are remembered as removed; the six jobs are accepted, so
 * counts and warnings do not silently disappear; per-deck role corrections
 * become cards added to or taken out of the matching job; the plan's text,
 * ways to win and key cards carry over with who added each. Card roles and
 * themes from the old read are dropped.
 */
export function migrateAll(): Migrated[] {
  const d = database();
  setSetting('categories.migrated', now());
  const decks = d.all(`SELECT id FROM lists WHERE kind = 'deck'`) as Array<{ id: string }>;
  const done: Migrated[] = [];
  for (const { id } of decks) {
    d.run('BEGIN');
    try {
      done.push(migrateDeck(id));
      d.run('COMMIT');
    } catch (e) {
      d.run('ROLLBACK');
      console.error('[categories] migration failed for', id, e);
    }
  }
  return done;
}

const hasTable = (name: string) => !!database().get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]);

function migrateDeck(listId: string): Migrated {
  const d = database();
  const m: Migrated = { listId, own: 0, dropped: 0, jobs: 0, corrections: 0, wins: 0, keys: 0, planText: false };
  // 1. The deck's own tags.
  const legacy = d.all(`SELECT id, name, status, origin FROM deck_tags WHERE listId = ? AND cat IS NULL`, [listId]) as Array<{ id: string; name: string; status: string; origin: string }>;
  for (const t of legacy) {
    if (t.status === 'accepted') {
      d.run(`UPDATE deck_tags SET cat = 'own', addedBy = ? WHERE id = ?`, [t.origin === 'ai' ? 'ai' : 'owner', t.id]);
      m.own++;
    } else {
      if (t.status === 'rejected') markGone(listId, identity('own', t.name));
      d.run('DELETE FROM deck_card_tags WHERE listId = ? AND tagId = ?', [listId, t.id]);
      d.run('DELETE FROM deck_tags WHERE id = ?', [t.id]);
      m.dropped++;
    }
  }
  // 2. The six jobs, so the deck's counts and warnings carry on.
  const jobIds = new Map<string, string>();
  for (const j of SIX_JOBS) { jobIds.set(j.id, addCategory(listId, { kind: 'job', name: j.label, by: 'cards', jobId: j.id, how: j.how })); m.jobs++; }
  // 3. Per-deck role corrections, as cards added to or taken out of each job.
  if (hasTable('deck_role_overrides')) {
    const corrections = d.all('SELECT oracleId, role, has FROM deck_role_overrides WHERE listId = ?', [listId]) as Array<{ oracleId: string; role: string; has: number }>;
    const nameOf = (key: string) => (d.get(`SELECT json_extract(c.data, '$.name') AS name FROM list_cards lc JOIN cards c ON c.id = lc.cardId WHERE lc.listId = ? AND json_extract(c.data, '$.oracle_id') = ?`, [listId, key]) as { name: string } | null)?.name ?? key;
    for (const o of corrections) {
      const jobs = SIX_JOBS.filter((j) => (JOB_ROLES[j.id] ?? []).includes(o.role));
      for (const j of o.has ? jobs.slice(0, 1) : jobs) {
        const catId = jobIds.get(j.id)!;
        d.run(`INSERT INTO deck_card_tags (listId, cardKey, tagId, source, isOn, reason) VALUES (?, ?, ?, 'manual', ?, ?)
          ON CONFLICT(listId, cardKey, tagId) DO UPDATE SET source = 'manual', isOn = excluded.isOn`, [listId, o.oracleId, catId, o.has ? 1 : 0, nameOf(o.oracleId)]);
        m.corrections++;
      }
    }
  }
  // 4. The plan: its text, ways to win and key cards, with who added each.
  const cardKeyOf = (name: string): { key: string; name: string } | null => {
    const r = d.get(`SELECT json_extract(c.data, '$.oracle_id') AS key, json_extract(c.data, '$.name') AS name FROM list_cards lc JOIN cards c ON c.id = lc.cardId
      WHERE lc.listId = ? AND lower(json_extract(c.data, '$.name')) = lower(?) LIMIT 1`, [listId, name]) as { key: string | null; name: string } | null;
    if (r?.key) return { key: r.key, name: r.name };
    const cmd = d.get(`SELECT json_extract(c.data, '$.oracle_id') AS key, json_extract(c.data, '$.name') AS name FROM lists l JOIN cards c ON c.id = l.commanderId WHERE l.id = ? AND lower(json_extract(c.data, '$.name')) = lower(?)`, [listId, name]) as { key: string | null; name: string } | null;
    return cmd?.key ? { key: cmd.key, name: cmd.name } : null;
  };
  const owner = hasTable('plan_owner') ? d.get('SELECT * FROM plan_owner WHERE listId = ?', [listId]) as Record<string, string | null> | null : null;
  const edits = parse<{ plan?: string; winRoutes?: Array<{ name: string; cards: string[] }>; keyCards?: string[] }>(owner?.edits, {});
  const pass = hasTable('plan_passes') ? d.get('SELECT output FROM plan_passes WHERE listId = ? ORDER BY at DESC LIMIT 1', [listId]) as { output: string } | null : null;
  const read = parse<{ plan?: string; winRoutes?: Array<{ name: string; cards: string[] }>; keyCards?: string[] }>(pass?.output, {});
  const plans = hasTable('deck_plans') ? d.get('SELECT parts FROM deck_plans WHERE listId = ?', [listId]) as { parts: string } | null : null;
  const parts = parse<{ key?: { v?: string[]; by?: string }; routes?: { custom?: Array<{ label: string; how: string; cards: string[] }>; by?: string }; role?: { v?: string } }>(plans?.parts, {});
  const wins: Array<{ name: string; how: string; cards: string[]; by: AddedBy }> = [
    ...(edits.winRoutes ? edits.winRoutes.map((r) => ({ name: r.name, how: '', cards: r.cards, by: 'owner' as AddedBy })) : (read.winRoutes ?? []).map((r) => ({ name: r.name, how: '', cards: r.cards, by: 'ai' as AddedBy }))),
    ...(parts.routes?.custom ?? []).map((r) => ({ name: r.label, how: r.how ?? '', cards: r.cards ?? [], by: 'owner' as AddedBy })),
  ];
  for (const w of wins) {
    if (!w.name?.trim()) continue;
    addCategory(listId, { kind: 'win', name: w.name, by: w.by, how: w.how, cards: w.cards.map(cardKeyOf).filter((c): c is { key: string; name: string } => !!c).map((c) => ({ ...c, by: w.by })) });
    m.wins++;
  }
  const keys: Array<{ name: string; by: AddedBy }> = edits.keyCards ? edits.keyCards.map((n) => ({ name: n, by: 'owner' as AddedBy }))
    : read.keyCards?.length ? read.keyCards.map((n) => ({ name: n, by: 'ai' as AddedBy }))
      : (parts.key?.v ?? []).map((n) => ({ name: n, by: (parts.key?.by === 'claude' ? 'ai' : 'owner') as AddedBy }));
  if (keys.length) {
    const keyId = keyCategoryId(listId);
    for (const k of keys) { const c = cardKeyOf(k.name); if (c) { putCard(listId, keyId, c.key, c.name, k.by); m.keys++; } }
  }
  ensurePlanColumns();
  const text = edits.plan?.trim() ? { t: edits.plan.trim(), by: 'owner' } : read.plan?.trim() ? { t: read.plan.trim(), by: 'ai' } : null;
  const roles = parse<string[]>(owner?.commanderRoles, []).filter((r) => r !== 'unsure');
  const oldRole = parts.role?.v && OLD_ROLE[parts.role.v] ? [OLD_ROLE[parts.role.v]] : [];
  if (text || (!roles.length && oldRole.length)) {
    d.run(`INSERT INTO plan_owner (listId, commanderRoles, edits, updatedAt) VALUES (?, ?, '{}', ?) ON CONFLICT(listId) DO NOTHING`, [listId, JSON.stringify(roles.length ? roles : oldRole), now()]);
    if (text) d.run('UPDATE plan_owner SET planText = ?, planBy = ? WHERE listId = ?', [text.t.slice(0, 2000), text.by, listId]);
    if (!roles.length && oldRole.length) d.run(`UPDATE plan_owner SET commanderRoles = ?, commanderBy = 'owner' WHERE listId = ?`, [JSON.stringify(oldRole), listId]);
    m.planText = !!text;
  }
  return m;
}

/** The plan's own table, with the columns the new Plan tab keeps (lib/plan-help.ts reads them). */
export function ensurePlanColumns(): void {
  const d = database();
  d.run(`CREATE TABLE IF NOT EXISTS plan_owner (
    listId TEXT PRIMARY KEY, commanderRoles TEXT NOT NULL DEFAULT '[]', edits TEXT NOT NULL DEFAULT '{}',
    confirmedAt TEXT, confirmedPass TEXT, useStalePass TEXT, questionsDone TEXT, ownPlan INTEGER NOT NULL DEFAULT 0, updatedAt TEXT NOT NULL)`);
  const cols = (d.all('PRAGMA table_info(plan_owner)') as Array<{ name: string }>).map((c) => c.name);
  for (const [col, def] of [['drafts', 'TEXT'], ['planText', "TEXT NOT NULL DEFAULT ''"], ['planBy', "TEXT NOT NULL DEFAULT 'owner'"], ['commanderBy', "TEXT NOT NULL DEFAULT 'owner'"], ['bracketBy', "TEXT NOT NULL DEFAULT 'owner'"], ['direction', 'TEXT']] as const) {
    if (!cols.includes(col)) d.run(`ALTER TABLE plan_owner ADD COLUMN ${col} ${def}`);
  }
}
