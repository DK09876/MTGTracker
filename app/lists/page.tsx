'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { List } from '@/lib/db';

export default function ListsPage() {
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => api.fetchLists('list').then(setLists).catch((e) => setError(e.message)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const list = await api.createList(trimmed);
      setLists((prev) => [...prev, list]);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that list');
    }
  };

  return (
    <div>
      <h1 className="text-xl font-semibold">Lists</h1>

      <form onSubmit={create} className="mt-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New list — Burn deck, Trade binder…"
          aria-label="New list name"
          className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 outline-none focus:border-[var(--accent)]"
        />
        <button className="rounded-xl bg-[var(--accent)] px-4 py-2.5 font-medium text-[#221c08] hover:brightness-110">
          Create
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {loading && <p className="mt-8 text-[var(--muted)]">Loading…</p>}

      {!loading && !lists.length && (
        <p className="mt-10 text-center text-[var(--muted)]">
          No lists yet. Make one above, or add a card from{' '}
          <Link href="/" className="text-[var(--accent)] underline">search</Link>.
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {lists.map((list) => (
          <Link
            key={list.id}
            href={`/lists/${list.id}`}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:bg-[var(--surface-hover)]"
          >
            <p className="font-medium">{list.name}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {list.totalCards} card{list.totalCards === 1 ? '' : 's'}
              {list.cardCount !== list.totalCards && <> · {list.cardCount} unique</>}
              {list.totalValue > 0 && <> · ${list.totalValue.toFixed(2)}</>}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
