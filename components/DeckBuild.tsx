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
  onTab: (tab: DeckTab) => void;
}

const MARK = { done: ['✓', 'text-emerald-400'], warn: ['!', 'text-amber-300'], todo: ['○', 'text-[var(--muted)]'] } as const;
const PRICES = [null, 1, 5, 10, 25] as const;
const SNAIL = 'https://www.salubrioussnail.com/manabase-tool';

export default function DeckBuild({ listId, cards, commander, version, onAdd, onTab }: Props) {
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
        {current === 'cuts' && (
          <Detail title="Cuts">
            <p>
              {plan.size === 100 ? 'The deck is exactly 100 cards.' : plan.size > 100 ? `The deck is ${plan.size - 100} over 100.` : `The deck is ${100 - plan.size} short of 100.`}
            </p>
            {plan.size > 100 && (
              <>
                <p className="text-sm text-[var(--muted)]">Start with roles you are over on and cards this commander&apos;s decks rarely play.</p>
                <div><button onClick={() => onTab('suggestions')} className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[#221c08]">See cut ideas</button></div>
              </>
            )}
          </Detail>
        )}
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
            {found.source === 'edhrec' ? `Ranked by how often ${commander ?? 'this commander'}'s decks play them on EDHREC` : 'Ranked by how popular they are in Commander'}; in your colours, legal, and not in the deck. No AI.
          </p>
        </>
      )}
    </div>
  );
}
