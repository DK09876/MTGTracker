'use client';

/**
 * Trim: cut a deck that is over 100 down to 100 (lib/trim.ts). Three steps:
 * an approach (drafted from the deck's numbers, written by Claude, or your
 * own; skippable), Claude's ranked list with its cuts already chosen, then
 * review and apply. Choosing is instant: your choices are kept in the page
 * and saved in the background, which also brings back what they do to the
 * deck's numbers. Claude runs in the background and the list is kept with
 * the deck, so leaving the page loses nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ManaCost from './ManaCost';
import Tip from './Tip';
import * as api from '@/lib/api';
import type { DeckSection } from '@/lib/sections-shared';
import {
  chosenCuts, CUT_CHIPS, KEEP_CHIPS, saidSomething, TRIM_CHIP_LABELS,
  type TrimChoice, type TrimItem, type TrimTier, type TrimView,
} from '@/lib/trim-shared';

interface Props {
  listId: string;
  /** Changes when the deck does, to read Trim again. */
  version: string;
  sections: DeckSection[];
  /** After applying or undoing, the deck page reads the deck again. */
  onChanged: () => Promise<void> | void;
  onTab: (tab: string) => void;
}

type Step = 'approach' | 'cuts' | 'review';

const CARD = 'rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4';
const BUTTON = 'rounded-full border border-[var(--border)] px-3.5 py-1.5 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';
const GO = 'btn-go rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-60';
const INPUT = 'rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]';
const POLL_MS = 2_500;
const SAVE_MS = 350;

const money = (c: { usd: number; measured: boolean }) => `about ${c.usd < 0.995 ? `${Math.max(1, Math.round(c.usd * 100))}¢` : `$${c.usd.toFixed(2)}`}${c.measured ? '' : ', estimated'}`;
const ago = (at: string | null) => {
  if (!at) return '';
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};
const TIER_TITLE: Record<TrimTier, [string, string]> = {
  cut: ['Claude’s cuts', 'Already chosen. Tap one to keep it.'],
  maybe: ['Closer calls', 'In order, not chosen. Tap one to cut it.'],
  kept: ['Kept on purpose', 'Cards a quick look would cut, and why Claude left them in. You can still cut them.'],
  yours: ['Kept by you', 'From the list before. Not suggested again.'],
};

