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
import { getProfile } from '@/lib/profile';
import { replayOf, type RecentSearch, type Replay } from '@/lib/recent';
import type { ScryfallCard } from '@/lib/scryfall';
import { parseSortKey } from '@/lib/sort';
import { dismissKeyboard, steady } from '@/lib/steady-tap';
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

/**
 * The search on screen, kept on this device so a reload - or iOS reopening
 * the home-screen app from scratch - brings it back. Only how to run it
 * again is kept, not the results: they come fresh from Scryfall.
 */
const currentKey = () => `mtg-search:${getProfile()}`;

function saveCurrent(text: string, replay: Replay): void {
  try { localStorage.setItem(currentKey(), JSON.stringify({ text, replay })); } catch { /* not kept; still works */ }
}

function loadCurrent(): { text: string; replay: Replay } | null {
  try {
    const saved = localStorage.getItem(currentKey());
    return saved ? JSON.parse(saved) as { text: string; replay: Replay } : null;
  } catch {
    return null;
  }
}

const THREAD = ' › ';

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
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);

  const [recent, setRecent] = useState<RecentSearch[]>([]);

  useEffect(() => { api.fetchLists().then(setLists).catch(() => {}); }, []);

  useEffect(() => {
    if (!toast) return;
    // Long enough to read which list it went to, and to undo it.
    const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const search = (text: string) => {
    const term = text.trim();
    if (!term) return;
    // The keyboard closes now, before results come up to be tapped.
    dismissKeyboard();
    setSearched(true);
    setThread([term]);
    setAsked({ text: term });
    run(looksLikeSyntax(term) ? 'searching' : 'thinking', () => api.ask(term), (r) => {
      showAnswer(r);
      remember(term, replayOf(r));
    });
  };

  const pickName = (name: string, keep = true) => {
    setQuery(name);
    setSearched(true);
    setThread([]);
    run('searching', () => api.search(exactName(name)), (r) => {
      s.setAnswer(null);
      s.setViews({ cards: { cards: r.cards, total: r.totalCards } });
      s.setTab('cards');
      if (keep) remember(name, { kind: 'name', name });
    });
  };

  /** Keep a search: on this device as the one on screen, and in the profile's recent list. */
  const remember = (text: string, replay: Replay | null) => {
    if (!replay) return;
    saveCurrent(text, replay);
    api.rememberSearch(text, replay).then(setRecent).catch(() => {});
  };

  /** Run a recent search again: straight to Scryfall, as it was read the first time. */
  const replay = (text: string, r: Replay, keep = true) => {
    dismissKeyboard();
    if (r.kind === 'name') {
      pickName(r.name, keep);
      return;
    }
    const parts = text.split(THREAD);
    setQuery(parts[0]);
    setSearched(true);
    setThread(parts);
    setAsked(null);
    const done = (result: api.AskResponse) => {
      showAnswer({
        ...result,
        interpretation: {
          ...result.interpretation,
          ...(r.explanation ? { explanation: r.explanation } : {}),
          ...(r.kind === 'combos' && r.note ? { note: r.note } : {}),
        },
      });
      if (keep) remember(text, r);
    };
    if (r.kind === 'combos') {
      run('searching', () => api.combosFor(r.commander), done);
    } else {
      run('searching', () => api.runQuery(r.query, {
        commander: r.commander, sort: parseSortKey(r.sort ?? null) ?? undefined, constraints: r.constraints,
      }), done);
    }
  };

  // On opening: the recent list, and the search that was on screen.
  useEffect(() => {
    api.recentSearches().then(setRecent).catch(() => {});
    const current = loadCurrent();
    // After this render, not in it; cancelled if the page goes before then.
    const timer = current ? setTimeout(() => replay(current.text, current.replay, false), 0) : undefined;
    return () => clearTimeout(timer);
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forget = (text: string | null) => { api.forgetSearch(text).then(setRecent).catch(() => {}); };

  const followUp = (text: string) => {
    if (!answer) return;
    dismissKeyboard();
    const previous = previousOf(answer, thread);
    run('thinking', () => api.followUp(text, previous), (r) => {
      setThread((t) => [...t, text]);
      setAsked({ text, previous });
      showAnswer(r);
      remember([...thread, text].join(THREAD), replayOf(r));
    });
  };

  /** Answer "which commander?" and let the search carry on. */
  const pickCommander = (name: string) => {
    if (!answer?.plan || !asked) return;
    const plan = answer.plan;
    run('thinking', () => api.resume(asked.text, asked.previous, plan, name), (r) => {
      showAnswer(r);
      remember(thread.join(THREAD) || asked.text, replayOf(r));
    });
  };

  const addCard = async (listId: string, quantity: number) => {
    if (!adding) return;
    const card = adding;
    const { before } = await api.addCard(listId, card.id, quantity);
    const fresh = await api.fetchLists();
    setLists(fresh);
    const name = fresh.find((l) => l.id === listId)?.name ?? 'list';
    s.setInLists((prev) => ({ ...prev, [card.id]: [...new Set([...(prev[card.id] ?? []), name])] }));
    setToast({
      text: `Added ${quantity > 1 ? `${quantity}× ` : ''}${card.name} to ${name}`,
      undo: async () => {
        await api.undoAdd(listId, card.id, before);
        setLists(await api.fetchLists());
        // Still in the list only if it was there before this add.
        if (!before) s.setInLists((prev) => ({ ...prev, [card.id]: (prev[card.id] ?? []).filter((n) => n !== name) }));
        setToast({ text: `Took ${card.name} back out of ${name}` });
      },
    });
  };

  const busy = status === 'searching' || status === 'thinking';
  const hasViews = Object.keys(views).length > 0;

  return (
    <div>
      <SearchBox
        value={query}
        onChange={setQuery}
        onSubmit={search}
        onPickName={(name) => pickName(name)}
        recent={recent.map((r) => r.text)}
        onPickRecent={(text) => { const r = recent.find((x) => x.text === text); if (r) replay(r.text, r.replay); }}
      />

      {!searched && recent.length > 0 && (
        <section className="mt-4" aria-label="Recent searches">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs uppercase tracking-wide text-[var(--muted)]">Recent</h2>
            <button onClick={() => forget(null)} className="min-h-9 px-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Clear all</button>
          </div>
          <ul className="mt-1 flex flex-col divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
            {recent.slice(0, 8).map((r) => (
              <li key={r.text} className="flex items-center">
                <button
                  {...steady(() => replay(r.text, r.replay))}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface)]"
                >
                  <span aria-hidden className="text-[var(--muted)]">↺</span>
                  <span className="truncate">{r.text}</span>
                  {r.replay.kind !== 'name' && r.replay.commander && (
                    <span className="ml-auto hidden shrink-0 text-xs text-[var(--muted)] sm:inline">{r.replay.commander.split(',')[0]}</span>
                  )}
                </button>
                <button
                  onClick={() => forget(r.text)}
                  aria-label={`Forget "${r.text}"`}
                  className="flex min-h-11 min-w-11 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

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
          edhrecFull={s.edhrecFull}
          onEdhrecFull={answer && answer.interpretation.constraints !== undefined
            && answer.interpretation.constraints !== answer.interpretation.query ? s.toggleEdhrecFull : undefined}
        />
      )}

      <CardModal
        card={selected}
        onClose={() => setSelected(null)}
        actions={
          selected && (
            <button
              {...steady(() => { setAdding(selected); setSelected(null); })}
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
        <div
          role="status"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[#221c08] shadow-lg"
        >
          <span className="min-w-0 flex-1">{toast.text}</span>
          {toast.undo && (
            <button
              {...steady(() => { const undo = toast.undo!; setToast(null); undo().catch(() => setToast({ text: 'Could not undo that - remove it from the list' })); })}
              className="min-h-9 shrink-0 rounded-lg bg-[#221c08]/15 px-3 font-semibold"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
