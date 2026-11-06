/**
 * How search results are ordered.
 *
 * Kept apart from the query. A sort chosen from the menu re-runs the search
 * with Scryfall doing the ordering, because results are only the first page
 * - sorting that page in the browser would show "the cheapest of the 175
 * newest" rather than the cheapest.
 *
 * Scryfall lets `order:` sit inside the query too, where it overrides the
 * API parameter; `splitSort` lifts it out so there is one place a sort
 * lives. Pure, so the page can use it.
 */

export type Direction = 'auto' | 'asc' | 'desc';

export interface Sort {
  /** A Scryfall order: released, name, usd, cmc... */
  order: string;
  dir: Direction;
}

/**
 * Newest first. The app does not rank cards by how popular they are (no
 * EDHREC data, since 2026-11), so the default is an order anyone can check.
 */
export const DEFAULT_SORT: Sort = { order: 'released', dir: 'desc' };

/** Orders the app no longer uses: a saved or typed one falls back to the default. */
const RETIRED = new Set(['edhrec']);

export interface SortOption extends Sort {
  label: string;
}

export const SORT_OPTIONS: SortOption[] = [
  { order: 'released', dir: 'desc', label: 'Newest first' },
  { order: 'name', dir: 'auto', label: 'Name' },
  { order: 'usd', dir: 'asc', label: 'Price: low to high' },
  { order: 'usd', dir: 'desc', label: 'Price: high to low' },
  { order: 'cmc', dir: 'asc', label: 'Mana value: low to high' },
  { order: 'cmc', dir: 'desc', label: 'Mana value: high to low' },
  { order: 'released', dir: 'asc', label: 'Oldest first' },
  { order: 'rarity', dir: 'desc', label: 'Rarity' },
  { order: 'power', dir: 'desc', label: 'Power' },
];

export const sortKey = (sort: Sort) => `${sort.order}:${sort.dir}`;

export function parseSortKey(key: string | null): Sort | null {
  if (!key) return null;
  const [order, dir] = key.split(':');
  if (!/^[a-z]+$/.test(order ?? '') || RETIRED.has(order)) return null;
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
    if (key.toLowerCase() === 'order') order = RETIRED.has(v) ? null : v;
    else if (v === 'asc' || v === 'desc') dir = v;
  }
  const filters = query.replace(SORT_TERM, ' ').replace(/\s+/g, ' ').trim();
  return { filters, sort: order ? { order, dir } : null };
}
