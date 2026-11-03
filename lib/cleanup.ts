/**
 * The weekly clean-up: logs older than a week go, so they do not pile up.
 *
 * Only records of what happened are removed - the AI usage trail (request
 * by request), finished background jobs, acknowledged errors, unsaved deck
 * reads, expired sign-ins. What people keep stays: decks, chats, saved
 * reads, rules answers, searches. The daily AI spending totals are kept
 * for 60 days, for the month's budget and each step's average cost.
 * Server only.
 */

import { database, setSetting } from './db';

const WEEK = 7 * 86400_000;
const SPEND_DAYS = 60;

export interface Cleaned { [what: string]: number }

/** Delete from a table if it exists; how many rows went. */
function prune(table: string, where: string, args: unknown[]): number {
  const d = database();
  if (!d.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [table])) return 0;
  return d.run(`DELETE FROM ${table} WHERE ${where}`, args as never).changes;
}

export function cleanUp(now = Date.now()): Cleaned {
  const week = new Date(now - WEEK).toISOString();
  const spendDay = new Date(now - SPEND_DAYS * 86400_000).toISOString().slice(0, 10);
  const done: Cleaned = {
    'AI requests': prune('ai_calls', 'at < ?', [week]),
    'background jobs': prune('jobs', `status != 'running' AND startedAt < ?`, [week]),
    'acknowledged errors': prune('app_errors', 'ackAt IS NOT NULL AND at < ?', [week]),
    'unsaved deck reads': prune('deck_reads', 'saved = 0 AND at < ?', [week]),
    'expired sign-ins': prune('sessions', 'expiresAt < ?', [new Date(now).toISOString()]),
    'daily spending totals': prune('ai_spend', 'day < ?', [spendDay]),
  };
  setSetting('cleanup.last', JSON.stringify({ at: new Date(now).toISOString(), removed: done }));
  return done;
}
