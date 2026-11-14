/**
 * Client-side calls into our own API, with errors that say something.
 *
 * Paths are built from the root rather than written relative. Next's basePath
 * rewrites links and assets but not fetch, and a relative "api/lists/x" read
 * from /lists/abc resolves to /lists/api/lists/x - which 404s only on the
 * nested pages, so it looks like the list page is broken rather than the URL.
 */

const BASE = process.env.NEXT_PUBLIC_MTG_BASE_PATH ?? '';

// Every call says which profile it is for; list routes refuse a request that
// does not, and search uses it to mark which of your lists hold a card.
const url = (path: string) => {
  const profile = getProfile();
  if (!profile) return `${BASE}/api/${path}`;
  return `${BASE}/api/${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`;
};

import type { BoxCopies, DeckCopies, Location, LocationKind, Ownership } from './collection';
import type { LinkReport } from './mythic';
import type { CardBefore, List, ListedCard, ListKind, Profile, RulesThread, RulesThreadSummary } from './db';
import type { ImportSummary } from './import-into';
import { getProfile } from './profile';
import type { Previous, Translation } from './gemini';
import type { Slot, SlotQuestion } from './commanders';
import type { Board } from './decklist';
import type { DeckSection, Purpose } from './sections-shared';
import type { BracketFloor } from './bracket';
import type { PlanChange as PlanChangeCore } from './deck-plan';
import type { ChangeLine, PlanPart, PlanState, ProposalLine, RouteView, RuleLine, ThemeView } from './plan-server';
import type { Health } from './health';
import type { RecentSearch, Replay, SavedSearch, Session } from './recent';
import type { Interpreted } from './interpret';
import type { RoleCount } from './roles';
import type { Combo } from './spellbook';
import type { WinGuess } from './wincons';
import type { Finish } from './scryfall';
import type { DeckTags, Tag, TagKind } from './tags';
import type { CardDataStatus } from './card-store';
import type { CutReview } from './cut-review-shared';
import type { GoldfishSettings } from './goldfish';
import type { CutSettings } from './cut-rules';
import type { CutCandidate, DeckType } from './cut-score';
import type { DeckChat } from './deck-chat';
import type { FavouriteCommander, ProfileStyle } from './profile-style';
import type { ThemeId } from './themes';
import type { CheckRun } from './checks';
import type { AppError } from './errors';
import type { Job } from './jobs';
import type { CardChange, DeckRead, ReadChange, ReadMode } from './reads';
import type { AiState } from './ai';
import type { AiCall } from './db';
import type { Game, GroupSummary, Member, PickDeck, Seat } from './games';
import type { GameEvent } from './game-play';
import type { GroupStats } from './game-stats';
import type { AiArea, Tier } from './models';
import type { Caps } from './spend';
import type { Budget } from './quota';
import { sortKey, type Sort } from './sort';
import type { ScryfallCard } from './scryfall';

import { noteStatus, reached } from './reach';

// Every request in this file goes through reached (lib/reach.ts): it notes whether the server answered, and
// turns "can't reach it" during a deploy into words instead of "Failed to fetch".
const fetch = (input: string, init?: RequestInit) => reached(input, init);

/** How the app stands (handoff 9, Part B): its build, and whether a deploy is under way. Noted for the update banner. */
export const appStatus = () => fetch(`${BASE}/api/status`, { cache: 'no-store' }).then(json<{ build: string; updating: string | null; running: number }>).then((s) => { noteStatus(s); return s; });

/** Told when a request may have spent on a model, so the header's budget is read again. */
export const AI_SPENT = 'mtg-ai-spent';

function spending<T>(work: Promise<T>): Promise<T> {
  return work.finally(() => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(AI_SPENT)); });
}

// --- answers remembered for this visit -----------------------------------------
//
// The Pi answers in tens of milliseconds, but from away it is a round trip of
// 100-300ms. So a page opened again starts from what it showed last time
// (peek) and refreshes in the background, rather than going blank to wait.
// A deck's answers are dropped as soon as the deck itself has changed.

const memo = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * One request at a time per URL: several parts of a page asking for the same
 * thing while it loads share one answer (the deck page asked for the plan,
 * health, jobs and who is signed in two to four times on one load).
 */
function shared<T>(key: string, ask: () => Promise<T>): Promise<T> {
  const was = inFlight.get(key) as Promise<T> | undefined;
  if (was) return was;
  const p = ask().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

function get<T>(path: string): Promise<T> {
  const u = url(path);
  return shared(u, () => fetch(u).then(json<T>).then((v) => { memo.set(u, v); return v; }));
}

/** What a GET answered last time this visit, if anything: to show at once while it is asked again. */
export function peek<T>(path: string): T | undefined {
  return memo.get(url(path)) as T | undefined;
}

/** Forget a deck's remembered answers (it changed). */
function forgetDeck(listId: string) {
  for (const k of memo.keys()) if (k.includes(`/lists/${listId}/`)) memo.delete(k);
  // A read already on its way may carry the deck from before the change: the next ask starts a new one.
  for (const k of inFlight.keys()) if (k.includes(`/lists/${listId}/`)) inFlight.delete(k);
}

/** The paths the deck pages read, for peek. */
export const paths = {
  list: (id: string) => `lists/${id}`,
  lists: (kind?: ListKind) => (kind ? `lists?kind=${kind}` : 'lists'),
  plan: (id: string) => `lists/${id}/plan`,
  ownership: (id: string) => `lists/${id}/collection`,
  deckSummaries: 'collection/decks',
  build: (id: string) => `lists/${id}/build`,
  cuts: (id: string) => `lists/${id}/cuts`,
  review: (id: string) => `lists/${id}/cuts/review`,
  health: (id: string) => `lists/${id}/health`,
  roles: (id: string) => `lists/${id}/health?roles=1`,
  insights: (id: string) => `lists/${id}/insights`,
  tags: (id: string) => `lists/${id}/tags`,
  playtest: (id: string) => `lists/${id}/playtest`,
  chats: (id: string) => `lists/${id}/chats`,
  reads: (id: string) => `lists/${id}/reads`,
  folders: 'folders',
};

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string }).error || `Request failed (${response.status})`);
  }
  return body as T;
}

export interface SearchResponse {
  cards: ScryfallCard[];
  totalCards: number;
  hasMore: boolean;
  inLists: Record<string, string[]>;
  /** Copies the profile owns of each card (any printing), by card id. */
  owned?: Record<string, number>;
}

export const search = (q: string, page = 1) =>
  fetch(url(`search?q=${encodeURIComponent(q)}&page=${page}`)).then(json<SearchResponse>);

export type AskResponse = SearchResponse & Omit<Interpreted, keyof SearchResponse>;

/** Search from anything typed - syntax, a name, or plain English. */
export const ask = (q: string) =>
  spending(fetch(url(`ask?q=${encodeURIComponent(q)}`)).then(json<AskResponse>));

