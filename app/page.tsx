'use client';

import { useEffect, useState } from 'react';

import AddToListDialog from '@/components/AddToListDialog';
import CardModal from '@/components/CardModal';
import CommanderChoice from '@/components/CommanderChoice';
import FollowUp from '@/components/FollowUp';
import Interpreted from '@/components/Interpreted';
import Results from '@/components/Results';
import SearchBox from '@/components/SearchBox';
import { useSearch } from '@/components/useSearch';
import * as api from '@/lib/api';
import type { List } from '@/lib/db';
import type { Previous } from '@/lib/gemini';
import type { ScryfallCard } from '@/lib/scryfall';
import { exactName, looksLikeSyntax } from '@/lib/syntax';

const EXAMPLES = [
  'green ramp spells for omnath',
  'enchantments that work well for fire lord azula',
  'combo cards for vivi',
  'cheap green ramp that isn\'t a land',
  'lightnig bolt',
];

/** The search that ran, for a follow-up to refine. */
function previousOf(answer: api.AskResponse, thread: string[]): Previous {
  const { kind, commander, query, constraints } = answer.interpretation;
  return {
    request: thread.join(' › '),
    kind,
    commander: commander?.name,
    cardName: kind === 'card' ? query.replace(/^!"|"$/g, '') : undefined,
    query,
    constraints,
  };
}

export default function SearchPage() {
  const s = useSearch();
  const { answer, views, status, run, showAnswer } = s;
  const [query, setQuery] = useState('');
  const [thread, setThread] = useState<string[]>([]);
  // The request that produced the current answer, so a search that stopped
  // to ask which commander can carry on from it.
  const [asked, setAsked] = useState<{ text: string; previous?: Previous } | null>(null);
  const [searched, setSearched] = useState(false);

  const [lists, setLists] = useState<List[]>([]);
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [adding, setAdding] = useState<ScryfallCard | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { api.fetchLists().then(setLists).catch(() => {}); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const search = (text: string) => {
    const term = text.trim();
    if (!term) return;
    setSearched(true);
    setThread([term]);
    setAsked({ text: term });
    run(looksLikeSyntax(term) ? 'searching' : 'thinking', () => api.ask(term), showAnswer);
  };

  const pickName = (name: string) => {
    setQuery(name);
    setSearched(true);
    setThread([]);
    run('searching', () => api.search(exactName(name)), (r) => {
      s.setAnswer(null);
      s.setViews({ cards: { cards: r.cards, total: r.totalCards } });
      s.setTab('cards');
    });
  };

  const followUp = (text: string) => {
    if (!answer) return;
    const previous = previousOf(answer, thread);
    run('thinking', () => api.followUp(text, previous), (r) => {
      setThread((t) => [...t, text]);
      setAsked({ text, previous });
      showAnswer(r);
    });
  };

  /** Answer "which commander?" and let the search carry on. */
  const pickCommander = (name: string) => {
    if (!answer?.plan || !asked) return;
    const plan = answer.plan;
    run('thinking', () => api.resume(asked.text, asked.previous, plan, name), showAnswer);
  };

  const addCard = async (listId: string, quantity: number) => {
    if (!adding) return;
    await api.addCard(listId, adding.id, quantity);
    const fresh = await api.fetchLists();
    setLists(fresh);
    const name = fresh.find((l) => l.id === listId)?.name ?? 'list';
    s.setInLists((prev) => ({ ...prev, [adding.id]: [...new Set([...(prev[adding.id] ?? []), name])] }));
    setToast(`Added ${quantity > 1 ? `${quantity}× ` : ''}${adding.name} to ${name}`);
  };

  const busy = status === 'searching' || status === 'thinking';
  const hasViews = Object.keys(views).length > 0;

  return (
    <div>
      <SearchBox value={query} onChange={setQuery} onSubmit={search} onPickName={pickName} />

      {!searched && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
          <span>Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              onClick={() => { setQuery(example); search(example); }}
              className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface)]"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {answer && status !== 'thinking' && (
        <Interpreted interpretation={answer.interpretation} trace={answer.trace} onRun={s.runEdited} />
      )}
      {answer && !answer.choice && <FollowUp thread={thread} busy={busy} onSubmit={followUp} />}

      {status === 'idle' && answer?.choice && (
        <CommanderChoice mention={answer.choice.mention} options={answer.choice.options} onPick={pickCommander} />
      )}

      {status === 'searching' && <p className="mt-8 text-center text-[var(--muted)]">Searching…</p>}
      {status === 'thinking' && <p className="mt-8 text-center text-[var(--muted)]">Working out what you mean…</p>}
      {status === 'error' && <p className="mt-8 text-center text-red-400">{s.error}</p>}

      {status === 'idle' && hasViews && !answer?.choice && (
        <Results
          views={views}
          commander={answer?.interpretation.kind !== 'card' ? answer?.interpretation.commander?.name : undefined}
          tab={s.tab}
          onTab={s.openTab}
          loading={s.tabLoading}
          inLists={s.inLists}
          onSort={s.resort}
          onLoadMore={answer ? s.loadMore : undefined}
          loadingMore={s.loadingMore}
          onSelect={setSelected}
          onAdd={setAdding}
        />
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
