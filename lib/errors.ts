/**
 * The app's error log: what went wrong, where, and whether someone has seen
 * it. Settings lists them; an error (not a warning) shows a banner across
 * the app until it is acknowledged.
 *
 * Errors are things someone should look at - a failed nightly refresh, a
 * job that crashed, a check that failed. Warnings are things that sort
 * themselves out with a retry, like a busy model; they are logged but do not
 * raise the banner. Server only.
 */

import { randomUUID } from 'crypto';

import { database } from './db';

export type Level = 'error' | 'warn';

export interface AppError {
  id: string;
  at: string;
  level: Level;
  /** Where it happened, in words: "Nightly card refresh", "Tagging". */
  source: string;
  message: string;
  detail: string;
  profileId: string | null;
  listId: string | null;
  /** When and by whom it was acknowledged; null while it needs a look. */
  ackAt: string | null;
  ackBy: string | null;
}

// Kept for a while after they are seen, then dropped.
const KEEP_DAYS = 60;
let ready = false;

function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS app_errors (
      id TEXT PRIMARY KEY, at TEXT NOT NULL, level TEXT NOT NULL, source TEXT NOT NULL,
      message TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', profileId TEXT, listId TEXT,
      ackAt TEXT, ackBy TEXT)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_app_errors_at ON app_errors (at)');
    ready = true;
  }
  return d;
}

export function recordError(e: { source: string; message: string; level?: Level; detail?: unknown; profileId?: string | null; listId?: string | null }): AppError {
  const detail = e.detail instanceof Error ? (e.detail.stack ?? e.detail.message) : e.detail == null ? '' : String(e.detail);
  const row: AppError = {
    id: randomUUID(), at: new Date().toISOString(), level: e.level ?? 'error', source: e.source,
    message: e.message.slice(0, 500), detail: detail.slice(0, 4000),
    profileId: e.profileId ?? null, listId: e.listId ?? null, ackAt: null, ackBy: null,
  };
  const d = db();
  d.run(
    `INSERT INTO app_errors (id, at, level, source, message, detail, profileId, listId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.at, row.level, row.source, row.message, row.detail, row.profileId, row.listId],
  );
  d.run('DELETE FROM app_errors WHERE ackAt IS NOT NULL AND at < ?', [new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString()]);
  if (row.level === 'error') console.error(`[error] ${row.source}: ${row.message}`);
  return row;
}

/** Newest first: everything from the last `days`, plus anything still not acknowledged. */
export function listErrors(days = 30): AppError[] {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  return db().all('SELECT * FROM app_errors WHERE at >= ? OR ackAt IS NULL ORDER BY at DESC LIMIT 200', [since]) as unknown as AppError[];
}

/** Errors that still need a look - what the banner shows. */
export function openErrors(): AppError[] {
  return db().all(`SELECT * FROM app_errors WHERE ackAt IS NULL AND level = 'error' ORDER BY at DESC`) as unknown as AppError[];
}

/** Acknowledge one error, or every open one when no id is given. */
export function acknowledge(by: string, id?: string): number {
  const at = new Date().toISOString();
  const d = db();
  const before = (d.get('SELECT COUNT(*) AS n FROM app_errors WHERE ackAt IS NULL') as { n: number }).n;
  if (id) d.run('UPDATE app_errors SET ackAt = ?, ackBy = ? WHERE id = ? AND ackAt IS NULL', [at, by, id]);
  else d.run('UPDATE app_errors SET ackAt = ?, ackBy = ? WHERE ackAt IS NULL', [at, by]);
  return before - (d.get('SELECT COUNT(*) AS n FROM app_errors WHERE ackAt IS NULL') as { n: number }).n;
}
