'use client';

/**
 * The state behind a search and its views, shared by the search page and a
 * deck's "Add cards" window: running a request without a slow one
 * overwriting a newer one, the tabs and loading them when first opened,
 * re-sorting, "Load more", and re-running an edited query.
 */

import { useCallback, useRef, useState } from 'react';

import type { Tab, Views } from './Results';
import * as api from '@/lib/api';
import type { Sort } from '@/lib/sort';

export type Status = 'idle' | 'searching' | 'thinking' | 'error';

/** The views an answer brings with it; tabs it does not cover load when opened. */
export function viewsOf(answer: api.AskResponse): Views {
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

export function useSearch() {
  const [answer, setAnswer] = useState<api.AskResponse | null>(null);
  const [views, setViews] = useState<Views>({});
  const [tab, setTab] = useState<Tab>('cards');
  const [tabLoading, setTabLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [inLists, setInLists] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow request overwriting the result of a later one.
  const runId = useRef(0);

  /** Run a request, and show its answer if nothing newer has started. */
  const run = useCallback(async <T extends api.SearchResponse>(
    next: Status, request: () => Promise<T>, show: (result: T) => void,
  ) => {
    const id = ++runId.current;
    setStatus(next);
    setError(null);
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

  /** An edited query: both card views change, the explanation stays. */
  const runEdited = (edited: string) => {
    if (!answer) return;
    const { commander, sort, explanation } = answer.interpretation;
    run('searching', () => api.runQuery(edited, { commander: commander?.name, sort }), (result) => {
      showAnswer({ ...result, interpretation: { ...result.interpretation, explanation } });
    });
  };

  /** A new order only touches the Scryfall view. */
  const resort = (sort: Sort) => {
    if (!answer) return;
    const { commander, query } = answer.interpretation;
    run('searching', () => api.runQuery(query, { commander: commander?.name, sort, edhrec: false }), (result) => {
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

  return {
    answer, setAnswer, views, setViews, tab, setTab, tabLoading, loadingMore, inLists, setInLists,
    status, error, run, showAnswer, runEdited, resort, loadMore, openTab,
  };
}
