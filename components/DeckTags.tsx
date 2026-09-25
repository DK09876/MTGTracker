'use client';

/**
 * The Tags tab: the deck's own categories, made by hand or with the model,
 * in two steps the owner controls.
 *
 *   1. Tags.  Write what the deck should do; the model reads every card and
 *      suggests tags, each with a test for what belongs. Keep, edit or drop
 *      each; ask again with instructions; add your own.
 *   2. Cards. The model goes through the deck in batches and applies the
 *      tags you kept, then rechecks each tag across the whole deck. What you
 *      set by hand - on or off - is never overridden.
 *
 * The page drives the batches, so progress shows as it goes and one failed
 * batch does not lose the rest.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Entry } from './DeckCards';
import * as api from '@/lib/api';
import type { Board } from '@/lib/decklist';
import { BATCHES, requestsFor, type Budget, type Mode } from '@/lib/quota';
import type { ScryfallCard } from '@/lib/scryfall';
import { TAG_COLORS, TAG_KINDS, tagKey, tagsByCard, type DeckTags as Tags, type Tag, type TagKind } from '@/lib/tags';

interface Props {
  listId: string;
  entries: Entry[];
  tags: Tags | null;
  onTags: (tags: Tags) => void;
  onSelect: (card: ScryfallCard) => void;
}

// One request at a time in free mode: when Gemini is busy, every refused
// request still counts against the day, and two at once double that.
const CONCURRENCY: Record<Mode, number> = { free: 1, smart: 2 };
const MODE_KEY = 'mtg-tag-mode';

type Scope = 'all' | 'untagged';

interface Run {
  phase: 'assign' | 'audit' | 'done';
  done: number;
  total: number;
  added: number;
  removed: number;
  failed: string[];
  stopped?: boolean;
  /** Which models answered, in order of first use. */
  models: string[];
}

const input = 'rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]';
const button = 'rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';
const primary = 'rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[#221c08] hover:brightness-110 disabled:opacity-50';

