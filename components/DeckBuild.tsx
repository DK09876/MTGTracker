'use client';

/**
 * The Build tab: a checklist to build a deck by, from
 * docs/deckbuilding-reference.md - the commander's style, the plan, the
 * skeleton of roles, filling the gaps (cards you own first), the mana,
 * cuts to 100, and a last check. Every step is worked out from the cards
 * without a model; the AI lives on the Tags tab and in the deck chat.
 */

import Image from 'next/image';
import { useEffect, useState } from 'react';

import ManaCost from './ManaCost';
import * as api from '@/lib/api';
import type { BuildPlan, StepId } from '@/lib/build';
import type { ListedCard } from '@/lib/db';
import type { Board } from '@/lib/decklist';

export type DeckTab = 'cards' | 'tags' | 'health' | 'suggestions' | 'collection' | 'chat';

interface Props {
  listId: string;
  cards: ListedCard[];
  commander: string | null;
  version: string;
  onAdd: (cardId: string, board: Board) => Promise<void>;
  /** Move a card between boards: cuts go to the maybeboard, so nothing is lost. */
  onMove: (cardId: string, board: Board) => Promise<void> | void;
  onTab: (tab: DeckTab) => void;
}

const MARK = { done: ['✓', 'text-emerald-400'], warn: ['!', 'text-amber-300'], todo: ['○', 'text-[var(--muted)]'] } as const;
const PRICES = [null, 1, 5, 10, 25] as const;
const SNAIL = 'https://www.salubrioussnail.com/manabase-tool';

