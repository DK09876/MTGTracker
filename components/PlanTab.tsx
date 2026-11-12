'use client';

/**
 * The Plan tab: what the owner wants the deck to be, in the order they fill
 * it - (1) what the commander does, (2) their settings, (3) their notes,
 * (4) the plan: how the deck wins, its ways to win and key cards - every
 * section open. Set what you know and leave the rest on Not sure; AI can
 * suggest the rest in step 4, and nothing it returns is part of the plan
 * until the owner accepts it. Confirming opens Tune.
 *
 * Colours: gold is yours and selected, violet with ✦ is AI, blue is from the
 * cards (lib/plan-help.ts has the rules; components/TagsTab.tsx shares the
 * ways to win and key cards).
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import GameChangerLine from './GameChangerLine';
import Tip from './Tip';
import * as api from '@/lib/api';
import { BRACKETS } from '@/lib/brackets';
import type { Category } from '@/lib/categories-shared';
import { BRACKET_CHIPS, COMMANDER_ROLES, NOT_SURE_TIP, type PlanAction, type PlanState } from '@/lib/plan-help-shared';

// The page's colours: gold = yours and selected, violet ✦ = AI, blue = from the cards.
export const C = {
  on: 'border-[#d6aa2e] bg-[#d6aa2e] font-semibold text-[#15110a]',
  off: 'border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-hover)]',
  yours: 'text-[#e8c558]',
  ai: 'text-[#c3a6e6]',
  cards: 'text-[#8cc0ee]',
  aiBox: 'rounded-xl border border-[#a98bd0] bg-[#1c1723] p-3',
  cardsBox: 'rounded-xl border border-[#8cc0ee]/70 bg-[#0f1a22] p-3',
  box: 'rounded-xl border border-[var(--border)] bg-[#141210] p-3',
  sec: 'scroll-mt-24 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5',
  btn: 'min-h-11 rounded-xl border border-[#4a443b] px-4 text-sm font-semibold hover:bg-[var(--surface-hover)] disabled:cursor-default disabled:opacity-50',
  go: 'min-h-11 rounded-xl bg-[#d6aa2e] px-4 text-sm font-bold text-[#15110a] hover:brightness-110 disabled:cursor-default disabled:opacity-50',
  aiBtn: 'min-h-11 rounded-xl border border-[#a98bd0] bg-[#241d2e] px-4 text-sm font-bold hover:bg-[#2e2440] disabled:cursor-default disabled:opacity-50',
  input: 'min-h-11 min-w-0 rounded-xl border border-[#4a443b] bg-[var(--background)] px-3 text-sm outline-none focus:border-[#d6aa2e]',
  pill: 'min-h-11 rounded-full border px-3.5 text-sm',
  chip: 'inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-xl border border-[#3a352d] bg-[var(--background)] px-3 text-left text-[13px] hover:bg-[var(--surface-hover)]',
};
export const MARK: Record<string, [string, string]> = { owner: ['yours', C.yours], ai: ['✦ AI', C.ai], cards: ['from the cards', C.cards] };

const H2 = ({ n, children, tip }: { n?: number; children: React.ReactNode; tip?: React.ReactNode }) => (
  <h2 className="break-words font-display text-[19px] font-bold">
    {n !== undefined && <span className="mr-2 text-[13px] font-semibold text-[var(--muted)]">{n}</span>}
    {children}
    {tip && <span className="ml-2 inline-block align-middle"><Tip label="About this">{tip}</Tip></span>}
  </h2>
);
const Group = ({ children }: { children: React.ReactNode }) => <div className="mt-1 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted)]">{children}</div>;

/** A card picker: type a card in the deck and pick it. The same everywhere on the Plan and Tags tabs. */
export function CardPick({ names, label, onPick, skip = [] }: { names: string[]; label: string; onPick: (n: string) => void; skip?: string[] }) {
  const id = useId();
  const [text, setText] = useState('');
  const left = names.filter((n) => !skip.includes(n));
  const pick = (v: string) => {
    const hit = left.find((n) => n.toLowerCase() === v.trim().toLowerCase());
    if (hit) { onPick(hit); setText(''); } else setText(v);
  };
  return (
    <>
      <input list={id} aria-label={label} value={text} onChange={(e) => pick(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const one = left.filter((n) => n.toLowerCase().includes(text.trim().toLowerCase())); if (text.trim() && one.length === 1) { onPick(one[0]); setText(''); } } }}
        placeholder="Add a card…" className={`${C.input} w-full max-w-full sm:w-[16rem]`} />
      <datalist id={id}>{left.map((n) => <option key={n} value={n} />)}</datalist>
    </>
  );
}

/** Remove, asked twice: the first tap says what removing does, the second removes. Quiet until then. */
export function RemoveButton({ label, what, onRemove, text = 'Remove' }: { label: string; what: string; onRemove: () => void; text?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return armed
    ? <button type="button" aria-label={`${label}: tap again to confirm`} onClick={() => { setArmed(false); onRemove(); }} className="min-h-11 shrink-0 rounded-xl border border-red-400/60 px-3 text-[13px] font-semibold text-red-300 hover:bg-red-400/10">{what} · tap again</button>
    : <button type="button" aria-label={label} onClick={() => setArmed(true)} className="min-h-11 shrink-0 rounded-xl px-2.5 text-[13px] font-semibold text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">{text}</button>;
}

/** "Taken out · Undo" for a few seconds after a card leaves a list. */
export function useUndo() {
  const [undo, setUndo] = useState<{ text: string; run: () => void } | null>(null);
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 8000); return () => clearTimeout(t); }, [undo]);
  const bar = undo && (
    <div role="status" className="fixed inset-x-4 top-[4.25rem] z-40 lg:top-auto mx-auto flex max-w-md items-center gap-3 rounded-xl border border-[#4a443b] bg-[#26221c] px-4 py-2 text-sm shadow-lg lg:bottom-24">
      <span className="min-w-0 flex-1 break-words">{undo.text}</span>
      <button type="button" className="min-h-11 rounded-xl px-3 font-bold text-[#d6aa2e] hover:bg-[var(--surface-hover)]" onClick={() => { undo.run(); setUndo(null); }}>Undo</button>
    </div>
  );
  return { setUndo, bar };
}

