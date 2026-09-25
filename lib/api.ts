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

import type { List, ListedCard, ListKind, Profile } from './db';
import type { ImportSummary } from './import-into';
import { getProfile } from './profile';
import type { Previous, Translation } from './gemini';
import type { Board } from './decklist';
import type { BracketFloor } from './bracket';
import type { CutGroup } from './cuts';
import type { Health } from './health';
import type { Interpreted } from './interpret';
import type { RoleCount } from './roles';
import type { Combo } from './spellbook';
import type { Finish } from './scryfall';
import type { DeckTags, Tag, TagKind } from './tags';
import type { Budget } from './quota';
import { sortKey, type Sort } from './sort';
import type { ScryfallCard } from './scryfall';

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
}

export const search = (q: string, page = 1) =>
  fetch(url(`search?q=${encodeURIComponent(q)}&page=${page}`)).then(json<SearchResponse>);

export type AskResponse = SearchResponse & Omit<Interpreted, keyof SearchResponse>;

/** Search from anything typed - syntax, a name, or plain English. */
export const ask = (q: string) =>
  fetch(url(`ask?q=${encodeURIComponent(q)}`)).then(json<AskResponse>);

const post = (body: object) =>
  fetch(url('ask'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(json<AskResponse>);

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
 * scoped to the same commander. `edhrec: false` skips rebuilding the EDHREC
 * tab, for a change that only affects the Scryfall one.
 */
export const runQuery = (query: string, opts: { commander?: string; sort?: Sort; edhrec?: boolean; page?: number } = {}) =>
  fetch(url(`ask?${new URLSearchParams({
    query,
    ...(opts.commander ? { commander: opts.commander } : {}),
    ...(opts.sort ? { sort: sortKey(opts.sort) } : {}),
    ...(opts.edhrec === false ? { edhrec: '0' } : {}),
    ...(opts.page && opts.page > 1 ? { page: String(opts.page) } : {}),
  })}`)).then(json<AskResponse>);

/** A commander's combos, for the Combos tab. */
export const combosFor = (commander: string) =>
  fetch(url(`ask?combosFor=${encodeURIComponent(commander)}`)).then(json<AskResponse>);

export const autocomplete = (q: string, signal?: AbortSignal) =>
  fetch(url(`autocomplete?q=${encodeURIComponent(q)}`), { signal })
    .then(json<{ names: string[] }>).then((b) => b.names);

export const fetchLists = (kind?: ListKind) =>
  fetch(url(kind ? `lists?kind=${kind}` : 'lists')).then(json<{ lists: List[] }>).then((b) => b.lists);

export interface CommanderOption {
  id: string;
  name: string;
  typeLine: string;
  image: string | null;
}

export const searchCommanders = (q: string, signal?: AbortSignal) =>
  fetch(url(`commanders?q=${encodeURIComponent(q)}`), { signal })
    .then(json<{ commanders: CommanderOption[] }>).then((b) => b.commanders);

export const createDeck = (name: string, commanderId: string | null, decklist: string) =>
  fetch(url('lists'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, kind: 'deck', commanderId, decklist }),
  }).then(json<{ list: List; imported?: ImportSummary }>);

/** Set a deck's commander; `fromList` takes a card already in the deck out of the 99. */
export const setCommander = (listId: string, commanderId: string | null, fromList = false) =>
  fetch(url(`lists/${listId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commanderId, fromList }),
  }).then(json<{ list: List }>);

/**
 * Make a list exactly this decklist. A 422 carries the lines that could not
 * be found, and means nothing was changed.
 */
export async function replaceDecklist(listId: string, decklist: string): Promise<{ imported: ImportSummary; ok: boolean }> {
  const response = await fetch(url(`lists/${listId}/import`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decklist }),
  });
  if (response.status === 422) {
    const body = (await response.json()) as { imported: ImportSummary };
    return { imported: body.imported, ok: false };
  }
  const body = await json<{ imported: ImportSummary }>(response);
  return { imported: body.imported, ok: true };
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

export const deleteList = (id: string) =>
  fetch(url(`lists/${id}`), { method: 'DELETE' }).then(json<{ ok: true }>);

export const fetchList = (id: string) =>
  fetch(url(`lists/${id}`)).then(json<{ list: List; cards: ListedCard[] }>);

export const addCard = (listId: string, cardId: string, quantity = 1, board: Board = 'main') =>
  fetch(url(`lists/${listId}/cards`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, quantity, board }),
  }).then(json<{ ok: true }>);

/** Move a card to another board, or change its printing or finish. */
export const updateCard = (listId: string, cardId: string, change: { board?: Board; finish?: Finish; printingId?: string }) =>
  fetch(url(`lists/${listId}/cards`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, ...change }),
  }).then(json<{ ok: true }>);

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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, quantity }),
  }).then(json<{ ok: true }>);

export const removeCard = (listId: string, cardId: string) =>
  fetch(url(`lists/${listId}/cards?cardId=${encodeURIComponent(cardId)}`), { method: 'DELETE' })
    .then(json<{ ok: true }>);

export const fetchProfiles = () =>
  fetch(url('profiles')).then(json<{ profiles: Profile[] }>).then((b) => b.profiles);

export const createProfile = (name: string) =>
  fetch(url('profiles'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(json<{ profile: Profile }>).then((b) => b.profile);

export interface DeckHealth {
  health: Health;
  landTarget: [number, number];
}

/** Everything that comes from the stored cards - immediate. */
export const deckHealth = (listId: string) => fetch(url(`lists/${listId}/health`)).then(json<DeckHealth>);

/** Role counts - slow the first time a deck's cards are seen, then immediate. */
export const deckRoles = (listId: string) =>
  fetch(url(`lists/${listId}/health?roles=1`)).then(json<{ roles: RoleCount[] }>).then((b) => b.roles);

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
      combos: Array<{ id: string; url: string; produces: string[]; popularity: number | null; have: string[] }>;
    }>;
  } | null;
  cuts: CutGroup[];
  /** Parts that could not be worked out just now: 'bracket', 'combos'. */
  unavailable: string[];
}

export const deckInsights = (listId: string) => fetch(url(`lists/${listId}/insights`)).then(json<DeckInsights>);

// --- deck tags -----------------------------------------------------------

const send = (path: string, method: string, body: object) =>
  fetch(url(path), { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const deckTags = (listId: string) => fetch(url(`lists/${listId}/tags`)).then(json<DeckTags>);

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
  send(`lists/${listId}/tags/cards`, 'PATCH', { cardKey, tagId, on }).then(json<DeckTags>);

export type ModelStep = { model: string; budget: Budget };

export const proposeTags = (listId: string, instructions: string, boards: Board[]) =>
  send(`lists/${listId}/tags/ai`, 'POST', { step: 'propose', instructions, boards }).then(json<DeckTags & ModelStep & { proposed: number }>);

export const assignTags = (listId: string, keys: string[], boards: Board[]) =>
  send(`lists/${listId}/tags/ai`, 'POST', { step: 'assign', keys, boards })
    .then(json<DeckTags & ModelStep & { tagged: number; skipped: number; added: number }>);

export const auditTags = (listId: string, tagIds: string[], boards: Board[]) =>
  send(`lists/${listId}/tags/ai`, 'POST', { step: 'audit', tagIds, boards })
    .then(json<DeckTags & ModelStep & { added: number; removed: number }>);

/** Today's free requests left on each tagging model. */
export const aiBudget = () => fetch(url('ai/budget')).then(json<Budget & { configured: boolean }>);