export default function DeckTrim({ listId, version, sections, onChanged, onTab }: Props) {
  const [view, setView] = useState<TrimView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  // Your choices as you make them: shown at once, saved a moment later.
  const [choices, setChoices] = useState<Record<string, TrimChoice>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [text, setText] = useState(() => { try { return localStorage.getItem('mtg-trim-text') !== 'off'; } catch { return true; } });
  const [own, setOwn] = useState<string | null>(null);
  const [correction, setCorrection] = useState('');
  const [cutsTo, setCutsTo] = useState<string | null>(null);
  const dirty = useRef(false);
  const runId = useRef<string | null>(null);

  // What the server says, taken in: the list's choices only when it is a new list or nothing is waiting to be saved.
  const take = useCallback((v: TrimView) => {
    setView(v);
    setError(null);
    if (runId.current !== (v.run?.id ?? null) || !dirty.current) { setChoices(v.choices); if (runId.current !== (v.run?.id ?? null)) setOpen({}); }
    if (runId.current !== (v.run?.id ?? null) && v.run && runId.current !== null) setStep('cuts');
    runId.current = v.run?.id ?? null;
  }, []);

  useEffect(() => {
    let stop = false;
    api.trim(listId).then((v) => { if (!stop) { take(v); setCorrection(v.correction); } }).catch((e) => { if (!stop) setError(e instanceof Error ? e.message : 'Couldn’t read the deck just now'); });
    return () => { stop = true; };
  }, [listId, version, take]);

  // Claude runs in the background: look until it finishes.
  const running = view?.job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void api.trim(listId).then(take).catch(() => {}); }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, listId, take]);

  // Choices are saved a moment after the last change; the answer carries what they do to the numbers.
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      void api.trimAct(listId, { action: 'choices', choices }).then((v) => { if (!dirty.current) setView(v); }).catch(() => { dirty.current = true; });
    }, SAVE_MS);
    return () => clearTimeout(timer);
  }, [choices, listId]);

  useEffect(() => {
    if (correction === (view?.correction ?? '')) return;
    const timer = setTimeout(() => { void api.trimAct(listId, { action: 'correction', text: correction }).catch(() => {}); }, 600);
    return () => clearTimeout(timer);
  }, [correction, listId, view?.correction]);

  const act = async (action: api.TrimAction, after?: () => Promise<void> | void) => {
    setBusy(true);
    setError(null);
    try {
      // Anything typed or chosen goes first, so the request reads it.
      if (dirty.current) { dirty.current = false; await api.trimAct(listId, { action: 'choices', choices }); }
      if (correction !== (view?.correction ?? '')) await api.trimAct(listId, { action: 'correction', text: correction });
      take(await api.trimAct(listId, action));
      await after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that');
    } finally {
      setBusy(false);
    }
  };

  const items = useMemo(() => view?.run?.items ?? [], [view]);
  const cuts = useMemo(() => chosenCuts(items, choices), [items, choices]);
  if (error && !view) return <p className="mt-4 text-sm text-red-400">{error}</p>;
  if (!view) return <p className="mt-4 text-sm text-[var(--muted)]">Reading the deck…</p>;

  const over = view.over;
  const at: Step = step ?? (view.run ? 'cuts' : 'approach');
  const cutsRunning = running && view.job?.kind === 'cuts';
  const approachRunning = running && view.job?.kind === 'approach';
  const choose = (item: TrimItem, change: Partial<TrimChoice> | null) => {
    dirty.current = true;
    setChoices((c) => {
      const next = { ...c };
      if (change === null) delete next[item.name];
      else next[item.name] = { choice: c[item.name]?.choice ?? (item.tier === 'cut' ? 'cut' : 'keep'), chip: c[item.name]?.chip ?? null, text: c[item.name]?.text ?? '', ...change };
      // Back to the list's own call with no reason: nothing to keep.
      const now = next[item.name];
      if (now && !saidSomething(item, now)) delete next[item.name];
      return next;
    });
  };
  const toggle = (item: TrimItem) => {
    const isCut = cuts.includes(item.name);
    // A new call starts without the old reason: "pet card" is no reason to cut.
    choose(item, { choice: isCut ? 'keep' : 'cut', chip: null, text: '' });
    // Keeping one of Claude's cuts is worth a word: the box opens, and can be ignored.
    if (isCut && item.tier === 'cut') setOpen((o) => ({ ...o, [item.name]: true }));
  };
  const reasons = items.filter((i) => choices[i.name]?.chip || choices[i.name]?.text?.trim()).length;
  const changed = items.filter((i) => saidSomething(i, choices[i.name])).length;
  const n = cuts.length;
  const hint = n < over ? `Pick ${over - n} more, from the closer calls or anywhere below.` : n > over ? `${n - over} too many: keep ${n - over} of them.` : `Exactly ${over}. Ready to review.`;
  const outs = [...sections].sort((a, b) => Number(b.purpose === 'out') - Number(a.purpose === 'out'));
  const refused = items.filter((i) => (i.tier === 'cut' || i.tier === 'yours') && !cuts.includes(i.name));
  const reasonWords = (c?: TrimChoice) => [c?.chip ? TRIM_CHIP_LABELS[c.chip] : '', c?.text?.trim() ?? ''].filter(Boolean).join(': ');

  // --- done: what happened, and the way back --------------------------------------------
  if (view.done) {
    const d = view.done;
    return (
      <section className={`${CARD} flex flex-col gap-3`} data-tour="trim-done" data-section="Trim">
        <h3 className="font-display text-2xl font-semibold">{d.size === 100 ? 'The deck is at 100 cards' : `The deck is at ${d.size} cards${d.size > 100 ? `, ${d.size - 100} over` : ''}`}</h3>
        <p className="text-sm text-[var(--muted)]">{d.cut} card{d.cut === 1 ? '' : 's'} moved to {d.to}, each with its reason. A snapshot from before is in History.</p>
        <p className="text-xs text-[var(--faint)]">Kept in the suggestion log: {d.logged.accepted} cut, {d.logged.refused} of Claude’s cuts kept, {d.logged.left} closer calls left alone, {d.logged.reasons} with a reason.</p>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button className={GO} onClick={() => onTab('check')}>Check mana and curve</button>
          <button className={BUTTON} disabled={busy} onClick={() => act({ action: 'undo' }, async () => { setStep('cuts'); await onChanged(); })}>Undo</button>
          {d.size > 100 && <button className={BUTTON} disabled={busy} onClick={() => act({ action: 'reset' })}>Trim the rest</button>}
        </div>
      </section>
    );
  }

  if (over <= 0) {
    return <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">The deck is at 100 or under: nothing needs to come out.</p>;
  }

  const planNote = view.plan.state === 'none'
    ? 'This deck has no plan yet. Cuts are better with one: Claude ranks against how the deck wins. You can go on without it.'
    : view.plan.state === 'stale' ? 'The plan is out of date, so it won’t be sent. Read it again first, or go on without it.' : null;
  const find = (rerun = false) => act({ action: 'find', rerun });
  const groups = (['cut', 'maybe', 'kept', 'yours'] as TrimTier[]).map((t) => ({ tier: t, items: items.filter((i) => i.tier === t) })).filter((g) => g.items.length);

  return (
    <section className="flex flex-col gap-4" data-tour="trim" data-section="Trim">
      <nav aria-label="Trim steps" className="flex flex-wrap items-center gap-1.5">
        <h3 className="mr-2 font-display text-xl font-semibold">Trim to 100</h3>
        {([['approach', '1 · Approach'], ['cuts', '2 · Choose cuts'], ['review', '3 · Review and apply']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setStep(id)} aria-current={at === id ? 'step' : undefined} disabled={id !== 'approach' && !view.run}
            className={`rounded-full border px-3.5 py-1.5 text-sm disabled:opacity-40 ${at === id ? 'border-[var(--accent)] bg-[var(--surface-hover)] font-semibold' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'}`}>{label}</button>
        ))}
      </nav>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {view.job?.status === 'failed' && <p role="alert" className="text-sm text-red-400">Claude didn’t finish: {view.job.error}</p>}

      {cutsRunning && (
        <div role="status" className="flex flex-col gap-2 rounded-2xl border border-[var(--c1)]/50 bg-[var(--surface)] p-4">
          <b>{view.job?.detail || 'Claude is ranking the cuts'}…</b>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--c1)]" /></div>
          <span className="text-sm text-[var(--muted)]">Usually under a minute. It runs in the background: you can switch tabs or close the page, and the list will be here when you come back.</span>
        </div>
      )}

      {/* --- 1: the approach ------------------------------------------------------------- */}
      {at === 'approach' && (
        <div className="flex flex-col gap-4">
          {planNote && (
            <p role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-300/[0.05] px-3.5 py-2.5 text-sm">
              <span className="min-w-0 flex-1">{planNote}</span>
              <button className={BUTTON} onClick={() => onTab('plan')}>Open the plan</button>
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="flex flex-col gap-4 lg:col-span-3">
              <div className={`${CARD} flex flex-col gap-3`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h4 className="font-display text-lg font-semibold">{view.approach ? 'Approach' : `How should the ${over} cuts be chosen?`}</h4>
                  {view.approach && <span className="text-xs text-[var(--muted)]">{view.approach.by === 'owner' ? 'written by you' : view.approach.by === 'claude' ? 'written by Claude from the plan' : 'drafted from the deck’s numbers and your plan, no AI'}</span>}
                  <Tip label="About the approach">A few lines on where the cuts come from and what is protected. The cut list follows it, and you can skip it. In testing, a two-line correction to the approach changed 4 to 6 of 15 cuts.</Tip>
                </div>
                {own !== null ? (
                  <>
                    <textarea autoFocus value={own} onChange={(e) => setOwn(e.target.value)} rows={5} maxLength={2000} aria-label="Your approach"
                      placeholder="e.g. Cut the black removal first. Keep every counterspell and all the token makers." className={`${INPUT} w-full resize-y`} />
                    <div className="flex flex-wrap gap-2">
                      <button className={GO} disabled={busy || !own.trim()} onClick={() => act({ action: 'approach', text: own }, () => setOwn(null))}>Use this</button>
                      <button className={BUTTON} onClick={() => setOwn(null)}>Cancel</button>
                    </div>
                  </>
                ) : view.approach ? (
                  <>
                    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">{view.approach.text.split('\n').map((l) => l.replace(/^[-•]\s*/, '')).filter(Boolean).map((l) => <li key={l}>{l}</li>)}</ul>
                    <div className="flex flex-wrap gap-2">
                      <button className={BUTTON} disabled={busy} onClick={() => setOwn(view.approach!.text)}>Edit</button>
                      {view.approach.by !== 'code' && <button className={BUTTON} disabled={busy} onClick={() => act({ action: 'approach', draft: true })}>Draft from the numbers · free</button>}
                      <button className={BUTTON} disabled={busy || approachRunning || view.noKey} onClick={() => act({ action: 'approach', claude: true })}>{approachRunning ? 'Claude is writing…' : `✦ Write it with Claude · ${money(view.costs.approach)}`}</button>
                      <button className="px-2 text-sm text-[var(--muted)] underline hover:text-[var(--foreground)]" disabled={busy} onClick={() => act({ action: 'approach', clear: true })}>Remove</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-[var(--muted)]">A few lines on what to trim and what to protect. The cut list follows it. You can skip it.</p>
                    <div className="flex flex-wrap gap-2">
                      <button className={BUTTON} disabled={busy} onClick={() => act({ action: 'approach', draft: true })}>Draft from the deck’s numbers · free</button>
                      <button className={BUTTON} disabled={busy || approachRunning || view.noKey} onClick={() => act({ action: 'approach', claude: true })}>{approachRunning ? 'Claude is writing…' : `✦ Write it with Claude · ${money(view.costs.approach)}`}</button>
                      <button className={BUTTON} disabled={busy} onClick={() => setOwn('')}>Write my own</button>
                    </div>
                  </>
                )}
              </div>
              <label className={`${CARD} flex flex-col gap-2 text-sm`}>
                <span className="font-semibold">Anything to add or correct? One line.</span>
                <input value={correction} onChange={(e) => setCorrection(e.target.value)} maxLength={600} placeholder="e.g. keep all the token makers" className={INPUT} />
                <span className="text-xs text-[var(--faint)]">Sent with the cut list request, and saved to your notes on this deck.</span>
              </label>
            </div>
            <div className={`${CARD} flex flex-col gap-2 text-sm lg:col-span-2`}>
              <h4 className="font-display text-lg font-semibold">What Claude reads <span className="text-xs font-normal text-[var(--muted)]">for the cut list</span></h4>
              <ul className="flex list-disc flex-col gap-1 pl-5">{view.reads.map((r) => <li key={r}>{r}</li>)}</ul>
              {view.plan.text && view.plan.state === 'current' && <p className="border-t border-[var(--border)] pt-2 text-[var(--muted)]"><span className="text-[var(--foreground)]">The plan, read {ago(view.plan.at)}:</span> {view.plan.text}</p>}
              <p className="text-xs text-[var(--faint)]">Not sent: your other decks, your collection, other profiles.</p>
            </div>
          </div>
          <div className={`${CARD} flex flex-wrap items-center gap-x-5 gap-y-3`}>
            <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-2">
              <span className="text-sm font-semibold">Who ranks the cuts</span>
              <span className="text-sm text-[var(--muted)]">Claude Opus, {money(view.costs.opus)}.</span>
            </div>
            <button className={GO} disabled={busy || cutsRunning || view.noKey} onClick={() => find(false)} data-tour="trim-find">
              {cutsRunning ? 'Claude is ranking…' : view.run ? `✦ Find ${over} cuts again` : view.approach ? `✦ Find ${over} cuts` : `✦ Skip the approach and find ${over} cuts`}
            </button>
            {view.noKey && <span className="basis-full text-xs text-amber-300">No Claude key is set on the server, so the list can’t be made here. “Cuts by rule” under Other tools works without one.</span>}
          </div>
        </div>
      )}

      {/* --- 2: choose ----------------------------------------------------------------------- */}
      {at === 'cuts' && view.run && (
        <div className="flex flex-col gap-4">
          <div className="sticky top-[calc(env(safe-area-inset-top)+4rem)] z-10 flex flex-col gap-2 rounded-2xl border border-[var(--accent)]/50 bg-[var(--surface)] p-3 shadow-lg sm:p-3.5" data-tour="trim-bar">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <b className="font-display text-xl tabular-nums">{n} of {over} chosen</b>
              <span className={`min-w-0 flex-[1_1_12rem] text-sm ${n === over ? 'text-emerald-300' : n > over ? 'text-amber-300' : 'text-[var(--muted)]'}`}>{hint}</span>
              <button className={BUTTON} disabled={busy || cutsRunning || !changed} onClick={() => find(true)}
                title={changed ? 'Sends your choices and reasons back for a new list. The approach stays as it is.' : 'Keep or cut a card, or add a reason, and Claude can make a new list from it'}>
                ✦ Rerun with {reasons ? `my ${reasons} reason${reasons === 1 ? '' : 's'}` : `my ${changed || ''} change${changed === 1 ? '' : 's'}`.replace('  ', ' ')} · {money(view.costs[view.model])}
              </button>
              <button className={GO} disabled={busy || !n} onClick={() => setStep('review')}>Review and apply</button>
            </div>
            <div role="img" aria-label={`${n} of ${over} chosen`} className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, Math.round((n / over) * 100))}%` }} /></div>
            {/* On a phone the bar stays short: the numbers are on the review step. */}
            <div className="hidden sm:block"><Numbers rows={view.impact.rows} /></div>
          </div>
          {view.run.stale && (
            <p role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-300/[0.05] px-3.5 py-2 text-sm">
              <span className="min-w-0 flex-1">The deck changed since this list was made. Cards no longer in the deck are left out.</span>
              <button className={BUTTON} disabled={busy || cutsRunning} onClick={() => find(false)}>✦ Make a new list</button>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
            {view.run.notes && <span className="min-w-0 flex-[1_1_24rem]"><span className="text-[var(--foreground)]">Claude{view.run.round > 1 ? `, list ${view.run.round}` : ''}:</span> {view.run.notes}</span>}
            <label className="flex items-center gap-2"><input type="checkbox" checked={text} onChange={(e) => { setText(e.target.checked); try { localStorage.setItem('mtg-trim-text', e.target.checked ? 'on' : 'off'); } catch { /* not remembered */ } }} /> Card text</label>
          </div>
          {groups.map((g) => (
            <div key={g.tier} className="flex flex-col gap-2" data-trim-group={g.tier}>
              <div className="flex flex-wrap items-baseline gap-x-3"><h4 className="font-display text-lg font-semibold">{TIER_TITLE[g.tier][0]} · {g.items.length}</h4><span className="text-sm text-[var(--muted)]">{TIER_TITLE[g.tier][1]}</span></div>
              {g.items.map((i) => (
                <Row key={i.name} item={i} cut={cuts.includes(i.name)} choice={choices[i.name]} showText={text} open={open[i.name] ?? false}
                  onToggle={() => toggle(i)} onOpen={(v) => setOpen((o) => ({ ...o, [i.name]: v }))} onReason={(change) => choose(i, change)} />
              ))}
            </div>
          ))}
          <p className="text-xs text-[var(--faint)]">Lands: {view.lands.have} in the deck, usual {view.lands.range[0]}–{view.lands.range[1]}. The app never lets a cut take the deck under {Math.ceil(view.lands.floor)}.</p>
        </div>
      )}

      {/* --- 3: review and apply ----------------------------------------------------------- */}
      {at === 'review' && view.run && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-5">
            <div className={`${CARD} flex flex-col gap-3 lg:col-span-3`}>
              <h4 className="font-display text-lg font-semibold">Cutting {n} card{n === 1 ? '' : 's'}</h4>
              <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {items.filter((i) => cuts.includes(i.name)).map((i) => (
                  <li key={i.name} className="flex items-baseline gap-2"><span className="font-bold text-[#ffb4a8]" aria-hidden="true">−</span><span className="min-w-0 truncate">{i.name}</span>{i.flag && <span className="shrink-0 text-xs text-amber-300">{i.flag.split(':')[0]}</span>}</li>
                ))}
              </ul>
              {refused.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-3 text-sm">
                  <b className="font-semibold">Suggested cuts you kept</b>
                  <ul className="list-disc pl-5">{refused.map((i) => <li key={i.name}>{i.name} <span className="text-[var(--muted)]">· {reasonWords(choices[i.name]) || 'no reason given'}</span></li>)}</ul>
                  <span className="text-xs text-[var(--faint)]">Your reasons are remembered for this deck and sent with the next cut list. “Pet card” also marks the card ★ never cut.</span>
                </div>
              )}
            </div>
            <div className={`${CARD} flex flex-col gap-2 lg:col-span-2`}>
              <h4 className="font-display text-lg font-semibold">What changes</h4>
              <table className="w-full text-sm tabular-nums">
                <thead><tr className="text-left text-xs text-[var(--muted)]"><th className="py-1 font-medium">Count</th><th className="font-medium">Now</th><th className="font-medium">After</th><th className="font-medium">Usual</th></tr></thead>
                <tbody>
                  <tr className="border-t border-[var(--border)]"><td className="py-1.5">Cards</td><td className="text-[var(--muted)]">{view.size}</td><td className="font-bold">{view.size - n}</td><td className="text-[var(--muted)]">100</td></tr>
                  {view.impact.rows.map((r) => (
                    <tr key={r.id} className="border-t border-[var(--border)]"><td className="py-1.5">{r.label}</td><td className="text-[var(--muted)]">{fmt(r.before)}</td><td className="font-bold">{fmt(r.after)}</td><td className="text-[var(--muted)]">{r.range ? `${r.range[0]}–${r.range[1]}` : ''}</td></tr>
                  ))}
                </tbody>
              </table>
              <span className="text-xs text-[var(--faint)]">All counts come from the app’s code, not from Claude.</span>
            </div>
          </div>
          <div className={`${CARD} flex flex-wrap items-center gap-x-5 gap-y-3`}>
            <label className="flex min-w-0 flex-[1_1_18rem] flex-wrap items-center gap-2 text-sm">Cut cards go to
              <select value={cutsTo ?? view.cutsTo.id} onChange={(e) => setCutsTo(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm">
                {outs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span className="text-[var(--muted)]">with the reason. A snapshot is saved first.</span>
            </label>
            <button className={BUTTON} onClick={() => setStep('cuts')}>Back to the list</button>
            {n > over
              ? <span className="text-sm font-semibold text-amber-300">{hint}</span>
              : <button className={GO} disabled={busy || !n} onClick={() => act({ action: 'apply', cutsTo: cutsTo ?? undefined }, onChanged)}>{n === over ? `Apply ${n} cuts` : `Apply ${n} cut${n === 1 ? '' : 's'}, stay ${over - n} over`}</button>}
          </div>
        </div>
      )}
    </section>
  );
}

const fmt = (x: number) => (Math.round(x * 10) / 10).toString();

/** What the chosen cuts do to the deck's numbers. */
function Numbers({ rows }: { rows: TrimView['impact']['rows'] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-[var(--muted)]" aria-label="What the chosen cuts do to the deck">
      {rows.map((r) => (
        <span key={r.id}>{r.label} {r.after !== r.before ? <>{fmt(r.before)} → <b className="text-[var(--foreground)]">{fmt(r.after)}</b></> : <b className="text-[var(--foreground)]">{fmt(r.after)}</b>}{r.range && <span className="text-[var(--faint)]"> ({r.range[0]}–{r.range[1]})</span>}</span>
      ))}
    </div>
  );
}

function Row({ item, cut, choice, showText, open, onToggle, onOpen, onReason }: {
  item: TrimItem; cut: boolean; choice?: TrimChoice; showText: boolean; open: boolean;
  onToggle: () => void; onOpen: (v: boolean) => void; onReason: (change: Partial<TrimChoice>) => void;
}) {
  const chips = cut ? CUT_CHIPS : KEEP_CHIPS;
  const has = !!choice?.chip || !!choice?.text?.trim();
  return (
    <div className={`flex flex-col gap-2 rounded-xl border bg-[var(--surface)] p-3 ${cut ? 'border-[#ffb4a8]/40' : 'border-[var(--border)]'}`} data-trim-card={item.name}>
      <div className="flex flex-wrap items-start gap-3">
        <button onClick={onToggle} aria-pressed={cut} aria-label={`${cut ? 'Keep' : 'Cut'} ${item.name}`}
          className={`w-24 shrink-0 rounded-xl border px-2 py-2 text-sm font-bold ${cut ? 'border-[#ffb4a8]/70 bg-[#ffb4a8]/10 text-[#ffb4a8]' : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}>
          {cut ? 'Cut' : item.tier === 'kept' ? 'Cut anyway' : 'Keep'}
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {item.card.image && <img src={item.card.image} alt="" loading="lazy" className="w-16 shrink-0 rounded-md" style={{ aspectRatio: '488 / 680' }} />}
        <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <b className={`text-base ${cut ? 'line-through decoration-[#ffb4a8]/60' : ''}`}>{item.name}</b>
            {item.card.manaCost && <ManaCost cost={item.card.manaCost} size={13} />}
            <span className="text-xs text-[var(--muted)]">{item.card.typeLine}</span>
            {item.flag && <span className="rounded-full border border-amber-300/60 px-1.5 text-[11px] font-semibold text-amber-300">{item.flag}</span>}
          </div>
          <span>{item.why}</span>
          {item.with.length > 0 && <span className="text-xs text-[var(--muted)]">Works with: {item.with.join(', ')}</span>}
          {cut && item.warn && <span className="text-xs font-semibold text-amber-300">{item.warn}</span>}
          <span><button className="text-xs text-[var(--muted)] underline hover:text-[var(--foreground)]" onClick={() => onOpen(!open)} aria-expanded={open}>{open ? 'Hide reason' : has ? `Your reason: ${[choice?.chip ? TRIM_CHIP_LABELS[choice.chip] : '', choice?.text?.trim() ?? ''].filter(Boolean).join(': ')}` : 'Add a reason'}</button></span>
        </div>
        {showText && item.card.text && <p className="min-w-0 flex-[1_1_14rem] whitespace-pre-line rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs text-[var(--muted)]">{item.card.text}</p>}
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2 text-xs" role="group" aria-label={`Why ${cut ? 'cut' : 'keep'} ${item.name}? (optional)`}>
          <span className="text-[var(--muted)]">Why {cut ? 'cut' : 'keep'} it? (optional)</span>
          {chips.map((c) => (
            <button key={c} aria-pressed={choice?.chip === c} onClick={() => onReason({ choice: cut ? 'cut' : 'keep', chip: choice?.chip === c ? null : c })}
              className={`rounded-full border px-2.5 py-1 ${choice?.chip === c ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--accent)]'}`}>{TRIM_CHIP_LABELS[c]}</button>
          ))}
          <input value={choice?.text ?? ''} onChange={(e) => onReason({ choice: cut ? 'cut' : 'keep', text: e.target.value })} maxLength={300} placeholder="or type a line" aria-label={`Why ${cut ? 'cut' : 'keep'} ${item.name}, in your words`}
            className="min-w-0 flex-[1_1_10rem] rounded-lg border border-[var(--border)] bg-transparent px-2 py-1" />
        </div>
      )}
    </div>
  );
}
