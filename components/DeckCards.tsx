'use client';

/**
 * A deck's (or list's) cards: board tabs, grouped stacks or a compact text
 * list, and the controls for grouping, sorting and filtering them.
 *
 * View choices are remembered in this browser, since they are how someone
 * likes to look at every deck, not a property of one deck.
 */

import { useEffect, useState } from 'react';

import CardTile from './CardTile';
import ManaCost from './ManaCost';
import type { Board } from '@/lib/decklist';
import { groupCards, type GroupBy, type Item, type SortBy } from '@/lib/deckview';
import { filterCards } from '@/lib/filter';
import type { ScryfallCard } from '@/lib/scryfall';
import { manaCostOf, priceOf } from '@/lib/scryfall';

export type Entry = Item & { board: Board };

interface Props {
  entries: Entry[];
  /** A deck gets board tabs; a plain list shows everything together. */
  isDeck: boolean;
  onSelect: (card: ScryfallCard) => void;
  onQuantity: (cardId: string, quantity: number) => void;
  onMove: (cardId: string, board: Board) => void;
}

type View = 'visual' | 'text';

const BOARDS: Array<[Board, string]> = [['main', 'Main'], ['maybe', 'Maybeboard'], ['side', 'Sideboard']];
const PREFS = 'mtg-deck-view';

function loadPrefs(): { view: View; groupBy: GroupBy; sortBy: SortBy } {
  const fallback = { view: 'visual' as View, groupBy: 'type' as GroupBy, sortBy: 'name' as SortBy };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(PREFS) ?? '{}') };
  } catch {
    return fallback;
  }
}

