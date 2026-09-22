'use client';

/**
 * Choosing where a card goes.
 *
 * Creating a list is offered inline rather than behind a separate page: the
 * moment you most want a new list is the moment you find a card that does not
 * belong in any of the ones you have.
 */

import { useState } from 'react';

import type { List } from '@/lib/db';
import type { ScryfallCard } from '@/lib/scryfall';

interface Props {
  card: ScryfallCard;
  lists: List[];
  onAdd: (listId: string, quantity: number) => Promise<void>;
  onCreateList: (name: string) => Promise<List | null>;
  onClose: () => void;
}

export default function AddToListDialog({ card, lists, onAdd, onCreateList, onClose }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [creating, setCreating] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (listId: string) => {
    setBusy(true);
    setError(null);
    try {
      await onAdd(listId, quantity);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that card');
      setBusy(false);
    }
  };

  const createThenAdd = async () => {
    const name = creating.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const list = await onCreateList(name);
      if (list) await onAdd(list.id, quantity);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that list');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${card.name} to a list`}
        className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <h2 className="text-base font-semibold">Add {card.name}</h2>

        <label className="mt-4 flex items-center gap-3 text-sm">
          <span className="text-[var(--muted)]">Copies</span>
          <input
            type="number"
            min={1}
            max={99}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
            className="w-20 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-center"
          />
        </label>

        <div className="mt-4 max-h-56 space-y-1 overflow-y-auto">
          {lists.map((list) => (
            <button
              key={list.id}
              disabled={busy}
              onClick={() => add(list.id)}
              className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50"
            >
              <span className="truncate">{list.name}</span>
              <span className="text-xs text-[var(--muted)]">{list.totalCards}</span>
            </button>
          ))}
          {!lists.length && (
            <p className="py-2 text-sm text-[var(--muted)]">No lists yet — make one below.</p>
          )}
        </div>

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <label htmlFor="newList" className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Or start a new list
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="newList"
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
              placeholder="Burn deck, Trade binder…"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
            <button
              disabled={busy || !creating.trim()}
              onClick={createThenAdd}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[#221c08] disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button onClick={onClose} className="mt-4 w-full rounded-lg px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-hover)]">
          Cancel
        </button>
      </div>
    </div>
  );
}
