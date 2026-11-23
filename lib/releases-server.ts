/**
 * What each profile has seen of the release notes (lib/releases.ts), and the
 * app's deploy history: every time the server starts on a build it hasn't
 * run before, the build and its version are written down, so the Releases
 * page can say when each version went live. Server only.
 */

import { database, getSetting, setSetting } from './db';
import { APP_VERSION, compareVersions, RELEASES } from './releases';
import { buildId } from './updating';

const SEEN = (profileId: string) => `profile.releaseSeen.${profileId}`;

/** The newest version this profile has seen, or null when it hasn't seen any. */
export function seenVersion(profileId: string): string | null {
  return getSetting(SEEN(profileId));
}

/** Note that this profile has seen up to `version`. Never goes backwards, and never past this build's. */
export function markSeen(profileId: string, version: string): string {
  const known = RELEASES.some((r) => r.version === version) ? version : APP_VERSION;
  const was = seenVersion(profileId);
  const next = was && compareVersions(was, known) > 0 ? was : known;
  if (next !== was) setSetting(SEEN(profileId), next);
  return next;
}

// --- deploys --------------------------------------------------------------------

export interface Deploy {
  /** The build: the commit it was built from. */
  build: string;
  version: string;
  /** When the server first started on it, ISO. */
  at: string;
}

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run('CREATE TABLE IF NOT EXISTS deploys (id INTEGER PRIMARY KEY AUTOINCREMENT, build TEXT NOT NULL, version TEXT NOT NULL, at TEXT NOT NULL)');
    ready = true;
  }
  return d;
}

/**
 * The server has started: write the build down when it differs from the last one written (a rollback to an older
 * build is a deploy too). A development server ('dev', or NODE_ENV not production) writes nothing.
 */
export function recordDeploy(build = buildId(), version = APP_VERSION, now = new Date()): boolean {
  if (build === 'dev') return false;
  const last = db().get('SELECT build FROM deploys ORDER BY id DESC LIMIT 1') as { build: string } | null;
  if (last?.build === build) return false;
  db().run('INSERT INTO deploys (build, version, at) VALUES (?, ?, ?)', [build, version, now.toISOString()]);
  return true;
}

/** Every deploy, newest first. */
export function deploys(limit = 200): Deploy[] {
  return db().all('SELECT build, version, at FROM deploys ORDER BY id DESC LIMIT ?', [limit]) as unknown as Deploy[];
}
