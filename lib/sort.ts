/**
 * How search results are ordered.
 *
 * Kept apart from the query. A sort chosen from the menu re-runs the search
 * with Scryfall doing the ordering, because results are only the first page
 * - sorting that page in the browser would show "the cheapest of the 175
 * most popular" rather than the cheapest.
 *
 * Scryfall lets `order:` sit inside the query too, where it overrides the
 * API parameter; `splitSort` lifts it out so there is one place a sort
 * lives. Pure, so the page can use it.
 */

export type Direction = 'auto' | 'asc' | 'desc';

export interface Sort {
  /** A Scryfall order: edhrec, name, usd, cmc, released... */
  order: string;
  dir: Direction;
}

/**
 * Most played in Commander first - the format these searches are for.
 * (What one commander's decks play is the EDHREC tab, not a sort.)
 */
export const DEFAULT_SORT: Sort = { order: 'edhrec', dir: 'auto' };

export interface SortOption extends Sort {
  label: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { order: 'edhrec', dir: 'auto', label: 'Most played in Commander' },
  { order: 'name', dir: 'auto', label: 'Name' },
  { order: 'usd', dir: 'asc', label: 'Price: low to high' },
  { order: 'usd', dir: 'desc', label: 'Price: high to low' },
  { order: 'cmc', dir: 'asc', label: 'Mana value: low to high' },
  { order: 'cmc', dir: 'desc', label: 'Mana value: high to low' },
  { order: 'released', dir: 'desc', label: 'Newest first' },
  { order: 'rarity', dir: 'desc', label: 'Rarity' },
  { order: 'power', dir: 'desc', label: 'Power' },
];

export const sortKey = (sort: Sort) => `${sort.order}:${sort.dir}`;

export function parseSortKey(key: string | null): Sort | null {
  if (!key) return null;
  const [order, dir] = key.split(':');
  if (!/^[a-z]+$/.test(order ?? '')) return null;
  return { order, dir: dir === 'asc' || dir === 'desc' ? dir : 'auto' };
}

export function sortLabel(sort: Sort): string {
  const known = SORT_OPTIONS.find((o) => o.order === sort.order && o.dir === sort.dir);
  if (known) return known.label;
  return `By ${sort.order}${sort.dir === 'auto' ? '' : sort.dir === 'asc' ? ', low to high' : ', high to low'}`;
}

const SORT_TERM = /(?:^|\s)-?(order|direction|dir):(\S+)/gi;

/** Lift `order:` and `direction:` out of a query. */
export function splitSort(query: string): { filters: string; sort: Sort | null } {
  let order: string | null = null;
  let dir: Direction = 'auto';
  for (const [, key, value] of query.matchAll(SORT_TERM)) {
    const v = value.toLowerCase();
    if (key.toLowerCase() === 'order') order = v;
    else if (v === 'asc' || v === 'desc') dir = v;
  }
  const filters = query.replace(SORT_TERM, ' ').replace(/\s+/g, ' ').trim();
  return { filters, sort: order ? { order, dir } : null };
}
