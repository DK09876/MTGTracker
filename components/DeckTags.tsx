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
 * The model's work runs as a job on the server (lib/tag-jobs.ts). The page
 * polls it and shows every answer and refusal as it happens, with a Stop
 * button. A busy model ends the job at once rather than being waited on.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import DeckBrief from './DeckBrief';
import type { Entry } from './DeckCards';
import ModelLine from './ModelLine';
import * as api from '@/lib/api';
import type { Board } from '@/lib/decklist';
import { modelLabel, requestsFor, tagRunCost, type Budget, type Mode } from '@/lib/quota';
import { dollars } from '@/lib/spend';
import type { TagJob } from '@/lib/tag-jobs';
import type { RoleCount } from '@/lib/roles';
import type { ScryfallCard } from '@/lib/scryfall';
import { TAG_COLORS, TAG_KIND_HINTS, TAG_KINDS, tagKey, tagsByCard, type DeckTags as Tags, type Tag, type TagKind } from '@/lib/tags';

interface Props {
  listId: string;
  entries: Entry[];
  tags: Tags | null;
  onTags: (tags: Tags) => void;
  onSelect: (card: ScryfallCard) => void;
}

const POLL_MS = 2_500;

type Scope = 'all' | 'untagged';

const isActive = (job: TagJob | null) => job?.status === 'running';

const input = 'rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]';
const button = 'rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';
const primary = 'rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[#221c08] hover:brightness-110 disabled:opacity-50';

