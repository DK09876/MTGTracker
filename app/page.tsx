'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import AddToListDialog from '@/components/AddToListDialog';
import CardModal from '@/components/CardModal';
import CommanderChoice from '@/components/CommanderChoice';
import FollowUp from '@/components/FollowUp';
import Interpreted from '@/components/Interpreted';
import Results, { type Tab, type Views } from '@/components/Results';
import SearchBox from '@/components/SearchBox';
import * as api from '@/lib/api';
import type { List } from '@/lib/db';
import type { Previous } from '@/lib/gemini';
import type { ScryfallCard } from '@/lib/scryfall';
import type { Sort } from '@/lib/sort';
import { exactName, looksLikeSyntax } from '@/lib/syntax';

const EXAMPLES = [
  'green ramp spells for omnath',
  'enchantments that work well for fire lord azula',
  'combo cards for vivi',
  'cheap green ramp that isn\'t a land',
  'lightnig bolt',
];

type Status = 'idle' | 'searching' | 'thinking' | 'error';

/** The views an answer brings with it; tabs it does not cover load when opened. */
function viewsOf(answer: api.AskResponse): Views {
  if (answer.interpretation.kind === 'combos') {
    return { combos: { combos: answer.combos ?? [], cards: answer.cards, note: answer.interpretation.note } };
  }
  return {
    cards: {
      cards: answer.cards, total: answer.totalCards, stats: answer.stats, sort: answer.interpretation.sort,
      page: 1, hasMore: answer.hasMore,
    },
    edhrec: answer.interpretation.commander ? answer.edhrec ?? null : undefined,
  };
}

