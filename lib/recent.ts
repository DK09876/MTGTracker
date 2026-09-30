/**
 * Recent searches, and how to run one again without asking the model.
 *
 * A search in plain English costs a model request to read; what it was read
 * as - the Scryfall query, the commander, the order - is kept with it, so
 * running it again from the recent list, or after a reload, goes straight
 * to Scryfall. Pure: shared by the page and the server.
 */

import type { Interpreted } from './interpret';
import { sortKey } from './sort';

export type Replay =
  /** A card picked by name from the suggestions. */
  | { kind: 'name'; name: string }
  /** A commander's combos. */
  | { kind: 'combos'; commander: string; explanation?: string; note?: string }
  /** Anything else: the query as Scryfall ran it. `card` for a search that was for one card by name. */
  | { kind: 'query'; query: string; commander?: string; sort?: string; explanation?: string; constraints?: string; card?: boolean; note?: string };

export interface RecentSearch {
  /** What was typed; a follow-up is the whole thread, "green ramp for omnath › only instants". */
  text: string;
  replay: Replay;
  at: string;
}

/** How to run this answer again, or null for one that has nothing to replay (it stopped to ask). */
export function replayOf(answer: Pick<Interpreted, 'interpretation' | 'choice'>): Replay | null {
  if (answer.choice) return null;
  const { kind, query, commander, sort, explanation, constraints, note } = answer.interpretation;
  if (kind === 'combos') {
    return commander ? { kind: 'combos', commander: commander.name, explanation, note } : null;
  }
  return {
    kind: 'query',
    query,
    ...(kind === 'card' ? { card: true } : {}),
    ...(note ? { note } : {}),
    ...(commander ? { commander: commander.name } : {}),
    ...(sort ? { sort: sortKey(sort) } : {}),
    ...(explanation ? { explanation } : {}),
    ...(constraints !== undefined ? { constraints } : {}),
  };
}

const MAX_TEXT = 500;
const MAX_QUERY = 2000;

/** A replay from a request body, checked, or null. */
export function parseReplay(value: unknown): Replay | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object') return null;
  const str = (x: unknown, max = MAX_TEXT) => (typeof x === 'string' && x.length <= max ? x : undefined);
  if (v.kind === 'name') {
    const name = str(v.name);
    return name ? { kind: 'name', name } : null;
  }
  if (v.kind === 'combos') {
    const commander = str(v.commander);
    return commander ? { kind: 'combos', commander, explanation: str(v.explanation), note: str(v.note) } : null;
  }
  if (v.kind === 'query') {
    const query = str(v.query, MAX_QUERY);
    if (query === undefined) return null;
    return {
      kind: 'query',
      query,
      card: v.card === true ? true : undefined,
      note: str(v.note),
      commander: str(v.commander),
      sort: str(v.sort, 40),
      explanation: str(v.explanation),
      constraints: str(v.constraints, MAX_QUERY),
    };
  }
  return null;
}

export const cleanText = (text: unknown): string | null => {
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/\s+/g, ' ');
  return t && t.length <= MAX_TEXT ? t : null;
};

// --- sessions: a search as it was left ----------------------------------------

export type SessionTab = 'edhrec' | 'cards' | 'combos';

/**
 * A search as it was left, to carry on from: what was asked (the request and
 * each refinement), how to run it again without the model, and what was on
 * screen - the tab, how many pages were loaded, EDHREC narrowed or matched to
 * the full search, and how far down the page was scrolled.
 */
export interface Session {
  thread: string[];
  replay: Replay;
  tab?: SessionTab;
  pages?: number;
  edhrecFull?: boolean;
  /** Only for the search on screen on a device, not a saved one. */
  scrollY?: number;
}

/** A session kept under a name, to come back to. */
export interface SavedSearch {
  id: string;
  name: string;
  session: Session;
  createdAt: string;
  updatedAt: string;
}

const TABS = new Set<SessionTab>(['edhrec', 'cards', 'combos']);

export function parseSession(value: unknown): Session | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object') return null;
  const replay = parseReplay(v.replay);
  const thread = Array.isArray(v.thread) ? v.thread.map(cleanText).filter((t): t is string => !!t).slice(0, 20) : [];
  if (!replay) return null;
  return {
    thread,
    replay,
    ...(TABS.has(v.tab as SessionTab) ? { tab: v.tab as SessionTab } : {}),
    ...(typeof v.pages === 'number' && v.pages > 1 ? { pages: Math.min(10, Math.trunc(v.pages)) } : {}),
    ...(v.edhrecFull === true ? { edhrecFull: true } : {}),
  };
}

/** Whether two sessions are the same search in the same state, scroll aside. */
export function sameSession(a: Session, b: Session): boolean {
  const key = (s: Session) => JSON.stringify([s.thread, s.replay, s.tab ?? null, s.pages ?? 1, !!s.edhrecFull]);
  return key(a) === key(b);
}
