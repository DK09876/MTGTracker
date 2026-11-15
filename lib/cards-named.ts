/**
 * Cards by name, for every place that checks a name Claude gave (Chat, Upgrades, Finish's cards to buy). Server only.
 */

import { localCards } from './card-store';
import { database } from './db';
import type { ScryfallCard } from './scryfall';

/** Cards by name: the ones the app has stored (the owner's, the decks') first, then the full card data. By front name, lower case. */
export function cardsNamed(names: string[]): Map<string, ScryfallCard> {
  const key = (n: string) => n.split(' // ')[0].trim().toLowerCase();
  const out = new Map<string, ScryfallCard>();
  for (const n of names) {
    const r = database().get(`SELECT data FROM cards WHERE json_extract(data, '$.name') = ? OR json_extract(data, '$.name') LIKE ? LIMIT 1`, [n, `${n} // %`]) as { data: string } | null;
    if (r) out.set(key(n), JSON.parse(r.data) as ScryfallCard);
  }
  const rest = names.filter((n) => !out.has(key(n)));
  if (rest.length) for (const c of localCards(rest)) if (!out.has(key(c.name))) out.set(key(c.name), c);
  return out;
}