function firstTab(answer: api.AskResponse): Tab {
  if (answer.interpretation.kind === 'combos') return 'combos';
  return answer.edhrec ? 'edhrec' : 'cards';
}

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
  const [query, setQuery] = useState('');
  // What the search was taken to mean and how it ran; null for a picked name.
  const [answer, setAnswer] = useState<api.AskResponse | null>(null);
  const [views, setViews] = useState<Views>({});
  const [tab, setTab] = useState<Tab>('cards');
  const [tabLoading, setTabLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [thread, setThread] = useState<string[]>([]);
  // The request that produced the current answer, so a search that stopped
  // to ask which commander can carry on from it.
  const [asked, setAsked] = useState<{ text: string; previous?: Previous } | null>(null);
  const [inLists, setInLists] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [lists, setLists] = useState<List[]>([]);
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [adding, setAdding] = useState<ScryfallCard | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Guards against a slow request overwriting the result of a later one.
  const runId = useRef(0);

  useEffect(() => { api.fetchLists().then(setLists).catch(() => {}); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  /** Run a request, and show its answer if nothing newer has started. */
  const run = useCallback(async (status: Status, request: () => Promise<api.AskResponse | api.SearchResponse>,
    show: (result: api.AskResponse | api.SearchResponse) => void) => {
    const id = ++runId.current;
    setStatus(status);
    setError(null);
    setSearched(true);
    try {
      const result = await request();
      if (id !== runId.current) return;
      setInLists((prev) => ({ ...prev, ...result.inLists }));
      show(result);
      setStatus('idle');
    } catch (e) {
      if (id !== runId.current) return;
      setError(e instanceof Error ? e.message : 'Search failed');
      setStatus('error');
    }
  }, []);

  const showAnswer = useCallback((result: api.AskResponse) => {
    setAnswer(result);
    setViews(viewsOf(result));
    setTab(firstTab(result));
  }, []);

  const search = (text: string) => {
    const term = text.trim();
    if (!term) return;
    setThread([term]);
    setAsked({ text: term });
    run(looksLikeSyntax(term) ? 'searching' : 'thinking', () => api.ask(term), (r) => showAnswer(r as api.AskResponse));
  };

  const pickName = (name: string) => {
    setQuery(name);
    setThread([]);
    run('searching', () => api.search(exactName(name)), (r) => {
      setAnswer(null);
      setViews({ cards: { cards: r.cards, total: r.totalCards } });
      setTab('cards');
    });
  };

  const followUp = (text: string) => {
    if (!answer) return;
    const previous = previousOf(answer, thread);
    run('thinking', () => api.followUp(text, previous), (r) => {
      setThread((t) => [...t, text]);
      setAsked({ text, previous });
      showAnswer(r as api.AskResponse);
    });
  };

  /** Answer "which commander?" and let the search carry on. */
  const pickCommander = (name: string) => {
    if (!answer?.plan || !asked) return;
    const plan = answer.plan;
    run('thinking', () => api.resume(asked.text, asked.previous, plan, name), (r) => showAnswer(r as api.AskResponse));
  };

  /** An edited query: both card views change, the explanation stays. */
  const runEdited = (edited: string) => {
    if (!answer) return;
    const { commander, sort, explanation } = answer.interpretation;
    run('searching', () => api.runQuery(edited, { commander: commander?.name, sort }), (r) => {
      const result = r as api.AskResponse;
      showAnswer({ ...result, interpretation: { ...result.interpretation, explanation } });
    });
  };

  /** A new order only touches the Scryfall view. */
  const resort = (sort: Sort) => {
    if (!answer) return;
    const { commander } = answer.interpretation;
    run('searching', () => api.runQuery(answer.interpretation.query, { commander: commander?.name, sort, edhrec: false }), (r) => {
      const result = r as api.AskResponse;
      setViews((v) => ({
        ...v,
        cards: {
          cards: result.cards, total: result.totalCards, stats: result.stats, sort: result.interpretation.sort,
          page: 1, hasMore: result.hasMore,
        },
      }));
      setAnswer((a) => (a ? { ...a, interpretation: { ...a.interpretation, sort: result.interpretation.sort } } : a));
    });
  };

  /** The next page of the Scryfall view, added below what is already there. */
  const loadMore = async () => {
    const current = views.cards;
    if (!answer || !current?.hasMore || loadingMore) return;
    const id = runId.current;
    setLoadingMore(true);
    try {
      const next = (current.page ?? 1) + 1;
      const r = await api.runQuery(answer.interpretation.query, {
        commander: answer.interpretation.commander?.name, sort: current.sort, edhrec: false, page: next,
      });
      if (id !== runId.current) return;
      setInLists((prev) => ({ ...prev, ...r.inLists }));
      setViews((v) => {
        if (!v.cards) return v;
        const seen = new Set(v.cards.cards.map((c) => c.id));
        return {
          ...v,
          cards: {
            ...v.cards,
            cards: [...v.cards.cards, ...r.cards.filter((c) => !seen.has(c.id))],
            stats: { ...v.cards.stats, ...r.stats },
            page: next,
            hasMore: r.hasMore,
          },
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more');
    } finally {
      setLoadingMore(false);
    }
  };

  /** Open a tab, fetching its view the first time. */
  const openTab = async (next: Tab) => {
    setTab(next);
    const commander = answer?.interpretation.commander?.name;
    if (!commander) return;
    const missing = next === 'combos' ? !views.combos : next === 'edhrec' ? views.edhrec === undefined : !views.cards;
    if (!missing) return;

    const id = runId.current;
    setTabLoading(true);
    try {
      if (next === 'combos') {
        const r = await api.combosFor(commander);
        if (id !== runId.current) return;
        setInLists((prev) => ({ ...prev, ...r.inLists }));
        setViews((v) => ({ ...v, combos: { combos: r.combos ?? [], cards: r.cards, note: r.interpretation.note } }));
      } else {
        // Came from a combo search: fetch "everything for this commander".
        const r = await api.runQuery('', { commander });
        if (id !== runId.current) return;
        setInLists((prev) => ({ ...prev, ...r.inLists }));
        setViews((v) => ({
          ...v,
          cards: { cards: r.cards, total: r.totalCards, stats: r.stats, sort: r.interpretation.sort, page: 1, hasMore: r.hasMore },
          edhrec: r.edhrec ?? null,
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that tab');
    } finally {
      setTabLoading(false);
    }
  };

  const addCard = async (listId: string, quantity: number) => {
    if (!adding) return;
    await api.addCard(listId, adding.id, quantity);
    const fresh = await api.fetchLists();
    setLists(fresh);
    const name = fresh.find((l) => l.id === listId)?.name ?? 'list';
    setInLists((prev) => ({ ...prev, [adding.id]: [...new Set([...(prev[adding.id] ?? []), name])] }));
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
        <Interpreted interpretation={answer.interpretation} trace={answer.trace} onRun={runEdited} />
      )}
      {answer && !answer.choice && <FollowUp thread={thread} busy={busy} onSubmit={followUp} />}

      {status === 'idle' && answer?.choice && (
        <CommanderChoice mention={answer.choice.mention} options={answer.choice.options} onPick={pickCommander} />
      )}

      {status === 'searching' && <p className="mt-8 text-center text-[var(--muted)]">Searching…</p>}
      {status === 'thinking' && <p className="mt-8 text-center text-[var(--muted)]">Working out what you mean…</p>}
      {status === 'error' && <p className="mt-8 text-center text-red-400">{error}</p>}

      {status === 'idle' && hasViews && !answer?.choice && (
        <Results
          views={views}
          commander={answer?.interpretation.kind !== 'card' ? answer?.interpretation.commander?.name : undefined}
          tab={tab}
          onTab={openTab}
          loading={tabLoading}
          inLists={inLists}
          onSort={resort}
          onLoadMore={answer ? loadMore : undefined}
          loadingMore={loadingMore}
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
