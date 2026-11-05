'use client';

/**
 * The Tune tab: change the deck toward its plan. Pick what you want to do -
 * finish the deck, find cards, swaps and upgrades, cuts, fix a problem,
 * lands; the deck's state picks one for you. Suggestions wait in groups
 * until you accept a group or a single card, save it to a section, or
 * dismiss it. Accepted cards go to Your changes, which shows what they
 * would do to the deck and touches nothing until you apply it.
 *
 * Every suggestion has a How?: what went in and which rules moved it.
 * Claude's ideas join the same groups, read against the plan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AiModelPicker from './AiModelPicker';
import CutRules from './CutRules';
import ManaCost from './ManaCost';
import PlanLine from './PlanLine';
import Tip from './Tip';
import { AI_READS } from '@/lib/ai-reads';
import * as api from '@/lib/api';
import type { CutSettings } from '@/lib/cut-rules';
import { capToHundred, CUT_FILTERS, INTENTS, SYMPTOMS, type CutFilter, type Intent, type Staged, type Suggestion, type SuggestionGroup, type Symptom } from '@/lib/tune-shared';
import type { DeckSection } from '@/lib/sections-shared';
import type { DeckTab } from '@/lib/deck-tabs';
import type { Job } from '@/lib/jobs';

interface Props {
  listId: string;
  /** Changes when the deck does, to read Tune again. */
  version: string;
  sections: DeckSection[];
  brief: string;
  styleLabel?: string | null;
  tagNames: string[];
  /** After applying, the deck page reads the deck again. */
  onChanged: () => Promise<void> | void;
  onTab: (tab: DeckTab | string) => void;
  /** Open Chat with this question ready to send. */
  onAsk: (question: string) => void;
}

const BUTTON = 'rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--surface-hover)] disabled:opacity-50';
const GHOST = 'rounded-full px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50';
const POLL_MS = 2_500;

const remembered = (listId: string): Intent | null => {
  try { const v = sessionStorage.getItem(`mtg-tune:${listId}`); return INTENTS.some((i) => i.id === v) ? v as Intent : null; } catch { return null; }
};