/** A card in a list: its name, who added it, and × to take it out (only the × removes). */
export function CardChip({ name, by, onRemove, label }: { name: string; by?: string; onRemove: () => void; label: string }) {
  const m = by ? MARK[by] : null;
  return (
    <span className={`${C.chip} cursor-default pr-0 hover:bg-[var(--background)]`}>
      <span className="min-w-0 break-words">{name}</span>
      {m && <span className={`text-[11px] font-bold ${m[1]}`}>{m[0]}</span>}
      <button type="button" onClick={onRemove} aria-label={label} className="-my-px flex min-h-11 w-9 shrink-0 items-center justify-center rounded-r-xl text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">×</button>
    </span>
  );
}

/** A suggestion box beside a field: violet, ✦, Accept and Skip. */
function Suggested({ title = '✦ Suggested', children, onAccept, onSkip, note }: { title?: string; children: React.ReactNode; onAccept: () => void; onSkip: () => void; note: string }) {
  return (
    <div className={`${C.aiBox} flex flex-col gap-2`} data-suggestion>
      <span className={`font-bold ${C.ai}`}>{title}</span>
      <div className="text-sm">{children}</div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onAccept} className={C.btn}>Accept</button>
        <button type="button" onClick={onSkip} className={C.btn}>Skip</button>
        <span className="text-[13px] text-[var(--muted)]">{note}</span>
      </div>
    </div>
  );
}

/** The Plan tab's state, loaded and kept fresh while an AI run is going. */
export function usePlanState(listId: string, version: string) {
  const [state, setState] = useState<PlanState | null>(() => api.peek<PlanState>(api.planHelpPath(listId)) ?? null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.planHelp(listId).then((s) => { setState(s); return s; }).catch((e) => { setError(e instanceof Error ? e.message : 'Could not read the plan'); return null; }), [listId]);
  useEffect(() => { void load(); }, [load, version]);
  const running = state?.job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void load(); }, 2500);
    return () => clearInterval(t);
  }, [running, load]);
  return { state, setState, load, error, setError };
}

interface Props {
  listId: string;
  version: string;
  onTab: (tab: 'tags' | 'tune') => void;
  /** Confirming opens Tune: the page's tabs follow. */
  onConfirmed: (confirmed: boolean) => void;
  /** The bracket, for the Cards tab's Game Changer line. */
  onBracket?: (b: number | null) => void;
}

