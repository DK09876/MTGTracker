/**
 * Whether the server can be reached, and whether it now runs a newer build
 * (handoff 9, Part B), as a tiny client store the update banner reads. Every
 * request from lib/api.ts goes through `reached`; the header's pollers too.
 *
 * Unreachable: the fetch itself threw (the app is stopped), or a 502, 503 or
 * 504 that doesn't carry the app's mark (x-mtg, next.config.ts headers): those
 * come from in front of the app. A 400 or 500 the app sent is a real error
 * and keeps its own message. Pure apart from the store.
 */

/** A change whose answer never came: it may have been saved before the connection dropped (review 25). */
export const MAYBE_SAVED = 'This may not have been saved. Check before trying again.';
export const NOT_READ = 'The app is updating. This page will reconnect by itself.';
export const NO_REACH = 'Can’t reach the app. This page will reconnect by itself.';

/** This page's build, baked in at build time. */
export const PAGE_BUILD = process.env.NEXT_PUBLIC_MTG_BUILD || 'dev';

export type Reach = 'ok' | 'down';

/** What one answer says about the server: down, or up with its build id (null when it doesn't say). */
export function classify(r: { status: number; headers: { get: (k: string) => string | null } } | 'threw'): { reach: Reach; build: string | null } {
  if (r === 'threw') return { reach: 'down', build: null };
  const ours = r.headers.get('x-mtg') === '1';
  if (!ours && (r.status === 502 || r.status === 503 || r.status === 504)) return { reach: 'down', build: null };
  return { reach: 'ok', build: ours ? r.headers.get('x-mtg-build') : null };
}

/** Whether a build id from the server is a different version from this page's. */
export const isNewer = (server: string | null, page = PAGE_BUILD) => !!server && server !== page && page !== 'dev';

export interface ReachState {
  /** The server couldn't be reached on the last try. */
  down: boolean;
  /** A deploy has started (the server said so), so the buttons that start work are greyed out. */
  updating: boolean;
  /** When the server last said a deploy was under way: an outage soon after is the deploy, not the network. */
  updatingAt?: number;
  /** The server runs a different build from this page: offer a refresh. */
  newer: boolean;
}

let state: ReachState = { down: false, updating: false, newer: false };
const listeners = new Set<(s: ReachState) => void>();

export const reachState = () => state;

function set(next: Partial<ReachState>) {
  const merged = { ...state, ...next };
  if (merged.down === state.down && merged.updating === state.updating && merged.newer === state.newer && merged.updatingAt === state.updatingAt) return;
  state = merged;
  for (const l of listeners) l(state);
}

export function onReach(listener: (s: ReachState) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Note one answer (or a thrown fetch). Returns what it said. */
export function note(r: Parameters<typeof classify>[0]): { reach: Reach; build: string | null } {
  const c = classify(r);
  if (c.reach === 'down') set({ down: true });
  // A build id says whether this page is behind: true or false, so a rollback clears the line again.
  else set({ down: false, ...(c.build ? { newer: isNewer(c.build) } : {}) });
  return c;
}

/** What the status endpoint said: a deploy under way, and its build. */
export function noteStatus(s: { build: string; updating: string | null }) {
  set({ down: false, updating: !!s.updating, newer: isNewer(s.build), ...(s.updating ? { updatingAt: Date.now() } : {}) });
}

/** Whether an outage now reads as the deploy: the server said it was updating in the last ten minutes. */
export const looksLikeDeploy = (s: ReachState = state, now = Date.now()) => s.updating || (!!s.updatingAt && now - s.updatingAt < 10 * 60_000);

/** For tests. */
export function resetReach() { state = { down: false, updating: false, newer: false }; listeners.clear(); }

/**
 * fetch, noting what the answer says. A fetch that throws (the server is stopped) or a 502/503/504 from in front
 * of the app becomes an Error with words for it: a read says it will reconnect, a change says it wasn't sent.
 * Nothing is re-sent automatically: a change sent twice is worse than one pressed again.
 */
export async function reached(input: string, init?: RequestInit, f: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Response> {
  const change = !!init?.method && init.method.toUpperCase() !== 'GET';
  let r: Response;
  try {
    r = await f(input, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    note('threw');
    throw new Error(change ? MAYBE_SAVED : looksLikeDeploy() ? NOT_READ : NO_REACH);
  }
  if (note(r).reach === 'down') throw new Error(change ? MAYBE_SAVED : looksLikeDeploy() ? NOT_READ : NO_REACH);
  return r;
}
