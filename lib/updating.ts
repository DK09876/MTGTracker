/**
 * Whether a deploy is under way (handoff 9, Part B). scripts/deploy.sh writes
 * a file named "updating" beside the database once the new version is built,
 * while it waits for running jobs to finish; while it is there no new
 * background job starts, and the pages grey out the buttons that would start
 * one. The script removes it before the new version starts. A file, not a
 * request: the script runs on the same machine and needs no sign-in. Server
 * only.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

export const UPDATING_MESSAGE = 'The app is updating. Try again in a moment.';

/** The file's path: beside the database, wherever MTG_DB_PATH puts it. */
export const updatingFile = () => join(dirname(process.env.MTG_DB_PATH || `${process.cwd()}/data/mtg.db`), 'updating');

/** When the deploy started waiting, or null when no deploy is under way. */
export function updatingSince(): string | null {
  const f = updatingFile();
  if (!existsSync(f)) return null;
  try { return readFileSync(f, 'utf8').trim() || new Date().toISOString(); } catch { return new Date().toISOString(); }
}

/** This build's id (next.config.ts: the commit), as the pages have it baked in. */
export const buildId = () => process.env.NEXT_PUBLIC_MTG_BUILD || 'dev';
