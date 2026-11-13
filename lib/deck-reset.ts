/**
 * The one-time reset at the first start after the Plan and Tags redesign
 * ships: every deck that exists then is left as if it had just been
 * imported. Its cards, sections, folders, history, chats, games and
 * collection pulls stay; everything the Plan, Tags and Tune pages ever
 * stored for it goes. The owner chose this over carrying old plans and tags
 * across.
 *
 * Before clearing, each cleared table's rows for those decks are copied once
 * into `<table>_before_reset`. Nothing reads the copies; they are there so a
 * hand-made group can be recovered by hand.
 *
 * Runs like the earlier migration did: the first attempt's time is kept, one
 * transaction per deck, a per-deck mark when done, and the global flag only
 * when every deck succeeded, so a deck that fails is retried at the next
 * start. Decks made after the first attempt are never touched. The setting
 * and mark names are new, so a database the earlier carry-over migration
 * already ran on is reset too. Server only.
 */

import { database, getSetting, setSetting } from './db';

/** Per-deck tables that hold Plan, Tags or Tune state: a deck imported a minute ago has no rows in any of them. */
export const CLEARED_TABLES = [
  'plan_owner', 'plan_helps', 'plan_passes', 'deck_reads', 'deck_plans',
  'deck_tags', 'deck_card_tags', 'deck_category_marks', 'tags_ai_runs', 'tag_jobs',
  'deck_role_overrides', 'deck_keeps', 'deck_tune', 'deck_trim', 'deck_cut_reviews',
  'deck_cut_rules', 'deck_playtest', 'jobs',
] as const;

/** The per-deck mark, kept in deck_category_marks (the one row of that table a reset deck keeps). */
export const RESET_MARK = 'decks.reset';
const STARTED = 'decks.resetting';
const DONE = 'decks.reset';

const now = () => new Date().toISOString();
const hasTable = (name: string) => !!database().get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]);
const hasColumn = (table: string, col: string) => (database().all(`PRAGMA table_info(${table})`) as Array<{ name: string }>).some((c) => c.name === col);

export function resetNeeded(): boolean { return !getSetting(DONE); }

/** Copies each cleared table's rows for the decks being reset, once per table. */
function archive(started: string): void {
  const d = database();
  const decks = `SELECT id FROM lists WHERE kind = 'deck' AND createdAt <= '${started.replace(/'/g, "''")}'`;
  d.run('BEGIN');
  try {
    for (const t of CLEARED_TABLES) {
      if (!hasTable(t) || !hasColumn(t, 'listId') || hasTable(`${t}_before_reset`)) continue;
      d.run(`CREATE TABLE ${t}_before_reset AS SELECT * FROM ${t} WHERE listId IN (${decks})`);
    }
    if (!hasTable('lists_before_reset')) d.run(`CREATE TABLE lists_before_reset AS SELECT id, tagBrief, tagOverview FROM lists WHERE id IN (${decks})`);
    d.run('COMMIT');
  } catch (e) {
    d.run('ROLLBACK');
    throw e;
  }
}

/** Clears one deck. Runs inside the caller's transaction. */
function resetDeck(listId: string): void {
  const d = database();
  for (const t of CLEARED_TABLES) {
    if (!hasTable(t)) continue;
    d.run(`DELETE FROM ${t} WHERE listId = ?`, [listId]);
  }
  d.run(`UPDATE lists SET tagBrief = '', tagOverview = '' WHERE id = ?`, [listId]);
  // The accept/skip log stays (it is the owner's evaluation data); nothing on the deck reads as still shown.
  if (hasTable('suggestion_batches')) d.run('UPDATE suggestion_batches SET closedAt = ? WHERE listId = ? AND closedAt IS NULL', [now(), listId]);
  d.run(`INSERT OR IGNORE INTO deck_category_marks (listId, key, mark, scope, at) VALUES (?, ?, ?, '', ?)`, [listId, RESET_MARK, RESET_MARK, now()]);
}

/** Resets every deck that existed at the first attempt and is not reset yet. Returns the ids reset now. */
export function resetAll(): string[] {
  const d = database();
  d.run(`CREATE TABLE IF NOT EXISTS deck_category_marks (
    listId TEXT NOT NULL, key TEXT NOT NULL, mark TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', at TEXT NOT NULL,
    PRIMARY KEY (listId, key, mark))`);
  const started = getSetting(STARTED) ?? now();
  setSetting(STARTED, started);
  archive(started);
  const decks = d.all(`SELECT id FROM lists WHERE kind = 'deck' AND createdAt <= ?`, [started]) as Array<{ id: string }>;
  const done: string[] = [];
  let failed = 0;
  for (const { id } of decks) {
    if (d.get('SELECT 1 FROM deck_category_marks WHERE listId = ? AND mark = ?', [id, RESET_MARK])) continue;
    d.run('BEGIN');
    try {
      resetDeck(id);
      d.run('COMMIT');
      done.push(id);
    } catch (e) {
      d.run('ROLLBACK');
      failed++;
      console.error('[deck reset] failed for', id, e);
    }
  }
  if (!failed) setSetting(DONE, now());
  return done;
}
