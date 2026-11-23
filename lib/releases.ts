/**
 * The app's versions and what each one changed, for the people who use it:
 * the "What's new" line under the header and the Releases page (/releases).
 * The notes themselves are in lib/release-notes.ts: agents add theirs to the
 * unreleased list, and the owner decides when they become a version
 * (AGENTS.md, "Releases").
 * Pure: the browser and the server both read it.
 */

import { RELEASE_NOTES, UNRELEASED as UNRELEASED_NOTES } from './release-notes';

export interface ReleaseItem {
  /** One short line that stands on its own in the banner: at most 70 characters, no full stop. */
  title: string;
  /** One to three sentences for the Releases page. May name cards as [[Card Name]]. */
  details: string;
}

export interface Release {
  /** major.minor.patch: minor for something new (announced), patch for fixes only (quiet). */
  version: string;
  /** The day it was merged, YYYY-MM-DD. */
  date: string;
  /** A headline, three to eight words. */
  title: string;
  items: ReleaseItem[];
}

/** A note not yet in a version: what kind it is helps the owner pick the next number. */
export interface UnreleasedItem extends ReleaseItem {
  /** Something new, or a fix or small touch. */
  kind: 'new' | 'fix';
  /** The day it was merged, YYYY-MM-DD. */
  date: string;
}

/** Notes since the newest version, oldest first. */
export const UNRELEASED: readonly UnreleasedItem[] = UNRELEASED_NOTES;

/** Every release, newest first. */
export const RELEASES: readonly Release[] = RELEASE_NOTES;

/** The version this build is. */
export const CURRENT: Release = RELEASES[0];
export const APP_VERSION = CURRENT.version;

const parts = (v: string) => v.split('.').map((n) => Number(n));

/** Negative when a is older than b, positive when newer, 0 when the same. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** A fix: a patch release (1.4.2). It goes on the Releases page quietly, with no banner of its own. */
export const isFix = (r: Release) => (parts(r.version)[2] ?? 0) > 0;

/**
 * The releases someone hasn't seen, newest first. Nothing seen yet (a new profile, or the first build with
 * releases) counts as having seen everything before the newest new thing: the banner shows that, not the history.
 */
export function unseen(seen: string | null, releases: readonly Release[] = RELEASES): Release[] {
  if (!seen) {
    const upTo = releases.findIndex((r) => !isFix(r));
    return releases.slice(0, upTo < 0 ? releases.length : upTo + 1);
  }
  return releases.filter((r) => compareVersions(r.version, seen) > 0);
}

/** What the banner announces: the unseen releases with something new, newest first, and the fixes beside them. */
export function toAnnounce(seen: string | null, releases: readonly Release[] = RELEASES): { news: Release[]; fixes: Release[] } {
  const u = unseen(seen, releases);
  return { news: u.filter((r) => !isFix(r)), fixes: u.filter(isFix) };
}

/** Whether `next` is one step up from `prev`: x.y.z+1 (a fix), x.y+1.0 (something new) or x+1.0.0. */
export function isNextVersion(prev: string, next: string): boolean {
  const [a, b, c] = parts(prev);
  const [x, y, z] = parts(next);
  return (x === a && y === b && z === c + 1) || (x === a && y === b + 1 && z === 0) || (x === a + 1 && y === 0 && z === 0);
}

/** "18 Nov 2026", from YYYY-MM-DD, the same wherever the page is opened. */
export function releaseDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${d} ${month} ${y}`;
}

/** Where a release's section is on the Releases page. */
export const releaseAnchor = (version: string) => `v${version}`;