export default function DeckBuild({ listId, cards, commander, version, onAdd, onMove, onTab }: Props) {
  const [plan, setPlan] = useState<BuildPlan | 'loading' | 'failed'>('loading');
  const [step, setStep] = useState<StepId | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.buildPlan(listId).then((p) => { if (!cancelled) setPlan(p); }).catch(() => { if (!cancelled) setPlan('failed'); });
    return () => { cancelled = true; };
  }, [listId, version]);

  if (plan === 'loading') return <p className="mt-8 text-center text-[var(--muted)]">Reading the deck…</p>;
  if (plan === 'failed') return <p className="mt-8 text-center text-red-400">Couldn&apos;t read the deck just now.</p>;
  // Opens on the first step that needs work.
  const current = step ?? plan.steps.find((s) => s.status !== 'done')?.id ?? 'check';

  return (
    <div className="mt-5 flex flex-wrap items-start gap-5">
      <nav data-tour="build-steps" aria-label="Build steps" className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2">
        {plan.steps.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setStep(s.id)}
            aria-current={current === s.id ? 'step' : undefined}
            className={`flex items-start gap-3 rounded-xl px-3 py-2.5 text-left ${current === s.id ? 'border border-[var(--accent)] bg-[var(--accent)]/10' : 'border border-transparent hover:bg-[var(--surface-hover)]'}`}
          >
            <span aria-hidden className={`w-4 font-bold ${MARK[s.status][1]}`}>{MARK[s.status][0]}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{i + 1} · {s.title}</span>
              <span className="block text-xs text-[var(--muted)]">{s.summary}</span>
            </span>
          </button>
        ))}
      </nav>

      <section className="flex min-w-0 flex-[999_1_32rem] flex-col gap-4">
        {current === 'style' && (
          <Detail title="Commander style">
            {plan.style ? (
              <>
                <p><span className="font-semibold">{plan.style.label}.</span> {plan.style.note}</p>
                <p className="text-sm text-[var(--muted)]">Read from {commander ?? 'the commander'}&apos;s text. Every other step follows from what it rewards.</p>
              </>
            ) : <p>Pick a commander first, from the deck&apos;s header.</p>}
          </Detail>
        )}
        {current === 'plan' && (
          <Detail title="Plan">
            <p>Write down how the deck wins - or let the AI read it. Every AI step reads the brief.</p>
            <div><button onClick={() => onTab('tags')} className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[#221c08]">Open the brief on the Tags tab</button></div>
          </Detail>
        )}
        {current === 'skeleton' && (
          <Detail title="Skeleton">
            {plan.gaps.length ? (
              <ul className="flex flex-col gap-1.5">
                {plan.gaps.map((g) => (
                  <li key={g.role} className="flex justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                    <span>{g.label}</span>
                    <span><span className="font-semibold text-amber-300">{g.have}</span> <span className="text-[var(--muted)]">of {g.want[0]}–{g.want[1]}</span></span>
                  </li>
                ))}
              </ul>
            ) : <p>Every role is at its usual count.</p>}
            <p className="text-sm text-[var(--muted)]">Guidelines, not rules: a deck&apos;s plan may want more or fewer. The Health tab has every role.</p>
            {plan.gaps.length > 0 && <div><button onClick={() => setStep('fill')} className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[#221c08]">Fill the gaps</button></div>}
          </Detail>
        )}
        {current === 'fill' && <Fill listId={listId} plan={plan} commander={commander} onAdd={onAdd} />}
        {current === 'mana' && (
          <Detail title="Mana" tour="build-mana">
            <p>
              <span className="font-semibold">{plan.lands.have} lands</span>; Karsten&apos;s formula says <span className="font-semibold">{plan.lands.want}</span>
              <span className="text-[var(--muted)]"> (average mana value {plan.lands.averageMv.toFixed(2)}, {plan.lands.cheap} cheap draw and ramp spells, never below 37).</span>
            </p>
            {plan.colors.some((c) => c.needed !== null) && (
              <ul className="flex flex-col gap-1 text-sm">
                {plan.colors.filter((c) => c.needed !== null).map((c) => {
                  const short = c.sources < c.needed! - 1;
                  return (
                    <li key={c.color} className="flex flex-wrap items-center gap-2">
                      <ManaCost cost={`{${c.color}}`} size={16} />
                      <span className={short ? 'font-semibold text-amber-300' : 'text-emerald-400'}>{short ? '▲' : '✓'} {c.sources} of {c.needed} sources</span>
                      <span className="text-[var(--muted)]">- {c.neededFor} sets it</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-sm text-[var(--muted)]">
              {plan.lands.have > plan.lands.want + 1 ? 'You could cut a land or two for spells.' : plan.lands.have < plan.lands.want - 1 ? 'Add lands, or cheap ramp and draw, before cutting more.' : 'Right where it should be.'}
              {' '}For how often each spell is castable on curve, check the deck in Salubrious Snail&apos;s tool.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  const main = cards.filter((c) => c.board === 'main');
                  const text = [...(commander ? [`1 ${commander}`] : []), ...main.map((c) => `${c.quantity} ${c.card.name}`)].join('\n');
                  await navigator.clipboard?.writeText(text).catch(() => {});
                  window.open(SNAIL, '_blank', 'noopener');
                }}
                className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]"
              >
                Copy the decklist and open Salubrious Snail
              </button>
              <button onClick={() => onTab('health')} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]">Colours on the Health tab</button>
            </div>
          </Detail>
        )}
        {current === 'cuts' && <Cuts listId={listId} cards={cards} version={version} onMove={onMove} onTab={onTab} />}
        {current === 'check' && (
          <Detail title="Check">
            <p>Look over the bracket, the combos it has and the free win read, then save a read of the finished deck.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => onTab('health')} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]">Bracket and win read</button>
              <button onClick={() => onTab('suggestions')} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]">Combos</button>
              <button onClick={() => onTab('tags')} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]">Save a read</button>
            </div>
          </Detail>
        )}
      </section>
    </div>
  );
}

