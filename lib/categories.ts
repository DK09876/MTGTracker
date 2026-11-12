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
 * Decks that existed before this shipped are reset once at the first start
 * (lib/deck-reset.ts): they start with no categories, like a deck just
 * imported. Server only.
 */

import { randomUUID } from 'node:crypto';

import { cardTags } from './card-store';
import { cardsInList, database, type List, type ListedCard } from './db';
import { resetAll, resetNeeded } from './deck-reset';
import { primaryType } from './deckview';
import { identity, type AddedBy, type Category, type CategoryCard, type CategoryKind } from './categories-shared';
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
    if (resetNeeded()) resetAll();
  }
  return d;
}

/** At server start: makes the tables and runs the one-time reset of existing decks before any new deck is made. */
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
/**
 * A category made by accepting a suggestion keeps that suggestion's key
 * (mark 'from', scope = the category's id), so a rename doesn't bring the
 * suggestion back as new and removing the renamed category still retires it.
 */
export function markFrom(listId: string, catId: string, key: string): void {
  db().run(`INSERT OR REPLACE INTO deck_category_marks (listId, key, mark, scope, at) VALUES (?, ?, 'from', ?, ?)`, [listId, key, catId, now()]);
}
export function fromKeys(listId: string): Set<string> {
  return new Set((db().all(`SELECT key FROM deck_category_marks WHERE listId = ? AND mark = 'from'`, [listId]) as Array<{ key: string }>).map((r) => r.key));
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
 * Undo taking a card out: it goes back the way it was. A card the card data
 * put in a job or a tag goes back to being live; any other goes back with
 * who added it. Not remembered as removed any more.
 */
export function restoreCard(listId: string, catId: string, card: { key: string; name: string }, by: AddedBy): boolean {
  const r = rowOf(listId, catId);
  if (!r) return false;
  const d = db();
  d.run(`DELETE FROM deck_category_marks WHERE listId = ? AND key = ? AND mark = 'gone'`, [listId, cardMark(identityOf(r), card.key)]);
  const kind = kindOf(r);
  if ((kind === 'job' || kind === 'tag') && by === 'cards') d.run('DELETE FROM deck_card_tags WHERE listId = ? AND cardKey = ? AND tagId = ?', [listId, card.key, catId]);
  else putCard(listId, catId, card.key, card.name, by);
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
  // What it was accepted from, under whatever name it has now.
  for (const m of d.all(`SELECT key FROM deck_category_marks WHERE listId = ? AND mark = 'from' AND scope = ?`, [listId, catId]) as Array<{ key: string }>) markGone(listId, m.key);
  d.run(`DELETE FROM deck_category_marks WHERE listId = ? AND mark = 'from' AND scope = ?`, [listId, catId]);
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
 * source goes. A merged generated category is not suggested again. Jobs,
 * ways to win and key cards can take cards in but are never merged away.
 */
export function mergeCategory(listId: string, from: Category, intoId: string): boolean {
  const into = rowOf(listId, intoId);
  const src = rowOf(listId, from.id);
  // A job, a way to win or the key cards are never merged away: that would silently stop a job's counts and warnings, or take a way to win off the plan.
  if (!into || !src || into.id === src.id || from.kind === 'key' || from.kind === 'job' || from.kind === 'win') return false;
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
  if (from.by !== 'owner') markGone(listId, identityOf(src));
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
  const d = db();
  d.run('INSERT OR IGNORE INTO deck_category_marks (listId, key, mark, scope, at) SELECT ?, key, mark, scope, at FROM deck_category_marks WHERE listId = ?', [toId, fromId]);
  // The copy's categories have new ids: point each 'from' mark at the copy's category of the same kind and name.
  const before = new Map(rows(fromId).map((r) => [r.id, r]));
  const after = rows(toId);
  for (const m of d.all(`SELECT key, scope FROM deck_category_marks WHERE listId = ? AND mark = 'from'`, [toId]) as Array<{ key: string; scope: string }>) {
    const old = before.get(m.scope);
    const match = old && after.find((r) => r.cat === old.cat && r.name === old.name);
    if (match) d.run(`UPDATE deck_category_marks SET scope = ? WHERE listId = ? AND key = ? AND mark = 'from'`, [match.id, toId, m.key]);
    else d.run(`DELETE FROM deck_category_marks WHERE listId = ? AND key = ? AND mark = 'from'`, [toId, m.key]);
  }
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