export default function DeckTune({ listId, version, sections, brief, styleLabel, tagNames, onChanged, onTab, onAsk }: Props) {
  const [intent, setIntent] = useState<Intent | null>(() => remembered(listId));
  const [symptom, setSymptom] = useState<Symptom>('gas');
  const [state, setState] = useState<api.TuneState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  const [filter, setFilter] = useState<CutFilter | 'all'>('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const [rules, setRules] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [reviewJob, setReviewJob] = useState<Job | null>(null);
  const [cutsTo, setCutsTo] = useState<string | null>(null);
  const loadId = useRef(0);

  const load = useCallback(async (next?: Intent | null, sym?: Symptom) => {
    const id = ++loadId.current;
    try {
      const s = await api.tune(listId, next ?? undefined, sym);
      if (id !== loadId.current) return;
      setState(s);
      setError(null);
      if (!next) setIntent(s.intent);
    } catch (e) {
      if (id === loadId.current) setError(e instanceof Error ? e.message : 'Couldn’t read the deck just now');
    }
  }, [listId]);

  useEffect(() => {
    const id = ++loadId.current;
    api.tune(listId, intent ?? undefined, symptom)
      .then((s) => { if (id === loadId.current) { setState(s); setError(null); if (!intent) setIntent(s.intent); } })
      .catch((e) => { if (id === loadId.current) setError(e instanceof Error ? e.message : 'Couldn’t read the deck just now'); });
  }, [listId, intent, symptom, version]);

  // Claude's ideas and the cut review run in the background: look until they finish, then read Tune again.
  useEffect(() => {
    let stop = false;
    const look = async () => {
      const [ideas, review] = await Promise.all([api.tuneIdeasJob(listId).catch(() => ({ job: null })), api.cutReview(listId).catch(() => null)]);
      if (stop) return;
      setJob(ideas.job?.status === 'running' ? ideas.job : ideas.job?.status === 'failed' ? ideas.job : null);
      setReviewJob(review?.job ?? null);
    };
    void look();
    return () => { stop = true; };
  }, [listId]);
  useEffect(() => {
    if (job?.status !== 'running' && reviewJob?.status !== 'running') return;
    const timer = setInterval(async () => {
      const [ideas, review] = await Promise.all([api.tuneIdeasJob(listId).catch(() => ({ job: null })), api.cutReview(listId).catch(() => null)]);
      const ideasDone = job?.status === 'running' && ideas.job?.status !== 'running';
      const reviewDone = reviewJob?.status === 'running' && review?.job?.status !== 'running';
      setJob(ideas.job?.status === 'running' || ideas.job?.status === 'failed' ? ideas.job : null);
      setReviewJob(review?.job ?? null);
      if (ideasDone || reviewDone) void load(intent, symptom);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [job, reviewJob, listId, load, intent, symptom]);

  const pick = (next: Intent) => {
    setIntent(next);
    setFilter('all');
    try { sessionStorage.setItem(`mtg-tune:${listId}`, next); } catch { /* not remembered, still works */ }
  };

  const act = async (work: () => Promise<unknown>, after?: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load(intent, symptom);
      if (after) setNote({ text: after });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that');
    } finally {
      setBusy(false);
    }
  };

  const staged = useMemo(() => new Set(state?.staged ?? []), [state]);
  const dismissed = useMemo(() => new Set(state?.dismissed ?? []), [state]);
  if (error && !state) return <p className="mt-8 text-center text-red-400">{error}</p>;
  if (!state) return <p className="mt-8 text-center text-[var(--muted)]">Reading the deck…</p>;

  const current = intent ?? state.intent;
  const sizeAfter = state.impact.size.after;
  const stage = (items: Suggestion[]) => act(async () => {
    const r = await api.tuneAct<{ staged: number; capped: number }>(listId, { action: 'stage', items });
    if (r.capped) setNote({ text: `${r.staged} staged. ${r.capped} more would take the deck under 100: a cut now needs an add.` });
  });
  const unstage = (keys: string[]) => act(() => api.tuneAct(listId, { action: 'unstage', keys }));
  const dismiss = (keys: string[], on = true) => act(() => api.tuneAct(listId, { action: on ? 'dismiss' : 'undismiss', keys }));
  const save = (section: string, items: Suggestion[]) => act(async () => {
    const r = await api.tuneAct<{ saved: number }>(listId, { action: 'save', section, items });
    await onChanged();
    setNote({ text: `${r.saved} saved to ${sections.find((s) => s.id === section)?.name ?? 'the section'}.` });
  });
  const keep = (cardId: string) => act(async () => { await api.tuneAct(listId, { action: 'keep', cardId, keep: true }); await onChanged(); }, '★ Kept: never offered as a cut again.');
  const apply = () => act(async () => {
    const r = await api.tuneAct<{ added: number; cut: number; undo: { add: Staged[]; cut: Staged[] } }>(listId, { action: 'apply', cutsTo: cutsTo ?? undefined });
    await onChanged();
    const undoItems: Suggestion[] = [
      // A swap undone is a swap: put each pair back together.
      ...r.undo.add.map((a) => ({ key: `undo:${a.key}`, add: { ...a.card, quantity: a.quantity }, cut: r.undo.cut.find((c) => c.pair && c.pair === a.pair)?.card, why: 'Undo' } as Suggestion)),
      ...r.undo.cut.filter((c) => !c.pair || !r.undo.add.some((a) => a.pair === c.pair)).map((c) => ({ key: `undo:${c.key}`, cut: { ...c.card, quantity: c.quantity }, why: 'Undo' } as Suggestion)),
    ];
    setNote({
      text: `Applied: +${r.added} −${r.cut}.${r.cut ? ` Cuts are in ${sections.find((s) => s.id === (cutsTo ?? state.cutsTo.id))?.name ?? state.cutsTo.name}.` : ''}`,
      undo: async () => {
        await api.tuneAct(listId, { action: 'stage', items: undoItems });
        await api.tuneAct(listId, { action: 'apply' });
        await onChanged();
      },
    });
  });
  const ask = () => act(async () => setJob((await api.startTuneIdeas(listId, current, instructions, current === 'fix' ? symptom : undefined)).job));
  const startReview = (mode: 'top' | 'whole') => act(async () => setReviewJob((await api.startCutReview(listId, instructions, mode)).job));

  // Cuts on their own stop at 100; a cut paired with an add doesn't move the size.
  const cutRoom = Math.max(0, sizeAfter - 100);
  const groups = state.groups.filter((g) => current !== 'cuts' || filter === 'all' || g.filter === filter);
  const visible = (g: SuggestionGroup) => (showDismissed ? g.items : g.items.filter((i) => !dismissed.has(i.key)));
  const hiddenCount = state.groups.reduce((n, g) => n + g.items.filter((i) => dismissed.has(i.key)).length, 0);

  return (
    <div className="mt-5 flex flex-col gap-5" data-tour="tune">
      <PlanLine data-tour="tune-plan" brief={brief} note={styleLabel ?? undefined} action="Edit" onAction={() => onTab('plan')} />

      <div role="tablist" aria-label="What do you want to do?" data-tour="tune-intents" className="flex flex-wrap gap-1.5">
        {INTENTS.map((i) => {
          const on = i.id === current;
          const badge = state.badges[i.id];
          return (
            <button key={i.id} role="tab" aria-selected={on} data-intent={i.id} onClick={() => pick(i.id)} title={i.why}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm ${on ? 'id-grad border-transparent font-semibold text-[#15110a]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'}`}>
              {i.label}
              {badge && <span className={`rounded-full px-1.5 text-[11px] font-bold ${on ? 'bg-black/25 text-[#15110a]' : 'bg-[#ffb4a8] text-[#1c0d06]'}`}>{badge}</span>}
              {i.id === state.suggested && <span className="text-[10px] uppercase tracking-wide opacity-70">suggested</span>}
            </button>
          );
        })}
      </div>

      <Changes state={state} sections={sections} busy={busy} cutsTo={cutsTo ?? state.cutsTo.id} onCutsTo={setCutsTo}
        onUnstage={(k) => unstage([k])} onClear={() => act(() => api.tuneAct(listId, { action: 'clear' }))} onApply={apply} />

      {note && (
        <p role="status" className="flex max-w-3xl flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm">
          <span className="min-w-0 flex-1">{note.text}</span>
          {note.undo && <button className={BUTTON} disabled={busy} onClick={() => { const u = note.undo!; setNote(null); void act(u, 'Undone.'); }}>Undo</button>}
          <button className={GHOST} onClick={() => setNote(null)} aria-label="Close">✕</button>
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      <section className="flex flex-col gap-4" data-section={INTENTS.find((i) => i.id === current)!.label}>
        <p className="flex max-w-3xl items-start gap-2 text-sm text-[var(--muted)]">
          <span>{INTENTS.find((i) => i.id === current)!.why}</span>
        </p>

        {current === 'cuts' && <CutsBar state={state} filter={filter} onFilter={setFilter} rules={rules} onRules={() => setRules((r) => !r)} />}
        {current === 'cuts' && rules && state.cuts && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><CutRules listId={listId} settings={state.cuts.settings as CutSettings} tagNames={tagNames} onSaved={() => void load(intent, symptom)} /></div>
        )}
        {current === 'fix' && <FixBar state={state} symptom={symptom} onSymptom={setSymptom} busy={busy}
          onVerdict={(id, verdict) => act(() => api.tuneAct(listId, { action: 'verdict', id, verdict }), verdict === 'worse' ? 'The fix is staged to be undone in Your changes.' : 'Noted.')} />}
        {current === 'lands' && state.lands && <LandsBar lands={state.lands} />}
        {current === 'find' && state.pile && <PileQuestion pile={state.pile} busy={busy} onPick={(choice) => choice === 'cut' ? pick('cuts') : act(() => api.tuneAct(listId, { action: 'pile', choice }))} />}

        <AskClaude intent={current} busy={busy} job={current === 'cuts' ? reviewJob : job} instructions={instructions} onInstructions={setInstructions}
          onAsk={current === 'cuts' ? undefined : ask} onReview={current === 'cuts' ? startReview : undefined} onChat={() => onAsk(`Help me tune this deck: ${INTENTS.find((i) => i.id === current)!.label.toLowerCase()}.${instructions.trim() ? ` ${instructions.trim()}` : ''}`)} />

        {groups.length === 0 && !(current === 'find' && state.pile && !state.pile.choice) && (
          <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">
            {current === 'cuts' && state.impact.size.before <= 100 ? 'The deck is at 100 or under: nothing needs to come out. Swaps & upgrades pairs a cut with an add.'
              : current === 'swaps' && !state.pool ? 'Nothing waits in a section set to “Might go in”, and no upgrade beats what the deck has. Find cards can save some to your Maybeboard.'
                : 'Nothing to suggest here right now.'}
          </p>
        )}
        <div className="flex flex-col gap-3" data-tour="tune-groups">
          {groups.map((g) => (
            <Group key={g.key} group={g} items={visible(g)} staged={staged} dismissed={dismissed} busy={busy} cutRoom={cutRoom}
              sections={sections} onStage={stage} onUnstage={unstage} onDismiss={dismiss} onSave={save} onKeep={keep} />
          ))}
        </div>
        {hiddenCount > 0 && (
          <button className={`${GHOST} self-start`} onClick={() => setShowDismissed((v) => !v)}>{showDismissed ? 'Hide dismissed' : `Show ${hiddenCount} dismissed`}</button>
        )}
      </section>
    </div>
  );
}

// --- Your changes -------------------------------------------------------------------

function Changes({ state, sections, busy, cutsTo, onCutsTo, onUnstage, onClear, onApply }: {
  state: api.TuneState; sections: DeckSection[]; busy: boolean; cutsTo: string; onCutsTo: (id: string) => void;
  onUnstage: (key: string) => void; onClear: () => void; onApply: () => void;
}) {
  const { add, cut } = state.changes;
  const total = (l: Staged[]) => l.reduce((n, s) => n + s.quantity, 0);
  const after = state.impact.size.after;
  const outs = [...sections].sort((a, b) => Number(b.purpose === 'out') - Number(a.purpose === 'out'));
  const empty = !add.length && !cut.length;
  const pairOf = (s: Staged) => (s.pair ? [...add, ...cut].find((x) => x.pair === s.pair && x.key !== s.key) : null);
  return (
    <section data-tour="tune-changes" data-section="Your changes" className="flex flex-col gap-3 rounded-2xl border border-[var(--accent)]/50 bg-[var(--accent)]/[0.04] p-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="font-display text-lg font-semibold">Your changes</h3>
        {empty
          ? <span className="text-sm text-[var(--muted)]">Nothing yet. What you accept below lands here, and nothing touches the deck until you apply it.</span>
          : (<>
            <span className="text-sm tabular-nums"><b className="text-emerald-300">+{total(add)}</b> to add · <b className="text-[#ffb4a8]">−{total(cut)}</b> to cut</span>
            <span className="text-sm">Deck after: <b className={after === 100 ? 'text-emerald-300' : 'text-amber-300'}>{after}</b></span>
            <label className="flex items-center gap-2 text-sm">Cuts go to
              <select value={cutsTo} onChange={(e) => onCutsTo(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm">
                {outs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Tip label="Where cuts go">Cuts move to this section with the reason they were cut, so you can bring one back. It starts as the first section set to “Came out”.</Tip>
            </label>
            <span className="flex-1" />
            <button className={GHOST} onClick={onClear} disabled={busy}>Clear</button>
            <button className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-60" onClick={onApply} disabled={busy}>Apply changes</button>
          </>)}
      </div>
      {!empty && (
        <div className="grid gap-3 sm:grid-cols-2">
          {([['To add', add, 'text-emerald-300'], ['To cut', cut, 'text-[#ffb4a8]']] as const).map(([label, list, tone]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1 text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">{label}</span>
              {list.length ? list.map((s) => (
                <span key={s.key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate"><span className={tone}>{s.quantity > 1 ? `${s.quantity}× ` : ''}{s.card.name}</span>{pairOf(s) && <span className="text-xs text-[var(--muted)]"> ⇄ {pairOf(s)!.card.name}</span>}</span>
                  <button className="shrink-0 px-1 text-[var(--muted)] hover:text-red-300" onClick={() => onUnstage(s.key)} aria-label={`Take ${s.card.name} out of your changes`} disabled={busy}>×</button>
                </span>
              )) : <span className="text-[var(--muted)]">–</span>}
            </div>
          ))}
        </div>
      )}
      <Impact impact={state.impact} />
    </section>
  );
}

function Impact({ impact }: { impact: api.TuneState['impact'] }) {
  const n = (x: number) => (Math.round(x * 10) / 10).toString();
  const gc = impact.gameChangers;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="What your changes do to the deck">
      {impact.rows.map((r) => {
        const inRange = r.range ? r.after >= r.range[0] && r.after <= r.range[1] : true;
        const moved = r.after !== r.before;
        return (
          <span key={r.id} className={`inline-flex items-baseline gap-1 rounded-lg border px-2 py-0.5 text-xs tabular-nums ${r.range ? (inRange ? 'border-emerald-500/40' : 'border-[#ffb4a8]/60') : 'border-[var(--border)]'}`}>
            {r.label} {moved ? <><span className="text-[var(--muted)]">{n(r.before)} →</span> <b className={r.range ? (inRange ? 'text-emerald-300' : 'text-[#ffb4a8]') : 'text-amber-300'}>{n(r.after)}</b></> : <b>{n(r.after)}</b>}
            {r.range && <span className="text-[10px] text-[var(--faint)]">{r.range[0]}–{r.range[1]}</span>}
            {r.id === 'impulse' && <Tip label="About impulse draw">Exile-and-play cards. They dig but don’t refill your hand, so they are counted apart from card draw everywhere.</Tip>}
          </span>
        );
      })}
      <span className="inline-flex items-baseline gap-1 rounded-lg border border-[var(--border)] px-2 py-0.5 text-xs tabular-nums">Average cost {impact.averageMv.after !== impact.averageMv.before ? <><span className="text-[var(--muted)]">{impact.averageMv.before.toFixed(2)} →</span> <b>{impact.averageMv.after.toFixed(2)}</b></> : <b>{impact.averageMv.after.toFixed(2)}</b>}</span>
      <span className={`inline-flex items-baseline gap-1 rounded-lg border px-2 py-0.5 text-xs tabular-nums ${gc.limit !== null && gc.after > gc.limit ? 'border-[#ffb4a8]/60' : 'border-[var(--border)]'}`}>
        ◆ Game Changers <b>{gc.after}</b>{gc.limit !== null && <span className="text-[10px] text-[var(--faint)]">up to {gc.limit}</span>}
      </span>
    </div>
  );
}

// --- the intents' own bits ---------------------------------------------------------

function CutsBar({ state, filter, onFilter, rules, onRules }: { state: api.TuneState; filter: CutFilter | 'all'; onFilter: (f: CutFilter | 'all') => void; rules: boolean; onRules: () => void }) {
  const counts = state.cuts?.counts ?? {};
  const over = state.impact.size.before - 100;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {over > 0 ? <><b className="tabular-nums">{over}</b> to cut{state.changes.cut.length ? `, ${Math.max(0, state.impact.size.after - 100)} after your changes` : ''}. </> : 'At 100 or under. '}
        <span className="text-[var(--muted)]">Lands aren’t offered while they’re in range; the Lands tab handles them.</span>{' '}
        {state.cuts?.type && <Tip label="How the deck is built">{state.cuts.type.why}</Tip>}
      </p>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Look at">
        {CUT_FILTERS.map((f) => {
          const n = f.id === 'all' ? counts.all : counts[f.id];
          if (f.id !== 'all' && !n) return null;
          return (
            <button key={f.id} onClick={() => onFilter(f.id)} aria-pressed={filter === f.id} title={f.why} data-cut-filter={f.id}
              className={`rounded-full border px-3 py-1 text-xs ${filter === f.id ? 'border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)]'}`}>
              {f.label}{n ? <span className="ml-1 tabular-nums opacity-70">· {n}</span> : null}
            </button>
          );
        })}
        <span className="flex-1" />
        <button className={GHOST} onClick={onRules} aria-expanded={rules} data-tour="cut-rules-toggle">{rules ? 'Hide the rules' : 'The rules behind it'}</button>
      </div>
      {Object.keys(state.cuts?.overridden ?? {}).length > 0 && (
        <p className="text-xs text-[var(--c1)]">Changed for this deck: {Object.values(state.cuts!.overridden).join('; ')}</p>
      )}
    </div>
  );
}

function FixBar({ state, symptom, onSymptom, busy, onVerdict }: { state: api.TuneState; symptom: Symptom; onSymptom: (s: Symptom) => void; busy: boolean; onVerdict: (id: string, v: 'better' | 'same' | 'worse') => void }) {
  const open = state.log.filter((l) => !l.verdict).slice(-2);
  return (
    <div className="flex flex-col gap-3">
      {open.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">On {new Date(l.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} you swapped {l.swaps.map((s) => `${s.add} for ${s.cut}`).join(', ')} for “{SYMPTOMS.find((x) => x.id === l.symptom)?.label.toLowerCase()}”. Did it help?</span>
          <button className={BUTTON} disabled={busy} onClick={() => onVerdict(l.id, 'better')}>Better</button>
          <button className={BUTTON} disabled={busy} onClick={() => onVerdict(l.id, 'same')}>Same</button>
          <button className={BUTTON} disabled={busy} onClick={() => onVerdict(l.id, 'worse')}>Worse, undo them</button>
        </div>
      ))}
      <h3 className="font-display text-lg font-semibold">What went wrong in your last games?</h3>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5" role="radiogroup" aria-label="What went wrong">
        {SYMPTOMS.map((s) => (
          <button key={s.id} role="radio" aria-checked={symptom === s.id} onClick={() => onSymptom(s.id)} data-symptom={s.id}
            className={`flex flex-col rounded-xl border px-3 py-2 text-left text-sm ${symptom === s.id ? 'border-[var(--accent)] bg-[var(--surface-hover)]' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
            <b className="font-semibold">{s.label}</b><span className="text-xs text-[var(--muted)]">{s.sub}</span>
          </button>
        ))}
      </div>
      {state.fix?.evidence.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">What the deck says</span>
          <ul className="mt-1 list-disc pl-5">{state.fix.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

function LandsBar({ lands }: { lands: NonNullable<api.TuneState['lands']> }) {
  const [how, setHow] = useState(false);
  const tone: Record<string, string> = { W: '#f3e6b8', U: '#8cc4ec', B: '#b49ae0', R: '#ef7d5c', G: '#8fd18f' };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">How many</span>
        <span className="font-display text-2xl tabular-nums">{lands.have} <span className="text-sm text-[var(--muted)]">of {lands.range[0]}–{lands.range[1]}{lands.mine ? ' (yours)' : ''}</span></span>
        <button className={`${GHOST} self-start px-0`} onClick={() => setHow((v) => !v)} aria-expanded={how}>{how ? 'Hide' : 'How?'}</button>
        {how && <HowBox how={lands.how} idea="Higher curves need more lands; cheap ramp and cheap draw let you run a few fewer. One number for Plan, Tune and Check." />}
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">Which colours</span>
        <div className="flex h-5 overflow-hidden rounded-md border border-[var(--border)]">
          {lands.colors.map((c) => <span key={c.color} style={{ width: `${Math.max(4, c.share)}%`, background: tone[c.color] }} className="flex items-center justify-center text-[10px] font-bold text-[#14110e]">{c.color} {c.share}%</span>)}
        </div>
        <ul className="text-xs text-[var(--muted)]">
          {lands.colors.map((c) => <li key={c.color}><ManaCost cost={`{${c.color}}`} size={12} /> {c.sources} sources{c.needed ? `, ${c.neededFor} wants ${c.needed}` : ''}</li>)}
        </ul>
        <span className="text-xs text-[var(--muted)]">Share of each colour’s symbols in your spells’ costs. Basics follow it, and the colour furthest from what its hungriest spell needs comes first.</span>
      </div>
    </div>
  );
}

function PileQuestion({ pile, busy, onPick }: { pile: NonNullable<api.TuneState['pile']>; busy: boolean; onPick: (c: 'fill' | 'best' | 'cut' | null) => void }) {
  const options: Array<[string, string, string]> = pile.over
    ? [['cut', 'Cut down to 100', `Keep what you have and trim the ${pile.main - 100} extra in Cuts.`], ['best', `Pick the best 100 from all ${pile.main + pile.pool}`, 'Everything is up for grabs: cards you might add can replace cards in the deck.']]
    : [['fill', 'Fill to 100', `Keep the ${pile.main} and add ${100 - pile.main}, from the cards you set aside first.`], ['best', `Pick the best 100 from all ${pile.main + pile.pool}`, 'Everything is up for grabs: cards you might add can replace cards in the deck.']];
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <b>{pile.main} in the deck, {pile.pool} you might add. What should happen?</b>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What should happen">
        {options.map(([id, title, sub]) => (
          <button key={id} role="radio" aria-checked={pile.choice === id} disabled={busy} onClick={() => onPick(id as 'fill' | 'best' | 'cut')} data-pile={id}
            className={`flex flex-col rounded-xl border px-3 py-2.5 text-left text-sm ${pile.choice === id ? 'border-[var(--accent)] bg-[var(--surface-hover)]' : 'border-[var(--border)]'}`}>
            <b>{title}</b><span className="text-xs text-[var(--muted)]">{sub}</span>
          </button>
        ))}
      </div>
      {pile.choice ? <button className={`${GHOST} self-start px-0`} onClick={() => onPick(null)}>Ask again</button> : <p className="text-xs text-[var(--muted)]">Nothing is suggested until you choose.</p>}
    </div>
  );
}

function AskClaude({ intent, busy, job, instructions, onInstructions, onAsk, onReview, onChat }: {
  intent: Intent; busy: boolean; job: Job | null; instructions: string; onInstructions: (v: string) => void;
  onAsk?: () => void; onReview?: (mode: 'top' | 'whole') => void; onChat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const running = job?.status === 'running';
  return (
    <div className="flex flex-col gap-2" data-tour="tune-claude">
      <div className="flex flex-wrap items-center gap-2">
        {onReview ? (<>
          <button className={BUTTON} disabled={busy || running} onClick={() => onReview('top')} data-tour="cut-review">✦ Ask Claude to check the cuts</button>
          <button className={BUTTON} disabled={busy || running} onClick={() => onReview('whole')}>✦ Rate the whole deck</button>
          <Tip label="What Claude reads"><span className="font-semibold">What Claude reads:</span><ul className="mt-1 list-disc pl-4">{AI_READS.cutReview.map((x) => <li key={x}>{x}</li>)}</ul></Tip>
        </>) : (<>
          <button className={BUTTON} disabled={busy || running} onClick={onAsk}>✦ Ideas from Claude</button>
          <Tip label="What Claude reads"><span className="font-semibold">What Claude reads:</span><ul className="mt-1 list-disc pl-4">{AI_READS.tuneIdeas.map((x) => <li key={x}>{x}</li>)}</ul></Tip>
        </>)}
        <button className={GHOST} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Hide instructions' : 'Add instructions'}</button>
        <button className={GHOST} onClick={onChat}>Talk it through in Chat</button>
        <AiModelPicker area="deck" />
        {running && <span className="text-xs text-[var(--muted)]">{job?.detail || 'Claude is reading the deck'}…</span>}
        {job?.status === 'failed' && <span className="text-xs text-red-400">Claude didn’t finish: {job.error}</span>}
      </div>
      {open && (
        <textarea value={instructions} onChange={(e) => onInstructions(e.target.value)} rows={2} maxLength={2000} aria-label="Your instructions for Claude"
          placeholder={intent === 'cuts' ? 'e.g. Keep anything that attacks alone. I’d rather cut ramp than draw.' : 'e.g. Cards under $5. Lean into the graveyard.'}
          className="max-w-3xl resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" />
      )}
    </div>
  );
}

// --- a group of suggestions -------------------------------------------------------

function HowBox({ how, idea }: { how: { inputs: string[]; steps: string[] }; idea?: string }) {
  return (
    <div className="flex flex-col gap-1 border-l-2 border-[var(--border)] pl-3 text-xs text-[var(--muted)]">
      {how.inputs.length > 0 && <><span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)]">Inputs</span>{how.inputs.map((x) => <span key={x}>{x}</span>)}</>}
      {how.steps.length > 0 && <><span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)]">Steps</span>{how.steps.map((x) => <span key={x}>{x}</span>)}</>}
      {idea && <><span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)]">The idea</span><span>{idea}</span></>}
    </div>
  );
}

function CardLine({ card, tone }: { card: NonNullable<Suggestion['add']>; tone: 'in' | 'out' }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      <span className={`font-medium ${tone === 'in' ? 'text-emerald-300' : 'text-[#ffb4a8]'}`}>{tone === 'in' ? '+' : '−'} {card.quantity && card.quantity > 1 ? `${card.quantity}× ` : ''}{card.name}</span>
      {card.manaCost && <ManaCost cost={card.manaCost} size={13} />}
      {card.gameChanger && <span className="rounded border border-pink-300/50 px-1 text-[10px] font-bold text-pink-300" title="Game Changer">◆ GC</span>}
      {tone === 'in' && card.where && <span className="text-xs text-emerald-400/90">{card.where}</span>}
      {tone === 'in' && !card.where && card.price && <span className="text-xs text-[var(--muted)]">${card.price}</span>}
    </span>
  );
}

function Group({ group, items, staged, dismissed, busy, cutRoom, sections, onStage, onUnstage, onDismiss, onSave, onKeep }: {
  group: SuggestionGroup; items: Suggestion[]; staged: Set<string>; dismissed: Set<string>; busy: boolean; cutRoom: number; sections: DeckSection[];
  onStage: (items: Suggestion[]) => void; onUnstage: (keys: string[]) => void; onDismiss: (keys: string[], on?: boolean) => void;
  onSave: (section: string, items: Suggestion[]) => void; onKeep: (cardId: string) => void;
}) {
  const [how, setHow] = useState<string | null>(null);
  const open = items.filter((i) => !staged.has(i.key) && !dismissed.has(i.key) && !i.keep);
  const allStaged = items.length > 0 && items.every((i) => staged.has(i.key) || dismissed.has(i.key));
  const onlyCuts = open.filter((i) => i.cut && !i.add);
  const acceptable = group.pickOne ? [] : [...open.filter((i) => !(i.cut && !i.add)), ...capToHundred(onlyCuts, 100 + cutRoom)];
  const addsOnly = open.filter((i) => i.add && !i.cut);
  const savable = sections.filter((s) => s.purpose !== 'out');
  const pickedOne = group.pickOne && items.some((i) => staged.has(i.key));
  if (!items.length) return null;
  return (
    <div className={`flex flex-col rounded-2xl border bg-[var(--surface)] ${group.source === 'claude' ? 'border-[var(--c1)]/50' : 'border-[var(--border)]'} ${allStaged ? 'opacity-70' : ''}`} data-group={group.key}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-3.5 py-2.5">
        <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-0.5">
          <h4 className="flex flex-wrap items-center gap-2 font-semibold">{group.title}{group.source === 'claude' && <span className="rounded bg-[var(--c1)]/20 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--c1)]">Claude</span>}</h4>
          <span className="text-sm text-[var(--muted)]">{group.why}</span>
        </div>
        {!group.pickOne && open.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5">
            <button className="btn-go rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy || !acceptable.length} onClick={() => onStage(acceptable)}
              title={onlyCuts.length > acceptable.filter((i) => i.cut && !i.add).length ? 'Cuts on their own stop at 100' : undefined}>
              Accept {acceptable.length === open.length ? 'all' : acceptable.length} {acceptable.reduce((n, i) => n + (i.add?.quantity ?? i.cut?.quantity ?? 1), 0) !== acceptable.length ? `(${acceptable.reduce((n, i) => n + (i.add?.quantity ?? i.cut?.quantity ?? 1), 0)} cards)` : ''}
            </button>
            {addsOnly.length > 0 && savable.length > 0 && (
              <select aria-label="Save these to a section" value="" disabled={busy} onChange={(e) => e.target.value && onSave(e.target.value, addsOnly)}
                className="rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs">
                <option value="">Save to…</option>
                {savable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <button className={GHOST} disabled={busy} onClick={() => onDismiss(open.map((i) => i.key))}>Dismiss</button>
          </span>
        )}
      </div>
      <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
        {items.map((i) => {
          const isStaged = staged.has(i.key);
          const isDismissed = dismissed.has(i.key);
          const cutOnly = !!i.cut && !i.add && !i.keep;
          const blocked = cutOnly && !isStaged && cutRoom <= 0;
          return (
            <li key={i.key} className={`flex flex-col gap-1 px-3.5 py-2 text-sm ${isStaged ? 'bg-emerald-500/[0.05]' : ''} ${isDismissed ? 'opacity-50' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {i.add && <CardLine card={i.add} tone="in" />}
                    {i.add && i.cut && <span className="text-[var(--muted)]" aria-label="replacing">⇄</span>}
                    {i.cut && <CardLine card={i.cut} tone="out" />}
                    {i.keep && <span className="text-xs font-semibold text-emerald-300">Claude says keep</span>}
                  </span>
                  <span className="text-xs text-[var(--muted)]">{i.why}</span>
                  {i.warn && <span className="text-xs text-amber-300">{i.warn}</span>}
                  {i.breaks && <span className="text-xs text-[var(--c1)]">Goes against “{i.breaks}”, on purpose</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {i.how && <button className={GHOST} onClick={() => setHow(how === i.key ? null : i.key)} aria-expanded={how === i.key}>How?</button>}
                  {isStaged ? (<><span className="text-xs text-emerald-300">In your changes</span><button className={GHOST} disabled={busy} onClick={() => onUnstage([i.key])}>Undo</button></>)
                    : isDismissed ? <button className={GHOST} disabled={busy} onClick={() => onDismiss([i.key], false)}>Bring back</button>
                      : i.keep ? (<><button className={BUTTON} disabled={busy} onClick={() => onKeep(i.cut!.id)}>★ Keep</button><button className={GHOST} disabled={busy} onClick={() => onDismiss([i.key])} aria-label="Dismiss">✕</button></>)
                        : (<>
                          <button className={BUTTON} disabled={busy || blocked || (group.pickOne && pickedOne)} onClick={() => onStage([i])} title={blocked ? 'At 100: a cut on its own would take the deck under. Pair it with an add.' : undefined}>
                            {group.pickOne ? 'Swap' : i.add && i.cut ? 'Stage swap' : 'Accept'}
                          </button>
                          <button className={GHOST} disabled={busy} onClick={() => onDismiss([i.key])} aria-label="Dismiss">✕</button>
                        </>)}
                </span>
              </div>
              {how === i.key && i.how && <HowBox how={i.how} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