export default function DeckTags({ listId, entries, tags, onTags, onSelect }: Props) {
  const [instructions, setInstructions] = useState('');
  const [boards, setBoards] = useState<Board[]>(['main']);
  const [error, setError] = useState<string | null>(null);
  // Unset until chosen: then cards with no tags yet if some are tagged, else every card.
  const [chosenScope, setScope] = useState<Scope | null>(null);
  const [audit, setAudit] = useState(true);
  const [job, setJob] = useState<TagJob | null>(null);
  const [stopping, setStopping] = useState(false);
  const [budget, setBudget] = useState<(Budget & { configured?: boolean }) | null>(null);

  // The budget is shared by everyone on the app, so it is read fresh on opening.
  useEffect(() => {
    let cancelled = false;
    api.aiBudget().then((b) => { if (!cancelled) setBudget(b); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const refreshBudget = useCallback(() => { api.aiBudget().then(setBudget).catch(() => {}); }, []);

  // The latest job, and while one runs, how it is going - it keeps going
  // with the page closed, so it is picked up again on opening.
  const show = useCallback((state: api.TagJobState) => {
    setJob(state.job);
    setBudget(state.budget);
    onTags(state.tags);
  }, [onTags]);
  const active = isActive(job);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => api.tagJob(listId)
      .then((state) => {
        if (cancelled) return;
        show(state);
        if (isActive(state.job)) timer = setTimeout(poll, POLL_MS);
        else setStopping(false);
      })
      .catch(() => { if (!cancelled) timer = setTimeout(poll, POLL_MS * 4); });
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [listId, active, show]);

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
  const partly = untagged.length > 0 && untagged.length < cards.length;
  const scope: Scope = chosenScope ?? (partly ? 'untagged' : 'all');
  // Claude is paid by the token; the free models by the request.
  const mode: Mode = budget?.spend ? 'claude' : 'free';
  const tagModel = budget?.models[0]?.id ?? null;
  const running = active;
  const proposing = active && job?.params.kind === 'propose';

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

  const start = async (params: Parameters<typeof api.startTagJob>[1]) => {
    setError(null);
    try {
      show(await api.startTagJob(listId, params));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start that');
    }
  };
  const propose = () => start({ kind: 'propose', instructions, boards });
  const tagCards = () => start({ kind: 'tag', mode, scope, audit, boards });
  const stopJob = async () => {
    setStopping(true);
    try {
      show(await api.stopTagJob(listId));
    } catch (e) {
      setStopping(false);
      setError(e instanceof Error ? e.message : 'Could not stop it');
    }
  };
  const panel = job && <JobPanel job={job} stopping={stopping} onStop={stopJob} />;

  const targetCount = scope === 'all' ? cards.length : untagged.length;
  const needs = (m: Mode) => requestsFor(m, targetCount, accepted.length, audit);

  const toggleBoard = (b: Board) =>
    setBoards((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]));

  return (
    <div className="mt-5 flex flex-col gap-8">
      <p className="max-w-3xl text-sm text-[var(--muted)]">
        Tags are this deck&apos;s own categories: its engines, payoffs and ways to win. The jobs every deck needs —
        ramp, draw, removal — are tagged automatically below. Group the deck by tags from the Cards tab, and open any
        card to see and change its tags.
      </p>
      <BasicRoles listId={listId} />
      {budget && <BudgetLine budget={budget} />}
      <ModelLine feature="tagging" />

      <DeckBrief listId={listId} tags={tags} onTags={onTags} />

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">1 · Suggest tags</h3>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          The model reads the commander, your brief and every card ({cards.length} different), and suggests tags for this
          deck&apos;s plan, each with a test for what belongs. It stops here so you can keep, edit or drop them. Ask again
          with instructions: &ldquo;split the payoffs by what they reward&rdquo;, &ldquo;more detail on the graveyard package&rdquo;.
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
            {proposing ? 'Suggesting…' : proposed.length ? 'Suggest again' : accepted.length ? 'Suggest more tags' : 'Suggest tags'}
          </button>
          <span className="text-[var(--muted)]">Include:</span>
          {(['maybe', 'side'] as Board[]).map((b) => (
            <label key={b} className="flex items-center gap-1.5 text-[var(--muted)]">
              <input type="checkbox" checked={boards.includes(b)} onChange={() => toggleBoard(b)} disabled={running} />
              {b === 'maybe' ? 'Maybeboard' : 'Sideboard'}
            </label>
          ))}
        </div>
        {job?.params.kind === 'propose' && panel}
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
        <h3 className="font-medium">2 · Your tags {accepted.length > 0 && <span className="text-[var(--muted)]">({accepted.length})</span>}</h3>
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
        <h3 className="font-medium">3 · Put them on the cards</h3>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          The model weighs every tag you kept against each card&apos;s full text and says why for each one it applies,
          then checks each tag across the deck. Tags you put on or took off by hand are never changed.
        </p>
        {mode === 'claude' && tagModel && (
          <p className="text-sm">
            About <span className="font-semibold">{dollars(tagRunCost(tagModel, { deck: cards.length, cards: targetCount, tags: accepted.length, audit, mode }))}</span>
            <span className="text-[var(--muted)]"> on {modelLabel(tagModel).replace(/^Claude /, '')} · {needs(mode)} requests · runs in the background</span>
          </p>
        )}
        {mode === 'free' && budget && budget.remaining < needs(mode) && (
          <p className="text-sm text-amber-400">
            {budget.remaining === 0
              ? `No free requests left today - they reset ${resetText(budget.resetsInMs)}.`
              : `Only ${budget.remaining} free request${budget.remaining === 1 ? '' : 's'} left today and this needs ${needs(mode)}. It will do what it can; finish later with the cards that have no tags yet.`}
          </p>
        )}
        <div className="flex flex-col gap-1.5 text-sm">
          {partly ? (
            <p>
              {scope === 'untagged'
                ? <>Cards: <span className="font-medium">{untagged.length} with no tags yet</span><span className="text-[var(--muted)]"> · the {cards.length - untagged.length} already tagged keep theirs</span></>
                : <>Cards: <span className="font-medium">every card ({cards.length})</span><span className="text-[var(--muted)]"> · redoes the model&apos;s earlier tags, keeps yours</span></>}
              {' '}
              <button onClick={() => setScope(scope === 'untagged' ? 'all' : 'untagged')} disabled={running} className="text-[var(--accent)] hover:underline">
                {scope === 'untagged' ? 'Redo every card instead' : 'Only the untagged ones'}
              </button>
            </p>
          ) : (
            <p>Cards: <span className="font-medium">{cards.length}</span>{untagged.length === 0 && <span className="text-[var(--muted)]"> · redoes the model&apos;s earlier tags, keeps yours</span>}</p>
          )}
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={audit} onChange={(e) => setAudit(e.target.checked)} disabled={running} />
            Then double-check each tag across the whole deck for misses and mistakes
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={tagCards}
            disabled={running || proposing || !accepted.length || (scope === 'untagged' && !untagged.length)}
            className={primary}
          >
            Start tagging with {accepted.length} tag{accepted.length === 1 ? '' : 's'}
          </button>
          {!accepted.length && <span className="text-sm text-[var(--muted)]">Keep or make some tags first.</span>}
        </div>
        {job?.params.kind === 'tag' && panel}
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

/**
 * The jobs every deck needs, counted from Scryfall's tags without a model:
 * what "Role" tags used to be. Read-only here; Health has the full table.
 */
function BasicRoles({ listId }: { listId: string }) {
  const [roles, setRoles] = useState<RoleCount[] | 'loading' | 'failed'>('loading');
  useEffect(() => {
    let cancelled = false;
    api.deckRoles(listId).then((r) => { if (!cancelled) setRoles(r); }).catch(() => { if (!cancelled) setRoles('failed'); });
    return () => { cancelled = true; };
  }, [listId]);
  const shown = Array.isArray(roles) ? roles.filter((r) => r.count > 0) : [];
  return (
    <section className="flex max-w-3xl flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">Basic roles <span className="text-sm font-normal text-emerald-400">· automatic, free</span></h3>
        <span className="text-xs text-[var(--muted)]">From Scryfall&apos;s card tags · the Health tab has the full table</span>
      </div>
      {roles === 'loading' && <p className="text-sm text-[var(--muted)]">Reading the cards&apos; roles… the first time takes up to a minute.</p>}
      {roles === 'failed' && <p className="text-sm text-[var(--muted)]">Couldn&apos;t reach Scryfall for the roles just now.</p>}
      {shown.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {shown.map((r) => (
            <li key={r.id} title={r.cards.join(', ')} className="rounded-full border border-[var(--border)] bg-[var(--background)] px-2.5 py-0.5 text-xs text-[var(--muted)]">
              {r.label} <span className="text-[var(--foreground)]">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function move(tags: Tag[], i: number, by: -1 | 1): string[] {
  const ids = tags.map((t) => t.id);
  [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
  return ids;
}

const STATUS: Record<TagJob['status'], { icon: string; label: string; tone: string }> = {
  running: { icon: '●', label: 'Working', tone: 'text-[var(--accent)]' },
  done: { icon: '✓', label: 'Done', tone: 'text-green-500' },
  failed: { icon: '✕', label: 'Failed', tone: 'text-red-400' },
  stopped: { icon: '■', label: 'Stopped', tone: 'text-[var(--muted)]' },
  interrupted: { icon: '!', label: 'Interrupted', tone: 'text-red-400' },
};
const LEVEL_ICON = { info: '·', warn: '⚠', error: '✕' } as const;

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The job as it stands: what it is doing, what it has spent, every answer and refusal, and a Stop button. */
function JobPanel({ job, stopping, onStop }: { job: TagJob; stopping: boolean; onStop: () => void }) {
  const active = isActive(job);

  const status = STATUS[job.status];
  const what = job.params.kind === 'propose'
    ? 'Suggesting tags'
    : job.phase === 'audit' ? `Checking tags across the deck — ${job.done} of ${job.total}` : `Tagging cards — ${job.done} of ${job.total}`;
  const share = job.total ? job.done / job.total : 0;
  const events = [...job.events].reverse();

  return (
    <div className="max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`font-medium ${status.tone}`}><span aria-hidden>{status.icon}</span> {status.label}</span>
        <span className="text-[var(--foreground)]">{what}</span>
        {active && (
          <button onClick={onStop} disabled={stopping} className={`${button} ml-auto`}>
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>
      {job.params.kind === 'tag' && active && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--background)]" role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${share * 100}%` }} />
        </div>
      )}
      {job.error && <p className="mt-1 text-red-400">{job.error}</p>}
      <p className="mt-1 text-[var(--muted)]">
        {job.params.kind === 'propose'
          ? job.status === 'done' && `${plural(job.proposed, 'tag')} suggested - review them below. `
          : `${plural(job.added, 'tag')} applied${job.removed ? `, ${job.removed} taken off after checking` : ''}. `}
        {plural(job.requests, 'request')} spent{job.refusals ? `, ${job.refusals} of them refused` : ''}
        {job.models.length > 0 && ` · answered by ${job.models.map(modelLabel).join(', then ')}`}.
        {job.params.kind === 'tag' && job.status === 'done' && ' Group the deck by tags in the Cards tab to look them over.'}
      </p>
      {job.failed.length > 0 && (
        <p className="mt-1 text-amber-400">
          ⚠ Some batches failed — run again with &ldquo;Only cards with no tags yet&rdquo; to fill the gaps: {job.failed.join('; ')}
        </p>
      )}
      {events.length > 0 && (
        <details className="mt-2" open={active}>
          <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Activity ({events.length})</summary>
          <ol className="mt-1 max-h-48 overflow-y-auto text-xs">
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex gap-2 py-0.5">
                <span className="shrink-0 tabular-nums text-[var(--muted)]">{timeOf(e.at)}</span>
                <span aria-hidden className={`w-3 shrink-0 text-center ${e.level === 'error' ? 'text-red-400' : e.level === 'warn' ? 'text-amber-400' : 'text-[var(--muted)]'}`}>{LEVEL_ICON[e.level]}</span>
                <span className="text-[var(--foreground)]">{e.text}</span>
              </li>
            ))}
          </ol>
        </details>
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
          {(Object.keys(TAG_KINDS) as TagKind[]).map((k) => <option key={k} value={k}>{TAG_KINDS[k]} — {TAG_KIND_HINTS[k]}</option>)}
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


/** "in 5 hours", "in 40 minutes". */
function resetText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Today's free requests, shared by everyone using the app: how many are
 * left, on which models, and when they reset.
 */
function BudgetLine({ budget }: { budget: Budget & { configured?: boolean } }) {
  if (budget.configured === false) {
    return <p className="text-sm text-amber-400">The model is off: no model API key is set on the server.</p>;
  }
  if (budget.spend) {
    const s = budget.spend;
    return (
      <div className="max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
        <p>
          <span className="font-medium">{dollars(s.left)} of today&apos;s AI budget left for you</span>
          <span className="text-[var(--muted)]"> - resets {resetText(s.resetsInMs)}.</span>
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Tagging runs on {budget.models[0]?.label}, paid by the token: tagging a whole deck usually costs well under a dollar.
          You have spent {dollars(s.profileToday)} of {dollars(s.caps.perProfile)} today; everyone {dollars(s.today)} of {dollars(s.caps.daily)}.
        </p>
      </div>
    );
  }
  const next = budget.models.find((m) => m.remaining > 0);
  return (
    <div className="max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
      <p>
        <span className="font-medium">{budget.remaining} free model requests left today</span>
        <span className="text-[var(--muted)]"> - shared by everyone on the app, reset {resetText(budget.resetsInMs)}.</span>
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {budget.models.length === 1 ? <>Every request goes to {budget.models[0].label}.</> : next ? <>Next request goes to {next.label}. </> : null}
        {budget.models.length > 1 && budget.models.map((m, i) => (
          <span key={m.id} className={m.remaining ? '' : 'line-through opacity-60'}>
            {i > 0 && ' › '}{m.label.replace(/^Gemini /, '')} {m.remaining}/{m.limit}
          </span>
        ))}
      </p>
    </div>
  );
}
