'use client';

/**
 * Fold, filter and sort for a long list of picks (handoff 9, D 13), shared by
 * Finish and Trim. The filter hides rows and never changes a choice. A row
 * whose choice changes under a filter stays where it is until the filter is
 * pressed again or a new list arrives: rows never vanish under the pointer.
 * The folded groups, the filter and the sort are remembered for the deck in
 * this browser.
 */

import { useCallback, useState } from 'react';

export type ListSort = 'claude' | 'choice' | 'mv' | 'name' | 'price';
export const SORTS: Array<[ListSort, string]> = [['claude', 'Claude’s order'], ['choice', 'By choice'], ['mv', 'By mana value'], ['name', 'By name']];

export interface ListView { filter: string; sort: ListSort; folded: string[]; /** Bumped on every filter press (not kept): pressing the same filter again re-applies it. */ press?: number }

const read = (key: string, fallback: ListView): ListView => {
  try { const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<ListView> | null; return v ? { ...fallback, ...v } : fallback; } catch { return fallback; }
};
const write = (key: string, v: ListView) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* still works, just not remembered */ } };

/** The list's view, remembered per deck in this browser. */
export function useListView(key: string): [ListView, (change: Partial<ListView>) => void] {
  const [view, setView] = useState<ListView>(() => (typeof window === 'undefined' ? { filter: 'all', sort: 'claude', folded: [] } : read(key, { filter: 'all', sort: 'claude', folded: [] })));
  const set = useCallback((change: Partial<ListView>) => setView((v) => {
    const next = { ...v, ...change, ...('filter' in change ? { press: (v.press ?? 0) + 1 } : {}) };
    write(key, { filter: next.filter, sort: next.sort, folded: next.folded });
    return next;
  }), [key]);
  return [view, set];
}

/**
 * A remembered filter that has no rows on a new list falls back to All (review 14): checked once per list
 * (`list`), not on every change, so a filter the owner emptied themselves stays until they press another.
 */
export function useFilterFallback(list: string, empty: boolean, toAll: () => void): void {
  const [checked, setChecked] = useState<string | null>(null);
  if (list && checked !== list) {
    setChecked(list);
    if (empty) toAll();
  }
}

/**
 * Which rows show under the filter: worked out when the filter or the list changes (`stamp`), not when a choice
 * does, so a row marked Skip under "Add" stays put until the filter is pressed again.
 */
export function useShown<T>(items: T[], name: (t: T) => string, test: (t: T) => boolean, stamp: string): Set<string> {
  // Kept from the render the filter or list last changed in (React's "adjust state while rendering" pattern).
  const [snap, setSnap] = useState(() => ({ stamp, names: new Set(items.filter(test).map(name)) }));
  if (snap.stamp !== stamp) {
    const next = { stamp, names: new Set(items.filter(test).map(name)) };
    setSnap(next);
    return next.names;
  }
  return snap.names;
}

/** Rows in a group in the chosen order; Claude's order keeps the list as it came. */
export function sortRows<T>(rows: T[], sort: ListSort, of: { choice: (t: T) => number; mv: (t: T) => number; name: (t: T) => string; /** Upgrades: dearest first; a card with no price last. */ price?: (t: T) => number | null }): T[] {
  if (sort === 'claude') return rows;
  const p = (t: T) => of.price?.(t) ?? -1;
  const by = sort === 'choice' ? (a: T, b: T) => of.choice(a) - of.choice(b) : sort === 'mv' ? (a: T, b: T) => of.mv(a) - of.mv(b) : sort === 'price' ? (a: T, b: T) => p(b) - p(a) : () => 0;
  return [...rows].sort((a, b) => by(a, b) || of.name(a).localeCompare(of.name(b)));
}

export default function ListControls({ filters, filter, onFilter, sort, onSort, label = 'Show', sorts = SORTS }: {
  filters: Array<{ id: string; label: string; count: number }>;
  filter: string; onFilter: (id: string) => void; sort: ListSort; onSort: (s: ListSort) => void; label?: string;
  /** The sorts offered (Upgrades: Claude's order, price, mana value, name). */
  sorts?: Array<[ListSort, string]>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-list-controls>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} onClick={() => onFilter(f.id)} data-filter={f.id}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] ${filter === f.id ? 'border-[#d6aa2e] bg-[#d6aa2e]/[0.1] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'}`}>
            {f.label} <span className="tabular-nums text-[var(--faint)]">{f.count}</span>
          </button>
        ))}
      </div>
      <label className="ml-auto flex items-center gap-2 text-[13px] text-[var(--muted)]">Sort
        <select value={sort} onChange={(e) => onSort(e.target.value as ListSort)} className="min-h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-[13px] text-[var(--foreground)]" data-sort>
          {sorts.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
      </label>
    </div>
  );
}

/** A group's header that folds it, with its counts said on it (shown folded or not). */
export function GroupHead({ title, count, extra, folded, onToggle }: { title: string; count: number; extra: string; folded: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={!folded} onClick={onToggle} className="flex w-full flex-wrap items-baseline gap-x-3 pb-1 pt-3 text-left" data-group-head>
      <span aria-hidden="true" className={`inline-block w-3 text-[var(--faint)] transition-transform ${folded ? '' : 'rotate-90'}`}>›</span>
      <h4 className="font-display text-lg font-semibold">{title}</h4>
      <span className="text-sm text-[var(--muted)]">{count}{extra ? ` · ${extra}` : ''}</span>
    </button>
  );
}