const post = (body: object) =>
  spending(fetch(url('ask'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(json<AskResponse>));

/** A follow-up that refines the search before it. */
export const followUp = (q: string, previous: Previous) => post({ q, previous });

/** A search from inside a deck, always for that deck's commander. */
export const askForDeck = (q: string, commander: string, previous?: Previous) =>
  post({ q, previous, forDeck: { commander } });

/** Carry on a search that stopped to ask which commander was meant. */
export const resume = (q: string, previous: Previous | undefined, plan: Translation, commander: string) =>
  post({ q, previous, resume: { plan, commander } });

/**
 * Re-run a query as written - edited, re-sorted, or for a tab opened later -
 * scoped to the same commander.
 */
export const runQuery = (query: string, opts: { commander?: string; sort?: Sort; page?: number } = {}) =>
  fetch(url(`ask?${new URLSearchParams({
    query,
    ...(opts.commander ? { commander: opts.commander } : {}),
    ...(opts.sort ? { sort: sortKey(opts.sort) } : {}),
    ...(opts.page && opts.page > 1 ? { page: String(opts.page) } : {}),
  })}`)).then(json<AskResponse>);

/** A commander's combos, for the Combos tab. */
export const combosFor = (commander: string) =>
  fetch(url(`ask?combosFor=${encodeURIComponent(commander)}`)).then(json<AskResponse>);

// --- recent searches -----------------------------------------------------

export const recentSearches = () => fetch(url('recent')).then(json<{ recent: RecentSearch[] }>).then((b) => b.recent);

export const rememberSearch = (text: string, replay: Replay) =>
  send('recent', 'POST', { text, replay }).then(json<{ recent: RecentSearch[] }>).then((b) => b.recent);

export const forgetSearch = (text: string | null) =>
  fetch(url(text === null ? 'recent' : `recent?text=${encodeURIComponent(text)}`), { method: 'DELETE' })
    .then(json<{ recent: RecentSearch[] }>).then((b) => b.recent);

// --- saved searches --------------------------------------------------------------

export const savedSearches = () => fetch(url('saved')).then(json<{ saved: SavedSearch[] }>).then((b) => b.saved);

export const saveSearch = (name: string, session: Session) =>
  send('saved', 'POST', { name, session }).then(json<{ id: string; saved: SavedSearch[] }>);

export const updateSavedSearch = (id: string, change: { name?: string; session?: Session }) =>
  send('saved', 'PATCH', { id, ...change }).then(json<{ saved: SavedSearch[] }>).then((b) => b.saved);

export const forgetSavedSearch = (id: string) =>
  fetch(url(`saved?id=${encodeURIComponent(id)}`), { method: 'DELETE' }).then(json<{ saved: SavedSearch[] }>).then((b) => b.saved);

export const autocomplete = (q: string, signal?: AbortSignal) =>
  fetch(url(`autocomplete?q=${encodeURIComponent(q)}`), { signal })
    .then(json<{ names: string[] }>).then((b) => b.names);

export const fetchLists = (kind?: ListKind) => get<{ lists: List[] }>(paths.lists(kind)).then((b) => b.lists);
export const peekLists = (kind?: ListKind) => peek<{ lists: List[] }>(paths.lists(kind))?.lists;

export interface CommanderOption {
  id: string;
  /** For finding the card in the Pi's own copy, without asking Scryfall. */
  oracleId?: string | null;
  name: string;
  typeLine: string;
  image: string | null;
}

export const searchCommanders = (q: string, signal?: AbortSignal) =>
  fetch(url(`commanders?q=${encodeURIComponent(q)}`), { signal })
    .then(json<{ commanders: CommanderOption[] }>).then((b) => b.commanders);

export const createDeck = (name: string, commander: CommanderOption | null, decklist: string, starter?: { ownedFirst: boolean }, linked = '') =>
  fetch(url('lists'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, kind: 'deck', commanderId: commander?.id ?? null, commanderOracleId: commander?.oracleId ?? null, decklist,
      starter: !!starter, ownedFirst: starter?.ownedFirst, ...(linked.trim() ? { linked } : {}),
    }),
  }).then(json<{ list: List; imported?: ImportSummary; link?: LinkReport | null }>).finally(jobsChanged);

/** Set a deck's commander; `fromList` takes a card already in the deck out of the 99. */
export const setCommander = (listId: string, commanderId: string | null, fromList = false) =>
  fetch(url(`lists/${listId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commanderId, fromList }),
  }).then(json<{ list: List }>);

/** Change the commander's printing or finish, keeping the other. */
export const setCommanderPrinting = (listId: string, change: { commanderId?: string; commanderFinish?: Finish }) =>
  fetch(url(`lists/${listId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  }).then(json<{ list: List }>);

/**
 * Make a list exactly this decklist. A 422 carries the lines that could not
 * be found, and means nothing was changed.
 */
export async function replaceDecklist(
  listId: string, decklist: string, linked = '',
): Promise<{ imported: ImportSummary; ok: boolean; link?: LinkReport | null }> {
  const response = await fetch(url(`lists/${listId}/import`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decklist, ...(linked.trim() ? { linked } : {}) }),
  });
  if (response.status === 422) {
    const body = (await response.json()) as { imported: ImportSummary };
    return { imported: body.imported, ok: false };
  }
  const body = await json<{ imported: ImportSummary; link?: LinkReport | null }>(response);
  return { imported: body.imported, ok: true, link: body.link };
}

export const importDecklist = (listId: string, decklist: string) =>
  fetch(url(`lists/${listId}/import`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decklist }),
  }).then(json<{ list: List; imported: ImportSummary }>);

