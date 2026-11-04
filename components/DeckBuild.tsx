'use client';

/**
 * The Tune tab: changing the deck toward its plan, both ways.
 *
 * Add: what to look at in plain words - a role short of the plan's range,
 * no way to win, too few lands or sources of a colour - each with why it
 * matters, the cards behind it and cards to fix it; every role against the
 * plan's ranges; the mana against Karsten's numbers; combos the deck has
 * and is one card from; and Claude's ideas, in Chat.
 * Cut: the cut list, its rules and Claude's review (TuneCut.tsx).
 *
 * It opens on Cut when the deck is over 100 and on Add otherwise.
 */

import Image from 'next/image';
import { Fragment, useEffect, useState } from 'react';

import DeckSuggestions from './DeckSuggestions';
import ManaCost from './ManaCost';
import TuneCut from './TuneCut';
import * as api from '@/lib/api';
import type { BuildPlan, Issue, RoleRow } from '@/lib/build';
import type { ListedCard } from '@/lib/db';
import type { Board } from '@/lib/decklist';
import { ROLE_GROUPS, ROLES } from '@/lib/roles';

export type DeckTab = 'cards' | 'plan' | 'tune' | 'tags' | 'health' | 'suggestions' | 'collection' | 'chat' | 'playtest';

interface Props {
  listId: string;
  cards: ListedCard[];
  commander: string | null;
  version: string;
  onAdd: (cardId: string, board: Board) => Promise<void>;
  /** Move a card between boards: cuts go to the maybeboard, so nothing is lost. */
  onMove: (cardId: string, board: Board) => Promise<void> | void;
  onTab: (tab: DeckTab) => void;
  /** The deck's tag names, for writing cut rules. */
  tagNames: string[];
  planConfirmed: boolean;
  brief: string;
  /** Open Chat with this question ready to send. */
  onAsk: (question: string) => void;
}

const PRICES = [null, 1, 5, 10, 25] as const;
const SNAIL = 'https://www.salubrioussnail.com/manabase-tool';
const BUTTON = 'rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]';
const PRIMARY = 'rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[#221c08]';

// Issues you hide stay hidden for this deck, in this browser.
const hiddenKey = (listId: string) => `mtg-build-hidden:${listId}`;
function readHidden(listId: string): string[] {
  try { return JSON.parse(localStorage.getItem(hiddenKey(listId)) ?? '[]'); } catch { return []; }
}

