'use client';

/**
 * Choosing where a card goes.
 *
 * The list used last comes first, as one large button: building a list is
 * adding card after card to the same one. Every row says whether it is a
 * deck and whose, so two similar names are not confused. On a phone the
 * window sits at the bottom of the screen, and a tap only counts if it began
 * on the row it ends on (see lib/steady-tap.ts) - a page that moved under the
 * finger once sent a run of cards to the wrong decks.
 *
 * Creating a list is offered inline rather than behind a separate page: the
 * moment you most want a new list is the moment you find a card that does not
 * belong in any of the ones you have.
 */

import { useEffect, useRef, useState } from 'react';

import type { List } from '@/lib/db';
import { getProfile } from '@/lib/profile';
import type { ScryfallCard } from '@/lib/scryfall';
import { dismissKeyboard, steady } from '@/lib/steady-tap';

interface Props {
  card: ScryfallCard;
  lists: List[];
  onAdd: (listId: string, quantity: number) => Promise<void>;
  onCreateList: (name: string) => Promise<List | null>;
  onClose: () => void;
}

const lastKey = () => `mtg-last-list:${getProfile()}`;

/** The list this profile added to last, if it is still there. */
function lastListId(): string | null {
  try {
    return localStorage.getItem(lastKey());
  } catch {
    return null;
  }
}

export function rememberList(id: string): void {
  try {
    localStorage.setItem(lastKey(), id);
  } catch { /* the next add just starts without a favourite */ }
}

function describe(list: List): string {
  const count = `${list.totalCards} card${list.totalCards === 1 ? '' : 's'}`;
  if (list.kind !== 'deck') return `List · ${count}`;
  const commander = list.commander?.name.split(',')[0];
  return `Deck${commander ? ` · ${commander}` : ''} · ${count}`;
}

export default function AddToListDialog({ card, lists, onAdd, onCreateList, onClose }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [creating, setCreating] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastId] = useState(lastListId);
  const last = lists.find((l) => l.id === lastId) ?? null;
  const others = lists.filter((l) => l !== last);

  // Nothing may move while a row is being tapped: the keyboard from the
  // search box closes now, not in the middle of the tap.
  // Once, on opening - not on every render, which would close the keyboard
  // on someone typing a new list's name.
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    dismissKeyboard();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const add = async (listId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(listId, quantity);
      rememberList(listId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that card');
      setBusy(false);
    }
  };

  const createThenAdd = async () => {
    const name = creating.trim();
    if (!name || busy) return;
    dismissKeyboard();
    setBusy(true);
    setError(null);
    try {
      const list = await onCreateList(name);
      if (list) {
        await onAdd(list.id, quantity);
        rememberList(list.id);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that list');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${card.name} to a list`}
        className="relative flex max-h-[85dvh] w-full max-w-sm flex-col overflow-y-auto overscroll-contain rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl sm:pb-5"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="min-w-0 truncate text-base font-semibold">Add {card.name}</h2>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <span className="text-[var(--muted)]">Copies</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
              className="w-16 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-center"
            />
          </label>
        </div>

        {last && (
          <button
            disabled={busy}
            {...steady(() => add(last.id))}
            className="mt-4 flex w-full flex-col rounded-xl bg-[var(--accent)] px-4 py-3 text-left text-[#221c08] disabled:opacity-50"
          >
            <span className="text-xs font-medium uppercase tracking-wide opacity-80">Add to the list you used last</span>
            <span className="truncate text-base font-semibold">{last.name}</span>
            <span className="text-xs opacity-80">{describe(last)}</span>
          </button>
        )}

        <div className="mt-4 space-y-1.5">
          {last && others.length > 0 && <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Or another</p>}
          {others.map((list) => (
            <button
              key={list.id}
              disabled={busy}
              {...steady(() => add(list.id))}
              className="flex min-h-11 w-full flex-col justify-center rounded-lg border border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              <span className="truncate text-sm">{list.name}</span>
              <span className="text-xs text-[var(--muted)]">{describe(list)}</span>
            </button>
          ))}
          {!lists.length && (
            <p className="py-2 text-sm text-[var(--muted)]">No lists yet — make one below.</p>
          )}
        </div>

        <form
          className="mt-4 border-t border-[var(--border)] pt-4"
          onSubmit={(e) => { e.preventDefault(); createThenAdd(); }}
        >
          <label htmlFor="newList" className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Or start a new list
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="newList"
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
              placeholder="Burn deck, Trade binder…"
              enterKeyHint="done"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy || !creating.trim()}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[#221c08] disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </form>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button onClick={onClose} className="mt-3 min-h-11 w-full rounded-lg px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-hover)]">
          Cancel
        </button>
      </div>
    </div>
  );
}