export default function PlanTab({ listId, version, onTab, onConfirmed, onBracket }: Props) {
  const { state: s, setState, load, error, setError } = usePlanState(listId, version);
  const [settings, setSettings] = useState<api.DeckPlanState | null>(() => api.peek<api.DeckPlanState>(api.paths.plan(listId)) ?? null);
  // Saves run one after another, and nothing is disabled while one is going: a click right after typing (the box saves as it loses focus) is never lost.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState(0);
  const { setUndo, bar: undoBar } = useUndo();
  const [otherOpen, setOtherOpen] = useState(false);
  const [goalText, setGoalText] = useState('');
  const [planText, setPlanText] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [winName, setWinName] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState(false);
  const [seen, setSeen] = useState<PlanState | null>(null);
  // Budget, cards and the deck rule sit folded in one line while they are at their defaults.
  const [limitsOpen, setLimitsOpen] = useState(false);

  useEffect(() => { api.deckPlan(listId).then(setSettings).catch(() => {}); }, [listId, version]);
  // The boxes follow what is saved unless the owner is typing in them.
  if (s && s !== seen && !typing) {
    setSeen(s);
    setPlanText(s.plan.text);
    setGoalText(s.goal.text);
    if (s.goal.text) setOtherOpen(true);
    setAnswers(Object.fromEntries((s.help?.questions ?? []).map((q) => [q.id, q.answer])));
  }
  useEffect(() => { if (s) { onConfirmed(!!s.confirmed); onBracket?.(s.bracket.value); } }, [s, onConfirmed, onBracket]);

  if (!s) return error ? <p className="mt-8 text-center text-red-400">{error}</p> : <p className="mt-8 text-center text-[var(--muted)]">Reading the plan…</p>;

  /** One save in the queue; the same action twice while the first is still going is dropped (a double tap). */
  const run = (key: string, fn: () => Promise<unknown>) => {
    if (inFlight.current.has(key)) return Promise.resolve();
    inFlight.current.add(key);
    setPending((n) => n + 1);
    const p = queue.current.then(async () => {
      setError(null);
      try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save that'); }
    }).finally(() => { inFlight.current.delete(key); setPending((n) => n - 1); });
    queue.current = p;
    return p;
  };
  const act = (a: PlanAction) => run(JSON.stringify(a), async () => {
    setState(await api.planHelpAct(listId, a));
    if (a.action === 'bracket' || a.action === 'acceptBracket' || a.action === 'acceptAll' || a.action === 'goal' || a.action === 'note' || a.action === 'confirm') api.deckPlan(listId).then(setSettings).catch(() => {});
  });
  const cat = (a: Record<string, unknown>) => run(JSON.stringify(a), async () => { await api.tagsTabAct(listId, a); await load(); });
  const change = (c: api.PlanChange) => run(JSON.stringify(c), async () => { setSettings(await api.changePlan(listId, c)); });
  /** Take a card out of a way to win or the key cards, with Undo. */
  const takeOut = (catId: string, listName: string, c: { name: string; by: string }) => {
    void cat({ action: 'card', id: catId, name: c.name, on: false });
    setUndo({ text: `${c.name} taken out of ${listName}.`, run: () => void cat({ action: 'card', id: catId, name: c.name, undo: true, by: c.by }) });
  };

  const h = s.help;
  const unsure = s.commander.roles.includes('unsure');
  const running = s.job?.status === 'running';
  const openQ = s.open.questions;
  const openS = s.open.suggestions;
  const step4 = (h?.plan ? 1 : 0) + (h?.fuller ? 1 : 0) + (h?.wins.length ?? 0) + (h?.keys.length ?? 0);
  const keyCards = s.key?.cards ?? [];
  const noText = !s.plan.text.trim();
  const planEmpty = noText && !s.wins.length && !keyCards.length;
  const sug = (n: number) => `${n} ${n === 1 ? 'suggestion' : 'suggestions'}`;
  const rail = [
    { id: 'p-role', label: '1 · The commander', status: h?.commander ? sug(1) : unsure ? 'not sure' : 'set', tone: h?.commander ? C.ai : unsure ? 'text-[var(--muted)]' : 'text-emerald-300' },
    { id: 'p-settings', label: '2 · Your settings', status: h?.bracket ? sug(1) : s.bracket.value === null ? 'bracket not sure' : 'set', tone: h?.bracket ? C.ai : s.bracket.value === null ? 'text-[var(--muted)]' : 'text-emerald-300' },
    { id: 'p-notes', label: '3 · Your notes', status: s.notes.length ? `${s.notes.length} ${s.notes.length === 1 ? 'note' : 'notes'}` : 'none yet', tone: s.notes.length ? 'text-emerald-300' : 'text-[var(--muted)]' },
    { id: 'p-four', label: '4 · The plan', status: step4 || openQ ? [step4 ? sug(step4) : '', openQ ? `${openQ} ${openQ === 1 ? 'question' : 'questions'}` : ''].filter(Boolean).join(' · ') : planEmpty ? 'not sure' : noText ? 'no “how it wins” yet' : 'set', tone: step4 || openQ ? C.ai : noText ? 'text-[var(--muted)]' : 'text-emerald-300' },
  ];
  const confirmed = !!s.confirmed;
  const newTitle = confirmed ? '✦ New since you confirmed' : '✦ Suggested';
  // Questions count as answered as soon as something is typed, so Confirm is ready the moment the box loses focus.
  const openQNow = (h?.questions ?? []).filter((q) => !q.skipped && !(answers[q.id] ?? '').trim()).length;
  const left = openS + openQNow;
  const leftWhat = [openS ? sug(openS) : '', openQNow ? `${openQNow} ${openQNow === 1 ? 'question' : 'questions'}` : ''].filter(Boolean).join(', ');
  const confirmHead = confirmed ? (left ? 'Confirmed · Tune is open.' : 'Plan confirmed.') : left ? `${left} left:` : 'Ready to confirm.';
  const confirmNote = confirmed ? (left ? `${left} new from AI (${leftWhat}); none apply until you accept them.` : 'Tune is open. Tags are optional. You can still change anything here.')
    : left ? `${leftWhat}. Accept, answer or skip each, then confirm.`
      : 'You can confirm with anything left on Not sure. The more you leave open, the less Tune has to go on.';
  const answeredUnsaved = confirmed && !left && (h?.questions ?? []).some((q) => !q.skipped && (answers[q.id] ?? '').trim());
  /** Scroll to the next suggestion or question still waiting, below where the screen is now (or the first one). */
  const nextSuggestion = () => {
    const all = [...document.querySelectorAll<HTMLElement>('[data-suggestion]')].filter((el) => el.getClientRects().length);
    const el = all.find((x) => x.getBoundingClientRect().top > 120) ?? all[0];
    if (!el) return;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    el.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
  };
  const cost = s.cost ? ` · about $${s.cost.toFixed(2)}` : '';
  const willSuggest = [
    ...(unsure ? ['a commander role, because yours is on Not sure'] : []),
    ...(s.bracket.value === null ? ['a bracket, because yours is on Not sure'] : []),
    s.plan.text.trim() ? (s.plan.by === 'owner' ? 'a fuller version of how the deck wins, to take or leave' : '') : 'how the deck wins, because the box is empty',
    'ways to win and key cards you haven’t listed',
    'up to 3 questions, where your intent is unclear or the cards point away from something you set',
  ].filter(Boolean);
  const budget = settings?.parts.budget?.value as number | null | undefined;
  const own = settings?.parts.own?.value as boolean | undefined;
  const rule = settings?.parts.rule?.value as { text: string; filter: string } | undefined;
  const limitsShown = limitsOpen || !!budget || !!own || !!rule?.text || !!rule?.filter;
  const planMark = !s.plan.text.trim() ? ['not sure yet', 'text-[var(--muted)]'] : s.plan.by === 'ai'
    ? [s.plan.direction ? '✦ AI direction, picked by you · edit to make it yours' : '✦ AI suggestion, accepted by you · edit to make it yours', C.ai] : ['yours', C.yours];
  const pickRole = (id: string) => {
    let next: string[];
    if (id === 'unsure') next = ['unsure'];
    else {
      const cur = s.commander.roles.filter((r) => r !== 'unsure');
      next = cur.includes(id as never) ? cur.filter((r) => r !== id) : [...cur, id];
      if (!next.length) next = ['unsure'];
    }
    void act({ action: 'commander', roles: next });
  };
  const savePlanText = () => { setTyping(false); if (planText !== s.plan.text) void act({ action: 'planText', text: planText }); };
  const saveGoalText = () => { setTyping(false); if (goalText !== s.goal.text) void act({ action: 'goal', chips: s.goal.chips, text: goalText }); };
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

  const legend = (
    <p className="text-[13px] text-[var(--muted)]"><span className={C.yours}>Gold</span> is yours · <span className={C.ai}>violet ✦</span> is AI · <span className={C.cards}>blue</span> is from the cards</p>
  );

  return (
    <div className="mt-4 flex flex-col gap-4 pb-4">
      <p className="flex flex-wrap items-center gap-2 text-[var(--muted)]">What you want this deck to be. Set what you know; leave the rest on Not sure.
        <Tip label="About the Plan tab">If you get stuck, AI can suggest the rest in step 4, and you accept or skip each suggestion. Everything in Tune works toward what you confirm here.</Tip></p>

      {/* Phones: the steps at the top, not sticking (wide screens show them in the rail on the left). */}
      <nav aria-label="On this page" className="flex flex-col gap-0.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2.5 lg:hidden">
        <span className="px-2.5 pb-1 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted)]">On this page</span>
        {rail.map((r) => (
          <button key={r.id} type="button" onClick={() => go(r.id)} className="flex min-h-11 flex-col items-start rounded-xl px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)]">
            <span className="font-semibold">{r.label}</span>
            <span className={`text-xs font-semibold ${r.tone}`}>{r.status}</span>
          </button>
        ))}
        <div className="mt-1 border-t border-[var(--border)] px-2.5 pb-1 pt-2">{legend}</div>
      </nav>
      {/* Wide screens: the rail on the left reads these. */}
      <div hidden data-rail-footer data-confirmed={confirmed ? '1' : ''} />

      {error && <p role="alert" className="rounded-xl border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      {/* 1 */}
      <section id="p-role" data-tour="plan-commander" data-section="1 · The commander" data-section-state={rail[0].status} data-section-tone={rail[0].tone} className={`${C.sec} flex flex-col gap-3`}>
        <H2 n={1} tip="What the commander does sets how much the deck leans on it and what the 99 has to back up. Every AI step is told which you picked, and whether you set it or accepted it from AI.">What {s.commanderNames} does for the deck</H2>
        <div role="group" aria-label="What the commander does" className="flex flex-wrap gap-2">
          {COMMANDER_ROLES.map((r) => {
            const on = s.commander.roles.includes(r.id);
            return <button key={r.id} type="button" aria-pressed={on} onClick={() => pickRole(r.id)} className={`${C.pill} ${on ? C.on : C.off}`}>{r.id === 'unsure' ? 'Not sure' : r.label}</button>;
          })}
        </div>
        <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
          {s.commander.roles.map((id) => { const r = COMMANDER_ROLES.find((x) => x.id === id)!; return <p key={id}><b className="text-[var(--foreground)]">{id === 'unsure' ? 'Not sure' : r.label}:</b> {id === 'unsure' ? NOT_SURE_TIP : r.tip}</p>; })}
        </div>
        {h?.commander && (
          <Suggested title={newTitle} onAccept={() => act({ action: 'acceptCommander' })} onSkip={() => act({ action: 'skip', what: 'commander' })} note="Skipping leaves this on Not sure.">
            <b>{h.commander.roles.map((id) => COMMANDER_ROLES.find((x) => x.id === id)?.label).join(', ')}</b>. {h.commander.why}
          </Suggested>
        )}
        {!unsure && s.commander.by === 'ai' && <p className={`text-sm ${C.ai}`}>✦ AI suggestion, accepted by you. Pick another any time.</p>}
        {s.commanderChanged && <p className={`text-sm ${C.yours}`}>Look again: the commander changed since you confirmed the plan. Tune stays open.</p>}
      </section>

      {/* 2 */}
      <section id="p-settings" data-tour="plan-settings" data-section="2 · Your settings" data-section-state={rail[1].status} data-section-tone={rail[1].tone} className={`${C.sec} flex flex-col gap-3`}>
        <H2 n={2}>Your settings</H2>
        <Group>What you want</Group>
        <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <div className={`${C.box} flex flex-col gap-2`}>
          <h3 className="flex flex-wrap items-baseline gap-2 text-[15px] font-bold">What you want from this deck <span className="text-[13px] font-normal text-[var(--muted)]">pick any that fit, or none</span>
            <Tip label="About what you want">Every AI step reads this as the tie-breaker for what counts as on plan: cuts, swaps and ideas are judged against it.</Tip></h3>
          <div role="group" aria-label="What you want from this deck" className="flex flex-wrap gap-2">
            {s.goals.map((g) => {
              const on = s.goal.chips.includes(g);
              return <button key={g} type="button" aria-pressed={on} onClick={() => act({ action: 'goal', chips: on ? s.goal.chips.filter((x) => x !== g) : [...s.goal.chips, g], text: s.goal.text })} className={`${C.pill} ${on ? C.on : C.off}`}>{g}</button>;
            })}
            <button type="button" aria-pressed={otherOpen} onClick={() => { if (otherOpen) { setOtherOpen(false); setGoalText(''); if (s.goal.text) void act({ action: 'goal', chips: s.goal.chips, text: '' }); } else setOtherOpen(true); }} className={`${C.pill} ${otherOpen ? C.on : C.off}`}>Other</button>
          </div>
          {otherOpen && <input aria-label="What you want from this deck, in your own words" value={goalText} placeholder="In your own words" onFocus={() => { setTyping(true); }} onChange={(e) => setGoalText(e.target.value)} onBlur={saveGoalText} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className={`${C.input} w-full`} />}
        </div>
        <div className={`${C.box} flex flex-col gap-2`} id="p-bracket">
          <h3 className="flex flex-wrap items-baseline gap-2 text-[15px] font-bold">Bracket you’re aiming for
            <Tip label="About the bracket">Once set, suggestions never go past it: no more Game Changers than it allows, no extra turns or mass land destruction below 4, no early two-card combos below 4. Not sure is fine: AI can suggest one in step 4.</Tip></h3>
          <div role="group" aria-label="Bracket" className="flex flex-wrap gap-2">
            {BRACKET_CHIPS.map(([v, label]) => <button key={label} type="button" aria-pressed={s.bracket.value === v} onClick={() => act({ action: 'bracket', value: v })} className={`${C.pill} ${s.bracket.value === v ? C.on : C.off}`}>{label}</button>)}
          </div>
          {s.bracket.value !== null && <p className="text-[13px] text-[var(--muted)]">{BRACKETS[s.bracket.value]}</p>}
          {h?.bracket && (
            <Suggested title={newTitle} onAccept={() => act({ action: 'acceptBracket' })} onSkip={() => act({ action: 'skip', what: 'bracket' })} note="Skipping leaves this on Not sure.">
              <b>Bracket {h.bracket.level}</b>. {h.bracket.why}
            </Suggested>
          )}
          {s.bracket.value !== null && s.bracket.by === 'ai' && <p className={`text-sm ${C.ai}`}>✦ AI suggestion, accepted by you. Pick another any time.</p>}
          {settings && s.bracket.value !== null && <GameChangerLine names={settings.gameChangers} bracket={s.bracket.value} />}
        </div>
        </div>
        <Group>Limits <span className="font-normal normal-case tracking-normal">· what Tune has to stay inside</span></Group>
        <div className={`${C.box} flex flex-col gap-2`}>
          <h3 className="flex flex-wrap items-baseline gap-2 text-[15px] font-bold">Never cut
            <Tip label="About never cut">The only thing that blocks a cut, checked by code before and after AI answers. It starts with the commander alone; add any card you want protected. Ways to win, key cards and tags never protect a card: owners cut those as often as any other.</Tip></h3>
          <div className="flex flex-wrap items-center gap-2">
            {s.neverCut.commanders.map((n) => <span key={n} className={`${C.chip} cursor-default`}>{n} <span className="text-[11px] font-bold text-[var(--muted)]">commander</span></span>)}
            {s.neverCut.cards.map((c) => <CardChip key={c.key} name={c.name} by="owner" label={`Remove ${c.name} from never cut`} onRemove={() => { void act({ action: 'neverCut', remove: c.name }); setUndo({ text: `${c.name} can be cut again.`, run: () => void act({ action: 'neverCut', add: c.name }) }); }} />)}
            <CardPick names={s.cardNames} label="Add a never-cut card" skip={[...s.neverCut.commanders, ...s.neverCut.cards.map((c) => c.name)]} onPick={(n) => act({ action: 'neverCut', add: n })} />
          </div>
        </div>
        {settings && !limitsShown && (
          <button type="button" aria-expanded={false} onClick={() => setLimitsOpen(true)} className={`${C.box} flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-left hover:bg-[var(--surface-hover)]`}>
            <span className="text-[15px] font-bold">Budget · cards · deck rule</span>
            <span className="font-semibold text-[#e8c558]">Any price · any card · no rule <span aria-hidden>›</span></span>
          </button>
        )}
        {settings && limitsShown && (
          <div className={`${C.box} flex flex-col gap-3`}>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-[15px] font-bold">Budget per card <Tip label="About the budget">Cards over this price aren’t suggested, unless you own them.</Tip></span>
              <div role="group" aria-label="Budget per card" className="flex flex-wrap gap-2">
                {([[0, 'Any'], [1, '$1'], [5, '$5'], [20, '$20'], [50, '$50']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={(budget ?? 0) === v} onClick={() => change({ budget: v || null })} className={`${C.pill} ${(budget ?? 0) === v ? C.on : C.off}`}>{l}</button>)}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-[15px] font-bold">Cards <Tip label="About only cards I own">Only mine: suggestions only come from your collection and your other decks, with where each copy is.</Tip></span>
              <div role="group" aria-label="Cards" className="flex flex-wrap gap-2">
                {([[false, 'Any card'], [true, 'Only mine']] as const).map(([v, l]) => <button key={l} type="button" aria-pressed={!!own === v} onClick={() => change({ own: v })} className={`${C.pill} ${!!own === v ? C.on : C.off}`}>{l}</button>)}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-[15px] font-bold">Deck rule <Tip label="About the deck rule">A restriction you set yourself. Suggestions keep to it, and nothing is cut for being weaker because of it. A card filter in search syntax makes the rules enforce it.</Tip></span>
              <RuleFields key={`${rule?.text}|${rule?.filter}`} rule={rule ?? { text: '', filter: '' }} onSave={(r) => change({ rule: r })} />
            </div>
          </div>
        )}
      </section>

      {/* 3 */}
      <section id="p-notes" data-tour="plan-notes" data-section="3 · Your notes" data-section-state={rail[2].status} data-section-tone={rail[2].tone} className={`${C.sec} flex flex-col gap-3`}>
        <H2 n={3} tip="Read word for word by every AI step. Your answers to AI’s questions are saved here when you confirm.">Your notes</H2>
        {s.notes.map((n) => (
          <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#141210] px-3 py-1.5">
            {editing?.id === n.id ? (
              <input aria-label="Edit the note" autoFocus value={editing.text} onChange={(e) => setEditing({ id: n.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { void act({ action: 'note', edit: editing }); setEditing(null); } if (e.key === 'Escape') setEditing(null); }} className={`${C.input} flex-[1_1_16rem]`} />
            ) : <span className="min-w-0 flex-[1_1_16rem] break-words text-sm">{n.text}</span>}
            <span className="flex gap-2">
              {editing?.id === n.id
                ? <><button type="button" className={C.btn} disabled={!editing.text.trim()} onClick={() => { void act({ action: 'note', edit: editing }); setEditing(null); }}>Save</button><button type="button" className={C.btn} onClick={() => setEditing(null)}>Cancel</button></>
                : <><button type="button" className={C.btn} onClick={() => setEditing({ id: n.id, text: n.text })} aria-label={`Edit note: ${n.text.slice(0, 40)}`}>Edit</button><button type="button" className={C.btn} onClick={() => act({ action: 'note', remove: n.id })} aria-label={`Remove note: ${n.text.slice(0, 40)}`}>Remove</button></>}
            </span>
          </div>
        ))}
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (noteDraft.trim()) { void act({ action: 'note', add: noteDraft.trim() }); setNoteDraft(''); } }}>
          <input aria-label="Add a note" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="e.g. I want it to win through combat more than the loop" className={`${C.input} flex-[1_1_16rem]`} />
          <button type="submit" className={C.btn} disabled={!noteDraft.trim()}>Add</button>
        </form>
      </section>

      {/* 4 */}
      <section id="p-four" data-tour="plan-read" data-section="4 · The plan" data-section-state={rail[3].status} data-section-tone={rail[3].tone} className={`${C.sec} flex flex-col gap-3 border-[#4a443b]`}>
        <H2 n={4} tip="Three parts: how the deck wins, its ways to win, and its key cards. You fill them in, and every item shows who added it. Suggestions drawn from the cards themselves, with no AI, are on the Tags tab.">The plan</H2>
        <div className={`${C.aiBox} flex flex-col gap-2`}>
          <h3 className="flex flex-wrap items-baseline gap-2 text-[15px] font-bold">Stuck, or want a second look? <span className="text-[13px] font-normal text-[var(--muted)]">optional</span>
            <Tip label="What AI reads">AI reads the deck’s facts the app works out (every card with its rules text, the numbers, combos and bracket facts) and everything set on this page, including your notes word for word. One call to Claude Opus.</Tip></h3>
          <p className="text-sm text-[var(--muted)]">AI suggests what’s missing. It never changes what you set, and nothing is added until you accept it.</p>
          {!h && <div className="text-sm"><p>It would suggest:</p><ul className="ml-5 list-disc">{willSuggest.map((w) => <li key={w}>{w}</li>)}</ul></div>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={C.aiBtn} disabled={!s.hasKey || pending > 0 || running} onClick={() => act({ action: 'run' })}>
              {running ? 'AI is reading the deck…' : `${h ? '✦ Get new AI suggestions' : '✦ Get AI suggestions'} · Claude Opus${cost}`}
            </button>
            {!s.hasKey && <span className="text-[13px] text-[var(--muted)]">Needs a Claude key on the server. Everything else on this page works without one.</span>}
            {running && <span role="status" className="text-[13px] text-[var(--muted)]">{s.job?.progress ?? 'Working…'} This takes about a minute.</span>}
            {s.job?.error && <span role="alert" className="text-[13px] text-red-300">{s.job.error}</span>}
            {h && confirmed && !running && <span className="text-[13px] text-[var(--muted)]">Your plan stays confirmed and Tune stays open: nothing new applies until you accept it.</span>}
          </div>
        </div>

        {h && (
          <div className={`${C.box} flex flex-col gap-2 border-[#a98bd0]`} role="status">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-bold ${C.ai}`}>{confirmed && left ? `✦ New since you confirmed · ${left} to look at` : '✦ AI suggestions are ready'}</span>
              <span className={`rounded-lg px-2.5 py-0.5 text-xs font-bold ${h.state === 'focused' ? 'bg-[#1d3324] text-[#9bdcae]' : 'bg-[#3a3010] text-[#f0cf6a]'}`}>{h.state === 'focused' ? 'One clear plan' : h.state === 'unfocused' ? 'Competing plans' : 'No clear plan'}</span>
            </div>
            {h.summary && <p className="text-sm">{h.summary}</p>}
            <p className="text-[13px] text-[var(--muted)]">{left ? 'Each suggestion sits beside the field it is for. The list of steps shows what is still waiting.' : 'Nothing left to accept or answer.'}</p>
            {h.directions.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-[15px] font-bold">Directions these cards could support</h3>
                {h.directions.map((d) => {
                  const on = s.plan.direction === d.name;
                  return (
                    <div key={d.name} className={`${C.box} flex flex-col gap-1.5 ${on ? 'border-[#a98bd0]' : ''}`}>
                      <b>{d.name}</b>
                      <p className="text-sm text-[var(--muted)]">{d.plan}</p>
                      <p className="text-[13px] text-[var(--muted)]">Already in the list: {d.cards.join(', ')}</p>
                      <div><button type="button" className={C.btn} aria-pressed={on} onClick={() => act({ action: 'direction', name: d.name })}>{on ? 'Picked' : 'Use this direction'}</button></div>
                    </div>
                  );
                })}
                <p className="text-[13px] text-[var(--muted)]">Or write your own below. Picking one fills in “How the deck wins” and three key cards, which you can change.</p>
              </div>
            )}
          </div>
        )}

        <div id="p-plan" className={`${C.box} flex flex-col gap-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="plantext" className="text-[15px] font-bold">How the deck wins</label>
            <span className={`text-[11px] font-bold ${planMark[1]}`}>{planMark[0]}</span>
          </div>
          <textarea id="plantext" rows={4} value={planText} onFocus={() => { setTyping(true); }} onChange={(e) => setPlanText(e.target.value)} onBlur={savePlanText}
            placeholder="How does the deck win, and what is it built around? A few sentences is plenty. Leave it empty if you’re not sure." className={`${C.input} w-full resize-y py-2`} />
          {h?.fuller && (
            <Suggested title="✦ Suggested · a fuller version, built on yours" onAccept={() => act({ action: 'acceptFuller' })} onSkip={() => act({ action: 'skip', what: 'fuller' })} note="Accepting replaces your text. Skipping keeps yours as it is.">{h.fuller}</Suggested>
          )}
          {h?.plan && (
            <Suggested title={newTitle} onAccept={() => act({ action: 'acceptPlan' })} onSkip={() => act({ action: 'skip', what: 'plan' })} note="Accepting puts it in the box, where you can edit it.">{h.plan}</Suggested>
          )}
        </div>

        <div id="p-wins" className={`${C.box} flex flex-col gap-2`}>
          <h3 className="flex items-center gap-2 text-[15px] font-bold">Ways to win <Tip label="About ways to win">How the deck ends games. They are the same as the ways to win on the Tags tab. They describe the plan; they never stop a card being cut.</Tip></h3>
          {!s.wins.length && <p className="text-[13px] text-[var(--muted)]">None yet.</p>}
          {s.wins.map((w) => <WinRow key={w.id} w={w} names={s.cardNames} cat={cat} takeOut={takeOut} />)}
          <form className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-2.5" onSubmit={(e) => { e.preventDefault(); if (winName.trim()) { void act({ action: 'addWin', name: winName.trim() }); setWinName(''); } }}>
            <input aria-label="Name a way to win" value={winName} onChange={(e) => setWinName(e.target.value)} placeholder="Name a way to win, e.g. Reiterate loop" className={`${C.input} flex-[1_1_14rem]`} />
            <button type="submit" className={C.btn} disabled={!winName.trim()}>Add</button>
          </form>
          {h && h.wins.length > 0 && (
            <div className={`${C.aiBox} flex flex-col gap-2`} data-suggestion>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className={`font-bold ${C.ai}`}>{confirmed ? '✦ New since you confirmed · ways to win' : '✦ Suggested ways to win'}</span>{h.wins.length > 1 && <button type="button" className={C.btn} onClick={() => act({ action: 'acceptAllWins' })}>Accept all</button>}</div>
              {h.wins.map((w) => (
                <div key={w.name} className="flex flex-wrap items-start justify-between gap-2 border-t border-[var(--border)] pt-2">
                  <div className="min-w-0 flex-[1_1_18rem]"><b className="break-words">{w.name}</b><p className="text-sm text-[var(--muted)]">{w.how}</p><p className="text-[13px] text-[var(--muted)]">{w.cards.join(', ')}</p></div>
                  <div className="flex gap-2"><button type="button" className={C.btn} aria-label={`Accept ${w.name} as a way to win`} onClick={() => act({ action: 'acceptWin', name: w.name })}>Accept</button><button type="button" className={C.btn} aria-label={`Skip ${w.name}`} onClick={() => act({ action: 'skip', what: `win:${w.name.trim().toLowerCase()}` })}>Skip</button></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="p-keys" className={`${C.box} flex flex-col gap-2`}>
          <h3 className="flex flex-wrap items-baseline gap-2 text-[15px] font-bold">Key cards <span className="text-[13px] font-normal text-[var(--muted)]">cards the deck can’t work without</span>
            <Tip label="About key cards">List as many as you like. AI suggests at most five. Key cards describe the plan; they never stop a card being cut. Only Never cut does.</Tip></h3>
          {s.key && s.key.gone.length > 0 && <p className={`text-[13px] ${C.yours}`}>Look again: {s.key.gone.join(', ')} left the deck.</p>}
          <div className="flex flex-wrap items-center gap-2">
            {keyCards.map((c) => <CardChip key={c.key} name={c.name} by={c.by} label={`Remove ${c.name} from key cards`} onRemove={() => takeOut(s.key!.id, 'key cards', c)} />)}
            <CardPick names={s.cardNames} label="Add a key card" skip={keyCards.map((c) => c.name)} onPick={(n) => act({ action: 'addKey', name: n })} />
          </div>
          {h && h.keys.length > 0 && (
            <div className={`${C.aiBox} flex flex-col gap-2`} data-suggestion>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className={`font-bold ${C.ai}`}>{confirmed ? '✦ New since you confirmed · key cards' : '✦ Suggested key cards'}</span>{h.keys.length > 1 && <button type="button" className={C.btn} onClick={() => act({ action: 'acceptAllKeys' })}>Accept all</button>}</div>
              {h.keys.map((k) => (
                <div key={k.key} className="flex flex-wrap items-start justify-between gap-2 border-t border-[var(--border)] pt-2">
                  <div className="min-w-0 flex-[1_1_16rem]"><b className="break-words">{k.name}</b>{k.why && <p className="text-sm text-[var(--muted)]">{k.why}</p>}</div>
                  <div className="flex gap-2"><button type="button" className={C.btn} aria-label={`Accept ${k.name} as a key card`} onClick={() => act({ action: 'acceptKey', name: k.name })}>Accept</button><button type="button" className={C.btn} aria-label={`Skip ${k.name}`} onClick={() => act({ action: 'skip', what: `key:${k.key}` })}>Skip</button></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {h && h.questions.length > 0 && (
          <div id="p-q" className={`${C.box} flex flex-col gap-2 border-[#a98bd0]`}>
            <h3 className="flex flex-wrap items-baseline gap-2 text-[15px] font-bold">✦ AI asks <span className="text-[13px] font-normal text-[var(--muted)]">answer in a line, or skip</span></h3>
            {h.questions.map((q) => (
              <div key={q.id} className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-2.5" data-suggestion={!q.skipped && !(answers[q.id] ?? '').trim() ? '' : undefined}>
                {q.about && <span className={`text-[11px] font-bold ${C.yours}`}>About something you set</span>}
                <label htmlFor={q.id} className={`text-sm ${q.skipped ? 'line-through text-[var(--muted)]' : ''}`}>{q.text}</label>
                <div className="flex flex-wrap gap-2">
                  <input id={q.id} value={answers[q.id] ?? ''} disabled={q.skipped} placeholder="A line is plenty" onFocus={() => { setTyping(true); }}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    onBlur={() => { setTyping(false); if ((answers[q.id] ?? '') !== q.answer) void act({ action: 'answer', id: q.id, text: answers[q.id] ?? '' }); }}
                    className={`${C.input} flex-[1_1_14rem]`} />
                  <button type="button" className={C.btn} aria-pressed={q.skipped} onClick={() => act({ action: 'answer', id: q.id, skip: !q.skipped })}>{q.skipped ? 'Skipped · undo' : 'Skip'}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Confirm: the row itself stays at the bottom of the screen. */}
      <div data-confirm-bar className={`sticky bottom-[calc(var(--nav-h)+4.75rem)] z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-[#1f1c18] px-3 py-2.5 shadow-[0_-10px_24px_rgba(0,0,0,0.55)] sm:px-4 sm:py-3 lg:bottom-3 ${confirmed ? 'border-[#3f6b4a]' : 'border-[#d6aa2e]/70'}`}>
        <span className="min-w-0 flex-[1_1_12rem] text-[13px] sm:text-sm"><b>{confirmHead}</b> <span className={`text-[var(--muted)] ${!left && !confirmed ? 'max-sm:hidden' : ''}`}>{confirmNote}</span></span>
        <span className="flex w-full gap-2 sm:w-auto [&>button]:max-sm:flex-auto [&>button]:max-sm:whitespace-nowrap [&>button]:max-sm:px-2.5 [&>button]:max-sm:text-[13px]">
          {/* Short labels on a phone, so the bar stays one row of buttons. */}
          {left > 0 && <button type="button" className={C.aiBtn} aria-label="Next suggestion" onClick={nextSuggestion}>Next<span className="max-sm:hidden"> ✦</span> ↓</button>}
          {left > 0 && <button type="button" className={C.btn} aria-label="Skip the rest" onClick={() => act({ action: 'skipAll' })}>Skip<span className="max-sm:hidden"> the rest</span></button>}
          {s.bulk > 0 && <button type="button" className={C.aiBtn} aria-label={s.bulk === 1 ? 'Accept the 1 suggestion' : `Accept all ${s.bulk} suggestions`} onClick={() => act({ action: 'acceptAll' })}>✦ Accept<span className="max-sm:hidden"> {s.bulk === 1 ? 'the 1 suggestion' : 'all'}</span>{s.bulk > 1 ? ` ${s.bulk}` : ''}</button>}
          {!confirmed && <button type="button" className={C.go} aria-label="Confirm the plan" disabled={left > 0} onClick={() => act({ action: 'confirm' })}>Confirm<span className="max-sm:hidden"> the plan</span></button>}
          {answeredUnsaved && <button type="button" className={C.btn} onClick={() => act({ action: 'confirm' })}>Save answers<span className="max-sm:hidden"> to notes</span></button>}
          {confirmed && <><button type="button" className={C.go} onClick={() => onTab('tune')}>Go to Tune</button>{!left && <button type="button" className={C.btn} onClick={() => onTab('tags')}>Tags (optional)</button>}</>}
        </span>
      </div>
      {undoBar}
    </div>
  );
}

function RuleFields({ rule, onSave }: { rule: { text: string; filter: string }; onSave: (r: { text: string; filter: string }) => void }) {
  const [text, setText] = useState(rule.text);
  const [filter, setFilter] = useState(rule.filter);
  const save = () => { if (text !== rule.text || filter !== rule.filter) onSave({ text, filter }); };
  return (
    <div className="flex flex-col gap-2">
      <input aria-label="Deck rule" value={text} onChange={(e) => setText(e.target.value)} onBlur={save} placeholder="e.g. No infinite combos, or every creature wears a hat" className={`${C.input} w-full`} />
      <input aria-label="Card filter" value={filter} onChange={(e) => setFilter(e.target.value)} onBlur={save} placeholder="Optional card filter, e.g. -t:legendary or cmc<=3" className={`${C.input} w-full`} />
    </div>
  );
}

/** One way to win: its name and who added it, Remove, how it wins, its cards and a picker. Shared records with the Tags tab. */
function WinRow({ w, names, cat, takeOut }: { w: Category; names: string[]; cat: (a: Record<string, unknown>) => Promise<unknown>; takeOut: (catId: string, listName: string, c: { name: string; by: string }) => void }) {
  const m = MARK[w.by];
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2"><b className="min-w-0 break-words">{w.name}</b><span className={`text-[11px] font-bold ${m[1]}`}>{m[0]}</span></div>
        <RemoveButton label={`Remove ${w.name}`} what="Remove this way to win" onRemove={() => void cat({ action: 'remove', id: w.id })} />
      </div>
      {w.how && <p className="text-sm text-[var(--muted)]">{w.how}</p>}
      {w.gone.length > 0 && <p className={`text-[13px] ${C.yours}`}>Look again: {w.gone.join(', ')} left the deck.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {w.cards.map((c) => <CardChip key={c.key} name={c.name} by={c.by} label={`Remove ${c.name} from ${w.name}`} onRemove={() => takeOut(w.id, w.name, c)} />)}
        <CardPick names={names} label={`Add a card to ${w.name}`} skip={w.cards.map((c) => c.name)} onPick={(n) => cat({ action: 'card', id: w.id, name: n, on: true })} />
      </div>
    </div>
  );
}
