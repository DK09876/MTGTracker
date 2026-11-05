/**
 * A deck's sections, stored. The Maybeboard and Sideboard need no row until
 * the owner renames or re-purposes one; the owner's own sections are rows,
 * with ids starting "s-" so a card's board says which section it is in.
 * Deleting a section moves its cards to the Maybeboard rather than losing
 * them. Server only.
 */

import { randomUUID } from 'node:crypto';

import { database } from './db';
import type { Board } from './decklist';
import { DEFAULT_SECTIONS, isPurpose, type DeckSection, type Purpose } from './sections-shared';

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS deck_sections (
      listId TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, purpose TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (listId, id))`);
    ready = true;
  }
  return d;
}

interface Row { id: string; name: string; purpose: string; position: number }

export function sectionsOf(listId: string): DeckSection[] {
  const rows = db().all('SELECT id, name, purpose, position FROM deck_sections WHERE listId = ? ORDER BY position, rowid', [listId]) as unknown as Row[];
  const purpose = (p: string, fallback: Purpose): Purpose => (isPurpose(p) ? p : fallback);
  const builtIn = DEFAULT_SECTIONS.map((d) => {
    const r = rows.find((x) => x.id === d.id);
    return r ? { ...d, name: r.name, purpose: purpose(r.purpose, d.purpose) } : d;
  });
  const own = rows.filter((r) => r.id.startsWith('s-'))
    .map((r): DeckSection => ({ id: r.id as `s-${string}`, name: r.name, purpose: purpose(r.purpose, 'list'), builtIn: false }));
  return [...builtIn, ...own];
}

/** Whether a board is one this deck has: main, the two built in, or one of the owner's. */
export function hasBoard(listId: string, board: unknown): board is Board {
  if (board === 'main' || board === 'side' || board === 'maybe') return true;
  return typeof board === 'string' && board.startsWith('s-') && sectionsOf(listId).some((s) => s.id === board);
}

const cleanName = (name: unknown) => (typeof name === 'string' ? name.trim().slice(0, 40) : '');

export function addSection(listId: string, name: string, purpose: Purpose): DeckSection | null {
  const n = cleanName(name);
  if (!n || !isPurpose(purpose)) return null;
  const id = `s-${randomUUID().slice(0, 8)}` as const;
  const last = db().get('SELECT MAX(position) AS p FROM deck_sections WHERE listId = ?', [listId]) as { p: number | null } | null;
  db().run('INSERT INTO deck_sections (listId, id, name, purpose, position) VALUES (?, ?, ?, ?, ?)', [listId, id, n, purpose, (last?.p ?? 0) + 1]);
  return { id, name: n, purpose, builtIn: false };
}

export function changeSection(listId: string, id: string, change: { name?: string; purpose?: Purpose }): DeckSection | null {
  const current = sectionsOf(listId).find((s) => s.id === id);
  if (!current) return null;
  const name = change.name === undefined ? current.name : cleanName(change.name) || current.name;
  const purpose = change.purpose !== undefined && isPurpose(change.purpose) ? change.purpose : current.purpose;
  db().run(
    `INSERT INTO deck_sections (listId, id, name, purpose, position) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(listId, id) DO UPDATE SET name = excluded.name, purpose = excluded.purpose`,
    [listId, id, name, purpose],
  );
  return { ...current, name, purpose };
}

/** Remove one of the owner's sections; its cards move to the Maybeboard. */
export function deleteSection(listId: string, id: string): number | null {
  if (!id.startsWith('s-') || !sectionsOf(listId).some((s) => s.id === id)) return null;
  const d = db();
  const moved = (d.get('SELECT COUNT(*) AS n FROM list_cards WHERE listId = ? AND board = ?', [listId, id]) as { n: number }).n;
  d.run('BEGIN');
  try {
    d.run(`UPDATE list_cards SET board = 'maybe' WHERE listId = ? AND board = ?`, [listId, id]);
    d.run('DELETE FROM deck_sections WHERE listId = ? AND id = ?', [listId, id]);
    d.run('COMMIT');
  } catch (error) {
    d.run('ROLLBACK');
    throw error;
  }
  return moved;
}

/** A duplicated deck keeps its sections (its cards keep their boards). */
export function copySections(fromId: string, toId: string): void {
  db().run('INSERT OR IGNORE INTO deck_sections (listId, id, name, purpose, position) SELECT ?, id, name, purpose, position FROM deck_sections WHERE listId = ?', [toId, fromId]);
}

export function dropSections(listId: string): void {
  db().run('DELETE FROM deck_sections WHERE listId = ?', [listId]);
}
