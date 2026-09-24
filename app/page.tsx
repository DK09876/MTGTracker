'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import AddToListDialog from '@/components/AddToListDialog';
import CardModal from '@/components/CardModal';
import CardTile from '@/components/CardTile';
import Interpreted from '@/components/Interpreted';
import SearchBox from '@/components/SearchBox';
import * as api from '@/lib/api';
import type { List } from '@/lib/db';
import type { Interpretation } from '@/lib/interpret';
import type { ScryfallCard } from '@/lib/scryfall';
import { exactName, looksLikeSyntax } from '@/lib/syntax';

const EXAMPLES = [
  'cheap green ramp that isn\'t a land',
  'best board wipes for Atraxa',
  'lightnig bolt',
  't:goblin c:r',
];

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState<ScryfallCard[]>([]);
  const [inLists, setInLists] = useState<Record<string, string[]>>({});
  const [total, setTotal] = useState(0);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [status, setStatus] = useState<'idle' | 'searching' | 'thinking' | 'error'>('idle');
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

  // `ask` works out what was typed; `exact` runs a query as written, for a
  // picked name or an edited translation.
  const runSearch = useCallback(async (q: string, how: 'ask' | 'exact' = 'ask') => {
    const term = q.trim();
    if (!term) return;
    const id = ++runId.current;
    setStatus(how === 'ask' && !looksLikeSyntax(term) ? 'thinking' : 'searching');
    setError(null);
    setSearched(true);
    try {
      const asked = how === 'ask' ? await api.ask(term) : null;
      const result = asked ?? await api.search(term);
      if (id !== runId.current) return;
      setCards(result.cards);
      setInLists(result.inLists);
      setTotal(result.totalCards);
      if (asked) setInterpretation(asked.interpretation);
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
      <SearchBox
        value={query}
        onChange={setQuery}
        onSubmit={(q) => { setInterpretation(null); runSearch(q); }}
        onPickName={(name) => { setQuery(name); setInterpretation(null); runSearch(exactName(name), 'exact'); }}
      />

      {!searched && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span>Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              onClick={() => { setQuery(example); runSearch(example); }}
              className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface)]"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {interpretation && status !== 'thinking' && (
        <Interpreted
          interpretation={interpretation}
          onRun={(q) => {
            // An edited query keeps the explanation it was edited from.
            setInterpretation({ ...interpretation, query: q, note: undefined });
            runSearch(q, 'exact');
          }}
        />
      )}

      {status === 'searching' && <p className="mt-8 text-center text-[var(--muted)]">Searching…</p>}
      {status === 'thinking' && <p className="mt-8 text-center text-[var(--muted)]">Working out what you mean…</p>}
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
