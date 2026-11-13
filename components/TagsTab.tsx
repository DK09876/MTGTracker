'use client';

/**
 * The Tags tab: the jobs the app counts (tiles with their counts), then
 * "Your groups" (ways to win, key cards, the owner's own, AI's and tags from
 * the card data, each marked with who added it), then two folded rows:
 * "More from your cards" (no AI) and "Refine with AI" (optional, after the
 * plan is confirmed). Nothing is added until the owner accepts it.
 * lib/tags-tab.ts holds the rules.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { C, CardChip, CardPick, MARK, RemoveButton, useUndo } from './PlanTab';
import Tip from './Tip';
import SymbolText from './SymbolText';
import * as api from '@/lib/api';
import { price } from '@/lib/price';
import type { Category } from '@/lib/categories-shared';
import type { AiRow, TagRow, TagsView } from '@/lib/tags-tab-shared';

interface Props {
  listId: string;
  version: string;
  onTab: (tab: 'plan' | 'tune') => void;
}

const H2 = ({ n, children, extra }: { n?: number; children: React.ReactNode; extra?: React.ReactNode }) => (
  <h2 className="break-words font-display text-[19px] font-bold">
    {n !== undefined && <span className="mr-2 text-[13px] font-semibold text-[var(--muted)]">{n}</span>}
    {children}
    {extra && <span className="ml-2 font-sans text-[13px] font-normal text-[var(--muted)]">{extra}</span>}
  </h2>
);

export default function TagsTab({ listId, version, onTab }: Props) {
  const [v, setV] = useState<TagsView | null>(() => api.peek<TagsView>(api.categoriesPath(listId)) ?? null);
  const [error, setError] = useState<string | null>(null);
  // Saves run one after another and nothing is disabled meanwhile (see PlanTab): a double tap on the same thing is dropped.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState(0);
  const busy = false;
  const { setUndo, bar: undoBar } = useUndo();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [more, setMore] = useState(false);
  const [filter, setFilter] = useState<string[]>([]);
  const [filterText, setFilterText] = useState('');
  const [sort, setSort] = useState<'plan' | 'az' | 'size'>('plan');
  const [catName, setCatName] = useState('');
  const [adding, setAdding] = useState(false);
  const [allGroups, setAllGroups] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  // The two optional parts sit folded; a deck with nothing on it opens "More from your cards".
  const [fold, setFold] = useState<{ cards?: boolean; ai?: boolean }>({});

  const load = useCallback(() => api.tagsTab(listId).then(setV).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the tags')), [listId]);
  useEffect(() => { void load(); }, [load, version]);
  const running = v?.ai.job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void load(); }, 2500);
    return () => clearInterval(t);
  }, [running, load]);

  if (!v) return error ? <p className="mt-8 text-center text-red-400">{error}</p> : <p className="mt-8 text-center text-[var(--muted)]">Reading the tags…</p>;

  const act = (a: Record<string, unknown>) => {
    const key = JSON.stringify(a);
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setPending((n) => n + 1);
    queue.current = queue.current.then(async () => {
      setError(null);
      try { setV(await api.tagsTabAct(listId, a)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save that'); }
    }).finally(() => { inFlight.current.delete(key); setPending((n) => n - 1); });
  };
  const takeOut = (c: Category, x: { name: string; by: string }) => {
    act({ action: 'card', id: c.id, name: x.name, on: false });
    setUndo({ text: `${x.name} taken out of ${c.name}.`, run: () => act({ action: 'card', id: c.id, name: x.name, undo: true, by: x.by }) });
  };
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const shown = v.categories.filter((c) => c.kind !== 'key' || c.cards.length);
  const jobs = shown.filter((c) => c.kind === 'job');
  const groups = shown.filter((c) => c.kind !== 'job');
  const order = (c: Category) => (c.kind === 'win' ? 0 : c.kind === 'key' ? 1 : c.kind === 'own' && c.by === 'owner' ? 2 : c.kind === 'own' ? 3 : 4);
  const filtered = groups.filter((c) => !filter.length || c.cards.some((x) => filter.includes(x.name)))
    .sort((a, b) => (sort === 'size' ? b.cards.length - a.cards.length : sort === 'plan' ? order(a) - order(b) : 0) || a.name.localeCompare(b.name));
  const FIRST = 8;
  const listed = allGroups || filter.length ? filtered : filtered.slice(0, FIRST);
  const openJob = jobs.find((c) => c.id === job) ?? null;
  // Opened by the page (nothing from the cards or of the owner's on the deck yet, or AI rows waiting) means it stays open until the owner folds it.
  if (fold.cards === undefined && !shown.some((c) => c.kind === 'job' || c.kind === 'tag' || c.kind === 'own')) setFold((f) => ({ ...f, cards: true }));
  if (fold.ai === undefined && (v.ai.rows.length > 0 || running)) setFold((f) => ({ ...f, ai: true }));
  const cardsOpen = !!fold.cards;
  const aiOpen = !!fold.ai;
  const s1 = v.step1;
  // The jobs suggestion shows in the Jobs section, so it is not counted here.
  const step1Open = s1.open - (s1.jobs && !s1.jobs.skipped ? 1 : 0);
  const visibleTags = more ? [...s1.tags, ...s1.more] : s1.tags;
  const acceptShown = visibleTags.map((t) => t.key);
  const comboCount = s1.combos.length;
  const keyCount = s1.comboKeys.length;
  const combosLabel = [comboCount ? `${comboCount} ${comboCount === 1 ? 'combo' : 'combos'} found in the deck` : '', keyCount ? `${keyCount} key ${keyCount === 1 ? 'card' : 'cards'} several combos share` : ''].filter(Boolean).join(', and ');
  const aiOff = !v.hasKey || !v.confirmed || running || pending > 0;
  const aiNote = !v.hasKey ? 'Needs a Claude key on the server. Step 1 works without one.'
    : !v.confirmed ? 'AI reads your confirmed plan, so confirm the plan first.'
      : step1Open > 0 ? `Best after “More from your cards”: AI works with what is on the deck. ${step1Open} still to look at there.` : 'AI has your choices to work with.';
  const pickFilter = (text: string) => {
    const hit = v.cardNames.find((n) => n.toLowerCase() === text.trim().toLowerCase());
    if (hit) { if (!filter.includes(hit)) setFilter([...filter, hit]); setFilterText(''); } else setFilterText(text);
  };

  return (
    <div className="mt-4 flex flex-col gap-4 pb-4">
      <p className="flex flex-wrap items-center gap-2 text-[var(--muted)]">{shown.length ? 'Groups of cards in this deck. Optional: Tune works without them.' : 'Nothing is grouped on this deck yet. Optional: Tune works without it.'}
        <Tip label="About this tab">Jobs are counted and checked against a usual range. Your groups are ways to win, key cards, groups you or AI named, and tags from the card data. A card can be in several. Open any one to see its cards, take one out, or add one.</Tip></p>
      {error && <p role="alert" className="rounded-xl border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <section data-tour="tags-on-deck" data-section="Jobs" data-section-count={String(jobs.length)} className={`${C.sec} flex flex-col gap-3`}>
        <h2 className="flex flex-wrap items-center gap-2 font-display text-[19px] font-bold">Jobs the app counts
          <Tip label="About jobs">Ramp, card draw, interaction, board wipes, protection and finishers: counted from the card data and checked against a usual range for the deck. Open one to see its cards, add one, or stop counting it.</Tip></h2>
        {jobs.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {jobs.map((c) => (
              <button key={c.id} type="button" aria-expanded={job === c.id} onClick={() => setJob(job === c.id ? null : c.id)}
                className={`flex min-h-14 flex-col justify-center rounded-xl border px-3 py-1.5 text-left hover:bg-[var(--surface-hover)] ${job === c.id ? 'border-[#d6aa2e] bg-[#1f1a10]' : 'border-[var(--border)] bg-[var(--background)]'}`}>
                <b className="text-sm">{c.name}</b>
                {(() => {
                  // The same number and aim the Cards tab shows; the card list (and its count) is in the opened job.
                  const n = c.jobId ? v.jobNumbers[c.jobId] : undefined;
                  if (!n) return <span className="text-[13px] tabular-nums text-[var(--muted)]">{c.cards.length} {c.cards.length === 1 ? 'card' : 'cards'}</span>;
                  return (
                    <span className="text-[13px] tabular-nums">
                      {/* In range green, outside its aim amber, a hard failure (no draw at 90+) amber too. */}
                      <b data-range={!n.range ? 'none' : n.count < n.range[0] || n.count > n.range[1] ? 'out' : 'in'}
                        className={`font-semibold ${n.warn || (n.range && (n.count < n.range[0] || n.count > n.range[1])) ? 'text-amber-300' : n.range ? 'text-[#9bdcae]' : 'text-[var(--foreground)]'}`}>{n.count}</b>
                      {n.range && <span className="text-[var(--muted)]"> aim {n.range[0]}–{n.range[1]}</span>}
                    </span>
                  );
                })()}
              </button>
            ))}
          </div>
        ) : s1.jobs && !s1.jobs.skipped ? (
          <SugRow title={s1.jobs.all ? 'Count the six jobs most decks track' : 'Jobs not on this deck'} meta={s1.jobs.missing.map((j) => j.label).join(' · ')}
            why="Each is counted and checked against a usual range once accepted. Remove any you do not want afterwards." busy={busy}
            onAccept={() => act({ action: 'accept', keys: ['jobs'] })} onSkip={() => act({ action: 'skip', key: 'jobs' })} />
        ) : null}
        {s1.jobs && (jobs.length > 0 && !s1.jobs.skipped ? (
          <SugRow title="Jobs not on this deck" meta={s1.jobs.missing.map((j) => j.label).join(' · ')} busy={busy}
            onAccept={() => act({ action: 'accept', keys: ['jobs'] })} onSkip={() => act({ action: 'skip', key: 'jobs' })} />
        ) : s1.jobs.skipped && (
          // Skipped: no longer a suggestion, but the jobs can always be added from here.
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--border)] pt-2 text-sm">
            <span className="min-w-0 flex-[1_1_16rem] text-[var(--muted)]">{jobs.length ? `Not counted: ${s1.jobs.missing.map((j) => j.label).join(', ')}.` : 'No jobs counted on this deck.'}</span>
            <button type="button" className={C.btn} disabled={busy} onClick={() => act({ action: 'accept', keys: ['jobs'] })}>
              {s1.jobs.all ? 'Count the six jobs' : s1.jobs.missing.length === 1 ? `Count ${s1.jobs.missing[0].label}` : `Count these ${s1.jobs.missing.length}`}
            </button>
          </div>
        ))}
        {openJob && <CatRow c={openJob} all={v.categories} names={v.cardNames} open onToggle={() => setJob(null)} filter={[]} act={act} takeOut={takeOut} />}
      </section>

      <section data-section="Your groups" data-section-count={String(groups.length)} className={`${C.sec} flex flex-col gap-2`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-display text-[19px] font-bold">Your groups</h2>
          <span className="text-[13px] tabular-nums text-[var(--muted)]">{groups.length || 'none yet'}</span>
          <span className="ml-auto" />
          <button type="button" className={C.btn} aria-expanded={adding} onClick={() => setAdding(!adding)}>+ New group</button>
        </div>
        {adding && (
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (catName.trim()) { void act({ action: 'add', name: catName.trim() }); setCatName(''); setAdding(false); } }}>
            <input autoFocus aria-label="Name a new group" value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="e.g. Pet cards" className={`${C.input} flex-[1_1_14rem]`} />
            <button type="submit" className={C.btn} disabled={busy || !catName.trim()}>Add</button>
          </form>
        )}
        {groups.length >= 6 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--muted)]">Filter by card</span>
            {filter.map((n) => <CardChip key={n} name={n} label={`Stop filtering by ${n}`} onRemove={() => setFilter(filter.filter((x) => x !== n))} />)}
            <input list={`deck-cards-${listId}`} aria-label="Type a card name to filter by" value={filterText} onChange={(e) => pickFilter(e.target.value)} placeholder={filter.length ? 'Add another card…' : 'Type a card name…'} className={`${C.input} w-full flex-[1_1_12rem] sm:max-w-[18rem]`} />
            <datalist id={`deck-cards-${listId}`}>{v.cardNames.map((n) => <option key={n} value={n} />)}</datalist>
            {filter.length > 0 && <button type="button" className={C.btn} onClick={() => { setFilter([]); setFilterText(''); }}>Clear</button>}
            {filter.length > 0 && <span className="flex-[1_1_8rem] text-[13px] text-[var(--muted)]">Showing {filtered.length} of {groups.length} {filter.length > 1 ? 'that have at least one of these' : 'that have it'}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-sm text-[var(--muted)]">Sort</span>
              {([['plan', 'Plan first'], ['az', 'A to Z'], ['size', 'Most cards']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={`${C.pill} ${sort === k ? C.on : C.off}`}>{l}</button>)}
            </span>
          </div>
        )}
        {!groups.length && <p className="text-sm text-[var(--muted)]">Nothing yet. Add a way to win on the Plan tab, accept something from your cards below, or name a group of your own.</p>}
        <div className="grid gap-x-8 xl:grid-cols-2 xl:items-start">
          {listed.map((c) => <CatRow key={c.id} c={c} all={v.categories} names={v.cardNames} open={!!open[`cat:${c.id}`]} onToggle={() => toggle(`cat:${c.id}`)} filter={filter} act={act} takeOut={takeOut} />)}
        </div>
        {!filter.length && filtered.length > FIRST && (
          <button type="button" aria-expanded={allGroups} onClick={() => setAllGroups(!allGroups)} className="flex min-h-11 items-center border-t border-[var(--border)] text-left text-sm font-semibold text-[#e8c558] hover:text-[#f3d77a]">
            {allGroups ? 'Show fewer' : `Show all ${filtered.length} ›`}
          </button>
        )}
      </section>

      {cardsOpen && <section id="t-cards" data-section="More from your cards" data-section-count={step1Open ? String(step1Open) : 'done'} className={`${C.sec} flex flex-col gap-2`}>
        <div className="flex items-start justify-between gap-2"><H2 extra={step1Open ? `${step1Open} to look at` : 'done'}>More from your cards</H2><button type="button" aria-expanded className={C.btn} onClick={() => setFold({ ...fold, cards: false })}>Fold</button></div>
        <p className="text-sm text-[var(--muted)]">Groups that come with the cards in this deck. No AI, and nothing is added until you accept it.</p>
        {step1Open === 0 && <p className="flex flex-wrap gap-2 text-sm"><span className="font-semibold text-[#9bdcae]">Nothing left to look at.</span><span className="text-[var(--muted)]">Anything you skipped comes back if you refresh.</span></p>}
        {(visibleTags.length > 0 || s1.more.length > 0 || comboCount + keyCount > 0) && (
          <div className={`${C.cardsBox} flex flex-col gap-2`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`font-bold ${C.cards}`}>Suggested from your cards <Tip label="How these are found">Every tag the card data gives this deck’s non-land cards, kept when it is on two or more of them, is not trivia, and is at least three times more common here than across all cards. Ranked by how many cards have it and how unusual it is here; a tag that is nearly the same cards as a stronger one, or as one of the six jobs, is left out.</Tip></span>
              <span className="flex flex-wrap gap-2">
                {s1.more.length > 0 && <button type="button" className={C.btn} aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Show only the top 5' : `Show ${s1.more.length} more`}</button>}
                {acceptShown.length > 1 && <button type="button" className={C.btn} disabled={busy} onClick={() => act({ action: 'accept', keys: acceptShown })}>{s1.more.length && !more ? 'Accept all shown' : 'Accept all'}</button>}
              </span>
            </div>
            <p className="text-[13px] text-[var(--muted)]">Accepted tags stay live: a card you add later that has the tag joins by itself.</p>
            {visibleTags.map((t) => <TagSug key={t.key} t={t} open={!!open[`sug:${t.key}`]} onToggle={() => toggle(`sug:${t.key}`)} busy={busy} act={act} />)}
            {comboCount + keyCount > 0 && (
              <details className="border-t border-[var(--border)] pt-1">
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">{combosLabel}</summary>
                <p className="pb-1.5 text-[13px] text-[var(--muted)]">Accepting a combo says you mean to win that way, so it also shows on the Plan tab as a way to win.</p>
                {s1.combos.map((c) => <SugRow key={c.key} title={c.title} meta={c.result} busy={busy} onAccept={() => act({ action: 'accept', keys: [c.key] })} onSkip={() => act({ action: 'skip', key: c.key })} />)}
                {s1.comboKeys.map((k) => <SugRow key={k.key} title={`Key cards: add ${k.name}`} meta={`In ${k.count} of the combos found in the deck`} busy={busy} onAccept={() => act({ action: 'accept', keys: [k.key] })} onSkip={() => act({ action: 'skip', key: k.key })} />)}
              </details>
            )}
          </div>
        )}
        <div><button type="button" className={C.btn} disabled={busy} onClick={() => act({ action: 'refresh' })}>Refresh</button></div>
      </section>}

      {aiOpen && <section id="t-ai" data-section="✦ Refine with AI" className={`${C.sec} flex flex-col gap-2`}>
        <div className="flex items-start justify-between gap-2"><H2 extra="optional">Refine with AI</H2><button type="button" aria-expanded className={C.btn} onClick={() => setFold({ ...fold, ai: false })}>Fold</button></div>
        <p className="text-sm text-[var(--muted)]">AI suggests cards to add to your groups or take out of them, then anything new the plan depends on. Tune’s ranking of cuts doesn’t use groups; Tune’s AI reads them as a description of the deck, never as a reason to keep a card.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={step1Open === 0 ? C.aiBtn : C.btn} disabled={aiOff} onClick={() => act({ action: 'ai' })}>
            {running ? 'AI is reading the deck…' : `${v.ai.ran ? '✦ Ask AI again' : '✦ Refine with AI'} · Claude Opus · ${price(v.ai.cost)}`}
          </button>
          <Tip label="What AI reads">The plan as you confirmed it, with who set each part; every category on this deck with its cards and who added each; what you removed or skipped before; and the deck’s facts (every card with its rules text). One call to Claude Opus.</Tip>
          <span className="flex-[1_1_14rem] text-[13px] text-[var(--muted)]">{running ? v.ai.job?.progress ?? 'Working…' : aiNote}</span>
        </div>
        {v.ai.job?.error && <p role="alert" className="text-[13px] text-red-300">{v.ai.job.error}</p>}
        {v.ai.ran && !v.ai.rows.length && !running && <p className="text-sm text-[var(--muted)]">Nothing new to suggest: the categories on this deck already match what AI would do.</p>}
        {v.ai.rows.length > 0 && (
          <div className={`${C.aiBox} flex flex-col gap-2`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`font-bold ${C.ai}`}>✦ Suggested by AI</span>
              {v.ai.rows.length > 1 && <button type="button" className={C.btn} disabled={busy} onClick={() => act({ action: 'accept', keys: v.ai.rows.map((r) => r.key) })}>Accept all</button>}
            </div>
            {v.ai.notes && <p className="text-[13px] text-[var(--muted)]"><SymbolText text={v.ai.notes} /></p>}
            {v.ai.rows.map((r) => <AiSug key={r.key} r={r} busy={busy} act={act} />)}
          </div>
        )}
      </section>}

      {(!cardsOpen || !aiOpen) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {!cardsOpen && (
            <button type="button" aria-expanded={false} data-section="More from your cards" data-section-count={step1Open ? String(step1Open) : 'done'} onClick={() => setFold({ ...fold, cards: true })}
              className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-[#8cc0ee]/70 bg-[#0f1a22] px-4 text-left hover:brightness-125">
              <span><b className={C.cards}>More from your cards</b> <span className="text-[var(--muted)]">· {step1Open ? `${step1Open} ${step1Open === 1 ? 'suggestion' : 'suggestions'}` : 'nothing new'}</span></span>
              <span aria-hidden className={C.cards}>▸</span>
            </button>
          )}
          {!aiOpen && (
            <button type="button" aria-expanded={false} data-section="✦ Refine with AI" onClick={() => setFold({ ...fold, ai: true })}
              className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-[#a98bd0] bg-[#1c1723] px-4 text-left hover:brightness-125">
              <span><b className={C.ai}>✦ Refine with AI</b> <span className="text-[var(--muted)]">· optional</span></span>
              <span aria-hidden className={C.ai}>▸</span>
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-[var(--muted)]">{v.confirmed ? 'Tags are optional. Tune is open either way.' : 'Tags are optional.'}</span>
        <button type="button" className={C.go} onClick={() => onTab(v.confirmed ? 'tune' : 'plan')}>{v.confirmed ? 'Next: Tune' : 'Back to Plan'}</button>
      </div>
      {undoBar}
    </div>
  );
}

function SugRow({ title, meta, why, busy, onAccept, onSkip, children }: { title: string; meta?: string; why?: string; busy: boolean; onAccept: () => void; onSkip: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-[var(--border)] pt-2" data-suggestion>
      <div className="min-w-0 flex-[1_1_18rem]">
        <b className="break-words">{title}</b> {meta && <span className="text-[13px] text-[var(--muted)]">{meta}</span>}
        {why && <p className="text-sm text-[var(--muted)]"><SymbolText text={why} /></p>}
        {children}
      </div>
      <div className="flex gap-2">
        <button type="button" className={C.btn} disabled={busy} aria-label={`Accept: ${title}`} onClick={onAccept}>Accept</button>
        <button type="button" className={C.btn} disabled={busy} aria-label={`Skip: ${title}`} onClick={onSkip}>Skip</button>
      </div>
    </div>
  );
}

function TagSug({ t, open, onToggle, busy, act }: { t: TagRow; open: boolean; onToggle: () => void; busy: boolean; act: (a: Record<string, unknown>) => void }) {
  return (
    <SugRow title={t.name} meta={`${t.cards.length} cards`} busy={busy} onAccept={() => act({ action: 'accept', keys: [t.key] })} onSkip={() => act({ action: 'skip', key: t.key })}>
      {!open && <p className="text-[13px] text-[var(--muted)]">{t.cards.slice(0, 3).join(', ')}{t.cards.length > 3 ? ', …' : ''}</p>}
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
        <span aria-hidden className={C.cards}>{open ? '▾' : '▸'}</span> {open ? 'Hide the cards' : `See all ${t.cards.length} cards`}
      </button>
      {open && <p className="text-sm text-[var(--muted)]">{t.cards.join('  ·  ')}</p>}
    </SugRow>
  );
}

function AiSug({ r, busy, act }: { r: AiRow; busy: boolean; act: (a: Record<string, unknown>) => void }) {
  const title = r.kind === 'new' ? r.category : `${r.category}: ${r.kind === 'add' ? 'add' : 'remove'} ${r.card}`;
  return (
    <SugRow title={title} meta={r.kind === 'new' ? 'New category' : undefined} why={r.why} busy={busy} onAccept={() => act({ action: 'accept', keys: [r.key] })} onSkip={() => act({ action: 'skip', key: r.key })}>
      {r.kind === 'new' && r.cards && <p className="text-[13px] text-[var(--muted)]">{r.cards.slice(0, 8).join(', ')}{r.cards.length > 8 ? `, and ${r.cards.length - 8} more` : ''}</p>}
    </SugRow>
  );
}

const KIND: Record<Category['kind'], [string, string]> = {
  job: ['job · counted', 'text-emerald-300'],
  tag: ['from the cards', C.cards],
  win: ['way to win', C.yours],
  key: ['key cards', C.yours],
  own: ['group', 'text-[var(--muted)]'],
};

/** One category: a compact row that opens to its cards, a picker, rename, what was merged in, and Merge into. */
function CatRow({ c, all, names, open, onToggle, filter, act, takeOut }: { c: Category; all: Category[]; names: string[]; open: boolean; onToggle: () => void; filter: string[]; act: (a: Record<string, unknown>) => void; takeOut: (c: Category, x: { name: string; by: string }) => void }) {
  const [edit, setEdit] = useState<{ name: string; how: string } | null>(null);
  // One label: what it is for ways to win and key cards, who added it for groups, blue for the card data.
  const who = c.kind === 'own' ? MARK[c.by] : c.kind === 'win' && c.by === 'ai' ? MARK.ai : null;
  const has = filter.length ? c.cards.filter((x) => filter.includes(x.name)).map((x) => x.name) : [];
  // Jobs, ways to win and key cards are never merged away; anything can take another in.
  const mergeable = c.kind === 'own' || c.kind === 'tag';
  const targets = all.filter((x) => x.id !== c.id).sort((a, b) => a.name.localeCompare(b.name));
  const removeWhat = c.kind === 'job' ? 'Stop counting this job' : c.kind === 'key' ? 'Empty the key cards' : c.kind === 'win' ? 'Remove this way to win' : 'Remove this category';
  const kind = c.kind === 'own' ? null : KIND[c.kind];
  return (
    <div className="flex items-start gap-1 border-t border-[var(--border)] py-1">
      <div className="min-w-0 flex-1">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-11 w-full flex-wrap items-center gap-x-2 text-left">
          <span aria-hidden className={C.cards}>{open ? '▾' : '▸'}</span>
          <b className="min-w-0 break-words">{c.name}</b>
          {kind && <span className={`text-[11px] font-bold ${kind[1]}`}>{kind[0]}</span>}
          <span className="text-[13px] text-[var(--muted)]">{c.cards.length} {c.cards.length === 1 ? 'card' : 'cards'}</span>
          {who && <span className={`text-[11px] font-bold ${who[1]}`}>{who[0]}</span>}
          {has.length > 0 && <span className={`text-[11px] font-bold ${C.yours}`}>has {has.join(', ')}</span>}
        </button>
        {open && (
          <div className="flex flex-col gap-2 pb-2 pl-5">
            {edit ? (
              <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (edit.name.trim()) { act({ action: 'edit', id: c.id, name: edit.name.trim(), how: edit.how }); setEdit(null); } }}>
                <input aria-label={`Name of ${c.name}`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={`${C.input} w-full`} />
                <input aria-label={`What ${c.name} is for`} value={edit.how} onChange={(e) => setEdit({ ...edit, how: e.target.value })} placeholder="What this group is for, in a line (optional)" className={`${C.input} w-full`} />
                <span className="flex gap-2"><button type="submit" className={C.btn} disabled={!edit.name.trim()}>Save</button><button type="button" className={C.btn} onClick={() => setEdit(null)}>Cancel</button></span>
              </form>
            ) : (
              <div className="flex flex-wrap items-start gap-2">
                <p className="min-w-0 flex-[1_1_14rem] text-[13px] text-[var(--muted)]">{c.how || (c.kind === 'own' ? 'No description yet.' : '')}</p>
                {(c.kind === 'own' || c.kind === 'win' || c.kind === 'tag') && <button type="button" className="min-h-11 rounded-xl px-2.5 text-[13px] font-semibold text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]" onClick={() => setEdit({ name: c.name, how: c.how })}>Rename or describe</button>}
              </div>
            )}
            {c.gone.length > 0 && <p className={`text-[13px] ${C.yours}`}>Look again: {c.gone.join(', ')} left the deck.</p>}
            <div className="flex flex-wrap items-center gap-2">
              {c.cards.map((x) => <CardChip key={x.key} name={x.name} by={x.by === 'cards' ? undefined : x.by} label={`Remove ${x.name} from ${c.name}`} onRemove={() => takeOut(c, x)} />)}
              <CardPick names={names} label={`Add a card to ${c.name}`} skip={c.cards.map((x) => x.name)} onPick={(n) => act({ action: 'card', id: c.id, name: n, on: true })} />
            </div>
            {!c.cards.length && <p className="text-[13px] text-[var(--muted)]">No cards yet.</p>}
            {c.out.length > 0 && <p className="text-[13px] text-[var(--muted)]">Taken out by you: {c.out.map((x) => x.name).join(', ')}</p>}
            {c.madeOf.length > 0 && <p className="text-[13px] text-[var(--muted)]">Includes what was merged in: {c.madeOf.join(', ')}</p>}
            {mergeable && targets.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label={`Merge ${c.name} into another category`} value="" onChange={(e) => { if (e.target.value) act({ action: 'merge', id: c.id, into: e.target.value }); }} className={`${C.input} max-w-full sm:max-w-[16rem]`}>
                  <option value="">Merge into…</option>
                  {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <span className="text-[13px] text-[var(--muted)]">Moves these cards into the other category and removes this one.</span>
              </div>
            )}
          </div>
        )}
      </div>
      <RemoveButton label={`Remove ${c.name}`} what={removeWhat} text={c.kind === 'key' ? 'Empty' : 'Remove'} onRemove={() => act({ action: 'remove', id: c.id })} />
    </div>
  );
}
