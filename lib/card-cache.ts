'use client';

/**
 * The browser's copy of cards by name (AGENTS.md, "Getting a card"): one cache for the whole app, so a card looked
 * up on one screen is known on every other. A name is looked up only when something asks for it (a name pointed
 * at, a popup opened); names asked for together go to the server in one request (/api/cards, lib/cards.ts), which
 * answers from the app's cards and reaches Scryfall only for a card it hasn't seen.
 */

import { useSyncExternalStore } from 'react';

import { foldName, type LookupState } from './card-lookup';
import type { ScryfallCard } from './scryfall';

type State = LookupState<ScryfallCard>;
const IDLE: State = { status: 'idle' };
const LOADING: State = { status: 'loading' };

const known = new Map<string, State>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => { version += 1; for (const l of listeners) l(); };

/** Cards a page already holds (a deck's cards): known at once, no request. */
export function rememberCards(cards: Array<ScryfallCard | null | undefined>): void {
  let any = false;
  for (const c of cards) {
    if (!c?.name) continue;
    const k = foldName(c.name);
    if (known.get(k)?.status !== 'found') { known.set(k, { status: 'found', card: c }); any = true; }
  }
  if (any) changed();
}

/** What is known of a card by name now: idle (not asked), loading, found or missing. */
export const cardState = (name: string): State => known.get(foldName(name)) ?? IDLE;

let queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const waiting = new Map<string, Array<(s: State) => void>>();

function flush() {
  timer = null;
  const names = [...queue];
  queue = new Set();
  if (!names.length) return;
  const base = process.env.NEXT_PUBLIC_MTG_BASE_PATH ?? '';
  const qs = names.map((n) => `name=${encodeURIComponent(n)}`).join('&');
  fetch(`${base}/api/cards?${qs}`)
    .then((r) => (r.ok ? r.json() as Promise<{ cards: ScryfallCard[] }> : { cards: [] }))
    .catch(() => ({ cards: [] as ScryfallCard[] }))
    .then(({ cards }) => {
      const byKey = new Map(cards.map((c) => [foldName(c.name), c]));
      for (const n of names) {
        const k = foldName(n);
        const c = byKey.get(k);
        const s: State = c ? { status: 'found', card: c } : { status: 'missing' };
        known.set(k, s);
        for (const done of waiting.get(k) ?? []) done(s);
        waiting.delete(k);
      }
      changed();
    });
}

/** Look a card up by name, once (a found or missing answer is kept; `retry` asks again after a miss). */
export function lookCard(name: string, retry = false): Promise<State> {
  const k = foldName(name);
  const had = known.get(k);
  if (had?.status === 'found' || (had?.status === 'missing' && !retry)) return Promise.resolve(had);
  const p = new Promise<State>((done) => waiting.set(k, [...(waiting.get(k) ?? []), done]));
  if (had?.status !== 'loading') {
    known.set(k, LOADING);
    queue.add(name.split(' // ')[0].trim());
    if (queue.size >= 60) flush();
    else timer ??= setTimeout(flush, 30);
    changed();
  }
  return p;
}

/** A card by name, kept up to date as lookups answer (re-renders the caller when anything is found). */
export function useCardState(name: string | null): State {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version, () => 0);
  return name ? cardState(name) : IDLE;
}
