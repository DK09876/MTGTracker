'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import AddToListDialog from '@/components/AddToListDialog';
import CardModal from '@/components/CardModal';
import CardTile from '@/components/CardTile';
import * as api from '@/lib/api';
import type { List } from '@/lib/db';
import type { ScryfallCard } from '@/lib/scryfall';

const EXAMPLES = ['Lightning Bolt', 't:goblin c:r', 'set:mh3 r:mythic', 'o:"draw a card" cmc<=2'];

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState<ScryfallCard[]>([]);
  const [inLists, setInLists] = useState<Record<string, string[]>>({});
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [lists, setLists] = useState<List[]>([]);
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [adding, setAdding] = useState<ScryfallCard | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Guards against a slow search overwriting the results of a faster later one.
  const runId = useRef(0);

  useEffect(() => { api.fetchLists().then(setLists).catch(() => {}); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const runSearch = useCallback(async (q: string) => {
    const term = q.trim();
    if (!term) return;
    const id = ++runId.current;
    setStatus('loading');
    setError(null);
    setSearched(true);
    try {
      const result = await api.search(term);
      if (id !== runId.current) return;
      setCards(result.cards);
      setInLists(result.inLists);
      setTotal(result.totalCards);
      setStatus('idle');
    } catch (e) {
      if (id !== runId.current) return;
      setError(e instanceof Error ? e.message : 'Search failed');
      setCards([]);
      setStatus('error');
    }
  }, []);

  const addCard = async (listId: string, quantity: number) => {
    if (!adding) return;
    await api.addCard(listId, adding.id, quantity);
    const [fresh] = await Promise.all([api.fetchLists()]);
    setLists(fresh);
    const name = fresh.find((l) => l.id === listId)?.name ?? 'list';
    setInLists((prev) => ({ ...prev, [adding.id]: [...new Set([...(prev[adding.id] ?? []), name])] }));
    setToast(`Added ${quantity > 1 ? `${quantity}× ` : ''}${adding.name} to ${name}`);
  };

  return (
    <div>
      <form
        onSubmit={(e) => { e.preventDefault(); runSearch(query); }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cards — name, or Scryfall syntax"
          aria-label="Search cards"
          className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          className="rounded-xl bg-[var(--accent)] px-5 py-3 font-medium text-[#221c08] hover:brightness-110"
        >
          Search
        </button>
      </form>

      {!searched && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span>Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              onClick={() => { setQuery(example); runSearch(example); }}
              className="rounded-lg border border-[var(--border)] px-2 py-1 font-mono text-xs hover:bg-[var(--surface)]"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {status === 'loading' && <p className="mt-8 text-center text-[var(--muted)]">Searching…</p>}
      {status === 'error' && <p className="mt-8 text-center text-red-400">{error}</p>}
      {status === 'idle' && searched && !cards.length && (
        <p className="mt-8 text-center text-[var(--muted)]">No cards matched that search.</p>
      )}

      {cards.length > 0 && (
        <>
          <p className="mt-6 text-sm text-[var(--muted)]">
            {total.toLocaleString()} match{total === 1 ? '' : 'es'}
            {cards.length < total && <> · showing the first {cards.length}</>}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {cards.map((card) => (
              <CardTile
                key={card.id}
                card={card}
                inLists={inLists[card.id]}
                onSelect={setSelected}
                onAdd={setAdding}
              />
            ))}
          </div>
        </>
      )}

      <CardModal
        card={selected}
        onClose={() => setSelected(null)}
        actions={
          selected && (
            <button
              onClick={() => { setAdding(selected); setSelected(null); }}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[#221c08]"
            >
              Add to list
            </button>
          )
        }
      />

      {adding && (
        <AddToListDialog
          card={adding}
          lists={lists}
          onAdd={addCard}
          onCreateList={async (name) => {
            const list = await api.createList(name);
            setLists((prev) => [...prev, list]);
            return list;
          }}
          onClose={() => setAdding(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[#221c08] shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