export const createList = (name: string) =>
  fetch(url('lists'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(json<{ list: List }>).then((b) => b.list);

export const renameList = (id: string, name: string) =>
  fetch(url(`lists/${id}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(json<{ list: List }>);

export const duplicateList = (id: string) =>
  fetch(url(`lists/${id}/duplicate`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then(json<{ list: List }>).then((b) => b.list);

export interface DeckFolders { folders: Array<{ id: string; name: string }>; placed: Record<string, string> }
export const fetchFolders = () => get<DeckFolders>(paths.folders);
export const createFolder = (name: string) =>
  fetch(url('folders'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    .then(json<{ folder: { id: string; name: string } }>).then((b) => b.folder);
export const renameFolder = (id: string, name: string) =>
  fetch(url(`folders/${id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then(json<{ folder: { id: string; name: string } }>);
export const deleteFolder = (id: string) => fetch(url(`folders/${id}`), { method: 'DELETE' }).then(json<{ ok: true }>);
export const placeDeck = (listId: string, folderId: string | null) =>
  fetch(url(`lists/${listId}/folder`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId }) }).then(json<{ ok: true }>);

export const deleteList = (id: string) =>
  fetch(url(`lists/${id}`), { method: 'DELETE' }).then(json<{ ok: true }>);

export type ListPage = { list: List; cards: ListedCard[]; public?: boolean; planConfirmed?: boolean; planProgress?: { done: number; total: number } | null; sections?: DeckSection[]; slotQuestions?: SlotQuestion[] };
export const fetchList = async (id: string) => {
  const before = peek<ListPage>(paths.list(id));
  const now = await get<ListPage>(paths.list(id));
  // The deck changed since its tabs were read: what they remember is out of date.
  if (before && before.list.updatedAt !== now.list.updatedAt) forgetDeck(id);
  return now;
};

// --- a deck's history: every change recorded, undo, snapshots -----------------

/** One change to a deck, as its history records it (lib/deck-history.ts). */
export interface DeckChange {
  id: string;
  at: string;
  profileId: string | null;
  who?: string | null;
  batch: string | null;
  kind: string;
  label: string;
  diff: HistoryDiff;
  undone: boolean;
  restorable: boolean;
}
export interface HistoryCardChange { cardId: string; name: string; from: string | null; to: string | null }
export interface HistoryDiff {
  added: HistoryCardChange[]; removed: HistoryCardChange[]; moved: HistoryCardChange[]; changed: HistoryCardChange[]; tagged: HistoryCardChange[];
  commander: HistoryCardChange | null;
}
export interface DeckSnapshot { id: string; at: string; name: string; auto: boolean; profileId: string | null; size: number }

/** Told when a change to a deck was recorded, so the page can offer Undo. */
export const DECK_CHANGED = 'mtg-deck-changed';
function deckChanged(listId: string, change: DeckChange | null | undefined) {
  if (change && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DECK_CHANGED, { detail: { listId, change } }));
}

// Changes made inside one bulk action share a batch id, so they undo as one.
let batch: string | null = null;
export async function inBatch<T>(work: () => Promise<T>): Promise<T> {
  const mine = `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  batch = mine;
  try { return await work(); } finally { if (batch === mine) batch = null; }
}
const editHeaders = (): Record<string, string> => ({ 'Content-Type': 'application/json', ...(batch ? { 'x-change-batch': batch } : {}) });

export const deckHistory = (listId: string) =>
  fetch(url(`lists/${listId}/history`)).then(json<{ changes: DeckChange[]; snapshots: DeckSnapshot[] }>);
export const compareSnapshot = (listId: string, id: string) =>
  fetch(url(`lists/${listId}/history?compare=${encodeURIComponent(id)}`)).then(json<{ diff: HistoryDiff; summary: string }>);
const history = (listId: string, body: object) =>
  fetch(url(`lists/${listId}/history`), { method: 'POST', headers: editHeaders(), body: JSON.stringify(body) })
    .then(json<{ change?: DeckChange | null; snapshot?: DeckSnapshot; ok?: boolean }>)
    .then((r) => { deckChanged(listId, r.change); return r; });
export const undoLast = (listId: string) => history(listId, { action: 'undo' });
export const restoreBefore = (listId: string, changeId: string) => history(listId, { action: 'restore-before', changeId });
export const takeSnapshot = (listId: string, name: string) => history(listId, { action: 'snapshot', name });
export const restoreSnapshot = (listId: string, id: string) => history(listId, { action: 'restore-snapshot', id });
export const renameSnapshot = (listId: string, id: string, name: string) => history(listId, { action: 'rename-snapshot', id, name });
export const deleteSnapshot = (listId: string, id: string) => history(listId, { action: 'delete-snapshot', id });

/** What saving this text over the deck would change, without saving. */
export const previewDecklist = (listId: string, decklist: string, linked = '') =>
  fetch(url(`lists/${listId}/import`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decklist, preview: true, ...(linked ? { linked } : {}) }) })
    .then(json<{ preview: { diff: HistoryDiff; summary: string; missing: string[]; unreadable: string[] } }>).then((b) => b.preview);

/** Card names as you type, from the Pi's copy, in the deck's colours, with where each already sits. */
export interface QuickCard { id: string; oracleId: string; name: string; cost: string; type: string; image: string | null; gameChanger: boolean; inDeck: string | null }
export const quickCards = (listId: string, q: string) =>
  fetch(url(`lists/${listId}/quick?q=${encodeURIComponent(q)}`)).then(json<{ q: string; cards: QuickCard[] }>);

export const addCard = (listId: string, cardId: string, quantity = 1, board: Board = 'main') =>
  fetch(url(`lists/${listId}/cards`), {
    method: 'POST',
    headers: editHeaders(),
    body: JSON.stringify({ cardId, quantity, board }),
  }).then(json<{ ok: true; before: CardBefore; change?: DeckChange | null }>).then((r) => { deckChanged(listId, r.change); return r; });

/** Put a card back as it was before an add: gone, or its old count and board. */
export const undoAdd = (listId: string, cardId: string, before: CardBefore) =>
  before
    ? fetch(url(`lists/${listId}/cards`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId, quantity: before.quantity, board: before.board }),
    }).then(json<{ ok: true }>)
    : fetch(url(`lists/${listId}/cards?cardId=${encodeURIComponent(cardId)}`), { method: 'DELETE' }).then(json<{ ok: true }>);

/** Move a card to another board, or change its printing or finish. */
export const updateCard = (listId: string, cardId: string, change: { board?: Board; finish?: Finish; printingId?: string }) =>
  fetch(url(`lists/${listId}/cards`), {
    method: 'PATCH',
    headers: editHeaders(),
    body: JSON.stringify({ cardId, ...change }),
  }).then(json<{ ok: true; change?: DeckChange | null }>).then((r) => { deckChanged(listId, r.change); return r; });

// --- a deck's sections, second commander and companion ---------------------------

export const addSection = (listId: string, name: string, purpose: Purpose) =>
  fetch(url(`lists/${listId}/sections`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, purpose }) })
    .then(json<{ section: DeckSection; sections: DeckSection[] }>);
export const changeSection = (listId: string, id: string, change: { name?: string; purpose?: Purpose }) =>
  fetch(url(`lists/${listId}/sections`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...change }) })
    .then(json<{ sections: DeckSection[] }>);
export const deleteSection = (listId: string, id: string) =>
  fetch(url(`lists/${listId}/sections?id=${encodeURIComponent(id)}`), { method: 'DELETE' }).then(json<{ moved: number; sections: DeckSection[] }>);
/** Make a card the second commander or the companion, or neither (null); or answer an import's question with "neither". */
export const setSlot = (listId: string, change: { cardId: string; slot: Slot | null } | { dismiss: Slot }) =>
  fetch(url(`lists/${listId}/slots`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) })
    .then(json<{ cards: ListedCard[]; questions: SlotQuestion[] }>);

export interface Printing {
  id: string;
  set: string;
  setName: string;
  collectorNumber: string;
  released: string;
  finishes: string[];
  image: string | null;
  prices: { usd: string | null; usd_foil: string | null; usd_etched: string | null };
}

export const printings = (oracleId: string) =>
  fetch(url(`prints?oracleId=${encodeURIComponent(oracleId)}`)).then(json<{ printings: Printing[] }>).then((b) => b.printings);

export const setQuantity = (listId: string, cardId: string, quantity: number) =>
  fetch(url(`lists/${listId}/cards`), {
    method: 'PATCH',
    headers: editHeaders(),
    body: JSON.stringify({ cardId, quantity }),
  }).then(json<{ ok: true; change?: DeckChange | null }>).then((r) => { deckChanged(listId, r.change); return r; });

export const removeCard = (listId: string, cardId: string) =>
  fetch(url(`lists/${listId}/cards?cardId=${encodeURIComponent(cardId)}`), { method: 'DELETE', headers: editHeaders() })
    .then(json<{ ok: true; change?: DeckChange | null }>).then((r) => { deckChanged(listId, r.change); return r; });

export const fetchProfiles = () =>
  shared(url('profiles'), () => fetch(url('profiles')).then(json<{ profiles: Profile[] }>).then((b) => b.profiles));

// --- signing in and admins -------------------------------------------------

export interface Me {
  id: string;
  name: string;
  isAdmin: boolean;
  hasPassword: boolean;
  signedIn: boolean;
  needsSignIn: boolean;
  /** An admin with no password yet: their first sign-in sets one. */
  setsPassword: boolean;
}
/** Told when sign-in changes, so everything that shows admin parts looks again. */
export const ME_CHANGED = 'mtg-me-changed';
const meChanged = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(ME_CHANGED)); };
export const me = (profile: string) => shared(`me:${profile}`, () => fetch(`${BASE}/api/auth/me?profile=${encodeURIComponent(profile)}`).then(json<Me>));
export const signIn = (profile: string, password: string) =>
  fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile, password }) })
    .then(json<{ ok: true }>).then((r) => { meChanged(); return r; });
export const signOut = () => fetch(`${BASE}/api/auth/logout`, { method: 'POST' }).then(json<{ ok: true }>).then((r) => { meChanged(); return r; });
export const changePassword = (current: string, next: string) =>
  send('auth/password', 'POST', { current, next }).then(json<{ access: Me }>).then((r) => { meChanged(); return r; });
export interface SuggestionRate { value: string; shown: number; accepted: number; refused: number; ignored: number; open: number; regretted: number; acceptRate: number | null }
export interface SuggestionLog {
  share: boolean;
  admin?: {
    method: 'all' | 'ai' | 'code';
    totals: { events: number; batches: number; conversations: number; sharing: Array<{ id: string; name: string; on: boolean }> };
    rates: Record<'task' | 'method' | 'model' | 'promptVersion' | 'rank', SuggestionRate[]>;
    reasons: Array<{ chip: string; count: number; typed: number }>;
  };
}
/** Your sharing setting; for an admin, the suggestion log's rates too. */
export const suggestionLog = (method?: 'ai' | 'code') => fetch(url(`suggestions${method ? `?method=${method}` : ''}`)).then(json<SuggestionLog>);
export const setSuggestionShare = (share: boolean) => send('suggestions', 'POST', { share }).then(json<{ share: boolean }>);
export const suggestionExportUrl = () => url('suggestions?export=1');
export interface Person { id: string; name: string; isAdmin: boolean; hasPassword: boolean; lists: number }
export const people = () => fetch(url('admin/people')).then(json<{ people: Person[] }>);
export const changePerson = (id: string, action: 'admin' | 'unadmin' | 'reset' | 'remove') =>
  send('admin/people', 'POST', { id, action }).then(json<{ people: Person[] }>);

// --- profiles, people and looks -------------------------------------------------

/** Told when the profile's look changes, so the theme is put on again. */
export const STYLE_CHANGED = 'mtg-style-changed';
export interface StyleAnswer { style: ProfileStyle; vars: Record<string, string> }
export const profileStyle = () => fetch(url('profile-style')).then(json<StyleAnswer>);
export const setProfileStyle = (change: { theme?: ThemeId; motion?: boolean; commanderId?: string | null; featuredDeck?: string | null }) =>
  send('profile-style', 'PUT', change).then(json<StyleAnswer>).then((r) => { window.dispatchEvent(new Event(STYLE_CHANGED)); return r; });
export interface PersonCard { id: string; name: string; isAdmin: boolean; art: string | null; commander: string | null; publicDecks: number }
export const peopleList = () => fetch(url('people')).then(json<{ people: PersonCard[] }>);
export interface ShownDeck { id: string; name: string; public: boolean; commander: string | null; identity: string[]; image: string | null; art: string | null; cards: number }
export interface PersonPage {
  person: { id: string; name: string; isAdmin: boolean };
  self: boolean;
  commander: FavouriteCommander | null;
  featured: ShownDeck | null;
  decks: ShownDeck[];
  hidden: number;
}
export const personPage = (id: string) => fetch(url(`people/${encodeURIComponent(id)}`)).then(json<PersonPage>);
export const personDeck = (id: string, listId: string) =>
  fetch(url(`people/${encodeURIComponent(id)}/decks/${encodeURIComponent(listId)}`)).then(json<{ list: List; cards: ListedCard[] }>);
export const setDeckPublic = (listId: string, value: boolean) =>
  fetch(url(`lists/${listId}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ public: value }) })
    .then(json<{ list: List; public: boolean }>);

