'use client';

/**
 * The Plan tab, in the order the owner fills it: (1) what the commander does
 * for the deck, (2) their settings, (3) their notes, then (4) the plan: a
 * Claude read of the deck that takes all of that in, or one they write -
 * edited in place, read again with their changes kept, and confirmed
 * (components/PlanPass.tsx, lib/plan-pass.ts). The numbers the app works
 * out (flip turn, lands, job ranges) sit folded at the end. Nothing is
 * locked behind confirming: Tune, Chat and Check read the plan when there is
 * one. Card roles and tags are on the Tags tab.
 */

import { useCallback, useEffect, useId, useState } from 'react';

import GameChangerLine from './GameChangerLine';
import { CommanderRoles, costOf, OwnerNotes, PlanRead, usePlanView } from './PlanPass';
import Tip from './Tip';
import { BRACKETS } from '@/lib/brackets';
import * as api from '@/lib/api';
import type { DeckTags } from '@/lib/tags';

interface Props {
  listId: string;
  tags: DeckTags;
  onTags: (tags: DeckTags) => void;
  /** Changes whenever the deck does. */
  version: string;
  /** After a confirm or a change, so the page can unlock what waits on it. */
  onPlan: (plan: api.DeckPlanState) => void;
  onTab: (tab: 'tags' | 'tune') => void;
  /** The deck's card names, for picking key cards and route cards. */
  cardNames?: string[];
}

type Part = api.PlanPart;


const TITLE: Record<string, string> = {
  goal: 'What you’re optimizing for', commanders: 'Commander', bracket: 'Bracket you’re aiming for', budget: 'Budget per card', own: 'Only cards I own',
  rule: 'Deck rule', brief: 'What this deck does', style: 'Style', role: 'What the commander does for the deck', build: 'How the deck is built',
  key: 'Key cards', themes: 'Themes', stages: 'Game plan by stage', routes: 'Ways to win', lean: 'Leans on the commander', flip: 'Flip turn',
  lands: 'Lands', ranges: 'Job ranges', protected: 'Never cut (★)', archetype: 'Archetype',
};
const TIPS: Record<string, string> = {
  goal: 'Pick any mix. The rules read the chips; Claude reads all of it, your words too, and can propose changes to the usual rules that serve it.',
  commanders: 'Set when the deck was imported, or from a card’s ⋯ menu. A second commander counts inside the 100; a companion sits outside it.',
  bracket: 'Suggestions never go past it: no more Game Changers than it allows, no extra turns or mass land destruction below 4, no early two-card combos below 4.',
  budget: 'Cards over this price aren’t suggested, unless you own them.',
  own: 'Suggestions only come from your collection and your other decks, with where each copy is.',
  rule: 'A restriction you set yourself. Suggestions keep to it, and nothing is cut for being weaker because of it. A card filter in search syntax makes the rules enforce it.',
  style: 'The kind of deck. It moves some ranges (a discard deck runs more draw), and cards that do what the style is about are kept over generic ones.',
  role: 'What the commander does for the deck sets how much the deck leans on it, and what the 99 has to back up.',
  build: 'Broad: any good card can fill a job, so cut on quality. Dense: the theme cards carry the deck, so they are protected hard.',
  key: 'What the deck is built around. Never cut, and tutors and draw are judged by finding it. A key card that costs more than the commander sets the flip turn.',
  themes: 'Packages of cards doing one thing, found without AI. Keep one and it becomes one of your tags. Eight cards give about a 62% chance of seeing one by turn 4; sixteen about 87%.',
  stages: 'Three short lines: how the deck starts, what it does once the commander is out, and how it closes. Find cards and Fix a problem read them.',
  routes: 'How the deck ends games. Their cards are never cut, and the deck is checked for a way to win without the commander.',
  lean: 'How much breaks without the commander. It moves the protection range: low 1–2, medium 2–3, high 3–5.',
  flip: 'The mana the deck needs before it stops setting up and starts doing its thing. Sets the ramp range and Playtest’s first goal.',
  lands: 'The one land number Plan, Tune and Check all use.',
  ranges: 'How many of each job the deck should run. Your own range wins over everything else.',
  protected: 'Never offered as a cut, anywhere: the commanders and the cards you mark ★ never cut (from a card’s menu).',
  archetype: 'A reading from the numbers, not something you set.',
};
const ROLE_NOTE: Record<string, string> = {
  Engine: 'The deck runs on it.', Payoff: 'It rewards what the 99 does.', Enabler: 'It makes the 99’s plan happen.', 'Covers a weakness': 'It fills a gap the 99 has.', Multiplier: 'It doubles what the 99 does.',
};
// Where the guided tour points on this page.
const SOURCE: Record<string, [string, string]> = {
  detected: ['detected', 'bg-emerald-500/10 text-emerald-300'],
  claude: ['Claude', 'bg-violet-400/15 text-violet-200'],
  yours: ['yours', 'bg-[var(--accent)]/15 text-[var(--accent)]'],
  unset: ['not set', 'bg-[var(--surface-hover)] text-[var(--muted)]'],
};
const STRENGTH: Record<string, [string, string]> = {
  clear: ['Clear', 'text-emerald-300'], likely: ['Likely', 'text-[var(--foreground)]'], guess: ['A guess', 'text-amber-300 border-amber-300/50'],
};
// The owner's settings, and the numbers the app works out (folded away).
const SETTINGS = ['goal', 'bracket', 'budget', 'own', 'rule', 'protected'];
const NUMBERS = ['flip', 'lands', 'ranges'];
const TOUR: Record<string, string> = { style: 'plan-style', flip: 'plan-flip', ranges: 'plan-guidelines', themes: 'plan-packages', goal: 'plan-goal' };
const BUTTON = 'rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--surface-hover)] disabled:opacity-50';
const OK = 'rounded-full border border-emerald-400/50 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50';
const INPUT = 'rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm outline-none focus:border-[var(--accent)]';

