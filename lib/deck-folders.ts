/**
 * Folders for a profile's decks: one level, each deck in at most one.
 *
 * Kept beside the lists rather than in them: a deck's row stays as it was,
 * and a deleted deck or folder simply drops out of the join.
 */

import { randomUUID } from 'node:crypto';

import { database } from './db';

export interface DeckFolder { id: string; name: string }

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS deck_folders (
      id TEXT PRIMARY KEY, profileId TEXT NOT NULL, name TEXT NOT NULL, createdAt TEXT NOT NULL)`);
    d.run(`CREATE TABLE IF NOT EXISTS deck_folder_items (listId TEXT PRIMARY KEY, folderId TEXT NOT NULL)`);
    ready = true;
  }
  return d;
}

export const cleanFolderName = (name: unknown) => (typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 60) : '');

/** A profile's folders by name, and which folder each of its decks is in. */
export function foldersFor(profileId: string): { folders: DeckFolder[]; placed: Record<string, string> } {
  const d = db();
  const folders = d.all('SELECT id, name FROM deck_folders WHERE profileId = ? ORDER BY name COLLATE NOCASE', [profileId]) as unknown as DeckFolder[];
  const rows = d.all(`
    SELECT i.listId, i.folderId FROM deck_folder_items i
    JOIN deck_folders f ON f.id = i.folderId
    JOIN lists l ON l.id = i.listId
    WHERE f.profileId = ? AND l.profileId = ?`, [profileId, profileId]) as Array<{ listId: string; folderId: string }>;
  return { folders, placed: Object.fromEntries(rows.map((r) => [r.listId, r.folderId])) };
}

export function folderOf(profileId: string, folderId: string): DeckFolder | null {
  return db().get('SELECT id, name FROM deck_folders WHERE id = ? AND profileId = ?', [folderId, profileId]) as DeckFolder | null;
}

const taken = (profileId: string, name: string, except?: string) =>
  !!db().get('SELECT 1 FROM deck_folders WHERE profileId = ? AND lower(name) = lower(?) AND id != ?', [profileId, name, except ?? '']);

/** A new folder, or null when the profile already has one by that name. */
export function createFolder(profileId: string, name: string): DeckFolder | null {
  if (taken(profileId, name)) return null;
  const folder = { id: randomUUID(), name };
  db().run('INSERT INTO deck_folders (id, profileId, name, createdAt) VALUES (?, ?, ?, ?)', [folder.id, profileId, name, new Date().toISOString()]);
  return folder;
}

/** Rename; false when another folder already has the name. */
export function renameFolder(profileId: string, id: string, name: string): boolean {
  if (taken(profileId, name, id)) return false;
  db().run('UPDATE deck_folders SET name = ? WHERE id = ? AND profileId = ?', [name, id, profileId]);
  return true;
}

/** Delete a folder; its decks stay, out of any folder. */
export function deleteFolder(profileId: string, id: string): void {
  const d = db();
  if (!folderOf(profileId, id)) return;
  d.run('DELETE FROM deck_folder_items WHERE folderId = ?', [id]);
  d.run('DELETE FROM deck_folders WHERE id = ?', [id]);
}

/** Put a deck in a folder, or take it out of any with null. */
export function placeDeck(listId: string, folderId: string | null): void {
  const d = db();
  if (folderId) d.run('INSERT INTO deck_folder_items (listId, folderId) VALUES (?, ?) ON CONFLICT(listId) DO UPDATE SET folderId = excluded.folderId', [listId, folderId]);
  else d.run('DELETE FROM deck_folder_items WHERE listId = ?', [listId]);
}

/** A duplicate goes in the same folder as the deck it copies. */
export function copyPlacement(fromListId: string, toListId: string): void {
  const row = db().get('SELECT folderId FROM deck_folder_items WHERE listId = ?', [fromListId]) as { folderId: string } | null;
  if (row) placeDeck(toListId, row.folderId);
}
