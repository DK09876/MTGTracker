'use client';

/**
 * Your tags, under the Plan tab: the deck's own categories, made by hand or with the model,
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

import type { Entry } from './DeckCards';
import AiModelPicker from './AiModelPicker';
import PlanLine from './PlanLine';
import Tip from './Tip';
import { AI_READS } from '@/lib/ai-reads';
import * as api from '@/lib/api';
import type { Board } from '@/lib/decklist';
import { DEFAULT_SECTIONS, type DeckSection } from '@/lib/sections-shared';
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
  /** Send the owner to the Plan tab, where the brief now lives. */
  onPlan: () => void;
  /** The deck's sections beyond Main, which the tagger can also read. */
  sections?: DeckSection[];
}

const POLL_MS = 2_500;

type Scope = 'all' | 'untagged' | 'missing' | 'picked';

const isActive = (job: TagJob | null) => job?.status === 'running';

const input = 'rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]';
const button = 'rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';
const primary = 'rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[#221c08] hover:brightness-110 disabled:opacity-50';

export default function DeckTags({ listId, entries, tags, onTags, onSelect, onPlan, sections = DEFAULT_SECTIONS }: Props) {
  const [instructions, setInstructions] = useState('');
  // Which boards the tagger reads, remembered for this deck in this browser.
  const [boards, setBoardsState] = useState<Board[]>(() => {
    try { const b = JSON.parse(localStorage.getItem(`mtg-tag-boards:${listId}`) ?? 'null'); return Array.isArray(b) && b.length ? b : ['main']; } catch { return ['main']; }
  });
  const setBoards = (next: Board[] | ((prev: Board[]) => Board[])) => setBoardsState((prev) => {
    const value = typeof next === 'function' ? next(prev) : next;
    try { localStorage.setItem(`mtg-tag-boards:${listId}`, JSON.stringify(value)); } catch { /* not remembered, still works */ }
    return value;
  });
  // A tagging run: the tag cards must lack, cards picked by hand, the tags to use, and instructions.
  const [missingTag, setMissingTag] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickFilter, setPickFilter] = useState('');
  const [onlyTags, setOnlyTags] = useState<Set<string> | null>(null);
  const [runInstructions, setRunInstructions] = useState('');
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
  const useTags = onlyTags ? accepted.filter((t) => onlyTags.has(t.id)) : accepted;
  const lacking = missingTag || accepted[0]?.id || '';
  const tagCards = () => start({
    kind: 'tag', mode, scope, audit, boards,
    ...(scope === 'missing' ? { missingTag: lacking } : {}),
    ...(scope === 'picked' ? { picked: [...picked] } : {}),
    ...(onlyTags ? { tagIds: [...onlyTags] } : {}),
    instructions: runInstructions,
  });
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

  const missingCount = cards.filter((e) => !tags.cardTags.some((l) => l.on && l.key === tagKey(e.card) && l.tagId === lacking)).length;
  const targetCount = scope === 'all' ? cards.length : scope === 'untagged' ? untagged.length : scope === 'missing' ? missingCount : picked.size;
  const needs = (m: Mode) => requestsFor(m, targetCount, useTags.length, audit);

  const toggleBoard = (b: Board) =>
    setBoards((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]));

  return (
    <div className="mt-5 flex flex-col gap-8">
      <div className="flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
          Your tags
          <Tip label="About tags">
            Tags are this deck&apos;s own categories: its engines, payoffs and ways to win. The jobs every deck needs -
            ramp, draw, removal - are tagged automatically. Theme tags become the plan&apos;s themes; a tag named for a job
            (Ramp, Draw, Removal) stays a tag, since the built-in jobs count those. Group the deck by tags from the Cards tab, and open any
            card to see and change its tags.
          </Tip>
        </h2>
        <AiModelPicker area="deck" className="ml-auto" />
      </div>
      <PlanLine data-tour="tags-brief" label="Plan the tagger reads" brief={tags.brief} action="Edit above" onAction={onPlan} />
      <BasicRoles listId={listId} />
      {budget && <BudgetLine budget={budget} />}

      <section className="flex flex-col gap-3">
        <h3 data-tour="suggest-tags" data-section="Suggest tags" className="font-medium">Suggest tags with Claude</h3>
        <p className="flex max-w-3xl items-center gap-2 text-sm text-[var(--muted)]">
          Claude suggests tags for this deck&apos;s plan; you keep, edit or drop each one.
          <Tip label="How suggesting works">
            It reads the commander, your brief and every card ({cards.length} different), and gives each tag a test for what
            belongs. It stops there so you can keep, edit or drop them. Ask again with instructions: &ldquo;split the payoffs by
            what they reward&rdquo;, &ldquo;more detail on the graveyard package&rdquo;.
          </Tip>
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
          <Tip label="What Claude reads"><span className="font-semibold">What Claude reads:</span><ul className="mt-1 list-disc pl-4">{AI_READS.proposeTags.map((x) => <li key={x}>{x}</li>)}</ul></Tip>
          <span className="text-[var(--muted)]">Include:</span>
          {sections.map((s) => (
            <label key={s.id} className="flex items-center gap-1.5 text-[var(--muted)]">
              <input type="checkbox" checked={boards.includes(s.id)} onChange={() => toggleBoard(s.id)} disabled={running} />
              {s.name}
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
        <h3 data-tour="your-tags" data-section="Tags" className="font-medium">Your tags {accepted.length > 0 && <span className="text-[var(--muted)]">({accepted.length})</span>}</h3>
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
        <h3 data-tour="tag-cards" data-section="Tag the cards" className="font-medium">Put them on the cards</h3>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          The model weighs every tag you kept against each card&apos;s full text and says why for each one it applies,
          then checks each tag across the deck. Tags you put on or took off by hand are never changed.
        </p>
        {mode === 'claude' && tagModel && (
          <p className="text-sm">
            About <span className="font-semibold">{dollars(tagRunCost(tagModel, { deck: cards.length, cards: targetCount, tags: useTags.length, audit, mode }))}</span>
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
        <div data-tour="tag-scope" className="flex flex-wrap gap-6 text-sm">
          <fieldset className="flex min-w-0 flex-[1_1_18rem] flex-col gap-1.5" disabled={running}>
            <legend className="mb-1 font-medium">Which cards</legend>
            {([
              ['all', `The whole deck (${cards.length})`, 'Redoes the model\'s earlier tags; yours are kept'],
              ['untagged', `Cards with no tags yet (${untagged.length})`, ''],
              ['missing', 'Cards without a tag', ''],
              ['picked', `Cards I pick${picked.size ? ` (${picked.size})` : ''}`, ''],
            ] as const).map(([v, label, note]) => (
              <label key={v} className="flex items-start gap-2">
                <input type="radio" name={`scope-${listId}`} checked={scope === v} onChange={() => setScope(v)} className="mt-1" />
                <span>{label}{note && <span className="block text-xs text-[var(--muted)]">{note}</span>}</span>
              </label>
            ))}
            {scope === 'missing' && (
              <label className="ml-6 flex items-center gap-2">
                <span className="text-[var(--muted)]">without</span>
                <select value={lacking} onChange={(e) => setMissingTag(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
                  {accepted.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <span className="text-[var(--muted)]">· {missingCount} cards</span>
              </label>
            )}
            {scope === 'picked' && (
              <div className="ml-6 flex flex-col gap-1.5">
                <input value={pickFilter} onChange={(e) => setPickFilter(e.target.value)} placeholder="Filter by name" aria-label="Filter cards"
                  className="w-56 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1" />
                <ul className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] p-1">
                  {cards.filter((e) => e.card.name.toLowerCase().includes(pickFilter.toLowerCase())).map((e) => {
                    const k = tagKey(e.card);
                    return (
                      <li key={k}>
                        <label className="flex items-center gap-2 rounded px-1.5 py-0.5 hover:bg-[var(--surface-hover)]">
                          <input type="checkbox" checked={picked.has(k)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                          {e.card.name}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </fieldset>
          <fieldset className="flex min-w-0 flex-[1_1_18rem] flex-col gap-1.5" disabled={running}>
            <legend className="mb-1 font-medium">Which tags</legend>
            <label className="flex items-center gap-2"><input type="radio" name={`tags-${listId}`} checked={!onlyTags} onChange={() => setOnlyTags(null)} /> All {accepted.length} of my tags</label>
            <label className="flex items-center gap-2"><input type="radio" name={`tags-${listId}`} checked={!!onlyTags} onChange={() => setOnlyTags(new Set(accepted.slice(0, 1).map((t) => t.id)))} /> Only these:</label>
            {onlyTags && (
              <div className="ml-6 flex flex-wrap gap-1.5">
                {accepted.map((t) => (
                  <button key={t.id} type="button" aria-pressed={onlyTags.has(t.id)}
                    onClick={() => setOnlyTags((o) => { const n = new Set(o ?? []); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${onlyTags.has(t.id) ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] text-[var(--muted)]'}`}>
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-[var(--muted)]">Ramp, removal and the other built-in tags come from Scryfall for free, so the tagger leaves them alone.</p>
          </fieldset>
        </div>
        <label className="flex max-w-3xl flex-col gap-1 text-sm">
          Your instructions <span className="text-xs text-[var(--muted)]">(optional, for this run)</span>
          <textarea value={runInstructions} onChange={(e) => setRunInstructions(e.target.value)} rows={2} maxLength={2000} disabled={running}
            placeholder="e.g. Only call something a Wheel if every player gets a new hand."
            className="resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 outline-none focus:border-[var(--accent)]" />
        </label>
        <div className="flex flex-col gap-1.5 text-sm">
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={audit} onChange={(e) => setAudit(e.target.checked)} disabled={running} />
            Then double-check each tag across the whole deck for misses and mistakes
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={tagCards}
            disabled={running || proposing || !useTags.length || !targetCount}
            className={primary}
          >
            Tag {targetCount} card{targetCount === 1 ? '' : 's'} with {useTags.length} tag{useTags.length === 1 ? '' : 's'}
          </button>
          <Tip label="What Claude reads"><span className="font-semibold">What Claude reads:</span><ul className="mt-1 list-disc pl-4">{AI_READS.tagCards.map((x) => <li key={x}>{x}</li>)}</ul></Tip>
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
    <section data-tour="basic-roles" className="flex max-w-3xl flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 data-section="Built-in tags" className="font-medium">Built-in tags <span className="text-sm font-normal text-emerald-400">· automatic, free</span></h3>
        <span className="text-xs text-[var(--muted)]">From Scryfall&apos;s card tags · Check has the full table</span>
      </div>
      {roles === 'loading' && <p className="text-sm text-[var(--muted)]">Reading the cards&apos; built-in tags… the first time takes up to a minute.</p>}
      {roles === 'failed' && <p className="text-sm text-[var(--muted)]">Couldn&apos;t reach Scryfall for the built-in tags just now.</p>}
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
    // The model chip carries the price and what is left; this speaks up only when the day's budget runs low.
    if (s.left >= 1) return null;
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