export default function DeckCards({ entries, isDeck, onSelect, onQuantity, onMove }: Props) {
  const [board, setBoard] = useState<Board>('main');
  const [filter, setFilter] = useState('');
  const [prefs, setPrefs] = useState(() => (typeof window === 'undefined'
    ? { view: 'visual' as View, groupBy: 'type' as GroupBy, sortBy: 'name' as SortBy }
    : loadPrefs()));

  useEffect(() => {
    try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* not remembered, still works */ }
  }, [prefs]);

  const onBoard = isDeck ? entries.filter((e) => e.board === board) : entries;
  const { results: shown, unsupported } = filterCards(onBoard, filter);
  const groups = groupCards(shown, prefs.groupBy, prefs.sortBy);
  const copies = (b: Board) => entries.filter((e) => e.board === b).reduce((n, e) => n + e.quantity, 0);

  const select = (className: string) =>
    `rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)] ${className}`;

  return (
    <div className="mt-5">
      {isDeck && (
        <div role="tablist" className="flex gap-1 border-b border-[var(--border)]">
          {BOARDS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={board === id}
              onClick={() => setBoard(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${board === id
                ? 'border-[var(--accent)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'}`}
            >
              {label} <span className="ml-1 text-xs text-[var(--muted)]">{copies(id)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter — t:creature, c:rg, cmc<=3, usd>5, -t:land"
          aria-label="Filter this list"
          className="min-w-[12rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        <div className="flex overflow-hidden rounded-lg border border-[var(--border)] text-sm" role="group" aria-label="View">
          {(['visual', 'text'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setPrefs((p) => ({ ...p, view: v }))}
              aria-pressed={prefs.view === v}
              className={`px-3 py-1.5 ${prefs.view === v ? 'bg-[var(--surface-hover)] text-[var(--foreground)]' : 'text-[var(--muted)]'}`}
            >
              {v === 'visual' ? 'Visual' : 'Text'}
            </button>
          ))}
        </div>
        <select aria-label="Group by" value={prefs.groupBy} onChange={(e) => setPrefs((p) => ({ ...p, groupBy: e.target.value as GroupBy }))} className={select('')}>
          <option value="type">Group: type</option>
          <option value="mv">Group: mana value</option>
          <option value="none">No groups</option>
        </select>
        <select aria-label="Sort by" value={prefs.sortBy} onChange={(e) => setPrefs((p) => ({ ...p, sortBy: e.target.value as SortBy }))} className={select('')}>
          <option value="name">Sort: name</option>
          <option value="mv">Sort: mana value</option>
          <option value="price">Sort: price</option>
        </select>
      </div>
      {unsupported.length > 0 && (
        <p className="mt-2 text-xs text-amber-400">
          Ignoring {unsupported.map((u) => `"${u}"`).join(', ')} — not supported here.
          Supported: name, t, o, c/id, cmc/mv, usd, pow, tou, r, set, a, kw, is, and - to exclude.
        </p>
      )}

      {!onBoard.length && (
        <p className="mt-10 text-center text-[var(--muted)]">
          {isDeck && board !== 'main'
            ? `Nothing on the ${board === 'maybe' ? 'maybeboard' : 'sideboard'} yet — move cards here from a card's menu, or use Maybe when adding.`
            : 'Nothing here yet — use Add cards.'}
        </p>
      )}
      {onBoard.length > 0 && !shown.length && (
        <p className="mt-10 text-center text-[var(--muted)]">Nothing here matches that filter.</p>
      )}

      {groups.map((group) => (
        <section key={group.key} className="mt-6">
          {prefs.groupBy !== 'none' || group.key === 'commander' ? (
            <h3 className="mb-2 text-sm font-medium text-[var(--muted)]">
              {group.label} <span className="tabular-nums">({group.count})</span>
            </h3>
          ) : null}
          {prefs.view === 'visual' ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {group.items.map((entry) => (
                <CardTile
                  key={entry.card.id}
                  card={entry.card}
                  finish={entry.finish}
                  onSelect={onSelect}
                  footer={entry.commander ? (
                    <p className="mt-auto rounded-lg bg-[var(--accent)]/15 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                      Commander
                    </p>
                  ) : (
                    <Controls entry={entry} isDeck={isDeck} onQuantity={onQuantity} onMove={onMove} />
                  )}
                />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              {group.items.map((entry) => (
                <li key={entry.card.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                  <span className="w-6 text-right tabular-nums text-[var(--muted)]">{entry.quantity}</span>
                  <button onClick={() => onSelect(entry.card)} className="min-w-0 flex-1 truncate text-left hover:text-[var(--accent)]">
                    {entry.card.name}
                    {entry.finish !== 'nonfoil' && <span className="ml-2 text-[10px] uppercase text-[var(--muted)]">{entry.finish}</span>}
                  </button>
                  <ManaCost cost={manaCostOf(entry.card)} size={13} />
                  <span className="w-16 text-right tabular-nums text-[var(--muted)]">
                    {priceOf(entry.card, entry.finish) === null ? '—' : `$${priceOf(entry.card, entry.finish)!.toFixed(2)}`}
                  </span>
                  {!entry.commander && (
                    <span className="flex items-center gap-1">
                      <button onClick={() => onQuantity(entry.card.id, entry.quantity - 1)} aria-label={`One fewer ${entry.card.name}`} className="h-6 w-6 rounded border border-[var(--border)] hover:bg-[var(--surface-hover)]">−</button>
                      <button onClick={() => onQuantity(entry.card.id, entry.quantity + 1)} aria-label={`One more ${entry.card.name}`} className="h-6 w-6 rounded border border-[var(--border)] hover:bg-[var(--surface-hover)]">+</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function Controls({ entry, isDeck, onQuantity, onMove }: {
  entry: Entry;
  isDeck: boolean;
  onQuantity: Props['onQuantity'];
  onMove: Props['onMove'];
}) {
  const { card, quantity } = entry;
  return (
    <div className="mt-auto flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button onClick={() => onQuantity(card.id, quantity - 1)} aria-label={`One fewer ${card.name}`} className="h-8 w-8 rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)]">−</button>
        <span className="min-w-[2ch] text-center text-sm tabular-nums">{quantity}</span>
        <button onClick={() => onQuantity(card.id, quantity + 1)} aria-label={`One more ${card.name}`} className="h-8 w-8 rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)]">+</button>
        <button onClick={() => onQuantity(card.id, 0)} aria-label={`Remove ${card.name}`} className="ml-auto rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-red-400">Remove</button>
      </div>
      {isDeck && (
        <select
          aria-label={`Board for ${card.name}`}
          value={entry.board}
          onChange={(e) => onMove(card.id, e.target.value as Board)}
          className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]"
        >
          <option value="main">In main</option>
          <option value="maybe">In maybeboard</option>
          <option value="side">In sideboard</option>
        </select>
      )}
    </div>
  );
}
