/**
 * Running a collection import on the server: a preview of what a file
 * holds, then adding it to the collection or making the collection exactly
 * it. The same file twice is caught by its fingerprint, so importing it
 * again does not double every copy.
 */

import { createHash } from 'node:crypto';

import { addManyToCollection, clearCollection, importedBefore, recordImport, UNSORTED } from './collection';
import { readCollectionFile, resolveRows, type Format } from './collection-import';
import { isProxy, parseVariant } from './copy-variant';
import { database } from './db';
import type { Identifier, ScryfallCard } from './scryfall';

export type ImportMode = 'add' | 'replace';

/** The same file, whatever its line endings or trailing space. */
export const fingerprint = (text: string) =>
  createHash('sha256').update(text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()).digest('hex').slice(0, 32);

export interface ImportPreview {
  format: Format;
  copies: number;
  rows: number;
  /** Where the copies go, as the file says. */
  locations: Array<{ name: string; kind: 'box' | 'binder'; copies: number }>;
  proxies: number;
  foil: number;
  etched: number;
  /** Copies in a language other than English. */
  otherLanguage: number;
  unreadable: string[];
  /** What is there now: replacing removes it. */
  current: { copies: number; inDecks: number };
  /** When this exact file was imported before. */
  before: { at: string; copies: number; mode: string } | null;
}

export function previewRows(profileId: string, text: string, location = ''): ImportPreview {
  const { rows, unreadable, format } = readCollectionFile(text, location);
  const byLoc = new Map<string, { name: string; kind: 'box' | 'binder'; copies: number }>();
  let proxies = 0, foil = 0, etched = 0, otherLanguage = 0;
  for (const r of rows) {
    const l = byLoc.get(r.location) ?? { name: r.location, kind: r.kind ?? 'box', copies: 0 };
    l.copies += r.quantity;
    byLoc.set(r.location, l);
    if (isProxy(r.variant)) proxies += r.quantity;
    if (r.finish === 'foil') foil += r.quantity;
    if (r.finish === 'etched') etched += r.quantity;
    if (parseVariant(r.variant).language !== 'en') otherLanguage += r.quantity;
  }
  const db = database();
  const count = (sql: string) => (db.get(sql, [profileId]) as { n: number | null } | null)?.n ?? 0;
  return {
    format, rows: rows.length, copies: rows.reduce((n, r) => n + r.quantity, 0),
    locations: [...byLoc.values()].sort((a, b) => b.copies - a.copies),
    proxies, foil, etched, otherLanguage, unreadable,
    current: {
      copies: count('SELECT SUM(quantity) AS n FROM collection_cards WHERE profileId = ?'),
      inDecks: count('SELECT SUM(dp.quantity) AS n FROM deck_pulls dp JOIN lists l ON l.id = dp.listId WHERE l.profileId = ?'),
    },
    before: importedBefore(profileId, fingerprint(text)),
  };
}

export interface ImportResult {
  format: Format;
  mode: ImportMode;
  copies: number;
  unique: number;
  missing: string[];
  /** Lines whose set and number were a different card: found by name instead. */
  byName: string[];
  unreadable: string[];
}

export class AlreadyImported extends Error {
  constructor(readonly before: { at: string; copies: number; mode: string }) {
    super('This file was imported before. Replace the collection with it, or add it again on purpose.');
  }
}

/**
 * Import a file. Adding a file already imported is refused unless `again`:
 * that would double every copy. Replacing empties the boxes - and unlinks
 * what decks held, as those copies are in the file too - first.
 */
export async function runCollectionImport(
  profileId: string, text: string,
  { location = UNSORTED, mode = 'add', again = false, lookup }: {
    location?: string; mode?: ImportMode; again?: boolean;
    lookup: (identifiers: Identifier[]) => Promise<{ cards: ScryfallCard[] }>;
  },
): Promise<ImportResult> {
  const hash = fingerprint(text);
  const before = importedBefore(profileId, hash);
  if (before && mode === 'add' && !again) throw new AlreadyImported(before);
  const { rows, unreadable, format } = readCollectionFile(text, location);
  // Every card is found before anything is written.
  const { items, missing, byName } = await resolveRows(rows, lookup);
  const db = database();
  const own = !db.inTransaction;
  if (own) db.run('BEGIN');
  try {
    if (mode === 'replace') clearCollection(profileId);
    addManyToCollection(profileId, items);
    const copies = items.reduce((n, i) => n + i.quantity, 0);
    recordImport(profileId, hash, format, copies, mode);
    if (own) db.run('COMMIT');
    return {
      format, mode, copies,
      unique: new Set(items.map((i) => i.card.oracle_id ?? i.card.id)).size,
      missing, byName, unreadable,
    };
  } catch (error) {
    if (own) db.run('ROLLBACK');
    throw error;
  }
}
