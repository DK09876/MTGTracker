/**
 * A deck card's collection mark, in words: whether the copy in the deck is
 * yours, a proxy, waiting in a box, held by another deck, or still to buy.
 * Read from the deck's ownership (lib/collection.ts), which is worked out on
 * the server; these are the pure bits the card views, the filter words and
 * the decks page share. Basic lands get no mark - they are not tracked.
 */

import type * as api from './api';
import type { Holding, Ownership, Status } from './collection';
import { isProxy } from './copy-variant';
import type { ScryfallCard } from './scryfall';
import { tagKey } from './tags';

/** The deck filter's words for each mark: is:held, is:proxy, is:inbox, is:otherdeck, is:tobuy. */
export const STATUS_WORDS: Record<string, Status> = {
  held: 'in-deck', proxy: 'proxy', inbox: 'in-box', otherdeck: 'in-other-deck', tobuy: 'missing',
};

interface DeckEntry { card: ScryfallCard; board: string; slot?: string | null }

/** A lookup from a deck card to its holding: by board and card, a side card falling back to the 100's. */
export function holdingIndex(o: Pick<Ownership, 'cards'> & { extras?: Holding[] } | null): (e: DeckEntry) => Holding | undefined {
  const map = new Map<string, Holding>();
  for (const h of [...(o?.cards ?? []), ...(o?.extras ?? [])]) map.set(`${h.board}:${h.key}`, h);
  return (e) => {
    const key = tagKey(e.card);
    const board = e.board === 'main' || e.slot === 'companion' ? 'main' : e.board;
    return map.get(`${board}:${key}`) ?? (board === 'side' || board === 'maybe' ? map.get(`main:${key}`) : undefined);
  };
}

/** Whether a filter word holds for a card: undefined when the word is not one of these, so the filter carries on. */
export function statusWord(h: Holding | undefined, word: string): boolean | undefined {
  const status = STATUS_WORDS[word.toLowerCase()];
  if (!status) return undefined;
  return h?.status === status;
}

export interface Mark {
  status: Status;
  /** The face: a character or two. */
  symbol: string;
  /** What it is, in a word or three: "Yours", "To buy". */
  label: string;
  /** What it means for this card, in a sentence. */
  tip: string;
}

const box = (name: string) => name || 'Unsorted';
const list = (names: string[]) => [...new Set(names)].join(', ');

/** The mark a card shows, or null for a basic land (or a card the deck has no holding for). */
export function markOf(h: Holding | undefined): Mark | null {
  if (!h || h.status === 'basic') return null;
  const some = h.short > 0 && h.pulled + h.proxies > 0 ? `${h.pulled + h.proxies} of ${h.need} in this deck. ` : '';
  switch (h.status) {
    case 'in-deck': {
      const from = list(h.pulledCopies.filter((p) => !isProxy(p.variant)).map((p) => box(p.fromLocation)));
      return { status: h.status, symbol: '✓', label: 'Yours', tip: `Your copy is in this deck${from ? `, taken from ${from}` : ''}.` };
    }
    case 'proxy': {
      const from = list(h.pulledCopies.map((p) => box(p.fromLocation)));
      return { status: h.status, symbol: 'P', label: 'Proxy', tip: from ? `A proxy copy from ${from} stands in for it.` : 'Marked as a proxy: it fills the slot without a real copy.' };
    }
    case 'in-box':
      return { status: h.status, symbol: '↓', label: 'In your boxes', tip: `${some}A copy is free in ${list(h.inBoxes.map((b) => box(b.location)))}: pull it into this deck.` };
    case 'in-other-deck':
      return { status: h.status, symbol: '⇄', label: 'In another deck', tip: `${some}Your copies are in ${list(h.inDecks.map((d) => d.listName))}.` };
    default:
      return { status: h.status, symbol: '$', label: 'To buy', tip: `${some}Not in your collection${h.price !== null ? ` - about $${h.price.toFixed(2)} each` : ''}.` };
  }
}

const proxies = (n: number) => `${n} prox${n === 1 ? 'y' : 'ies'}`;

/** The deck's chip: "86/100 yours · 2 proxies · 9 in your boxes · 1 in other decks · 0 to buy" - DeckCollection's words. */
export function summaryLine(s: Ownership['summary']): string {
  return `${s.inDeck}/${s.need} yours · ${proxies(s.proxies)} · ${s.inBoxes} in your boxes · ${s.inOtherDecks} in other decks · ${s.missing} to buy`;
}

/** A deck tile's owned count, and the proxies and to-buy beside it only when there are some. */
export function tileLine(s: Ownership['summary']): { owned: string; extra: string[] } {
  return { owned: `${s.inDeck}/${s.need}`, extra: [...(s.proxies ? [proxies(s.proxies)] : []), ...(s.missing ? [`${s.missing} to buy`] : [])] };
}

/**
 * What puts a move back, given the card as it was and how many copies moved:
 * a pull is returned, a return pulled again (from the same box when there was
 * one), a take given back to the deck it came from, a proxy count restored.
 */
export function undoFor(listId: string, act: api.DeckCollectionAction, before: Holding, moved: number): { listId: string; act: api.DeckCollectionAction } | null {
  switch (act.action) {
    case 'pull':
      return moved > 0 ? { listId, act: { action: 'return', key: act.key, quantity: moved } } : null;
    case 'take':
      return moved > 0 ? { listId: act.fromListId, act: { action: 'take', fromListId: listId, key: act.key, quantity: moved } } : null;
    case 'return': {
      if (moved <= 0 || !act.key) return null;
      const only = before.pulledCopies.length === 1 ? before.pulledCopies[0] : null;
      return { listId, act: { action: 'pull', key: act.key, quantity: moved, ...(only ? { from: { cardId: only.cardId, finish: only.finish, location: only.fromLocation, variant: only.variant } } : {}) } };
    }
    case 'proxies': {
      // What the row was marked before: the holding's proxies less the proxy copies pulled from boxes.
      const pulledProxies = before.pulledCopies.filter((p) => isProxy(p.variant)).reduce((n, p) => n + p.quantity, 0);
      return { listId, act: { action: 'proxies', cardId: act.cardId, proxies: Math.max(0, before.proxies - pulledProxies) } };
    }
    default:
      return null;
  }
}
