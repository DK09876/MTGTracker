/**
 * One price per card (handoff 10, item 26): Find cards and Swaps showed two
 * prices for one card because each read a different printing. Everywhere
 * Upgrades, its free list and Finish's cards to buy show a price, it comes
 * from here: the printing the owner holds when they hold one, else the
 * cheapest printing the app knows (the card data's own and any printing
 * stored in a list or the collection). A card with no price anywhere is
 * null: unknown, never free. Server only.
 */

import { localCardsByOracle } from './card-store';
import { database, IN_CHUNK } from './db';
import type { ScryfallCard } from './scryfall';

const usd = (c: ScryfallCard | undefined | null): number | null => {
  const v = Number(c?.prices?.usd);
  return c?.prices?.usd != null && Number.isFinite(v) && v > 0 ? v : null;
};

/** The price of each card, by oracle id: the held printing's, else the cheapest known; null when none has one. */
export function cardPrices(cards: ScryfallCard[], held?: Map<string, { card: ScryfallCard }>): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const key = (c: ScryfallCard) => c.oracle_id ?? c.id;
  const open: ScryfallCard[] = [];
  for (const c of cards) {
    const mine = held?.get(key(c))?.card;
    const p = usd(mine);
    if (p !== null) out.set(key(c), p);
    else open.push(c);
  }
  if (!open.length) return out;
  const best = new Map<string, number | null>(open.map((c) => [key(c), usd(c)]));
  const take = (k: string, c: ScryfallCard) => { const p = usd(c); if (p !== null && (best.get(k) == null || p < best.get(k)!)) best.set(k, p); };
  const ids = [...new Set(open.map((c) => c.oracle_id).filter((x): x is string => !!x))];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const part = ids.slice(i, i + IN_CHUNK);
    for (const r of database().all(`SELECT data FROM cards WHERE json_extract(data, '$.oracle_id') IN (${part.map(() => '?').join(',')})`, part) as Array<{ data: string }>) {
      const c = JSON.parse(r.data) as ScryfallCard;
      if (c.oracle_id) take(c.oracle_id, c);
    }
  }
  for (const c of localCardsByOracle(ids)) if (c.oracle_id) take(c.oracle_id, c);
  for (const [k, v] of best) out.set(k, v);
  return out;
}

/** One card's price, as cardPrices works it out. */
export const cardPrice = (card: ScryfallCard, held?: Map<string, { card: ScryfallCard }>): number | null => cardPrices([card], held).get(card.oracle_id ?? card.id) ?? null;

/** A price as the page shows it: "$1.35", or null for none. */
export const priceText = (p: number | null): string | null => (p === null ? null : p.toFixed(2));