export const createProfile = (name: string) =>
  fetch(url('profiles'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(json<{ profile: Profile }>).then((b) => b.profile);

export interface DeckHealth {
  health: Health;
  landTarget: [number, number];
  /** The six jobs not on this deck: no counts or warnings for them (the Tags tab adds them). */
  untracked?: string[];
  /** Lands as the plan counts them: a land on the back of a double-faced card is part of one. */
  landCount?: number;
}

/** Everything that comes from the stored cards - immediate. */
export const deckHealth = (listId: string) => get<DeckHealth>(paths.health(listId));

/** Role counts - slow the first time a deck's cards are seen, then immediate. */
export const deckRoles = (listId: string) => get<{ roles: RoleCount[] }>(paths.roles(listId)).then((b) => b.roles);

export interface DeckInsights {
  bracket: (BracketFloor & { spellbook: { tag: string; label: string } }) | null;
  combos: {
    included: Combo[];
    /** Cards that would each complete one or more combos, most combos first. */
    toAdd: Array<{
      name: string;
      id: string | null;
      image: string | null;
      price: string | null;
      combos: Array<{ id: string; url: string; produces: string[]; have: string[] }>;
    }>;
  } | null;
  /** How it wins, guessed from the cards alone; null when the roles could not be read. */
  wincons: WinGuess | null;
  /** Parts that could not be worked out just now: 'bracket', 'combos'. */
  unavailable: string[];
}

export const deckInsights = (listId: string) => get<DeckInsights>(paths.insights(listId));
/** Set a flagged card aside on the bracket box ("Doesn't count in this deck"), or put it back. */
export const setBracketAside = (listId: string, name: string, aside: boolean) => send(`lists/${listId}/bracket`, 'POST', { name, aside }).then(json<{ ok: true }>);

// --- deck tags -----------------------------------------------------------

const send = (path: string, method: string, body: object) =>
  fetch(url(path), { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const deckTags = (listId: string) => get<DeckTags>(paths.tags(listId));

// --- background jobs, errors and deck reads ---------------------------------

/** Told when a background job starts, so the header's jobs menu looks at once. */
export const JOBS_CHANGED = 'mtg-jobs-changed';
export const jobsChanged = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(JOBS_CHANGED)); };

export type JobSummary = Omit<Job, 'result'>;
export const jobs = () => shared(url('jobs'), () => fetch(url('jobs')).then(json<{ jobs: JobSummary[] }>));

/** Told when errors may have been acknowledged, so the banner looks again. */
export const ERRORS_CHANGED = 'mtg-errors-changed';
export const errors = (all = false) => fetch(url(`errors${all ? '?all=1' : ''}`)).then(json<{ errors: AppError[] }>);
export const acknowledgeError = (id?: string) =>
  send('errors', 'POST', id ? { id } : {}).then(json<{ acknowledged: number }>).finally(() => window.dispatchEvent(new Event(ERRORS_CHANGED)));

export const checks = () => fetch(url('checks')).then(json<{ run: CheckRun | null }>);
export const runChecks = () => send('checks', 'POST', {}).then(json<{ run: CheckRun }>).finally(() => window.dispatchEvent(new Event(ERRORS_CHANGED)));

export const cardData = () => fetch(url('card-data')).then(json<{ status: CardDataStatus }>);
export const refreshCardData = () => send('card-data', 'POST', {}).then(json<{ job: Job }>).finally(jobsChanged);

export interface CardRole { id: string; label: string; group: string; scryfall: boolean; has: boolean; corrected: boolean }
export const cardRoles = (listId: string, oracleId: string) =>
  fetch(url(`lists/${listId}/roles?card=${encodeURIComponent(oracleId)}`)).then(json<{ roles: CardRole[] }>).then((r) => r.roles);
export const correctRole = (listId: string, oracleId: string, role: string, has: boolean | null) =>
  send(`lists/${listId}/roles`, 'PUT', { oracleId, role, has }).then(json<{ roles: CardRole[] }>).then((r) => r.roles);

export interface CutPlan {
  size: number;
  candidates: Array<CutCandidate & { image: string | null }>;
  protectedCards: string[];
  type: DeckType;
  /** Where the curve is overloaded, in words; null when it is not. */
  curve: string | null;
  averageMv: number;
  roles: Array<{ id: string; label: string; count: number; target: [number, number] }>;
  /** The deck's own rule settings. */
  settings: CutSettings;
}
export const cutPlan = (listId: string) => get<CutPlan>(paths.cuts(listId));
/** Star a card so it is never offered as a cut. */
export const keepCard = (listId: string, oracleId: string, keep: boolean) => send(`lists/${listId}/cuts`, 'PUT', { oracleId, keep }).then(json<{ ok: true }>);
/** Save the deck's own cut rules. */
export const saveCutSettings = (listId: string, settings: CutSettings) => send(`lists/${listId}/cuts`, 'PATCH', { settings }).then(json<{ settings: CutSettings }>);


export type ChatSummary = { id: string; title: string; updatedAt: string; added: number; cut: number };
export const deckChats = (listId: string) => get<{ chats: ChatSummary[] }>(paths.chats(listId));
export const deckChat = (listId: string, chatId: string) =>
  fetch(url(`lists/${listId}/chats/${chatId}`)).then(json<{ chat: DeckChat; replying: boolean; error: string | null }>);
export const askDeck = (listId: string, text: string, chatId?: string) =>
  send(`lists/${listId}/chats`, 'POST', { text, chatId }).then(json<{ chat: DeckChat; job: Job }>).finally(jobsChanged);
export const markChange = (listId: string, chatId: string, message: number, change: number) =>
  send(`lists/${listId}/chats/${chatId}`, 'PATCH', { message, change }).then(json<{ chat: DeckChat }>);
/** Apply one of Claude's proposals in a chat, or take it back. The deck's remembered answers are dropped, since it changed. */
export const chatChange = (listId: string, chatId: string, message: number, change: number, act: 'apply' | 'undo') =>
  send(`lists/${listId}/chats/${chatId}`, 'PATCH', { message, change, do: act }).then(json<{ chat: DeckChat }>).finally(() => forgetDeck(listId));
export const forgetChat = (listId: string, chatId: string) =>
  fetch(url(`lists/${listId}/chats/${chatId}`), { method: 'DELETE' }).then(json<{ ok: true }>);

export interface SavedRead extends DeckRead {
  since: CardChange;
  against: ReadChange | null;
}
export interface DeckReads {
  draft: DeckRead | null;
  saved: SavedRead[];
  /** The read job, while it runs or if the last one failed. */
  job: Job | null;
}
export const deckReads = (listId: string) => get<DeckReads>(paths.reads(listId));
export const startRead = (listId: string, mode: ReadMode, instructions = '') =>
  send(`lists/${listId}/reads`, 'POST', { mode, instructions }).then(json<{ job: Job }>).finally(jobsChanged);
export const keepRead = (listId: string, id: string, saved: boolean) => send(`lists/${listId}/reads`, 'PATCH', { id, saved }).then(json<{ ok: true }>);
export const dropRead = (listId: string, id: string) =>
  fetch(url(`lists/${listId}/reads?read=${encodeURIComponent(id)}`), { method: 'DELETE' }).then(json<{ ok: true }>);

export const setTagBrief = (listId: string, brief: string) =>
  send(`lists/${listId}/tags`, 'PUT', { brief }).then(json<DeckTags>);

export const createTag = (listId: string, tag: { name: string; description?: string; color?: string; kind?: TagKind | null }) =>
  send(`lists/${listId}/tags`, 'POST', tag).then(json<DeckTags & { created: string }>);

export const updateTag = (listId: string, tagId: string, change: Partial<Pick<Tag, 'name' | 'description' | 'color' | 'kind' | 'status'>>) =>
  send(`lists/${listId}/tags`, 'PATCH', { tagId, ...change }).then(json<DeckTags>);

export const reorderTags = (listId: string, order: string[]) =>
  send(`lists/${listId}/tags`, 'PATCH', { order }).then(json<DeckTags>);

export const acceptAllTags = (listId: string) =>
  send(`lists/${listId}/tags`, 'PATCH', { acceptAll: true }).then(json<DeckTags>);

export const mergeTags = (listId: string, mergeFrom: string, mergeInto: string) =>
  send(`lists/${listId}/tags`, 'PATCH', { mergeFrom, mergeInto }).then(json<DeckTags>);

export const deleteTag = (listId: string, tagId: string) =>
  fetch(url(`lists/${listId}/tags?tagId=${encodeURIComponent(tagId)}`), { method: 'DELETE' }).then(json<DeckTags>);

export const setCardTag = (listId: string, cardKey: string, tagId: string, on: boolean) =>
  fetch(url(`lists/${listId}/tags/cards`), { method: 'PATCH', headers: editHeaders(), body: JSON.stringify({ cardKey, tagId, on }) })
    .then(json<DeckTags & { change?: DeckChange | null }>).then((r) => { deckChanged(listId, r.change); return r; });

/** Today's requests left on the tagging model - and, for Claude, today's spending. */
export const aiBudget = () => fetch(url('ai/budget')).then(json<Budget & { configured: boolean }>);

// --- collection ------------------------------------------------------------

export type CollectionState = {
  boxes: BoxCopies[];
  decks: DeckCopies[];
  locations: Location[];
  totals: { copies: number; unique: number; inBoxes: number; inDecks: number; proxies: number; value: number };
};

export const collection = () => get<CollectionState>('collection');
export const peekCollection = () => peek<CollectionState>('collection');

export const addToCollection = (cardId: string, opts: { quantity?: number; finish?: Finish; location?: string } = {}) =>
  send('collection', 'POST', { cardId, ...opts }).then(json<{ ok: true; count: number; card: ScryfallCard }>);

export const setCollectionCount = (cardId: string, finish: Finish, location: string, quantity: number, variant = '') =>
  send('collection', 'PATCH', { cardId, finish, location, variant, quantity }).then(json<CollectionState>);

export const moveCopies = (
  cardId: string, finish: Finish, location: string, move: { location?: string; finish?: Finish; quantity: number }, variant = '',
) => send('collection', 'PATCH', { cardId, finish, location, variant, move }).then(json<CollectionState>);

export interface CollectionImport {
  format: string;
  mode: 'add' | 'replace';
  copies: number;
  unique: number;
  missing: string[];
  /** Lines whose set and number were a different card: found by name instead. */
  byName: string[];
  unreadable: string[];
}

export interface CollectionImportPreview {
  format: string;
  copies: number;
  rows: number;
  locations: Array<{ name: string; kind: 'box' | 'binder'; copies: number }>;
  proxies: number;
  foil: number;
  etched: number;
  otherLanguage: number;
  unreadable: string[];
  current: { copies: number; inDecks: number };
  before: { at: string; copies: number; mode: string } | null;
}

export const previewCollectionImport = (text: string, location: string) =>
  send('collection/import', 'POST', { text, location, preview: true }).then(json<CollectionImportPreview>);

/** Thrown when adding a file that was imported before: adding it again would double every copy. */
export class ImportedBefore extends Error {
  constructor(message: string, readonly before: { at: string; copies: number; mode: string }) { super(message); }
}

export async function importCollection(
  text: string, location: string, opts: { mode?: 'add' | 'replace'; again?: boolean } = {},
): Promise<CollectionImport> {
  const response = await send('collection/import', 'POST', { text, location, ...opts });
  if (response.status === 409) {
    const body = await response.json() as { error: string; before: { at: string; copies: number; mode: string } };
    throw new ImportedBefore(body.error, body.before);
  }
  return json<CollectionImport>(response);
}

export const collectionExportUrl = () => url('collection/export');

export const addLocation = (name: string, kind: LocationKind = 'box') =>
  send('collection/locations', 'POST', { name, kind }).then(json<{ locations: Location[] }>);

export const renameLocation = (from: string, to: string, kind?: LocationKind) =>
  send('collection/locations', 'PATCH', { from, to, kind }).then(json<{ locations: Location[] }>);

export const deleteLocation = (name: string) =>
  fetch(url(`collection/locations?name=${encodeURIComponent(name)}`), { method: 'DELETE' }).then(json<{ locations: Location[] }>);

export type DeckOwnership = Ownership & { fetch: string; buy: string; moved?: number };

export const deckOwnership = (listId: string) => get<DeckOwnership>(paths.ownership(listId));
export const peekOwnership = (listId: string) => peek<DeckOwnership>(paths.ownership(listId));

/** How much of each of the profile's decks it owns, for the decks page. */
export const deckSummaries = () => get<{ decks: Record<string, Ownership['summary']> }>(paths.deckSummaries);

export type DeckCollectionAction =
  | { action: 'pull'; key: string; quantity?: number; from?: { cardId: string; finish: Finish; location: string; variant?: string } }
  | { action: 'pullAll' }
  | { action: 'take'; fromListId: string; key: string; quantity?: number }
  | { action: 'return'; key?: string; quantity?: number; to?: string }
  | { action: 'proxies'; cardId: string; proxies: number };

export const deckCollection = (listId: string, act: DeckCollectionAction) =>
  send(`lists/${listId}/collection`, 'POST', act).then(json<DeckOwnership>).then((v) => {
    // Copies moved: this deck's answer is the new one, and another deck it took from, and the totals, are stale.
    memo.set(url(paths.ownership(listId)), v);
    if (act.action === 'take') forgetDeck(act.fromListId);
    memo.delete(url(paths.deckSummaries));
    return v;
  });

// --- scanning ----------------------------------------------------------------

export interface ScanMatch {
  card: ScryfallCard | null;
  /** 'printing': set and number read and the name agreed. 'name': matched by name only. */
  match?: 'printing' | 'name';
  read: { title: string; set: string; number: string };
}

export const identifyScan = (read: { title: string; set?: string; number?: string }) =>
  send('scan', 'POST', read).then(json<ScanMatch>);

// --- rules ------------------------------------------------------------------------

export interface RulesChoice { mention: string; options: Array<{ name: string; image: string | null }> }

export const rulesThreads = () => fetch(url('rules')).then(json<{ threads: RulesThreadSummary[]; budget: Budget }>);

export const rulesThread = (id: string) => fetch(url(`rules?id=${encodeURIComponent(id)}`)).then(json<{ thread: RulesThread }>).then((b) => b.thread);

export interface RulesClarify { question: string; options: string[] }

export const askRules = (question: string, opts: {
  threadId?: string; picks?: Record<string, string>; secondCheck?: boolean; clarifications?: Array<{ question: string; answer: string }>;
} = {}) =>
  spending(send('rules', 'POST', { question, ...opts }).then(json<{ thread?: RulesThread; choice?: RulesChoice[]; clarify?: RulesClarify[]; budget?: Budget }>));

export const updateRulesThread = (id: string, change: { title?: string; starred?: boolean }) =>
  send('rules', 'PATCH', { id, ...change }).then(json<{ thread: RulesThread; threads: RulesThreadSummary[] }>);

export const forgetRulesThread = (id: string) =>
  fetch(url(`rules?id=${encodeURIComponent(id)}`), { method: 'DELETE' }).then(json<{ threads: RulesThreadSummary[] }>).then((b) => b.threads);

// --- the profile's models ------------------------------------------------------

/** Told when a model, effort or cap changes, so every picker shows it. */
export const AI_CHANGED = 'mtg-ai-changed';

const changed = (state: AiState) => {
  window.dispatchEvent(new Event(AI_CHANGED));
  return state;
};

export const aiState = () => fetch(url('ai/models')).then(json<AiState>);
/** The model this profile uses on one page. */
export const chooseTier = (area: AiArea, tier: Tier) => send('ai/models', 'PUT', { area, tier }).then(json<AiState>).then(changed);
export const setCaps = (caps: Partial<Caps>) => send('ai/models', 'PUT', { caps }).then(json<AiState>).then(changed);
/** Every Claude request in the last `days`, newest first, and profile names for showing who. */
export const aiUsage = (days = 7) =>
  fetch(url(`ai/usage?days=${days}`)).then(json<{ calls: AiCall[]; names: Record<string, string>; days: number }>);
export const testModel = (model: string) => send('ai/models', 'POST', { model }).then(json<AiState>).then(changed);

/** A deck's plan: what it does, its styles, the ranges it uses, how it wins. */
/** The Plan tab's picture of a deck (plan-server.ts). */
export type DeckPlanState = PlanState;
export type { PlanPart, ThemeView, RouteView, RuleLine, ChangeLine, ProposalLine };
/** A change to the plan, plus what only the route does: keep or drop a detected theme, settle one of Claude's proposals, the brief. */
export type PlanChange = PlanChangeCore & {
  brief?: string;
  keepTheme?: string;
  unkeepTheme?: string;
  settle?: { key: string; status: 'accepted' | 'skipped' };
  acceptBrief?: string;
};
export const deckPlan = (listId: string) => get<DeckPlanState>(paths.plan(listId));
export const changePlan = (listId: string, change: PlanChange) => send(`lists/${listId}/plan`, 'PUT', change).then(json<DeckPlanState>);


/** Claude's last review of the cut list, what the owner has done about it since, and the job if one is running. */
export interface CutReviewState { review: CutReview | null; settled?: { cut: string[]; kept: string[] }; job: Job | null }
export const cutReview = (listId: string) => get<CutReviewState>(paths.review(listId));

/** A deck's playtest settings, presets, and each card's tags by name. */
export interface PlaytestState {
  settings: GoldfishSettings;
  presets: Array<{ name: string; settings: GoldfishSettings }>;
  saved: boolean;
  cardTags: Record<string, string[]>;
  tagNames: string[];
}
export const deckPlaytest = (listId: string) => get<PlaytestState>(paths.playtest(listId));
export const savePlaytest = (listId: string, change: { settings?: GoldfishSettings; presets?: PlaytestState['presets'] }) =>
  send(`lists/${listId}/playtest`, 'PUT', change).then(json<{ settings: GoldfishSettings; presets: PlaytestState['presets'] }>);

// --- Tune ----------------------------------------------------------------------

/** Trim: the cut flow for a deck over 100 (lib/trim.ts). */
export type TrimView = import('./trim-shared').TrimView;
export type TrimAction =
  | { action: 'approach'; text?: string; draft?: boolean; clear?: boolean; claude?: boolean }
  | { action: 'find'; rerun?: boolean; message?: string }
  | { action: 'target'; target: import('./trim-shared').TrimTarget | null }
  | { action: 'choices'; choices: Record<string, import('./trim-shared').TrimChoice> }
  | { action: 'never'; name: string; on: boolean }
  | { action: 'apply'; cutsTo?: string; keepNotes?: string[] }
  | { action: 'undo' }
  | { action: 'reset' };
export const trim = (listId: string) => get<TrimView>(`lists/${listId}/trim`);
export const trimAct = (listId: string, act: TrimAction) => {
  const paid = act.action === 'find' || (act.action === 'approach' && act.claude === true);
  const work = send(`lists/${listId}/trim`, 'POST', act).then(json<TrimView>).finally(() => {
    if (paid) jobsChanged();
    if (act.action === 'apply' || act.action === 'undo') forgetDeck(listId);
  });
  return paid ? spending(work) : work;
};

/** Finish the deck from your cards (lib/finish.ts). */
export type FinishView = import('./finish-shared').FinishView;
export type FinishAction =
  | { action: 'settings'; copies?: import('./finish-shared').Copies; want?: number | null; lands?: number | null }
  | { action: 'find'; rerun?: boolean; message?: string }
  | { action: 'choices'; choices: FinishView['choices'] }
  | { action: 'take'; name: string; group: string }
  | { action: 'lands'; skip?: string[]; basics?: Record<string, number>; add?: string; room?: number }
  | { action: 'unskip'; name: string }
  | { action: 'apply' }
  | { action: 'undo' }
  | { action: 'reset' };
export const finish = (listId: string) => get<FinishView>(`lists/${listId}/finish`);
export const finishCard = (listId: string, cardId: string, name?: string) => get<import('./scryfall').ScryfallCard>(`lists/${listId}/finish?card=${encodeURIComponent(cardId)}${name ? `&name=${encodeURIComponent(name)}` : ''}`);
export const finishAct = (listId: string, act: FinishAction) => {
  const paid = act.action === 'find';
  const work = send(`lists/${listId}/finish`, 'POST', act).then(json<FinishView>).finally(() => {
    if (paid) jobsChanged();
    if (act.action === 'apply' || act.action === 'undo') forgetDeck(listId);
  });
  return paid ? spending(work) : work;
};

/** Upgrades for a finished deck (lib/upgrades.ts). */
export type UpgradesView = import('./upgrades-shared').UpgradesView;
export type UpgradesAction =
  | { action: 'settings'; count?: number; sources?: import('./upgrades-shared').UpgradeSources }
  | { action: 'find'; rerun?: boolean; message?: string }
  | { action: 'choices'; choices: UpgradesView['choices'] }
  | { action: 'unskip'; name: string }
  | { action: 'apply' }
  | { action: 'undo' }
  | { action: 'reset' };
export const upgrades = (listId: string) => get<UpgradesView>(`lists/${listId}/upgrades`);
export const upgradesAct = (listId: string, act: UpgradesAction) => {
  const paid = act.action === 'find';
  const work = send(`lists/${listId}/upgrades`, 'POST', act).then(json<UpgradesView>).finally(() => {
    if (paid) jobsChanged();
    if (act.action === 'apply' || act.action === 'undo') forgetDeck(listId);
  });
  return paid ? spending(work) : work;
};

export type TuneState = import('./tune').TuneState;
type TuneAction =
  | { action: 'stage'; items: import('./tune-shared').Suggestion[] }
  | { action: 'unstage'; keys: string[] }
  | { action: 'dismiss' | 'undismiss'; keys: string[] }
  | { action: 'save'; section: string; items: import('./tune-shared').Suggestion[] }
  | { action: 'clear' }
  | { action: 'apply'; cutsTo?: string }
  | { action: 'undo'; undo: unknown }
  | { action: 'keep'; cardId: string; keep: boolean; key?: string }
  | { action: 'reason'; key: string; chip?: import('./suggestion-shared').ReasonChip; text?: string }
  | { action: 'pile'; choice: 'fill' | 'best' | null }
  | { action: 'finishPicks'; showRules?: boolean }
  | { action: 'verdict'; id: string; verdict: 'better' | 'same' | 'worse' }
  | { action: 'propose'; intent?: import('./tune-shared').Intent; title?: string; why?: string; items: import('./tune-shared').Suggestion[] };

export const tunePath = (listId: string, intent?: string, symptom?: string) =>
  `lists/${listId}/tune${intent ? `?intent=${intent}${symptom ? `&symptom=${symptom}` : ''}` : ''}`;
export const tune = (listId: string, intent?: string, symptom?: string) => get<TuneState>(tunePath(listId, intent, symptom));
export const tuneAct = <T = { ok: true; staged?: number; capped?: number; saved?: number; added?: number; cut?: number }>(listId: string, act: TuneAction) =>
  send(`lists/${listId}/tune`, 'POST', act).then(json<T>).finally(() => { if (act.action === 'apply' || act.action === 'undo' || act.action === 'save' || act.action === 'keep') forgetDeck(listId); });
export const tuneIdeasJob = (listId: string) => get<{ job: Job | null }>(`lists/${listId}/tune/claude`);
export const startTuneIdeas = (listId: string, intent: string, instructions: string, problem?: string) =>
  spending(send(`lists/${listId}/tune/claude`, 'POST', { intent, instructions, problem }).then(json<{ job: Job }>).finally(jobsChanged));

// --- playgroups and games --------------------------------------------------------


export type GameSummary = Omit<Game, 'events'>;
export type { Game, GroupSummary, Member, PickDeck, Seat, GroupStats };
export interface GroupPage { group: GroupSummary; games: GameSummary[]; live: GameSummary[]; stats: GroupStats }

export const playgroups = () => get<{ groups: GroupSummary[] }>('playgroups');
export const createPlaygroup = (name: string) => send('playgroups', 'POST', { name }).then(json<{ group: { id: string } }>);
export const playgroup = (id: string, players?: number) => get<GroupPage>(`playgroups/${id}${players ? `?players=${players}` : ''}`);
export const renamePlaygroup = (id: string, name: string) => send(`playgroups/${id}`, 'PATCH', { name }).then(json<{ ok: true }>);
export const deletePlaygroup = (id: string) => fetch(url(`playgroups/${id}`), { method: 'DELETE' }).then(json<{ ok: true }>);
export const addPlaygroupMember = (id: string, who: { profileId: string } | { name: string }) =>
  send(`playgroups/${id}/members`, 'POST', who).then(json<{ member: Member }>);
export const removePlaygroupMember = (id: string, member: string) =>
  fetch(url(`playgroups/${id}/members?member=${encodeURIComponent(member)}`), { method: 'DELETE' }).then(json<{ ok: true }>);
export const playgroupDecks = (id: string) => get<{ decks: Record<string, PickDeck[]> }>(`playgroups/${id}/decks`);

export interface NewGameSeat { memberId: string; deckId: string | null; deckName: string }
export const startGame = (groupId: string, seats: NewGameSeat[], startingLife: number, firstSeat: number, borrowing: boolean, layout: string) =>
  send('games', 'POST', { groupId, seats: seats.map(({ memberId, deckId, deckName }) => ({ memberId, deckId, deckName })), startingLife, firstSeat, borrowing, layout }).then(json<{ id: string }>);
export const deckRecords = () => get<{ records: Record<string, { games: number; wins: number }> }>('games');
export const game = (id: string) => fetch(url(`games/${id}`)).then(json<{ game: Game }>);

/** Save a live game's events. On a 409 the saved events come back instead of throwing. */
export async function saveGame(id: string, events: GameEvent[], base: number): Promise<{ saved: number } | { conflict: GameEvent[] }> {
  const r = await send(`games/${id}`, 'PUT', { events, base });
  if (r.status === 409) {
    const body = await r.json().catch(() => ({})) as { events?: GameEvent[] };
    if (body.events) return { conflict: body.events };
  }
  return json<{ saved: number }>(r);
}
export const finishGame = (id: string, winner: number | null, events: GameEvent[]) => send(`games/${id}`, 'POST', { winner, events }).then(json<{ game: Game }>);
export const editGame = (id: string, change: { winner?: number | null; note?: string; layout?: string; seat?: { seat: number; deckId: string | null; deckName: string } }) =>
  send(`games/${id}`, 'PATCH', change).then(json<{ game: Game }>);
export const deleteGame = (id: string) => fetch(url(`games/${id}`), { method: 'DELETE' }).then(json<{ ok: true }>);

// --- the Plan and Tags tabs (lib/plan-help.ts, lib/tags-tab.ts) ----------------------------

export const planHelpPath = (listId: string) => `lists/${listId}/plan/help`;
export const categoriesPath = (listId: string) => `lists/${listId}/categories`;
/** The Plan tab: settings, how the deck wins, ways to win and key cards, open AI suggestions, confirmation. */
export const planHelp = (listId: string) => get<import('./plan-help-shared').PlanState>(planHelpPath(listId));
export const planHelpAct = (listId: string, a: import('./plan-help-shared').PlanAction) => {
  const work = send(planHelpPath(listId), 'POST', a).then(json<import('./plan-help-shared').PlanState>)
    .then((v) => { memo.set(url(planHelpPath(listId)), v); return v; });
  return a.action === 'run' ? spending(work.finally(jobsChanged)) : work;
};
/** The Tags tab: what is on the deck, and the suggestions from the cards and from AI. */
export const tagsTab = (listId: string) => get<import('./tags-tab-shared').TagsView>(categoriesPath(listId));
export const tagsTabAct = (listId: string, a: Record<string, unknown>) => {
  const work = send(categoriesPath(listId), 'POST', a).then(json<import('./tags-tab-shared').TagsView>)
    .then((v) => { memo.set(url(categoriesPath(listId)), v); return v; });
  return a.action === 'ai' ? spending(work.finally(jobsChanged)) : work;
};
