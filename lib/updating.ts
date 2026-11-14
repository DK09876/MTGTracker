/**
 * Whether a deploy is under way (handoff 9, Part B). scripts/deploy.sh writes
 * a file named "updating" beside the database once the new version is built,
 * while it waits for running jobs to finish; while it is there no new
 * background job starts, and the pages grey out the buttons that would start
 * one. The script removes it before the new version starts. A file, not a
 * request: the script runs on the same machine and needs no sign-in. Server
 * only.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, realpathSync, rmSync } from 'fs';
import { dirname, join } from 'path';

export const UPDATING_MESSAGE = 'The app is updating. Try again in a moment.';

/** The file's path: beside the database, wherever MTG_DB_PATH puts it. */
export const updatingFile = () => join(dirname(process.env.MTG_DB_PATH || `${process.cwd()}/data/mtg.db`), 'updating');

/** A flag with no end of its own (or unreadable) counts for this long: a killed script can't hold the app forever. */
const STALE_MS = 15 * 60_000;

/**
 * When the deploy started waiting, or null when no deploy is under way. The file holds its start ("2026-...Z")
 * and, from deploy.sh, the time it ends at the latest ("start until"); past that it is ignored (review 24).
 */
export function updatingSince(now = Date.now()): string | null {
  const f = updatingFile();
  if (!existsSync(f)) return null;
  let text = '';
  try { text = readFileSync(f, 'utf8').trim(); } catch { return null; }
  const [since, until] = text.split(/\s+/);
  const start = Date.parse(since ?? '');
  const end = Date.parse(until ?? '') || (Number.isFinite(start) ? start + STALE_MS : NaN);
  if (!Number.isFinite(end) || now > end) return null;
  return since;
}

/** Remove the flag. */
export function clearUpdating(): void {
  try { rmSync(updatingFile(), { force: true }); } catch { /* nothing to clear */ }
}

/**
 * The app is starting: a flag past its end (a deploy that died, a reboot mid-deploy) goes (review 24). A flag still
 * in its time is the deploy checking this very start, and stays until the script removes it (round 2, item 20).
 */
export function clearStaleUpdating(now = Date.now()): void {
  if (existsSync(updatingFile()) && !updatingSince(now)) clearUpdating();
}

/** Which database the app has open, as a hash of its real path: deploy.sh checks it against the one it expects (review 23). */
export function databaseId(): string {
  const path = process.env.MTG_DB_PATH || `${process.cwd()}/data/mtg.db`;
  let real = path;
  try { real = realpathSync(path); } catch { /* not there yet */ }
  return createHash('sha1').update(real).digest('hex').slice(0, 16);
}

/** This build's id (next.config.ts: the commit), as the pages have it baked in. */
export const buildId = () => process.env.NEXT_PUBLIC_MTG_BUILD || 'dev';
