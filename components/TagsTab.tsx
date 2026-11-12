'use client';

/**
 * The Tags tab: "On this deck" (every category: jobs, tags from the card
 * data, ways to win, key cards, the owner's own and AI's), then
 * "1 · From your cards" (no AI, shown as soon as the tab opens) and
 * "2 · Refine with AI" (optional, after the plan is confirmed). A deck starts
 * with nothing on it; nothing is added until the owner accepts it.
 * lib/tags-tab.ts holds the rules.
 */

import { useCallback, useEffect, useState } from 'react';

import { C, CardChip, CardPick, MARK, PlanStatusLine, usePlanState } from './PlanTab';
import Tip from './Tip';
import * as api from '@/lib/api';
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
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [more, setMore] = useState(false);
  const [filter, setFilter] = useState<string[]>([]);
  const [filterText, setFilterText] = useState('');
  const [sort, setSort] = useState<'az' | 'size'>('az');
  const [catName, setCatName] = useState('');
  const plan = usePlanState(listId, version);

  const load = useCallback(() => api.tagsTab(listId).then(setV).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the tags')), [listId]);
  useEffect(() => { void load(); }, [load, version]);
  const running = v?.ai.job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void load(); }, 2500);
    return () => clearInterval(t);
  }, [running, load]);

  if (!v) return error ? <p className="mt-8 text-center text-red-400">{error}</p> : <p className="mt-8 text-center text-[var(--muted)]">Reading the tags…</p>;

  const act = async (a: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try { setV(await api.tagsTabAct(listId, a)); void plan.load(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save that'); } finally { setBusy(false); }
  };
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const shown = v.categories.filter((c) => c.kind !== 'key' || c.cards.length);
  const filtered = shown.filter((c) => !filter.length || c.cards.some((x) => filter.includes(x.name)))
    .sort((a, b) => (sort === 'size' ? b.cards.length - a.cards.length : 0) || a.name.localeCompare(b.name));
  const s1 = v.step1;
  const step1Open = s1.open;
  const visibleTags = more ? [...s1.tags, ...s1.more] : s1.tags;
  const acceptShown = [...(s1.jobs ? [s1.jobs.key] : []), ...visibleTags.map((t) => t.key)];
  const comboCount = s1.combos.length;
  const keyCount = s1.comboKeys.length;
  const combosLabel = [comboCount ? `${comboCount} ${comboCount === 1 ? 'combo' : 'combos'} found in the deck` : '', keyCount ? `${keyCount} key ${keyCount === 1 ? 'card' : 'cards'} several combos share` : ''].filter(Boolean).join(', and ');
  const aiOff = !v.hasKey || !v.confirmed || running || busy;
  const aiNote = !v.hasKey ? 'Needs a Claude key on the server. Step 1 works without one.'
    : !v.confirmed ? 'AI reads your confirmed plan, so confirm the plan first.'
      : step1Open > 0 ? `Best after step 1: AI works with what is on the deck. ${step1Open} still to look at there.` : 'Step 1 is done, so AI has your choices to work with.';
  const pickFilter = (text: string) => {
    const hit = v.cardNames.find((n) => n.toLowerCase() === text.trim().toLowerCase());
    if (hit) { if (!filter.includes(hit)) setFilter([...filter, hit]); setFilterText(''); } else setFilterText(text);
  };

  return (
    <div className="mt-4 flex flex-col gap-4 pb-4">
      <PlanStatusLine state={plan.state} />
      <p className="text-[var(--muted)]">This deck starts with no tags and no categories. Accept only what fits it from the suggestions below, or name your own. A card can be in several. Open any row to see its cards, take one out, or add one.</p>
      {error && <p role="alert" className="rounded-xl border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <section data-tour="tags-on-deck" data-section="On this deck" data-section-count={String(shown.length)} className={`${C.sec} flex flex-col gap-2`}>
        <H2 extra={shown.length ? `${shown.length} ${shown.length === 1 ? 'category' : 'categories'}` : 'nothing yet'}>On this deck</H2>
        {shown.length >= 6 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--muted)]">Filter by card</span>
            {filter.map((n) => <CardChip key={n} name={n} label={`Stop filtering by ${n}`} onRemove={() => setFilter(filter.filter((x) => x !== n))} />)}
            <input list={`deck-cards-${listId}`} aria-label="Type a card name to filter by" value={filterText} onChange={(e) => pickFilter(e.target.value)} placeholder={filter.length ? 'Add another card…' : 'Type a card name…'} className={`${C.input} w-full flex-[1_1_12rem] sm:max-w-[18rem]`} />
            <datalist id={`deck-cards-${listId}`}>{v.cardNames.map((n) => <option key={n} value={n} />)}</datalist>
            {filter.length > 0 && <button type="button" className={C.btn} onClick={() => { setFilter([]); setFilterText(''); }}>Clear</button>}
            {filter.length > 0 && <span className="flex-[1_1_8rem] text-[13px] text-[var(--muted)]">Showing {filtered.length} of {shown.length} {filter.length > 1 ? 'that have at least one of these' : 'that have it'}</span>}
            <span className="ml-auto flex items-center gap-2">
              <span className="text-sm text-[var(--muted)]">Sort</span>
              {([['az', 'A to Z'], ['size', 'Most cards']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)} className={`${C.pill} ${sort === k ? C.on : C.off}`}>{l}</button>)}
            </span>
          </div>
        )}
        {!shown.length && <p className="text-sm text-[var(--muted)]">Nothing yet. Accept what fits from the suggestions below, or name a category of your own.</p>}
        <div className="flex flex-col">
          {filtered.map((c) => <CatRow key={c.id} c={c} all={v.categories} names={v.cardNames} open={!!open[`cat:${c.id}`]} onToggle={() => toggle(`cat:${c.id}`)} filter={filter} busy={busy} act={act} />)}
        </div>
        <form className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-2.5" onSubmit={(e) => { e.preventDefault(); if (catName.trim()) { void act({ action: 'add', name: catName.trim() }); setCatName(''); } }}>
          <input aria-label="Name a new category" value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Your own category, e.g. Pet cards" className={`${C.input} flex-[1_1_14rem]`} />
          <button type="submit" className={C.btn} disabled={busy || !catName.trim()}>Add category</button>
        </form>
      </section>

      <section id="t-cards" data-section="1 · From your cards" data-section-count={step1Open ? String(step1Open) : 'done'} className={`${C.sec} flex flex-col gap-2`}>
        <H2 n={1} extra={step1Open ? `${step1Open} to look at` : 'done'}>From your cards</H2>
        <p className="text-sm text-[var(--muted)]">Jobs and tags that come with the cards in this deck. No AI, and nothing is added until you accept it.</p>
        {step1Open === 0 && <p className="flex flex-wrap gap-2 text-sm"><span className="font-semibold text-[#9bdcae]">Step 1 done.</span><span className="text-[var(--muted)]">Anything you skipped comes back if you refresh.</span></p>}
        {(s1.jobs || visibleTags.length > 0 || s1.more.length > 0 || comboCount + keyCount > 0) && (
          <div className={`${C.cardsBox} flex flex-col gap-2`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`font-bold ${C.cards}`}>Suggested from your cards <Tip label="How these are found">Every tag the card data gives this deck’s non-land cards, kept when it is on two or more of them, is not trivia, and is at least three times more common here than across all cards. Ranked by how many cards have it and how unusual it is here; a tag that is nearly the same cards as a stronger one, or as one of the six jobs, is left out.</Tip></span>
              <span className="flex flex-wrap gap-2">
                {s1.more.length > 0 && <button type="button" className={C.btn} aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Show only the top 5 tags' : `Show ${s1.more.length} more tags`}</button>}
                {acceptShown.length > 1 && <button type="button" className={C.btn} disabled={busy} onClick={() => act({ action: 'accept', keys: acceptShown })}>{s1.more.length && !more ? 'Accept all shown' : 'Accept all'}</button>}
              </span>
            </div>
            <p className="text-[13px] text-[var(--muted)]">Accepted tags stay live: a card you add later that has the tag joins by itself.</p>
            {s1.jobs && (
              <SugRow title={s1.jobs.all ? 'The six jobs most decks track' : 'Jobs not on this deck'} meta={s1.jobs.missing.map((j) => j.label).join(' · ')}
                why="Each is counted and checked against a usual range once accepted. Remove any you do not want afterwards." busy={busy}
                onAccept={() => act({ action: 'accept', keys: ['jobs'] })} onSkip={() => act({ action: 'skip', key: 'jobs' })} />
            )}
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
      </section>

      <section id="t-ai" data-section="2 · Refine with AI" className={`${C.sec} flex flex-col gap-2`}>
        <H2 n={2} extra="optional">Refine with AI</H2>
        <p className="text-sm text-[var(--muted)]">AI reads your confirmed plan and what you accepted in step 1. It first suggests cards to add to those or take out of them, and only then anything new the plan depends on. Tags help you read the deck and help Find search your collection. They do not change how Tune ranks cuts.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={step1Open === 0 ? C.aiBtn : C.btn} disabled={aiOff} onClick={() => act({ action: 'ai' })}>
            {running ? 'AI is reading the deck…' : `${v.ai.ran ? '✦ Ask AI again' : '✦ Refine with AI'} · Claude Opus`}
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
            {v.ai.notes && <p className="text-[13px] text-[var(--muted)]">{v.ai.notes}</p>}
            {v.ai.rows.map((r) => <AiSug key={r.key} r={r} busy={busy} act={act} />)}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-[var(--muted)]">{v.confirmed ? 'Tags are optional. Tune is open either way.' : 'Tune opens once the plan is confirmed.'}</span>
        <button type="button" className={C.go} onClick={() => onTab(v.confirmed ? 'tune' : 'plan')}>{v.confirmed ? 'Next: Tune' : 'Back to Plan'}</button>
      </div>
    </div>
  );
}

function SugRow({ title, meta, why, busy, onAccept, onSkip, children }: { title: string; meta?: string; why?: string; busy: boolean; onAccept: () => void; onSkip: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-[var(--border)] pt-2" data-suggestion>
      <div className="min-w-0 flex-[1_1_18rem]">
        <b className="break-words">{title}</b> {meta && <span className="text-[13px] text-[var(--muted)]">{meta}</span>}
        {why && <p className="text-sm text-[var(--muted)]">{why}</p>}
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
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
        <span aria-hidden className={C.cards}>{open ? '▾' : '▸'}</span> See the {t.cards.length} cards
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

/** One category: a compact row that opens to its cards, a picker, what was merged in, and Merge into. */
function CatRow({ c, all, names, open, onToggle, filter, busy, act }: { c: Category; all: Category[]; names: string[]; open: boolean; onToggle: () => void; filter: string[]; busy: boolean; act: (a: Record<string, unknown>) => void }) {
  const plan = c.kind === 'win' || c.kind === 'key';
  const who = c.by === 'cards' || c.kind === 'key' ? null : MARK[c.by];
  const has = filter.length ? c.cards.filter((x) => filter.includes(x.name)).map((x) => x.name) : [];
  const targets = all.filter((x) => x.id !== c.id && (x.kind !== 'key' || true)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex items-start gap-2 border-t border-[var(--border)] py-1">
      <div className="min-w-0 flex-1">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-11 w-full flex-wrap items-center gap-x-2 text-left">
          <span aria-hidden className={C.cards}>{open ? '▾' : '▸'}</span>
          <b className="min-w-0 break-words">{c.name}</b>
          <span className="text-[13px] text-[var(--muted)]">{plan ? 'From the plan · ' : ''}{c.cards.length} {c.cards.length === 1 ? 'card' : 'cards'}</span>
          {who && <span className={`text-[11px] font-bold ${who[1]}`}>{who[0]}</span>}
          {has.length > 0 && <span className={`text-[11px] font-bold ${C.yours}`}>has {has.join(', ')}</span>}
        </button>
        {open && (
          <div className="flex flex-col gap-2 pb-2 pl-5">
            {c.how && <p className="text-[13px] text-[var(--muted)]">{c.how}</p>}
            {c.gone.length > 0 && <p className={`text-[13px] ${C.yours}`}>Look again: {c.gone.join(', ')} left the deck.</p>}
            <div className="flex flex-wrap items-center gap-2">
              {c.cards.map((x) => <CardChip key={x.key} name={x.name} by={x.by === 'cards' ? undefined : x.by} label={`Remove ${x.name} from ${c.name}`} onRemove={() => act({ action: 'card', id: c.id, name: x.name, on: false })} />)}
              <CardPick names={names} label={`Add a card to ${c.name}`} skip={c.cards.map((x) => x.name)} onPick={(n) => act({ action: 'card', id: c.id, name: n, on: true })} />
            </div>
            {!c.cards.length && <p className="text-[13px] text-[var(--muted)]">No cards yet.</p>}
            {c.out.length > 0 && <p className="text-[13px] text-[var(--muted)]">Taken out by you: {c.out.map((x) => x.name).join(', ')}</p>}
            {c.madeOf.length > 0 && <p className="text-[13px] text-[var(--muted)]">Includes what was merged in: {c.madeOf.join(', ')}</p>}
            {c.kind !== 'key' && targets.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label={`Merge ${c.name} into another category`} value="" disabled={busy} onChange={(e) => { if (e.target.value) act({ action: 'merge', id: c.id, into: e.target.value }); }} className={`${C.input} max-w-full sm:max-w-[16rem]`}>
                  <option value="">Merge into…</option>
                  {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <span className="text-[13px] text-[var(--muted)]">Moves these cards into the other category and removes this one.</span>
              </div>
            )}
          </div>
        )}
      </div>
      <button type="button" className={`${C.btn} shrink-0 max-sm:px-3`} disabled={busy} aria-label={`Remove ${c.name}`} onClick={() => act({ action: 'remove', id: c.id })}>Remove</button>
    </div>
  );
}
