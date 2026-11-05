/**
 * A deck's reads: how it wins and what it needs, either guessed from the
 * cards (quick, no model) or drafted by the model. The newest read waits on
 * the Tags tab until the owner saves it or lets it go; saved reads are kept,
 * each with the deck's card list at the time, so a later look can say what
 * changed since - cards in and out, routes gained and lost.
 *
 * This is the light version of version control: only the reads the owner
 * chose to keep, not every change to the deck.
 */

import { randomUUID } from 'crypto';

import { database } from './db';
import type { PlanSuggestion } from './tagging';

export type ReadMode = 'quick' | 'scratch' | 'build' | 'check';

export interface WinLine {
  how: string;
  cards: string[];
  /** Only on quick reads: a short name and how sure. */
  label?: string;
  strength?: 'strong' | 'some';
}

export interface DeckRead {
  id: string;
  listId: string;
  profileId: string;
  at: string;
  mode: ReadMode;
  /** The model that wrote it, or null for a quick read. */
  model: string | null;
  winConditions: WinLine[];
  missing: string;
  /** A brief the model suggests; '' for a quick read. */
  brief: string;
  /** The deck's cards (names, main board) when it was read. */
  cards: string[];
  /** What Claude would set in the plan: proposals, disagreements, overrides, notes. Model reads only. */
  suggestions?: PlanSuggestion[];
  saved: boolean;
}

let ready = false;

function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS deck_reads (
      id TEXT PRIMARY KEY, listId TEXT NOT NULL, profileId TEXT NOT NULL, at TEXT NOT NULL,
      saved INTEGER NOT NULL DEFAULT 0, read TEXT NOT NULL)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_deck_reads_list ON deck_reads (listId, at)');
    ready = true;
  }
  return d;
}

const parse = (row: { read: string; saved: number }): DeckRead => ({ ...JSON.parse(row.read) as DeckRead, saved: !!row.saved });

/** Keep a new read as the deck's draft, replacing the last unsaved one. */
export function addRead(read: Omit<DeckRead, 'id' | 'at' | 'saved'>): DeckRead {
  const full: DeckRead = { ...read, id: randomUUID(), at: new Date().toISOString(), saved: false };
  const d = db();
  d.run('DELETE FROM deck_reads WHERE listId = ? AND saved = 0', [read.listId]);
  d.run('INSERT INTO deck_reads (id, listId, profileId, at, saved, read) VALUES (?, ?, ?, ?, 0, ?)',
    [full.id, full.listId, full.profileId, full.at, JSON.stringify(full)]);
  return full;
}

/** The deck's waiting draft, if any, and its saved reads, newest first. */
export function readsFor(listId: string): { draft: DeckRead | null; saved: DeckRead[] } {
  const rows = (db().all('SELECT read, saved FROM deck_reads WHERE listId = ? ORDER BY at DESC', [listId]) as Array<{ read: string; saved: number }>).map(parse);
  return { draft: rows.find((r) => !r.saved) ?? null, saved: rows.filter((r) => r.saved) };
}

export function setSaved(listId: string, id: string, saved: boolean): boolean {
  return db().run('UPDATE deck_reads SET saved = ? WHERE id = ? AND listId = ?', [saved ? 1 : 0, id, listId]).changes > 0;
}

export function deleteRead(listId: string, id: string): boolean {
  return db().run('DELETE FROM deck_reads WHERE id = ? AND listId = ?', [id, listId]).changes > 0;
}

// --- comparing ------------------------------------------------------------

export interface CardChange { added: string[]; removed: string[] }

export function cardChange(before: string[], after: string[]): CardChange {
  const was = new Set(before);
  const now = new Set(after);
  return { added: after.filter((n) => !was.has(n)).sort(), removed: before.filter((n) => !now.has(n)).sort() };
}

export interface ReadChange {
  /** Routes in the newer read with no match in the older. */
  gained: WinLine[];
  /** Routes in the older read with no match in the newer. */
  lost: WinLine[];
  /** Routes in both. */
  kept: WinLine[];
  /** Whether the newer read still says the deck lacks something. */
  stillMissing: boolean;
}

/**
 * Routes are written fresh each time, so they are matched by the cards
 * behind them: two routes are the same plan when most of the smaller one's
 * cards are in the other.
 */
export function compareReads(older: DeckRead, newer: DeckRead): ReadChange {
  const same = (a: WinLine, b: WinLine) => {
    if (a.label && b.label) return a.label === b.label;
    const small = a.cards.length <= b.cards.length ? a.cards : b.cards;
    const big = new Set(a.cards.length <= b.cards.length ? b.cards : a.cards);
    return small.length > 0 && small.filter((c) => big.has(c)).length / small.length >= 0.5;
  };
  return {
    gained: newer.winConditions.filter((n) => !older.winConditions.some((o) => same(o, n))),
    lost: older.winConditions.filter((o) => !newer.winConditions.some((n) => same(o, n))),
    kept: newer.winConditions.filter((n) => older.winConditions.some((o) => same(o, n))),
    stillMissing: !!newer.missing,
  };
}
