'use client';

/**
 * The Build tab: what to look at in the deck, in plain words. A short list
 * of issues - over 100, a role well short of the usual count, no way to
 * win, too few lands or sources of a colour - each with why it matters, the
 * cards behind it and the fix right there. Below, every role against the
 * usual counts and the mana against Karsten's numbers. Worked out from the
 * cards without a model (docs/deckbuilding-reference.md).
 */

import Image from 'next/image';
import { Fragment, useEffect, useState } from 'react';

import ManaCost from './ManaCost';
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

export default function DeckBuild({ listId, cards, commander, version, onAdd, onMove, onTab }: Props) {
  const [plan, setPlan] = useState<BuildPlan | 'loading' | 'failed'>('loading');
  const [open, setOpen] = useState<Open>(null);
  const [hidden, setHidden] = useState<string[]>(() => readHidden(listId));
  const [showHidden, setShowHidden] = useState(false);

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
  const panel = (at: string) => open?.at === at && (
    <div className="mt-1 rounded-2xl border border-[var(--border)] bg-[var(--background)]/40 p-3">
      {open.kind === 'fill'
        ? <Fill key={open.role} listId={listId} plan={plan} commander={commander} start={open.role} onAdd={onAdd} />
        : <Cuts listId={listId} cards={cards} version={version} onMove={onMove} onTab={onTab} />}
    </div>
  );

  return (
    <div className="mt-5 flex flex-col gap-6">
      {plan.style && (
        <p className="text-sm">
          <span className="text-[var(--muted)]">{commander ?? 'The commander'} reads as </span>
          <span className="font-semibold">{plan.style.label}</span>
          <span className="text-[var(--muted)]"> - {plan.style.note}</span>
        </p>
      )}

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
              else if (a.kind === 'cuts') toggle({ at: issue.id, kind: 'cuts' });
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

      {!plan.issues.some((i) => i.action?.kind === 'cuts') && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-[var(--muted)]">Making room for something new?</span>
            <button data-tour="open-cuts" onClick={() => toggle({ at: 'bottom', kind: 'cuts' })} className={BUTTON} aria-expanded={open?.at === 'bottom'}>
              {open?.at === 'bottom' ? 'Close the cut list' : 'Open the cut list'}
            </button>
          </div>
          {panel('bottom')}
        </section>
      )}
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
        <h3 className="font-semibold">The cut list</h3>
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
