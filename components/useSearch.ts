'use client';

/**
 * The state behind a search and its views, shared by the search page and a
 * deck's "Add cards" window: running a request without a slow one
 * overwriting a newer one, the tabs and loading them when first opened,
 * re-sorting, "Load more", and re-running an edited query.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Tab, Views } from './Results';
import * as api from '@/lib/api';
import { getProfile } from '@/lib/profile';
import type { Sort } from '@/lib/sort';

export type Status = 'idle' | 'searching' | 'thinking' | 'error';

/** The views an answer brings with it; tabs it does not cover load when opened. */
export function viewsOf(answer: api.AskResponse): Views {
  if (answer.interpretation.kind === 'combos') {
    return { combos: { combos: answer.combos ?? [], cards: answer.cards, note: answer.interpretation.note } };
  }
  return {
    cards: {
      cards: answer.cards, total: answer.totalCards, sort: answer.interpretation.sort,
      page: 1, hasMore: answer.hasMore,
    },
  };
}

function firstTab(answer: api.AskResponse): Tab {
  return answer.interpretation.kind === 'combos' ? 'combos' : 'cards';
}

/**
 * The last search on screen, kept in memory while the app is open: going to
 * another page and back shows it at once rather than running it again. A
 * reload starts fresh (the search page runs it again from what it saved).
 */
interface Kept {
  profile: string;
  answer: api.AskResponse;
  views: Views;
  tab: Tab;
  inLists: Record<string, string[]>;
  owned: Record<string, number>;
}
let kept: Kept | null = null;

export function useSearch() {
  // Only this profile's, and read once, when the page opens.
  const [memory] = useState(() => (kept && kept.profile === getProfile() ? kept : null));
  const [answer, setAnswer] = useState<api.AskResponse | null>(memory?.answer ?? null);
  const [views, setViews] = useState<Views>(memory?.views ?? {});
  const [tab, setTab] = useState<Tab>(memory?.tab ?? 'cards');
  const [tabLoading, setTabLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [inLists, setInLists] = useState<Record<string, string[]>>(memory?.inLists ?? {});
  // Copies the profile owns of each card shown, by card id.
  const [owned, setOwned] = useState<Record<string, number>>(memory?.owned ?? {});
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
      setOwned((prev) => ({ ...prev, ...result.owned }));
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
    run('searching', () => api.runQuery(query, { commander: commander?.name, sort }), (result) => {
      setViews((v) => ({
        ...v,
        cards: {
          cards: result.cards, total: result.totalCards, sort: result.interpretation.sort,
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
        commander: answer.interpretation.commander?.name, sort: current.sort, page: next,
      });
      if (id !== runId.current) return;
      setInLists((prev) => ({ ...prev, ...r.inLists }));
      setOwned((prev) => ({ ...prev, ...r.owned }));
      setViews((v) => {
        if (!v.cards) return v;
        const seen = new Set(v.cards.cards.map((c) => c.id));
        return {
          ...v,
          cards: {
            ...v.cards,
            cards: [...v.cards.cards, ...r.cards.filter((c) => !seen.has(c.id))],
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

  /**
   * Put a search back as it was left: the pages of the Scryfall view that
   * were loaded, and the tab that was open. Takes the answer just shown, since state has not caught up yet.
   */
  const resumeView = async (result: api.AskResponse, left: { tab?: Tab; pages?: number }) => {
    const id = runId.current;
    const { query, commander, sort, kind } = result.interpretation;
    const name = commander?.name;
    const merge = (r: api.SearchResponse) => {
      setInLists((prev) => ({ ...prev, ...r.inLists }));
      setOwned((prev) => ({ ...prev, ...r.owned }));
    };
    try {
      if (kind !== 'combos' && left.pages && left.pages > 1 && result.hasMore) {
        let cards = result.cards;
        let hasMore: boolean = result.hasMore;
        let page = 1;
        for (let next = 2; next <= left.pages && hasMore; next++) {
          const r = await api.runQuery(query, { commander: name, sort, page: next });
          if (id !== runId.current) return;
          merge(r);
          const seen = new Set(cards.map((c) => c.id));
          cards = [...cards, ...r.cards.filter((c) => !seen.has(c.id))];
          hasMore = r.hasMore;
          page = next;
        }
        setViews((v) => (v.cards ? { ...v, cards: { ...v.cards, cards, page, hasMore } } : v));
      }
      if (left.tab && name) {
        const have = viewsOf(result);
        if (left.tab === 'combos' && !have.combos) {
          const r = await api.combosFor(name);
          if (id !== runId.current) return;
          merge(r);
          setViews((v) => ({ ...v, combos: { combos: r.combos ?? [], cards: r.cards, note: r.interpretation.note } }));
        } else if (left.tab !== 'combos' && !have.cards) {
          const r = await api.runQuery('', { commander: name });
          if (id !== runId.current) return;
          merge(r);
          setViews((v) => ({
            ...v,
            cards: { cards: r.cards, total: r.totalCards, sort: r.interpretation.sort, page: 1, hasMore: r.hasMore },
          }));
        }
      }
      if (left.tab && id === runId.current) setTab(left.tab);
    } catch {
      // What could not be put back stays as the search first showed it.
    }
  };

  /** Open a tab, fetching its view the first time. */
  const openTab = async (next: Tab) => {
    setTab(next);
    const commander = answer?.interpretation.commander?.name;
    if (!commander) return;
    const missing = next === 'combos' ? !views.combos : !views.cards;
    if (!missing) return;

    const id = runId.current;
    setTabLoading(true);
    try {
      if (next === 'combos') {
        const r = await api.combosFor(commander);
        if (id !== runId.current) return;
        setInLists((prev) => ({ ...prev, ...r.inLists }));
      setOwned((prev) => ({ ...prev, ...r.owned }));
        setViews((v) => ({ ...v, combos: { combos: r.combos ?? [], cards: r.cards, note: r.interpretation.note } }));
      } else {
        // Came from a combo search: fetch "everything for this commander".
        const r = await api.runQuery('', { commander });
        if (id !== runId.current) return;
        setInLists((prev) => ({ ...prev, ...r.inLists }));
      setOwned((prev) => ({ ...prev, ...r.owned }));
        setViews((v) => ({
          ...v,
          cards: { cards: r.cards, total: r.totalCards, sort: r.interpretation.sort, page: 1, hasMore: r.hasMore },
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that tab');
    } finally {
      setTabLoading(false);
    }
  };

  useEffect(() => {
    kept = answer ? { profile: getProfile(), answer, views, tab, inLists, owned } : null;
  }, [answer, views, tab, inLists, owned]);

  return {
    /** Whether this opened on the search kept from before, rather than empty. */
    fromMemory: !!memory,
    answer, setAnswer, views, setViews, tab, setTab, tabLoading, loadingMore, inLists, setInLists, owned,
    status, error, run, showAnswer, runEdited, resort, loadMore, openTab, resumeView,
  };
}