export default function DeckTags({ listId, entries, tags, onTags, onSelect }: Props) {
  const [brief, setBrief] = useState<string | null>(null);
  const [instructions, setInstructions] = useState('');
  const [boards, setBoards] = useState<Board[]>(['main']);
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [audit, setAudit] = useState(true);
  const [run, setRun] = useState<Run | null>(null);
  const stop = useRef(false);
  const [budget, setBudget] = useState<(Budget & { configured?: boolean }) | null>(null);
  const [mode, setMode] = useState<Mode>(() => {
    try { return localStorage.getItem(MODE_KEY) === 'smart' ? 'smart' : 'free'; } catch { return 'free'; }
  });
  const chooseMode = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* not remembered, still works */ }
  };

  // The budget is shared by everyone on the app, so it is read fresh on opening.
  useEffect(() => {
    let cancelled = false;
    api.aiBudget().then((b) => { if (!cancelled) setBudget(b); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const refreshBudget = useCallback(() => { api.aiBudget().then(setBudget).catch(() => {}); }, []);

  // One entry per card, as tags see them: every printing of a card is one card.
  const cards = useMemo(() => {
    const seen = new Map<string, Entry>();
    for (const e of entries) if (boards.includes(e.board) && !seen.has(tagKey(e.card))) seen.set(tagKey(e.card), e);
    return [...seen.values()];
  }, [entries, boards]);

  if (!tags) return <p className="mt-8 text-center text-[var(--muted)]">Loading tags…</p>;

  const accepted = tags.tags.filter((t) => t.status === 'accepted');
  const proposed = tags.tags.filter((t) => t.status === 'proposed');
  const rejected = tags.tags.filter((t) => t.status === 'rejected');
  const onCard = tagsByCard(tags);
  const untagged = cards.filter((e) => !onCard.has(tagKey(e.card)));
  const running = run !== null && run.phase !== 'done';

  const act = async (work: () => Promise<Tags & { budget?: Budget }>) => {
    setError(null);
    try {
      const result = await work();
      if (result.budget) setBudget(result.budget);
      onTags(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      refreshBudget();
    }
  };

  // null until edited: the saved brief shows until then.
  const saveBrief = async () => {
    if (brief === null || brief === tags.brief) return;
    await act(() => api.setTagBrief(listId, brief));
    setBrief(null);
  };

  const propose = async () => {
    setProposing(true);
    await saveBrief();
    await act(() => api.proposeTags(listId, instructions, boards));
    setProposing(false);
  };

  /** Step 2: tag the cards in batches, then recheck each tag across the deck. */
  const tagCards = async () => {
    await saveBrief();
    stop.current = false;
    const targets = (scope === 'all' ? cards : untagged).map((e) => tagKey(e.card));
    const size = BATCHES[mode];
    // Even batches: 92 cards in free mode is 46 and 46, not 50 and 42.
    const count = Math.ceil(targets.length / size.cards);
    const per = Math.ceil(targets.length / Math.max(1, count));
    const batches: string[][] = [];
    for (let i = 0; i < targets.length; i += per) batches.push(targets.slice(i, i + per));
    const tagChunks: string[][] = [];
    for (let i = 0; i < accepted.length; i += size.tags) tagChunks.push(accepted.slice(i, i + size.tags).map((t) => t.id));

    const state: Run = { phase: 'assign', done: 0, total: targets.length, added: 0, removed: 0, failed: [], models: [] };
    const answered = (r: api.ModelStep) => {
      setBudget(r.budget);
      if (!state.models.includes(r.model)) state.models.push(r.model);
    };
    setRun({ ...state });

    const pool = async <T,>(jobs: T[], work: (job: T) => Promise<void>) => {
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY[mode], jobs.length) }, async () => {
        while (next < jobs.length && !stop.current) await work(jobs[next++]);
      }));
    };
    // A refused batch is tried once more before it is counted as failed -
    // unless every model is out for the day, when another try cannot help.
    const attempt = async <R,>(call: () => Promise<R>): Promise<R> => {
      try {
        return await call();
      } catch (e) {
        if (e instanceof Error && /midnight Pacific/.test(e.message)) throw e;
        return call();
      }
    };

    await pool(batches, async (keys) => {
      try {
        const result = await attempt(() => api.assignTags(listId, keys, boards));
        state.added += result.added;
        answered(result);
        onTags(result);
      } catch (e) {
        state.failed.push(`${keys.length} cards: ${e instanceof Error ? e.message.replace(/^The model failed: /, '') : 'failed'}`);
      }
      state.done += keys.length;
      setRun({ ...state });
    });

    // Checking tags that were never applied would spend requests on nothing.
    const assigned = state.failed.length < batches.length;
    if (audit && assigned && !stop.current) {
      Object.assign(state, { phase: 'audit', done: 0, total: accepted.length });
      setRun({ ...state });
      await pool(tagChunks, async (ids) => {
        try {
          const result = await attempt(() => api.auditTags(listId, ids, boards));
          state.added += result.added;
          state.removed += result.removed;
          answered(result);
          onTags(result);
        } catch (e) {
          state.failed.push(`checking ${ids.length} tags: ${e instanceof Error ? e.message.replace(/^The model failed: /, '') : 'failed'}`);
        }
        state.done += ids.length;
        setRun({ ...state });
      });
    }
    setRun({ ...state, phase: 'done', stopped: stop.current });
    refreshBudget();
  };

  const targetCount = scope === 'all' ? cards.length : untagged.length;
  const needs = (m: Mode) => requestsFor(m, targetCount, accepted.length, audit);

  const toggleBoard = (b: Board) =>
    setBoards((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]));

  return (
    <div className="mt-5 flex flex-col gap-8">
      <p className="max-w-3xl text-sm text-[var(--muted)]">
        Tags are your own categories for this deck. A card can carry several. Group the deck by them from the
        Cards tab, and open any card to see and change its tags. The model can help in two steps: it suggests
        tags for you to shape, then applies the ones you keep to every card.
      </p>
      {budget && <BudgetLine budget={budget} />}

      <section className="flex flex-col gap-2">
        <h3 className="font-medium">What should this deck do?</h3>
        <p className="text-sm text-[var(--muted)]">
          Optional, and read by every step. The plan, how it wins, what you want parts of the deck to do —
          &ldquo;the tokens are there to feed Korvold&rdquo;, &ldquo;keep interaction cheap&rdquo;.
        </p>
        <textarea
          value={brief ?? tags.brief}
          onChange={(e) => setBrief(e.target.value)}
          onBlur={saveBrief}
          rows={3}
          maxLength={4000}
          placeholder="e.g. Aristocrats: make tokens, sacrifice them for value, drain the table. I want to know which cards are fodder vs. outlets vs. payoffs."
          className={`${input} max-w-3xl`}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Step 1 · Suggest tags</h3>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          The model reads the commander and every card ({cards.length} different), works out the plan, and suggests tags with a
          test for what belongs in each. Nothing is tagged yet — review them below. Ask again with instructions to
          refine: &ldquo;split removal by what it hits&rdquo;, &ldquo;more detail on the graveyard package&rdquo;.
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Instructions for this round (optional)"
          className={`${input} max-w-3xl`}
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button onClick={propose} disabled={proposing || running} className={primary}>
            {proposing ? 'Reading the deck…' : proposed.length ? 'Suggest again' : accepted.length ? 'Suggest more tags' : 'Suggest tags'}
          </button>
          <span className="text-[var(--muted)]">1 request</span>
          <span className="text-[var(--muted)]">Include:</span>
          {(['maybe', 'side'] as Board[]).map((b) => (
            <label key={b} className="flex items-center gap-1.5 text-[var(--muted)]">
              <input type="checkbox" checked={boards.includes(b)} onChange={() => toggleBoard(b)} disabled={running} />
              {b === 'maybe' ? 'Maybeboard' : 'Sideboard'}
            </label>
          ))}
        </div>
        {proposing && <p className="text-sm text-[var(--muted)]">This takes up to a minute — the model reads every card closely.</p>}
        {tags.overview && (
          <div className="max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">How the model reads this deck</p>
            <p className="mt-1">{tags.overview}</p>
          </div>
        )}

        {proposed.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{proposed.length} suggested</p>
              <button onClick={() => act(() => api.acceptAllTags(listId))} className={button}>Keep all</button>
              <button
                onClick={async () => { for (const t of proposed) await act(() => api.updateTag(listId, t.id, { status: 'rejected' })); }}
                className={button}
              >
                Drop all
              </button>
            </div>
            <ul className="grid gap-2 lg:grid-cols-2">
              {proposed.map((t) => (
                <li key={t.id}>
                  <TagEditor
                    tag={t}
                    listId={listId}
                    onTags={onTags}
                    onError={setError}
                    footer={(
                      <>
                        {t.examples.length > 0 && (
                          <p className="text-xs text-[var(--muted)]">e.g. {t.examples.join(' · ')}</p>
                        )}
                        <div className="flex gap-2">
                          <button onClick={() => act(() => api.updateTag(listId, t.id, { status: 'accepted' }))} className={primary}>Keep</button>
                          <button onClick={() => act(() => api.updateTag(listId, t.id, { status: 'rejected' }))} className={button}>Drop</button>
                        </div>
                      </>
                    )}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Your tags {accepted.length > 0 && <span className="text-[var(--muted)]">({accepted.length})</span>}</h3>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          The description is the test the model tags by, so make it say exactly what belongs — and what doesn&apos;t.
        </p>
        {accepted.length === 0 && <p className="text-sm text-[var(--muted)]">None yet — keep some suggestions, or make one below.</p>}
        <ul className="flex flex-col gap-2">
          {accepted.map((t, i) => (
            <li key={t.id}>
              <TagEditor
                tag={t}
                listId={listId}
                onTags={onTags}
                onError={setError}
                members={cards.filter((e) => (onCard.get(tagKey(e.card)) ?? []).some((x) => x.tag.id === t.id))}
                onCard={onCard}
                deckCards={cards}
                onSelect={onSelect}
                controls={(
                  <>
                    <button disabled={i === 0} onClick={() => act(() => api.reorderTags(listId, move(accepted, i, -1)))} aria-label={`Move ${t.name} up`} className={button}>↑</button>
                    <button disabled={i === accepted.length - 1} onClick={() => act(() => api.reorderTags(listId, move(accepted, i, 1)))} aria-label={`Move ${t.name} down`} className={button}>↓</button>
                    {accepted.length > 1 && (
                      <select
                        aria-label={`Merge ${t.name} into another tag`}
                        value=""
                        onChange={(e) => {
                          const into = accepted.find((x) => x.id === e.target.value);
                          if (into && confirm(`Merge "${t.name}" into "${into.name}"? Its cards move across and "${t.name}" goes.`)) {
                            act(() => api.mergeTags(listId, t.id, into.id));
                          }
                        }}
                        className={`${input} py-1`}
                      >
                        <option value="">Merge into…</option>
                        {accepted.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    )}
                    <button
                      onClick={() => confirm(`Delete "${t.name}"? It comes off every card.`) && act(() => api.deleteTag(listId, t.id))}
                      className={`${button} text-red-400`}
                    >
                      Delete
                    </button>
                  </>
                )}
              />
            </li>
          ))}
        </ul>
        <NewTag listId={listId} onTags={onTags} onError={setError} />
        {rejected.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-[var(--muted)] hover:text-[var(--foreground)]">
              Dropped suggestions ({rejected.length}) — not suggested again
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {rejected.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{t.name}</span> <span className="text-[var(--muted)]">— {t.description}</span></span>
                  <button onClick={() => act(() => api.updateTag(listId, t.id, { status: 'accepted' }))} className={button}>Keep after all</button>
                  <button onClick={() => act(() => api.deleteTag(listId, t.id))} className={button}>Forget</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Step 2 · Tag the cards</h3>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          The model goes through the cards in small batches, weighing every tag you kept against each card&apos;s full
          text, and says why for each tag it applies. Then it takes each tag in turn and checks the whole deck for
          cards missed or wrongly included. Tags you put on or took off by hand are never changed.
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Mode">
          {(['free', 'smart'] as Mode[]).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => chooseMode(m)}
              disabled={running}
              className={`flex max-w-sm flex-col rounded-xl border px-3 py-2 text-left text-sm ${mode === m
                ? 'border-[var(--accent)] bg-[var(--surface-hover)]'
                : 'border-[var(--border)] hover:bg-[var(--surface)]'}`}
            >
              <span className="font-medium">
                {m === 'free' ? 'Free mode' : 'Smart mode'}
                <span className="ml-2 font-normal text-[var(--muted)]">{needs(m)} request{needs(m) === 1 ? '' : 's'}</span>
              </span>
              <span className="text-xs text-[var(--muted)]">
                {m === 'free'
                  ? `About ${BATCHES.free.cards} cards per request, and every tag checked in one pass. Good for most decks.`
                  : `${BATCHES.smart.cards} cards per request and ${BATCHES.smart.tags} tags per check: closer attention to each card, about three times the requests.`}
              </span>
            </button>
          ))}
        </div>
        {budget && budget.remaining < needs(mode) && (
          <p className="text-sm text-amber-400">
            {budget.remaining === 0
              ? `No free requests left today - they reset ${resetText(budget.resetsInMs)}.`
              : `Only ${budget.remaining} free request${budget.remaining === 1 ? '' : 's'} left today and this needs ${needs(mode)}. It will do what it can; finish later with "Only cards with no tags yet".`}
          </p>
        )}
        <div className="flex flex-col gap-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} disabled={running} />
            Every card ({cards.length} different) — redoes the model&apos;s earlier tags, keeps yours
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" checked={scope === 'untagged'} onChange={() => setScope('untagged')} disabled={running} />
            Only cards with no tags yet ({untagged.length})
          </label>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={audit} onChange={(e) => setAudit(e.target.checked)} disabled={running} />
            Then check each tag across the whole deck for misses and mistakes
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={tagCards}
            disabled={running || proposing || !accepted.length || (scope === 'untagged' && !untagged.length)}
            className={primary}
          >
            Tag cards with {accepted.length} tag{accepted.length === 1 ? '' : 's'}
          </button>
          {running && <button onClick={() => { stop.current = true; }} className={button}>Stop after this batch</button>}
          {!accepted.length && <span className="text-sm text-[var(--muted)]">Keep or make some tags first.</span>}
        </div>
        {run && <Progress run={run} />}
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

function move(tags: Tag[], i: number, by: -1 | 1): string[] {
  const ids = tags.map((t) => t.id);
  [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
  return ids;
}

function Progress({ run }: { run: Run }) {
  const share = run.total ? run.done / run.total : 1;
  const label = run.phase === 'assign'
    ? `Tagging cards — ${run.done} of ${run.total}`
    : run.phase === 'audit'
      ? `Checking tags across the deck — ${run.done} of ${run.total}`
      : run.stopped ? 'Stopped' : 'Done';
  return (
    <div className="max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
      <p>{label}</p>
      {run.phase !== 'done' && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--background)]" role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${share * 100}%` }} />
        </div>
      )}
      <p className="mt-1 text-[var(--muted)]">
        {run.added} tag{run.added === 1 ? '' : 's'} applied{run.removed > 0 && `, ${run.removed} taken off after checking`}.
        {run.phase === 'done' && ' Group the deck by tags in the Cards tab to look them over.'}
      </p>
      {run.models.length > 0 && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Answered by {run.models.map(modelLabel).join(', then ')}.
        </p>
      )}
      {run.failed.length > 0 && (
        <p className="mt-1 text-amber-400">
          Some batches failed — run again with &ldquo;Only cards with no tags yet&rdquo; to fill the gaps: {run.failed.join('; ')}
        </p>
      )}
    </div>
  );
}

/** A tag's name, colour, kind and description, edited in place; and, for an accepted tag, its cards. */
function TagEditor({ tag, listId, onTags, onError, footer, controls, members, onCard, deckCards, onSelect }: {
  tag: Tag;
  listId: string;
  onTags: (t: Tags) => void;
  onError: (e: string | null) => void;
  footer?: React.ReactNode;
  controls?: React.ReactNode;
  members?: Entry[];
  onCard?: ReturnType<typeof tagsByCard>;
  deckCards?: Entry[];
  onSelect?: (card: ScryfallCard) => void;
}) {
  // Drafts, null when not being edited, so a change saved elsewhere shows through.
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);

  const save = async (change: Partial<Pick<Tag, 'name' | 'description' | 'color' | 'kind'>>) => {
    onError(null);
    try {
      onTags(await api.updateTag(listId, tag.id, change));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not change that tag');
    }
  };
  const setCard = async (key: string, on: boolean) => {
    onError(null);
    try {
      onTags(await api.setCardTag(listId, key, tag.id, on));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not change that card');
    }
  };

  const count = members?.reduce((n, e) => n + e.quantity, 0);
  const others = deckCards?.filter((e) => !members?.includes(e)) ?? [];

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3" style={{ borderLeft: `3px solid ${tag.color}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Colour of ${tag.name}`}
          value={tag.color}
          onChange={(e) => save({ color: e.target.value })}
          className="h-7 w-9 cursor-pointer appearance-none rounded-md border border-[var(--border)] text-transparent"
          style={{ background: tag.color }}
        >
          {/* A closed select shows its option's text, so the swatch has none of its own. */}
          {TAG_COLORS.map((c, i) => <option key={c} value={c} style={{ background: c, color: '#14120f' }}>Colour {i + 1}</option>)}
        </select>
        <input
          value={name ?? tag.name}
          onChange={(e) => setName(e.target.value)}
          onBlur={async () => {
            if (name?.trim() && name.trim() !== tag.name) await save({ name: name.trim() });
            setName(null);
          }}
          aria-label="Tag name"
          maxLength={60}
          className={`${input} min-w-0 flex-1 font-medium`}
        />
        <select
          aria-label={`Kind of ${tag.name}`}
          value={tag.kind ?? ''}
          onChange={(e) => save({ kind: (e.target.value || null) as TagKind | null })}
          className={`${input} py-1`}
        >
          <option value="">No kind</option>
          {Object.entries(TAG_KINDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {count !== undefined && <span className="text-sm tabular-nums text-[var(--muted)]">{count} card{count === 1 ? '' : 's'}</span>}
        {controls}
      </div>
      <textarea
        value={description ?? tag.description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={async () => {
          if (description !== null && description.trim() !== tag.description) await save({ description: description.trim() });
          setDescription(null);
        }}
        rows={2}
        maxLength={600}
        placeholder="What a card must do to belong — and what doesn't count"
        aria-label={`What belongs in ${tag.name}`}
        className={`${input} text-[var(--muted)] focus:text-[var(--foreground)]`}
      />
      {footer}
      {members && onCard && (
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--muted)] hover:text-[var(--foreground)]">Cards</summary>
          {members.length === 0 && <p className="mt-2 text-[var(--muted)]">No cards yet.</p>}
          <ul className="mt-2 flex flex-col gap-1">
            {members.map((e) => {
              const link = onCard.get(tagKey(e.card))?.find((x) => x.tag.id === tag.id)?.link;
              return (
                <li key={tagKey(e.card)} className="flex items-start gap-2">
                  <span className="w-4 shrink-0 pt-0.5 text-xs text-[var(--muted)]" title={link?.source === 'ai' ? 'Added by the model' : 'Added by you'}>
                    {link?.source === 'ai' ? '✦' : '•'}
                  </span>
                  <button onClick={() => onSelect?.(e.card)} className="shrink-0 text-left hover:text-[var(--accent)]">{e.card.name}</button>
                  {link?.reason && <span className="min-w-0 flex-1 text-xs text-[var(--muted)]">{link.reason}</span>}
                  <button onClick={() => setCard(tagKey(e.card), false)} aria-label={`Take ${tag.name} off ${e.card.name}`} className="ml-auto shrink-0 px-1 text-[var(--muted)] hover:text-red-400">✕</button>
                </li>
              );
            })}
          </ul>
          {others.length > 0 && (
            <select
              aria-label={`Add a card to ${tag.name}`}
              value=""
              onChange={(e) => e.target.value && setCard(e.target.value, true)}
              className={`${input} mt-2 py-1`}
            >
              <option value="">Add a card…</option>
              {[...others].sort((a, b) => a.card.name.localeCompare(b.card.name)).map((e) => (
                <option key={tagKey(e.card)} value={tagKey(e.card)}>{e.card.name}</option>
              ))}
            </select>
          )}
        </details>
      )}
    </div>
  );
}

function NewTag({ listId, onTags, onError }: { listId: string; onTags: (t: Tags) => void; onError: (e: string | null) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onError(null);
    try {
      onTags(await api.createTag(listId, { name: name.trim(), description: description.trim() }));
      setName('');
      setDescription('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not make that tag');
    }
  };
  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-wrap gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag" aria-label="New tag name" maxLength={60} className={`${input} w-44`} />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What belongs in it (optional, helps the model)"
        aria-label="What belongs in the new tag"
        maxLength={600}
        className={`${input} min-w-[12rem] flex-1`}
      />
      <button disabled={!name.trim()} className={button}>Add tag</button>
    </form>
  );
}

const modelLabel = (model: string) => model.replace(/^gemini-/, 'Gemini ').replace(/-flash/, ' Flash').replace(/-lite/, ' Lite');

/** "in 5 hours", "in 40 minutes". */
function resetText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Today's free requests, shared by everyone using the app: how many are
 * left, on which models, and when they reset. The smartest model with
 * requests left answers each request.
 */
function BudgetLine({ budget }: { budget: Budget & { configured?: boolean } }) {
  if (budget.configured === false) {
    return <p className="text-sm text-amber-400">The model is off: no GEMINI_API_KEY is set on the server.</p>;
  }
  const next = budget.models.find((m) => m.remaining > 0);
  return (
    <div className="max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
      <p>
        <span className="font-medium">{budget.remaining} free model requests left today</span>
        <span className="text-[var(--muted)]"> - shared by everyone on the app, reset {resetText(budget.resetsInMs)}.</span>
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {next ? <>Next request goes to {next.label}. </> : null}
        {budget.models.map((m, i) => (
          <span key={m.id} className={m.remaining ? '' : 'line-through opacity-60'}>
            {i > 0 && ' › '}{m.label.replace(/^Gemini /, '')} {m.remaining}/{m.limit}
          </span>
        ))}
      </p>
    </div>
  );
}
