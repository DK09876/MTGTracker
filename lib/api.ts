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
import type { Interpreted } from './interpret';
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

export const setCommander = (listId: string, commanderId: string | null) =>
  fetch(url(`lists/${listId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commanderId }),
  }).then(json<{ list: List }>);

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

export const addCard = (listId: string, cardId: string, quantity = 1) =>
  fetch(url(`lists/${listId}/cards`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, quantity }),
  }).then(json<{ ok: true }>);

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
