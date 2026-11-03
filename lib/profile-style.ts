/**
 * How a profile looks to itself and to others: its theme, whether the app
 * moves (the living background, foil shine), its picture - a favourite
 * commander's art - and the deck it shows off. And which decks others can
 * see: every deck is private until its owner makes it public. Server only.
 */

import { database, getSetting, setSetting } from './db';
import { THEME_IDS, type ThemeId } from './themes';

export interface FavouriteCommander {
  id: string;
  name: string;
  /** Scryfall's art crop: the profile picture and banner. */
  art: string | null;
  identity: string[];
}

export interface ProfileStyle {
  theme: ThemeId;
  motion: boolean;
  commander: FavouriteCommander | null;
  featuredDeck: string | null;
}

const KEY = (profileId: string) => `profile.style.${profileId}`;
const DEFAULT: ProfileStyle = { theme: 'gold', motion: true, commander: null, featuredDeck: null };

export function getStyle(profileId: string): ProfileStyle {
  const raw = getSetting(KEY(profileId));
  return raw ? { ...DEFAULT, ...JSON.parse(raw) as Partial<ProfileStyle> } : DEFAULT;
}

export function setStyle(profileId: string, change: Partial<ProfileStyle>): ProfileStyle {
  const next = { ...getStyle(profileId), ...change };
  if (!THEME_IDS.includes(next.theme)) next.theme = 'gold';
  setSetting(KEY(profileId), JSON.stringify(next));
  return next;
}

// --- public decks -------------------------------------------------------------

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    const cols = (d.all('PRAGMA table_info(lists)') as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes('public')) d.run('ALTER TABLE lists ADD COLUMN public INTEGER NOT NULL DEFAULT 0');
    ready = true;
  }
  return d;
}

export function isPublic(listId: string): boolean {
  return !!(db().get('SELECT public FROM lists WHERE id = ?', [listId]) as { public: number } | null)?.public;
}

export function setPublic(listId: string, value: boolean): void {
  db().run('UPDATE lists SET public = ? WHERE id = ?', [value ? 1 : 0, listId]);
}

/** The ids of a profile's decks others can see. */
export function publicIds(profileId: string): Set<string> {
  return new Set((db().all(`SELECT id FROM lists WHERE profileId = ? AND public = 1 AND kind = 'deck'`, [profileId]) as Array<{ id: string }>).map((r) => r.id));
}

/** Who owns a list, for showing a public one. */
export function ownerOf(listId: string): string | null {
  return (db().get('SELECT profileId FROM lists WHERE id = ?', [listId]) as { profileId: string } | null)?.profileId ?? null;
}