/** Text with {W}-style symbols drawn as mana symbols. */
function WithSymbols({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{[WUBRGC]\})/).map((part, i) => (/^\{[WUBRGC]\}$/.test(part)
        ? <ManaCost key={i} cost={part} size={15} />
        : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

/** Where a Find or Cuts panel is open: under an issue, under the roles, or at the bottom. */
type Open = { at: string; kind: 'fill'; role: string } | { at: string; kind: 'cuts' } | null;

export default function DeckBuild({ listId, cards, commander, version, onAdd, onMove, onTab, tagNames, planConfirmed, brief, onAsk }: Props) {
  const [plan, setPlan] = useState<BuildPlan | 'loading' | 'failed'>('loading');
  const [open, setOpen] = useState<Open>(null);
  const [hidden, setHidden] = useState<string[]>(() => readHidden(listId));
  const [showHidden, setShowHidden] = useState(false);
  const [mode, setMode] = useState<'add' | 'cut' | null>(null);
  const [ideas, setIdeas] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.buildPlan(listId).then((p) => { if (!cancelled) setPlan(p); }).catch(() => { if (!cancelled) setPlan('failed'); });
    return () => { cancelled = true; };
  }, [listId, version]);

  if (plan === 'loading') return <p className="mt-8 text-center text-[var(--muted)]">Reading the deck…</p>;
  if (plan === 'failed') return <p className="mt-8 text-center text-red-400">Couldn&apos;t read the deck just now.</p>;

  const hide = (id: string, on: boolean) => {
    const next = on ? [...new Set([...hidden, id])] : hidden.filter((h) => h !== id);
    setHidden(next);
    try { localStorage.setItem(hiddenKey(listId), JSON.stringify(next)); } catch { /* not remembered, still works */ }
  };
  const shown = plan.issues.filter((i) => showHidden || !hidden.includes(i.id));
  const hiddenCount = plan.issues.filter((i) => hidden.includes(i.id)).length;
  const toggle = (next: Exclude<Open, null>) => setOpen((o) => (o && o.at === next.at && o.kind === next.kind && (o.kind !== 'fill' || next.kind !== 'fill' || o.role === next.role) ? null : next));
  const panel = (at: string) => open?.at === at && open.kind === 'fill' && (
    <div className="mt-1 rounded-2xl border border-[var(--border)] bg-[var(--background)]/40 p-3">
      <Fill key={open.role} listId={listId} plan={plan} commander={commander} start={open.role} onAdd={onAdd} />
    </div>
  );
  const view = mode ?? (plan.size > 100 ? 'cut' : 'add');

  return (
    <div className="mt-5 flex flex-col gap-6">
      <div data-tour="tune-plan" className="flex max-w-3xl flex-wrap items-baseline gap-x-3 gap-y-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
        <span className="text-[var(--muted)]">{planConfirmed ? 'The plan:' : 'Write the plan first - everything here reads it.'}</span>
        <span className="min-w-0 flex-[1_1_20rem]">{planConfirmed ? brief || 'Not written.' : ''}{plan.style && <span className="text-[var(--muted)]"> · {plan.style.label}</span>}</span>
        <button onClick={() => onTab('plan')} className="text-[var(--accent)] hover:underline">{planConfirmed ? 'Edit' : 'Go to Plan'}</button>
      </div>

      <div data-tour="tune-modes" className="flex w-fit max-w-full gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 text-sm" role="tablist" aria-label="Tune">
        {([['add', 'Add'], ['cut', 'Cut']] as const).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={view === v} data-tune={v} onClick={() => setMode(v)}
            className={`rounded-full px-4 py-1.5 ${view === v ? 'id-grad font-semibold text-[#15110a]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}>
            {label}{v === 'cut' && plan.size > 100 ? <span className="ml-1.5 rounded-full bg-black/20 px-1.5 text-xs">{plan.size - 100}</span> : null}
          </button>
        ))}
      </div>

      {view === 'cut' ? (
        <TuneCut listId={listId} cards={cards} version={version} tagNames={tagNames} planConfirmed={planConfirmed} onMove={onMove} onPlan={() => onTab('plan')} />
      ) : (<>
      <section data-tour="build-issues" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-xl font-semibold">
            {plan.issues.length - hiddenCount === 0 ? 'Nothing stands out' : `${plan.issues.length - hiddenCount} thing${plan.issues.length - hiddenCount === 1 ? '' : 's'} to look at`}
          </h3>
          {hiddenCount > 0 && (
            <button onClick={() => setShowHidden((v) => !v)} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
              {showHidden ? 'Leave out hidden' : `Show ${hiddenCount} hidden`}
            </button>
          )}
        </div>
        {shown.length === 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">
            <span aria-hidden className="font-bold text-emerald-400">✓</span>
            <span className="min-w-0 flex-[1_1_20rem]">{plan.size} cards, every role at its usual count, enough lands and colour sources. See how it plays on the Playtest tab.</span>
            <button onClick={() => onTab('playtest')} className={BUTTON}>Playtest</button>
          </div>
        )}
        {shown.map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            hidden={hidden.includes(issue.id)}
            onHide={(on) => hide(issue.id, on)}
            onAction={() => {
              const a = issue.action;
              if (!a) return;
              if (a.kind === 'tags') onTab('plan');
              else if (a.kind === 'cuts') setMode('cut');
              else toggle({ at: issue.id, kind: 'fill', role: a.role });
            }}
            active={open?.at === issue.id}
          >
            {panel(issue.id)}
          </IssueCard>
        ))}
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <section data-tour="build-roles" className="flex min-w-0 flex-[1_1_28rem] flex-col gap-3">
          <h3 className="font-display text-xl font-semibold">Roles</h3>
          <Roles rows={plan.roles} finishers={plan.finishers} onFind={(role) => toggle({ at: 'roles', kind: 'fill', role })} />
          {panel('roles')}
        </section>

        <section data-tour="build-mana" className="flex min-w-0 flex-[1_1_20rem] flex-col gap-3">
          <h3 className="font-display text-xl font-semibold">Mana</h3>
          <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
            <p>
              <span className="font-semibold">{plan.lands.have} lands.</span> Karsten&apos;s formula suggests <span className="font-semibold">{plan.lands.want}</span>
              <span className="text-[var(--muted)]"> for an average mana value of {plan.lands.averageMv.toFixed(2)} with {plan.lands.cheap} ramp and draw spells at two mana or less.</span>
            </p>
            {plan.colors.some((c) => c.needed !== null) && (
              <ul className="flex flex-col gap-1.5">
                {plan.colors.filter((c) => c.needed !== null).map((c) => {
                  const short = c.sources < c.needed! - 1;
                  return (
                    <li key={c.color} className="flex flex-wrap items-center gap-2">
                      <ManaCost cost={`{${c.color}}`} size={16} />
                      <span className={short ? 'font-semibold text-amber-300' : 'text-emerald-400'}>{short ? '!' : '✓'} {c.sources} of {c.needed} sources</span>
                      <span className="min-w-0 text-[var(--muted)]">for {c.neededFor}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs text-[var(--muted)]">Sources each colour needs come from its most demanding spell, by Karsten&apos;s table; rocks and dorks count three-quarters.</p>
            <div>
              <button
                onClick={async () => {
                  const main = cards.filter((c) => c.board === 'main');
                  const text = [...(commander ? [`1 ${commander}`] : []), ...main.map((c) => `${c.quantity} ${c.card.name}`)].join('\n');
                  await navigator.clipboard?.writeText(text).catch(() => {});
                  window.open(SNAIL, '_blank', 'noopener');
                }}
                className={BUTTON}
              >
                Check each spell in Salubrious Snail&apos;s tool
              </button>
            </div>
          </div>
        </section>
      </div>

      <section data-tour="tune-combos" className="flex flex-col gap-3">
        <h3 className="font-display text-xl font-semibold">Combos</h3>
        <DeckSuggestions listId={listId} cards={cards} commander={commander} version={version} onAdd={onAdd} onMove={(id, board) => { void onMove(id, board); }} onRemove={() => {}} combosOnly />
      </section>

      <section data-tour="tune-ideas" className="flex max-w-3xl flex-col gap-2">
        <h3 className="font-display text-xl font-semibold">Ideas from Claude</h3>
        <p className="text-sm text-[var(--muted)]">Claude reads the plan, the roles and the cards, and suggests what to add, each with an Add button. It opens in Chat, where you can keep asking.</p>
        <label className="flex flex-col gap-1 text-sm">
          Your instructions <span className="text-xs text-[var(--muted)]">(optional)</span>
          <textarea value={ideas} onChange={(e) => setIdeas(e.target.value)} rows={2} maxLength={1000}
            placeholder="e.g. Only cards I own. More haste. Nothing over $10."
            className="resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 outline-none focus:border-[var(--accent)]" />
        </label>
        <div>
          <button onClick={() => onAsk(`Suggest cards to add that fit the plan and fill what the deck is short on.${ideas.trim() ? ` ${ideas.trim()}` : ''}`)}
            className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold">{planConfirmed ? 'Ask Claude for ideas' : 'Ask Claude (after the plan)'}</button>
        </div>
      </section>
      </>)}
    </div>
  );
}

function IssueCard({ issue, hidden, onHide, onAction, active, children }: { issue: Issue; hidden: boolean; onHide: (on: boolean) => void; onAction: () => void; active: boolean; children: React.ReactNode }) {
  const [showCards, setShowCards] = useState(false);
  const fix = issue.level === 'fix';
  return (
    <article className={`flex flex-col gap-2 rounded-2xl border bg-[var(--surface)] px-4 py-3 ${fix ? 'border-amber-300/40' : 'border-[var(--border)]'} ${hidden ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${fix ? 'bg-amber-300/15 text-amber-300' : 'bg-[var(--surface-hover)] text-[var(--muted)]'}`}>
          {fix ? 'Fix' : 'Worth a look'}
        </span>
        <h4 className="min-w-0 flex-[1_1_16rem] font-semibold"><WithSymbols text={issue.title} /></h4>
      </div>
      <p className="text-sm text-[var(--muted)]"><WithSymbols text={issue.why} /></p>
      {issue.cards.length > 0 && (
        showCards
          ? <p className="text-sm">{issue.cards.join(' · ')}</p>
          : null
      )}
      <div className="flex flex-wrap items-center gap-2">
        {issue.action && (
          <button onClick={onAction} aria-expanded={issue.action.kind === 'tags' ? undefined : active} className={active ? BUTTON : PRIMARY}>
            {active ? 'Close' : issue.action.label}
          </button>
        )}
        {issue.cards.length > 0 && (
          <button onClick={() => setShowCards((v) => !v)} aria-expanded={showCards} className={BUTTON}>
            {showCards ? 'Hide the cards' : `The ${issue.cards.length} card${issue.cards.length === 1 ? '' : 's'}`}
          </button>
        )}
        <button onClick={() => onHide(!hidden)} className="ml-auto text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
          {hidden ? 'Unhide' : 'Fine for this deck - hide'}
        </button>
      </div>
      {children}
    </article>
  );
}

function Roles({ rows, finishers, onFind }: { rows: RoleRow[]; finishers: string[]; onFind: (role: string) => void }) {
  const [openRole, setOpenRole] = useState<string | null>(null);
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{ROLE_GROUPS[g]}</h4>
          {rows.filter((r) => r.group === g).map((r) => {
            const short = r.want && r.have < r.want[0];
            const isOpen = openRole === r.role;
            return (
              <div key={r.role}>
                <div className="flex items-center gap-3">
                  <button onClick={() => setOpenRole(isOpen ? null : r.role)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left hover:text-[var(--foreground)]">
                    <span className="w-36 shrink-0 truncate">{r.label}</span>
                    <span className="relative h-1.5 min-w-0 flex-1 rounded-full bg-[var(--border)]" aria-hidden>
                      {r.want && <span className="absolute inset-y-0 rounded-full bg-emerald-500/25" style={{ left: `${(r.want[0] / 16) * 100}%`, width: `${((r.want[1] - r.want[0]) / 16) * 100}%` }} />}
                      <span className={`absolute inset-y-0 left-0 rounded-full ${short ? 'bg-amber-300' : 'bg-[#b38f1f]'}`} style={{ width: `${Math.min(1, r.have / 16) * 100}%` }} />
                    </span>
                    <span className="w-20 shrink-0 text-right tabular-nums">
                      <span className={short ? 'font-semibold text-amber-300' : ''}>{r.have}</span>
                      {r.want && <span className="text-[var(--muted)]"> of {r.want[0]}-{r.want[1]}</span>}
                    </span>
                  </button>
                  {r.want && <button data-tour="role-find" onClick={() => onFind(r.role)} className="shrink-0 text-xs text-[var(--accent)] hover:underline">Find</button>}
                </div>
                {isOpen && <p className="pb-2 pl-1 text-xs text-[var(--muted)]">{r.cards.length ? r.cards.join(' · ') : 'None in the deck.'}</p>}
              </div>
            );
          })}
        </div>
      ))}
      <p className="text-xs text-[var(--muted)]">
        {finishers.length ? `Ways to win: ${finishers.join(', ')}.` : 'No finishers found.'} Roles come from Scryfall&apos;s card tags; correct a card&apos;s roles from its card. Counts are guidelines - a deck&apos;s plan may want more or fewer.
      </p>
    </div>
  );
}

function Fill({ listId, plan, commander, start, onAdd }: { listId: string; plan: BuildPlan; commander: string | null; start: string; onAdd: Props['onAdd'] }) {
  const [role, setRole] = useState(start);
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
        <h3 className="font-semibold">Find cards</h3>
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
        {[...plan.targets, ...(plan.targets.some((t) => t.role === start) ? [] : [{ role: start, label: ROLES.find((r) => r.id === start)?.label ?? start, have: plan.roles.find((r) => r.role === start)?.have ?? 0, want: null }])].map((g) => (
          <button
            key={g.role}
            onClick={() => setRole(g.role)}
            className={`rounded-full border px-3 py-1 text-sm ${role === g.role ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'}`}
          >
            {g.label} · <span className={g.want && g.have < g.want[0] ? 'text-amber-300' : ''}>{g.have}</span>{g.want && <> of {g.want[0]}–{g.want[1]}</>}
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
