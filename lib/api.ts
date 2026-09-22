/**
 * Client-side calls into our own API, with errors that say something.
 *
 * Paths are built from the root rather than written relative. Next's basePath
 * rewrites links and assets but not fetch, and a relative "api/lists/x" read
 * from /lists/abc resolves to /lists/api/lists/x - which 404s only on the
 * nested pages, so it looks like the list page is broken rather than the URL.
 */

const BASE = process.env.NEXT_PUBLIC_MTG_BASE_PATH ?? '';
const url = (path: string) => `${BASE}/api/${path}`;

import type { List, ListedCard } from './db';
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

export const fetchLists = () =>
  fetch(url('lists')).then(json<{ lists: List[] }>).then((b) => b.lists);

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