function Seg<T extends string | number>({ options, value, onPick, disabled, label }: { options: Array<[T, string]>; value: T | null; onPick: (v: T) => void; disabled: boolean; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map(([v, text]) => (
        <button key={String(v)} onClick={() => onPick(v)} disabled={disabled} aria-pressed={value === v}
          className={`rounded-lg border px-2.5 py-1 text-sm tabular-nums disabled:opacity-60 ${value === v ? 'border-[var(--accent)] bg-[var(--accent)]/10 font-semibold text-[var(--accent)]' : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}>{text}</button>
      ))}
    </div>
  );
}

/** Text that saves when you leave the box, not on every key. */
type FieldProps = { value: string; onSave: (v: string) => void; placeholder: string; label: string; disabled: boolean; wide?: boolean };
// Starts again from the saved value whenever it changes.
const Field = (props: FieldProps) => <FieldBox key={props.value} {...props} />;
function FieldBox({ value, onSave, placeholder, label, disabled, wide = true }: FieldProps) {
  const [text, setText] = useState(value);
  return <input aria-label={label} value={text} placeholder={placeholder} disabled={disabled} onChange={(e) => setText(e.target.value)}
    onBlur={() => { if (text.trim() !== value.trim()) onSave(text); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    className={`${INPUT} ${wide ? 'w-full' : 'w-40'}`} />;
}

function How({ how, changedBy }: { how: Part['how'] | { inputs: string[]; steps: string[]; idea?: string }; changedBy?: string[] }) {
  const block = (title: string, items: string[]) => items.length ? (
    <div className="flex flex-col gap-0.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">{title}</span>{items.map((x, i) => <span key={i}>{x}</span>)}</div>
  ) : null;
  return (
    <div className="flex flex-col gap-2 border-l-2 border-[var(--border)] pl-3 text-sm text-[var(--muted)]">
      {block('Inputs', how.inputs)}
      {block('Steps', how.steps)}
      {block('Changes to the usual rules', changedBy ?? [])}
      {'idea' in how && how.idea ? block('The idea', [how.idea]) : null}
    </div>
  );
}


export default function DeckPlan({ listId, tags, onTags, version, onPlan, onTab, cardNames = [] }: Props) {
  const [plan, setPlan] = useState<api.DeckPlanState | 'loading' | 'failed'>(() => api.peek<api.DeckPlanState>(api.paths.plan(listId)) ?? 'loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState(false);
  const { view, act: planAct, error: viewError } = usePlanView(listId, version);

  const reload = useCallback(() => api.deckPlan(listId).then((p) => { setPlan(p); onPlan(p); }).catch(() => setPlan((x) => (x === 'loading' ? 'failed' : x))), [listId, onPlan]);
  useEffect(() => { void reload(); }, [reload, version, tags.brief]);
  // Reading again or confirming saves the owner's answers and note to their notes: show them.
  const act = async (a: api.PlanPassAction) => {
    const v = await planAct(a);
    if (a.action === 'generate' || a.action === 'confirm') await reload();
    return v;
  };

  if (plan === 'loading') return <p className="mt-8 text-center text-[var(--muted)]">Reading the deck…</p>;
  if (plan === 'failed') return <p className="mt-8 text-center text-red-400">Couldn&apos;t read the deck just now.</p>;

  const change = async (c: api.PlanChange) => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.changePlan(listId, c);
      setPlan(next);
      onPlan(next);
      if (c.confirm) onTags({ ...tags, brief: next.brief });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  };
  const p = plan.parts;
  const commander = ((p.commanders?.value as { commander: string | null } | undefined)?.commander ?? 'The commander').split(',')[0];

  // A deck with no plan yet sees how to make one first; 1-3 below are optional.
  const noPlan = view && !view.pass && view.job?.status !== 'running';
  const scrollTo = (id: string) => document.querySelector(`[data-tour="${id}"]`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

  return (
    <div className="mt-5 flex flex-col gap-6">
      {view && <DeckSize size={view.size} onTune={() => onTab('tune')} />}
      {noPlan && (
        <section className="flex flex-col gap-2 rounded-2xl border border-violet-300/40 bg-violet-300/[0.04] p-4">
          <h3 className="font-display text-lg font-semibold">This deck has no plan yet</h3>
          <p className="text-sm text-[var(--muted)]">Have Claude read the deck, or write the plan yourself. Fill in 1–3 below first if you like: what the commander does, your settings and your notes all go into the read.</p>
          <span className="flex flex-wrap items-center gap-3">
            <button onClick={() => void act({ action: 'generate' })} className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[#221c08]">✦ Generate the plan · Opus · {costOf(view)}</button>
            <button onClick={() => scrollTo('plan-read')} className="text-sm text-[var(--muted)] underline hover:text-[var(--foreground)]">Write it myself</button>
          </span>
        </section>
      )}
      {view && <CommanderRoles view={view} act={act} commander={commander} readRoles={view.pass && !view.pass.ownPlan ? view.pass.commanderRolesRead : null} />}

      <section data-tour="plan-settings" data-section="2 · Your settings" className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold"><span className="text-xs text-[var(--faint)]">2</span>Your settings
          <Tip label="About your settings">Limits every suggestion keeps to, AI or rules. Set by you; nothing here is guessed.</Tip></h3>
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {SETTINGS.map((id) => p[id] && (
            <div key={id} id={`plan-${id}`} data-tour={TOUR[id]} className={`flex min-w-0 flex-col gap-2 rounded-xl bg-[var(--surface-hover)]/40 p-3 ${id === 'goal' ? 'lg:col-span-2' : ''}`}>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold">{TITLE[id]} {TIPS[id] && <Tip label={`About: ${TITLE[id]}`}>{TIPS[id]}</Tip>}</h4>
              <Body id={id} part={p[id]} plan={plan} busy={busy} change={change} cardNames={cardNames} onTab={onTab} />
            </div>
          ))}
        </div>
      </section>

      <OwnerNotes notes={plan.notes} busy={busy} change={change} />

      {view ? <PlanRead key={view.pass?.id ?? 'none'} listId={listId} view={view} act={act} cardNames={cardNames} /> : <p className="text-sm text-[var(--muted)]">{viewError ?? 'Loading the plan…'}</p>}
      {viewError && view && <p role="alert" className="text-sm text-red-400">{viewError}</p>}

      <details data-section="Numbers the app uses" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <summary className="cursor-pointer px-4 py-3"><b>Numbers the app uses</b> <span className="text-sm text-[var(--muted)]">· flip turn, lands, job ranges · worked out from the cards, change any</span></summary>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {NUMBERS.map((id) => p[id] && (
              <div key={id} id={`plan-${id}`} data-tour={TOUR[id]} className={`flex min-w-0 flex-col gap-2 rounded-xl bg-[var(--surface-hover)]/40 p-3 ${id === 'ranges' ? 'lg:col-span-2' : ''}`}>
                <h4 className="flex items-center gap-1.5 text-sm font-semibold">{TITLE[id]} {TIPS[id] && <Tip label={`About: ${TITLE[id]}`}>{TIPS[id]}</Tip>}</h4>
                <Body id={id} part={p[id]} plan={plan} busy={busy} change={change} cardNames={cardNames} onTab={onTab} />
              </div>
            ))}
          </div>
          <Changes plan={plan} busy={busy} change={change} />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setRules((r) => !r)} aria-expanded={rules} className={BUTTON}>{rules ? 'Hide how the numbers are worked out' : 'How the numbers are worked out'}</button>
          </div>
          {rules && <RulesPage rules={plan.rules} />}
        </div>
      </details>

      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

/** Where the deck stands against 100 cards, and what comes next. */
function DeckSize({ size, onTune }: { size: number; onTune: () => void }) {
  const over = size - 100;
  return (
    <p className="text-sm text-[var(--muted)]">
      <b className="tabular-nums text-[var(--foreground)]">{size} of 100 cards</b>
      {over > 0 && <>: {over} over. Trim next, on <button onClick={onTune} className="underline hover:text-[var(--foreground)]">Tune</button>.</>}
      {over < 0 && <>: {-over} short. Fill next, on <button onClick={onTune} className="underline hover:text-[var(--foreground)]">Tune</button>.</>}
      {over === 0 && <>. The plan is what Tune, Chat and Check read.</>}
    </p>
  );
}

type Change = (c: api.PlanChange) => Promise<void>;

function Body({ id, part, plan, busy, change, cardNames, onTab }: { id: string; part: Part; plan: api.DeckPlanState; busy: boolean; change: Change; cardNames: string[]; onTab: (tab: 'tags') => void }) {
  const v = part.value as never;
  switch (id) {
    case 'goal': {
      const g = v as { chips: string[]; text: string };
      const pick = (chip: string) => {
        const usual = 'The usual guidelines';
        const chips = chip === usual ? [usual] : g.chips.filter((c) => c !== usual).includes(chip) ? g.chips.filter((c) => c !== chip && c !== usual) : [...g.chips.filter((c) => c !== usual), chip];
        return change({ goal: { chips: chips.length ? chips : [usual], text: g.text } });
      };
      return (
        <div className="flex flex-col gap-2">
          <div role="group" aria-label="What you’re optimizing for" className="flex flex-wrap gap-1.5">
            {plan.goals.map((c) => <button key={c} onClick={() => pick(c)} disabled={busy} aria-pressed={g.chips.includes(c)} className={`rounded-full border px-3 py-1 text-sm ${g.chips.includes(c) ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}>{c}</button>)}
          </div>
          <Field label="What you’re optimizing for, in your words" value={g.text} disabled={busy} placeholder="Or in your words: e.g. win before turn 9 at a bracket 3 table" onSave={(text) => change({ goal: { chips: g.chips, text } })} />
        </div>
      );
    }
    case 'commanders': {
      const c = v as { commander: string | null; partner: string | null; companion: string | null };
      return <p className="text-sm"><b>{c.commander ?? 'No commander set'}</b>{c.partner && <> + <b>{c.partner}</b></>}<span className="text-[var(--muted)]"> · {c.partner ? 'two commanders' : 'no second commander'} · {c.companion ? `companion ${c.companion}` : 'no companion'}</span></p>;
    }
    case 'bracket': {
      const b = v as { value: number | null; looksLike: number };
      return (
        <div className="flex flex-col gap-1.5">
          <Seg label="Bracket" options={[1, 2, 3, 4, 5].map((n) => [n, String(n)] as [number, string])} value={b.value} disabled={busy} onPick={(n) => change({ bracket: n })} />
          <span className="text-xs text-[var(--muted)]">{b.value ? BRACKETS[b.value] : `Not set · this list looks like ${b.looksLike} (${BRACKETS[b.looksLike]})`}</span>
          <GameChangerLine names={plan.gameChangers} bracket={b.value} />
        </div>
      );
    }
    case 'budget':
      return <Seg label="Budget per card" options={[[0, 'Any'], [1, '$1'], [5, '$5'], [20, '$20'], [50, '$50']]} value={(v as number | null) ?? 0} disabled={busy} onPick={(n) => change({ budget: n || null })} />;
    case 'own':
      return <Seg label="Cards" options={[['any', 'Any card'], ['mine', 'Only mine']]} value={v ? 'mine' : 'any'} disabled={busy} onPick={(x) => change({ own: x === 'mine' })} />;
    case 'rule': {
      const r = v as { text: string; filter: string };
      return (
        <div className="flex flex-col gap-1.5">
          <Field label="Deck rule" value={r.text} disabled={busy} placeholder="e.g. No infinite combos, or every creature wears a hat" onSave={(text) => change({ rule: { text, filter: r.filter } })} />
          <Field label="Card filter" value={r.filter} disabled={busy} placeholder="Optional card filter, e.g. -t:legendary or cmc<=3" onSave={(filter) => change({ rule: { text: r.text, filter } })} />
        </div>
      );
    }
    case 'style': {
      const st = v as { primary: string; secondary: string | null; own: { label: string } | null };
      const opts = plan.styles;
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">Main
              <select aria-label="Main style" value={st.primary} disabled={busy} onChange={(e) => change(e.target.value === 'own' ? { styleOwn: { label: st.own?.label ?? 'My own', ranges: {} } } : { style: e.target.value })} className={INPUT}>
                {opts.map((s) => <option key={s.id} value={s.id}>{s.label}{s.cards ? ` · ${s.cards} cards` : ''}</option>)}
                <option value="own">{st.own?.label ? `${st.own.label} (my own)` : 'My own…'}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">Second
              <select aria-label="Second style" value={st.secondary ?? ''} disabled={busy} onChange={(e) => change({ style2: e.target.value })} className={INPUT}>
                <option value="">None</option>
                {opts.map((s) => <option key={s.id} value={s.id}>{s.label}{s.cards ? ` · ${s.cards} cards` : ''}</option>)}
              </select>
            </label>
          </div>
          {st.primary === 'own'
            ? <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-[var(--muted)]">Name</span><Field wide={false} label="Your style’s name" value={st.own?.label ?? ''} disabled={busy} placeholder="My own" onSave={(label) => change({ styleOwn: { label, ranges: {} } })} /><span className="text-xs text-[var(--muted)]">Set its ranges in Job ranges below.</span></div>
            : <span className="text-xs text-[var(--muted)]">{opts.find((s) => s.id === st.primary)?.note}</span>}
          {part.source !== 'detected' && <button onClick={() => change({ style: null, style2: null })} disabled={busy} className="w-fit text-xs text-[var(--accent)] hover:underline">Back to what was detected</button>}
        </div>
      );
    }
    case 'role':
      return <div className="flex flex-col gap-1.5"><Seg label="What the commander does" options={plan.roles.map((r) => [r, r] as [string, string])} value={v as string} disabled={busy} onPick={(r) => change({ role: r as never })} /><span className="text-xs text-[var(--muted)]">{ROLE_NOTE[v as string]}</span></div>;
    case 'build':
      return <div className="flex flex-col gap-1.5"><Seg label="How the deck is built" options={[['Broad', 'Broad'], ['Dense', 'Dense']]} value={v as string} disabled={busy} onPick={(b) => change({ build: b as never })} /><span className="text-xs text-[var(--muted)]">{v === 'Broad' ? 'Good cards are easy to swap in; cut on quality.' : 'Layered synergy or a narrow pool: theme cards stay.'}</span></div>;
    case 'lean':
      return <Seg label="Leans on the commander" options={[['Low', 'Low'], ['Medium', 'Medium'], ['High', 'High']]} value={v as string} disabled={busy} onPick={(l) => change({ lean: l as never })} />;
    case 'key': {
      const k = v as { cards: string[]; candidates: string[] };
      const commander = (plan.parts.commanders.value as { commander: string | null; partner: string | null });
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {k.cards.map((n) => (
              <span key={n} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] py-0.5 pl-3 pr-1 text-sm">{n}
                {n !== commander.commander && n !== commander.partner && <button onClick={() => change({ key: { remove: n } })} disabled={busy} aria-label={`Not a key card: ${n}`} className="px-1.5 text-[var(--muted)] hover:text-red-300">×</button>}
              </span>
            ))}
            {k.candidates.map((n) => (
              <span key={n} className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] py-0.5 pl-3 pr-1 text-sm text-[var(--muted)]">{n}?
                <button onClick={() => change({ key: { add: n } })} disabled={busy} className="rounded-full px-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/10">Add</button>
                <button onClick={() => change({ key: { dismiss: n } })} disabled={busy} aria-label={`Don’t suggest ${n}`} className="px-1.5 hover:text-red-300">×</button>
              </span>
            ))}
          </div>
          <CardPick names={cardNames.filter((n) => !k.cards.includes(n))} label="Add a key card" disabled={busy} onPick={(n) => change({ key: { add: n } })} />
        </div>
      );
    }
    case 'themes': {
      const themes = v as api.ThemeView[];
      if (!themes.length) return <p className="text-sm text-[var(--muted)]">No themes yet. Add cards, or make a tag under Your tags, below.</p>;
      return (
        <div className="flex flex-col gap-1.5">
          {themes.map((t) => (
            <div key={t.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm ${t.status === 'dropped' ? 'opacity-50' : ''}`}>
              <span className="flex min-w-0 flex-[1_1_16rem] flex-col">
                <span><b className={t.status === 'dropped' ? 'line-through' : ''}>{t.name}</b> <span className="tabular-nums text-[var(--muted)]">{t.count} of {t.size}</span>{t.commander && <span className="ml-2 text-xs text-[var(--accent)]">the commander asks for it</span>}{t.status === 'open' && <span className={`ml-2 rounded-md border border-[var(--border)] px-1.5 text-[11px] ${STRENGTH[t.strength][1]}`}>{STRENGTH[t.strength][0]}</span>}</span>
                <span className="text-xs text-[var(--muted)]">{t.status === 'yours' ? 'One of your tags' : `${t.enablers} enabler${t.enablers === 1 ? '' : 's'} · ${t.payoffs} payoff${t.payoffs === 1 ? '' : 's'} · ${t.multipliers} multiplier${t.multipliers === 1 ? '' : 's'}`}{t.cards.length > 0 && <> · <span title={t.cards.join(', ')}>{t.cards.slice(0, 3).join(', ')}{t.cards.length > 3 ? '…' : ''}</span></>}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {t.status === 'open' && <><button onClick={() => change({ keepTheme: t.id })} disabled={busy} className={OK}>Keep</button><button onClick={() => change({ themes: { drop: t.id } })} disabled={busy} className={BUTTON}>Not a theme</button></>}
                {t.status === 'kept' && <><span className="text-xs text-emerald-300">Kept · now a tag</span><button onClick={() => change({ unkeepTheme: t.id })} disabled={busy} className="text-xs text-[var(--muted)] underline">Undo</button></>}
                {t.status === 'dropped' && <button onClick={() => change({ themes: { undrop: t.id } })} disabled={busy} className="text-xs text-[var(--muted)] underline">Undo</button>}
                {t.status !== 'dropped' && (
                  <select aria-label={`${t.name}: package size`} value={t.size} disabled={busy}
                    onChange={(e) => change(t.tagId ? { packages: { [t.tagId]: Number(e.target.value) } } : { themes: { size: { [t.id]: Number(e.target.value) } } })} className={INPUT}>
                    {[...new Set([4, 6, 8, 10, 12, 16, 20, t.size])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}{n === 8 ? ' (usual)' : n === 16 ? ' (main theme)' : ''}</option>)}
                  </select>
                )}
              </span>
            </div>
          ))}
          <button onClick={() => onTab('tags')} className="w-fit text-xs text-[var(--accent)] hover:underline">Make your own in Your tags, below</button>
        </div>
      );
    }
    case 'stages': {
      const st = v as { early: string; mid: string; close: string };
      const save = (k: 'early' | 'mid' | 'close') => (text: string) => change({ stages: { ...st, [k]: text } });
      return (
        <div className="grid gap-2 md:grid-cols-3">
          {(['early', 'mid', 'close'] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-sm"><span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">{{ early: 'Early', mid: 'Middle', close: 'Close' }[k]}</span>
              <Field label={`${k} game`} value={st[k]} disabled={busy} placeholder="" onSave={save(k)} /></label>
          ))}
        </div>
      );
    }
    case 'routes': return <Routes routes={v as api.RouteView[]} busy={busy} change={change} cardNames={cardNames} />;
    case 'flip': {
      const f = plan.flip;
      return (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">The deck gets going at
            <select aria-label="Flip turn" value={v as number} disabled={busy} onChange={(e) => change({ flip: Number(e.target.value) })} className={INPUT}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} mana</option>)}
            </select>
          </label>
          {f.mine && <button onClick={() => change({ flip: null })} disabled={busy} className="text-xs text-[var(--accent)] hover:underline">Back to what was detected</button>}
          <span className="text-xs text-[var(--muted)]">Playtest&apos;s first goal: {v} mana by turn {Math.max(3, (v as number) - 1)}.</span>
        </div>
      );
    }
    case 'lands': {
      const l = v as { have: number; range: [number, number]; want: number };
      return (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-display text-2xl font-semibold tabular-nums">{l.have}</span><span className="text-sm text-[var(--muted)]">lands · the plan wants</span>
          <RangeEdit range={l.range} label="Lands" disabled={busy} onSave={(r) => change({ targets: { lands: r } })} />
          {part.source === 'yours' && <button onClick={() => change({ targets: { lands: null } })} disabled={busy} className="text-xs text-[var(--accent)] hover:underline">Back to the formula ({l.want})</button>}
        </div>
      );
    }
    case 'ranges': return <Ranges rows={v as RangeRow[]} busy={busy} change={change} />;
    case 'protected': {
      const list = v as Array<{ name: string; why: string }>;
      return list.length ? <div className="flex flex-wrap gap-1.5">{list.map((x) => <span key={x.name} className="rounded-full border border-[var(--border)] px-3 py-0.5 text-sm">{x.name} <span className="text-xs text-[var(--muted)]">{x.why}</span></span>)}</div> : <p className="text-sm text-[var(--muted)]">Nothing yet.</p>;
    }
    case 'archetype': return <p className="text-sm"><b>{v as string}</b> <span className="text-[var(--muted)]">· a reading, updates with the deck</span></p>;
    default: return null;
  }
}

type RangeRow = { job: string; label: string; range: [number, number] | null; source: string; from: string; count: number | null; how: { inputs: string[]; steps: string[] } | null };

function Ranges({ rows, busy, change }: { rows: RangeRow[]; busy: boolean; change: Change }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="flex flex-col">
      {rows.map((r) => (
        <li key={r.job} className="flex flex-col gap-1.5 border-t border-dashed border-[var(--border)] py-2 first:border-t-0">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="min-w-0 flex-[1_1_9rem]">{r.label}</span>
            <span className="tabular-nums text-[var(--muted)]">{r.count ?? '–'}</span>
            {r.range ? <RangeEdit range={r.range} label={r.label} disabled={busy} onSave={(x) => change({ targets: { [r.job]: x } })} /> : <span className="text-xs text-[var(--muted)]">no range</span>}
            {r.source === 'yours' && <button onClick={() => change({ targets: { [r.job]: null } })} disabled={busy} className="text-xs text-[var(--accent)] hover:underline">Back</button>}
            {r.how && <button onClick={() => setOpen(open === r.job ? null : r.job)} aria-expanded={open === r.job} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">{open === r.job ? 'Hide' : 'How?'}</button>}
          </div>
          <span className={`text-xs ${r.source === 'override' ? 'text-violet-200' : 'text-[var(--faint)]'}`}>{r.range ? `From ${r.from}` : r.from[0].toUpperCase() + r.from.slice(1)}</span>
          {open === r.job && r.how && <How how={r.how} />}
        </li>
      ))}
    </ul>
  );
}

type RangeProps = { range: [number, number]; label: string; disabled: boolean; onSave: (r: [number, number]) => void };
const RangeEdit = (props: RangeProps) => <RangeBox key={props.range.join('-')} {...props} />;
function RangeBox({ range, label, disabled, onSave }: RangeProps) {
  const [lo, setLo] = useState(String(range[0]));
  const [hi, setHi] = useState(String(range[1]));
  const save = () => {
    const a = Number(lo), b = Number(hi);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 99 || a > b) { setLo(String(range[0])); setHi(String(range[1])); return; }
    if (a !== range[0] || b !== range[1]) onSave([a, b]);
  };
  const box = 'w-12 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1.5 py-1 text-center text-sm tabular-nums';
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <input aria-label={`${label}: fewest`} inputMode="numeric" value={lo} disabled={disabled} onChange={(e) => setLo(e.target.value)} onBlur={save} className={box} />
      <span className="text-[var(--muted)]">to</span>
      <input aria-label={`${label}: most`} inputMode="numeric" value={hi} disabled={disabled} onChange={(e) => setHi(e.target.value)} onBlur={save} className={box} />
    </span>
  );
}

function CardPick({ names, label, disabled, onPick }: { names: string[]; label: string; disabled: boolean; onPick: (n: string) => void }) {
  const [text, setText] = useState('');
  const id = `cards-${useId().replace(/:/g, '')}`;
  const pick = () => { const n = names.find((x) => x.toLowerCase() === text.trim().toLowerCase()); if (n) { onPick(n); setText(''); } };
  if (!names.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <input list={id} aria-label={label} value={text} placeholder={label} disabled={disabled} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') pick(); }} className={`${INPUT} w-56`} />
      <datalist id={id}>{names.slice(0, 200).map((n) => <option key={n} value={n} />)}</datalist>
      <button onClick={pick} disabled={disabled || !text.trim()} className={BUTTON}>Add</button>
    </span>
  );
}

function Routes({ routes, busy, change, cardNames }: { routes: api.RouteView[]; busy: boolean; change: Change; cardNames: string[] }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [cards, setCards] = useState('');
  return (
    <div className="flex flex-col gap-1.5">
      {routes.length === 0 && <p className="text-sm text-[var(--muted)]">No way to win found yet. Add one, or tag your win conditions under Your tags, below.</p>}
      {routes.map((r) => (
        <div key={r.id} className={`flex flex-col gap-1 rounded-xl border px-3 py-2 text-sm ${r.main && !r.dropped ? 'border-[var(--accent)]/70' : 'border-[var(--border)]'} ${r.dropped ? 'opacity-50' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className={r.dropped ? 'line-through' : ''}>{r.label}{r.own && <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">yours</span>}</b>
            <span className="flex flex-wrap items-center gap-2">
              {!r.dropped && (r.main ? <span className="text-xs text-[var(--accent)]">Main way to win</span> : <button onClick={() => change({ routes: { main: r.id } })} disabled={busy} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Make it the main one</button>)}
              {r.dropped ? <button onClick={() => change({ routes: { undrop: r.id } })} disabled={busy} className="text-xs text-[var(--muted)] underline">Undo</button>
                : <button onClick={() => change({ routes: { drop: r.id } })} disabled={busy} className="text-xs text-[var(--muted)] hover:text-red-300">Drop</button>}
            </span>
          </div>
          <span className="text-[var(--muted)]">{r.how} {r.cards.slice(0, 8).join(', ')}{r.cards.length > 8 ? '…' : ''}</span>
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className={r.needsCommander ? 'text-amber-300' : 'text-[var(--muted)]'}>{r.needsCommander ? 'Needs the commander' : 'Works without the commander'}</span>
            {!r.dropped && <CardPick names={cardNames.filter((n) => !r.cards.includes(n))} label="Add a card to it" disabled={busy} onPick={(n) => change({ routes: { addCard: { route: r.id, card: n } } })} />}
          </span>
        </div>
      ))}
      {adding ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-2 text-sm">
          <input aria-label="Name of the way to win" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Treasure drain" className={`${INPUT} w-44`} />
          <input aria-label="Its cards, separated by commas" value={cards} onChange={(e) => setCards(e.target.value)} placeholder="Its cards, separated by commas" className={`${INPUT} min-w-0 flex-[1_1_16rem]`} />
          <button onClick={async () => { await change({ routes: { custom: { label, how: '', cards: cards.split(',').map((x) => x.trim()).filter((x) => cardNames.includes(x)) } } }); setAdding(false); setLabel(''); setCards(''); }} disabled={busy || !label.trim()} className={OK}>Add</button>
          <button onClick={() => setAdding(false)} className={BUTTON}>Cancel</button>
        </div>
      ) : <button onClick={() => setAdding(true)} className="w-fit text-xs text-[var(--accent)] hover:underline">+ A way to win</button>}
    </div>
  );
}

function Changes({ plan, busy, change }: { plan: api.DeckPlanState; busy: boolean; change: Change }) {
  const on = plan.changes;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] pb-1.5">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-semibold">Changes to the usual rules <Tip label="About changes to the usual rules">The usual rules fit most decks. You, or Claude with your say-so, can change any of them for this deck. Yours win, then Claude&apos;s accepted changes, then what was detected. Legality never changes.</Tip></h3>
        <span className="text-xs text-[var(--muted)]">{on.filter((c) => c.on).length} for this deck</span>
      </div>
      {on.length === 0 ? <p className="text-sm text-[var(--muted)]">None. The usual rules apply everywhere.</p> : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {on.map((c) => (
            <li key={c.id} className={`flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ${c.on ? '' : 'opacity-55'}`}>
              <span className="flex flex-wrap items-center justify-between gap-2"><b>{c.what}</b><span className={`rounded-md px-1.5 text-[11px] leading-5 ${SOURCE[c.by][1]}`}>{SOURCE[c.by][0]}</span></span>
              <span className="text-[var(--muted)]">{c.why}</span>
              <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--faint)]">Affects: {c.affects}
                {c.undo ? <button onClick={() => change(c.undo!)} disabled={busy} className="text-[var(--muted)] underline hover:text-[var(--foreground)]">{c.on ? 'Undo' : 'Turn back on'}</button> : <span>{c.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RulesPage({ rules }: { rules: api.RuleLine[] }) {
  const groups = [...new Set(rules.map((r) => r.group))];
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="font-display text-lg font-semibold">How the plan is worked out</h3>
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">{g}</h4>
          <ul className="flex flex-col">
            {rules.filter((r) => r.group === g).map((r) => (
              <li key={`${g}:${r.name}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-0.5 border-t border-dashed border-[var(--border)] py-1.5 text-sm first:border-t-0">
                <span className="min-w-0 flex-[1_1_24rem]"><b>{r.name}:</b> <span className="text-[var(--muted)]">{r.rule}</span></span>
                <span className="text-right tabular-nums">{r.changed ? <span className="text-violet-200">{r.setting} · {r.changed}</span> : r.setting}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