function Detail({ title, children, tour }: { title: string; children: React.ReactNode; tour?: string }) {
  return (
    <div data-tour={tour} className="flex flex-col gap-3">
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Fill({ listId, plan, commander, onAdd }: { listId: string; plan: BuildPlan; commander: string | null; onAdd: Props['onAdd'] }) {
  const [role, setRole] = useState(plan.targets[0]?.role ?? 'removal');
  const [owned, setOwned] = useState(true);
  const [max, setMax] = useState<number | null>(null);
  // Kept with the question it answers, so a new question reads as loading.
  const key = `${role}:${owned}:${max}`;
  const [answer, setAnswer] = useState<{ key: string; found: Awaited<ReturnType<typeof api.gapCards>> | 'failed' } | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    api.gapCards(listId, role, { owned, max })
      .then((found) => { if (!cancelled) setAnswer({ key, found }); })
      .catch(() => { if (!cancelled) setAnswer({ key, found: 'failed' }); });
    return () => { cancelled = true; };
  }, [listId, role, owned, max, key]);
  const found = answer?.key === key ? answer.found : 'loading';

  const add = async (id: string) => {
    await onAdd(id, 'main');
    setAdded((s) => new Set(s).add(id));
  };

  return (
    <div data-tour="build-fill" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-xl font-semibold">Fill the gaps</h3>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={owned} onChange={(e) => setOwned(e.target.checked)} /> From my collection first</label>
          <label className="flex items-center gap-2">
            Max price
            <select value={max ?? ''} onChange={(e) => setMax(e.target.value ? Number(e.target.value) : null)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
              {PRICES.map((p) => <option key={p ?? 'any'} value={p ?? ''}>{p ? `$${p}` : 'Any'}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {plan.targets.map((g) => (
          <button
            key={g.role}
            onClick={() => setRole(g.role)}
            className={`rounded-full border px-3 py-1 text-sm ${role === g.role ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'}`}
          >
            {g.label} · <span className={g.have < g.want[0] ? 'text-amber-300' : ''}>{g.have}</span> of {g.want[0]}–{g.want[1]}
          </button>
        ))}
      </div>
      {found === 'loading' && <p className="text-sm text-[var(--muted)]">Finding cards…</p>}
      {found === 'failed' && <p className="text-sm text-red-400">Couldn&apos;t find cards just now. Has the card data been refreshed (Settings)?</p>}
      {typeof found === 'object' && (
        <>
          {found.cards.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing fits - try a higher price, or turn off the collection filter.</p>}
          <ul className="flex flex-col gap-2">
            {found.cards.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2.5">
                {c.image ? <Image src={c.image} alt="" width={48} height={67} className="rounded" unoptimized /> : <span className="h-[67px] w-12 rounded bg-[var(--surface-hover)]" />}
                <div className="min-w-0 flex-[1_1_14rem]">
                  <p className="font-medium">
                    {c.name}
                    {c.held ? <span className="ml-2 text-xs text-emerald-400">{c.held}</span> : c.price && <span className="ml-2 text-xs text-[var(--muted)]">${c.price}</span>}
                  </p>
                  <p className="text-xs text-[var(--muted)]">{c.why}</p>
                </div>
                <button
                  onClick={() => add(c.id)}
                  disabled={added.has(c.id)}
                  className={added.has(c.id) ? 'rounded-full px-4 py-1.5 text-sm text-emerald-400' : c.held ? 'rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[#221c08]' : 'rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]'}
                >
                  {added.has(c.id) ? 'Added' : 'Add'}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--muted)]">
            Ranked by how well they fit {commander ?? 'the commander'} and how much Commander plays them{found.source === 'edhrec' ? ', with EDHREC\'s numbers for this commander' : ''}; in your colours, legal, and not in the deck. No AI.
          </p>
        </>
      )}
    </div>
  );
}

function Cuts({ listId, cards, version, onMove, onTab }: { listId: string; cards: ListedCard[]; version: string; onMove: Props['onMove']; onTab: Props['onTab'] }) {
  const [plan, setPlan] = useState<{ version: string; plan: api.CutPlan | 'failed' } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.cutPlan(listId).then((p) => { if (!cancelled) setPlan({ version, plan: p }); }).catch(() => { if (!cancelled) setPlan({ version, plan: 'failed' }); });
    return () => { cancelled = true; };
  }, [listId, version]);

  const current = plan?.version === version ? plan.plan : null;
  if (!current) return <p className="text-sm text-[var(--muted)]">Weighing every card…</p>;
  if (current === 'failed') return <p className="text-sm text-red-400">Couldn&apos;t weigh the cards just now.</p>;

  const over = current.size - 100;
  const chosen = current.candidates.filter((c) => picked.has(c.cardId));
  // Cuts should keep the curve where it is or lower it (3/3 Elk).
  const spellCount = Math.max(1, Math.round(current.size - 1 - 37));
  const mvAfter = chosen.length
    ? (current.averageMv * spellCount - chosen.reduce((n, c) => n + c.cmc, 0)) / Math.max(1, spellCount - chosen.length)
    : current.averageMv;
  const left = Math.max(0, over - chosen.length);
  // The role counts as they would be after these cuts.
  const after = current.roles.map((r) => ({ ...r, now: r.count - chosen.filter((c) => c.roles.includes(r.id)).length }))
    .filter((r) => r.now !== r.count);
  // A ★ keeps a card for good: it leaves the list at once.
  const star = async (c: api.CutPlan['candidates'][number]) => {
    const card = cards.find((x) => x.card.id === c.cardId)?.card;
    if (!card || !current || typeof current === 'string') return;
    await api.keepCard(listId, card.oracle_id ?? card.id, true);
    setPicked((p) => { const n = new Set(p); n.delete(c.cardId); return n; });
    setPlan({ version, plan: { ...current, candidates: current.candidates.filter((x) => x.cardId !== c.cardId), protectedCards: [...current.protectedCards, c.name] } });
  };
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const cut = async () => {
    setBusy(true);
    try {
      const ids = chosen.map((c) => c.cardId);
      for (const id of ids) await onMove(id, 'maybe');
      setUndo(ids);
      setPicked(new Set());
    } finally {
      setBusy(false);
    }
  };
  const putBack = async () => {
    if (!undo) return;
    setBusy(true);
    try {
      for (const id of undo) await onMove(id, 'main');
      setUndo(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-tour="cut-workbench" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-xl font-semibold">Cuts</h3>
        <p className="text-sm">
          {over > 0
            ? <>{current.size} cards · <span className={left ? 'font-semibold text-amber-300' : 'font-semibold text-emerald-400'}>{left ? `pick ${left} more` : 'that gets it to 100'}</span></>
            : over === 0 ? <span className="text-emerald-400">100 cards - nothing has to go</span> : <span>{-over} short of 100</span>}
        </p>
      </div>
      {undo && (
        <p className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
          {undo.length} moved to the maybeboard.
          <button onClick={putBack} disabled={busy} className="text-[var(--accent)] hover:underline">Undo</button>
        </p>
      )}
      <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm">
        <p>
          <span className="font-semibold">Type {current.type.type} deck.</span>{' '}
          <span className="text-[var(--muted)]">{current.type.why}</span>
        </p>
        {current.curve && <p className="text-[var(--muted)]"><span className="text-[var(--foreground)]">Look here first:</span> {current.curve}.</p>}
        <p className="text-[var(--muted)]">
          Then interaction, then {current.type.type === 'B' ? 'the cards outside the theme' : 'ramp or draw'}; lands only if you run more than the formula wants.
          Cuts go to the maybeboard, so nothing is lost.
          {current.protectedCards.length > 0 && <> {current.protectedCards.length} card{current.protectedCards.length === 1 ? ' is' : 's are'} kept out by your tags or a ★.</>}
        </p>
      </div>
      {(after.length > 0 || chosen.length > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {chosen.length > 0 && (
            <span className={`rounded-full border px-2.5 py-0.5 ${mvAfter > current.averageMv + 0.02 ? 'border-amber-400/60 text-amber-300' : 'border-[var(--border)] text-[var(--muted)]'}`}>
              Average mana value {current.averageMv.toFixed(2)} → {mvAfter.toFixed(2)}{mvAfter > current.averageMv + 0.02 ? ' (heavier)' : ''}
            </span>
          )}
          {after.map((r) => {
            const low = r.now < r.target[0];
            return (
              <span key={r.id} className={`rounded-full border px-2.5 py-0.5 ${low ? 'border-amber-400/60 text-amber-300' : 'border-[var(--border)] text-[var(--muted)]'}`}>
                {r.label} {r.count} → {r.now}{low ? ` (below ${r.target[0]})` : ''}
              </span>
            );
          })}
        </div>
      )}
      {current.candidates.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nothing stands out - every card has a job here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {current.candidates.slice(0, 30).map((c) => (
            <li key={c.cardId}>
              <div className={`flex items-start gap-3 rounded-2xl border p-2.5 ${picked.has(c.cardId) ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]'}`}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={picked.has(c.cardId)} onChange={() => toggle(c.cardId)} className="mt-1" />
                  {c.image ? <Image src={c.image} alt="" width={40} height={56} className="rounded" unoptimized /> : <span className="h-14 w-10 rounded bg-[var(--surface-hover)]" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{c.name}</span>
                    <span className="block text-xs text-[var(--muted)]">{c.reasons.join(' · ')}</span>
                  </span>
                </label>
                <button
                  onClick={() => star(c)}
                  aria-label={`Keep ${c.name}: never offer it as a cut`}
                  title="Keep it: never offer it as a cut"
                  className="rounded-full px-2 py-1 text-base text-[var(--muted)] hover:text-[var(--accent)]"
                >
                  ☆
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="sticky bottom-[calc(var(--nav-h,0px)+0.75rem)] flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-3 backdrop-blur sm:bottom-4">
        <button onClick={cut} disabled={!chosen.length || busy} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-50">
          {busy ? 'Moving…' : `Cut ${chosen.length || ''} to the maybeboard`.replace('  ', ' ')}
        </button>
        <button onClick={() => onTab('suggestions')} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">Combos and more ideas</button>
      </div>
    </div>
  );
}
