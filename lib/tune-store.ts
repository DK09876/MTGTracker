/**
 * What Tune keeps for a deck between visits: your changes (staged, not yet
 * applied), the suggestions you dismissed, Claude's proposals waiting in
 * their groups, the reasons cards were cut, the answer to the pile question
 * and the log of fixes. Server only.
 */

import { database } from './db';
import type { Changes, FixLog, Intent, Staged, SuggestionGroup } from './tune-shared';

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS deck_tune (listId TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT '{}', updatedAt TEXT NOT NULL)`);
    ready = true;
  }
  return d;
}

export interface TuneStore {
  changes: Changes;
  /** Suggestion and group keys you dismissed. */
  dismissed: string[];
  /** Claude's proposals, by intent. */
  proposals: Partial<Record<Intent, SuggestionGroup[]>>;
  /** Why each card was cut, by name, kept with the section it went to. */
  cutReasons: Record<string, { why: string; at: string }>;
  /** For a pile: fill to 100, or pick the best 100 from everything. */
  pile?: 'fill' | 'best' | null;
  log: FixLog[];
}

const EMPTY: TuneStore = { changes: { add: [], cut: [] }, dismissed: [], proposals: {}, cutReasons: {}, pile: null, log: [] };

export function tuneStore(listId: string): TuneStore {
  const r = db().get('SELECT state FROM deck_tune WHERE listId = ?', [listId]) as { state: string } | null;
  if (!r) return structuredClone(EMPTY);
  try {
    const s = JSON.parse(r.state) as Partial<TuneStore>;
    return {
      changes: { add: Array.isArray(s.changes?.add) ? s.changes!.add : [], cut: Array.isArray(s.changes?.cut) ? s.changes!.cut : [] },
      dismissed: Array.isArray(s.dismissed) ? s.dismissed : [],
      proposals: s.proposals && typeof s.proposals === 'object' ? s.proposals : {},
      cutReasons: s.cutReasons && typeof s.cutReasons === 'object' ? s.cutReasons : {},
      pile: s.pile ?? null,
      log: Array.isArray(s.log) ? s.log : [],
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function saveTune(listId: string, store: TuneStore): void {
  // Old dismissals and logs are trimmed so the row stays small.
  const trimmed: TuneStore = { ...store, dismissed: store.dismissed.slice(-500), log: store.log.slice(-30) };
  db().run(`INSERT INTO deck_tune (listId, state, updatedAt) VALUES (?, ?, ?)
    ON CONFLICT(listId) DO UPDATE SET state = excluded.state, updatedAt = excluded.updatedAt`, [listId, JSON.stringify(trimmed), new Date().toISOString()]);
}

export function updateTune(listId: string, change: (s: TuneStore) => void): TuneStore {
  const s = tuneStore(listId);
  change(s);
  saveTune(listId, s);
  return s;
}

/** A duplicated deck starts with no staged changes, but keeps its log and cut reasons. */
export function copyTune(fromId: string, toId: string): void {
  const s = tuneStore(fromId);
  saveTune(toId, { ...s, changes: { add: [], cut: [] }, proposals: {} });
}

export function dropTune(listId: string): void {
  db().run('DELETE FROM deck_tune WHERE listId = ?', [listId]);
}

let counter = 0;
export const newKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Every staged card whose suggestion key is in this set. */
export const stagedFrom = (changes: Changes, key: string): Staged[] => [...changes.add, ...changes.cut].filter((s) => s.from === key);
