'use client';

/**
 * Trim: cut a deck that is over 100 down to 100 (lib/trim.ts), as one
 * conversation. Step 1 is one box, "What matters for these cuts?". Step 2 is
 * Claude's list, one line per card, with the cuts already chosen, and under it
 * the session so far and a box to say something back: the marks on the list
 * and the message go together, and Claude answers with a new list. Step 3
 * reviews and applies. Choosing is instant: choices are kept in the page and
 * saved in the background, which also brings back what they do to the deck's
 * numbers. Claude runs in the background and everything is kept with the
 * deck, so leaving the page loses nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ManaCost from './ManaCost';
import { C } from './PlanTab';
import Tip from './Tip';
import * as api from '@/lib/api';
import type { DeckSection } from '@/lib/sections-shared';
import {
  chosenCuts, CUT_CHIPS, KEEP_CHIPS, newMarks, saidSomething, TRIM_CHIP_LABELS,
  type CutMark, type TrimChoice, type TrimItem, type TrimTier, type TrimTurn, type TrimView,
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
const TRIM_GO = 'min-h-11 rounded-xl bg-[#ef6a4c] px-4 text-sm font-bold text-[#1b0d08] hover:brightness-110 disabled:cursor-default disabled:opacity-50';
const LINK = 'min-h-11 px-0.5 text-[13px] text-[var(--muted)] underline underline-offset-[3px] hover:text-[var(--foreground)] disabled:opacity-50';
const POLL_MS = 2_500;
const SAVE_MS = 350;

const HINTS = ['Keep my ramp', 'Cut from interaction first', 'Keep my mana dorks', 'Protect the combo pieces', 'Fewer board wipes', 'Don’t touch my pet cards'];
const WEIGH = ['speed', 'card advantage', 'my theme', 'staying on budget', 'interaction'];

const money = (c: { usd: number; measured: boolean }) => `about ${c.usd < 0.995 ? `${Math.max(1, Math.round(c.usd * 100))}¢` : `$${c.usd.toFixed(2)}`}${c.measured ? '' : ', estimated'}`;
const TIER_TITLE: Record<TrimTier, [string, string]> = {
  cut: ['Claude’s cuts', 'Already chosen. Tap Cut to keep one.'],
  maybe: ['Closer calls', 'In order, not chosen. Tap Keep to cut one.'],
  kept: ['Kept on purpose', 'Cards a quick look would cut, and why Claude left them in. You can still cut them.'],
  yours: ['Kept by you', 'From the list before. Not suggested again.'],
};
const MARK_LABEL: Record<CutMark, [string, string]> = {
  yours: ['your cut', 'bg-[#2b2410] text-[#e8c558]'],
  same: ['same', 'bg-[#26221c] text-[var(--muted)]'],
  new: ['new', 'bg-[#2a1d17] text-[#ffb4a8]'],
};
const reasonWords = (c?: { chip?: string | null; text?: string }) => [c?.chip ? TRIM_CHIP_LABELS[c.chip as keyof typeof TRIM_CHIP_LABELS] ?? c.chip : '', c?.text?.trim() ?? ''].filter(Boolean).join(': ');
/** A line added after what is typed: a full stop between them unless the text already ends a sentence. */
const addLine = (box: string, line: string) => { const t = box.trim(); return !t ? line : /[.!?]$/.test(t) ? `${t} ${line}` : `${t}. ${line}`; };
const names = (xs: string[]) => xs.join(', ');

export default function DeckTrim({ listId, version, sections, onChanged, onTab }: Props) {
  const [view, setView] = useState<TrimView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  // Your choices as you make them: shown at once, saved a moment later.
  const [choices, setChoices] = useState<Record<string, TrimChoice>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [card, setCard] = useState<Record<string, boolean>>({});
  // The box in step 1, and the message back in step 2.
  const [box, setBox] = useState('');
  const [message, setMessage] = useState('');
  const [keepNotes, setKeepNotes] = useState<string[]>([]);
  const [cutsTo, setCutsTo] = useState<string | null>(null);
  const dirty = useRef(false);
  const runId = useRef<string | null>(null);
  const approachAt = useRef<string | null | undefined>(undefined);
  // The box text last saved from this page: its echo from the server must not overwrite what was typed since.
  const sentBox = useRef<string | null>(null);

  // What the server says, taken in: the list's choices only when it is a new list or nothing is waiting to be saved.
  const take = useCallback((v: TrimView) => {
    setView(v);
    setError(null);
    const fresh = runId.current !== (v.run?.id ?? null);
    if (fresh || !dirty.current) { setChoices(v.choices); if (fresh) { setOpen({}); setCard({}); } }
    // A new list answered what was sent: the message box starts empty again.
    if (fresh && v.run && runId.current !== null) { setStep('cuts'); setMessage(''); }
    runId.current = v.run?.id ?? null;
    // The box follows the saved text when it changes on the server (a draft, or Claude adding to it).
    const at = v.approach?.at ?? null;
    if (approachAt.current !== at) {
      const text = v.approach?.text ?? '';
      if (sentBox.current === null || text.trim() !== sentBox.current) setBox(text);
      sentBox.current = null;
      approachAt.current = at;
    }
  }, []);

  useEffect(() => {
    let stop = false;
    api.trim(listId).then((v) => { if (!stop) take(v); }).catch((e) => { if (!stop) setError(e instanceof Error ? e.message : 'Couldn’t read the deck just now'); });
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

  const saved = view?.approach?.text ?? '';
  const act = async (action: api.TrimAction, after?: () => Promise<void> | void) => {
    setBusy(true);
    setError(null);
    try {
      // Anything typed or chosen goes first, so the request reads it.
      if (dirty.current) { dirty.current = false; await api.trimAct(listId, { action: 'choices', choices }); }
      if (box.trim() !== saved.trim() && !(action.action === 'approach')) { sentBox.current = box.trim(); take(await api.trimAct(listId, { action: 'approach', text: box })); }
      take(await api.trimAct(listId, action));
      await after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that');
    } finally {
      setBusy(false);
    }
  };
  const saveBox = () => {
    if (box.trim() === saved.trim()) return;
    sentBox.current = box.trim();
    void api.trimAct(listId, { action: 'approach', text: box }).then(take).catch(() => { sentBox.current = null; });
  };

  const items = useMemo(() => view?.run?.items ?? [], [view]);
  const cuts = useMemo(() => chosenCuts(items, choices), [items, choices]);
  const marked = useMemo(() => newMarks(items, choices, view?.carried ?? {}).length, [items, choices, view?.carried]);
  if (error && !view) return <p className="mt-4 text-sm text-red-400">{error}</p>;
  if (!view) return <p className="mt-4 text-sm text-[var(--muted)]">Reading the deck…</p>;

  const over = view.over;
  const at: Step = step ?? (view.run ? 'cuts' : 'approach');
  const cutsRunning = running && view.job?.kind === 'cuts';
  const approachRunning = running && view.job?.kind === 'approach';
  const session = view.turns.length > 0;
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
    // Keeping one of Claude's cuts opens its reason row in place.
    setOpen((o) => ({ ...o, [item.name]: isCut }));
  };
  const n = cuts.length;
  const hint = n < over ? `Pick ${over - n} more, from the closer calls or anywhere below.` : n > over ? `${n - over} too many: keep ${n - over} of them.` : `Exactly ${over}. Ready to review.`;
  const outs = [...sections].sort((a, b) => Number(b.purpose === 'out') - Number(a.purpose === 'out'));
  const refused = items.filter((i) => (i.tier === 'cut' || i.tier === 'yours') && !cuts.includes(i.name));
  const cost = money(view.costs[view.model]);
  const send = () => act({ action: 'find', rerun: true, message });

  // --- done: what happened, and the way back --------------------------------------------
  if (view.done) {
    const d = view.done;
    return (
      <section className={`${CARD} flex flex-col gap-3`} data-tour="trim-done" data-section="Trim">
        <h3 className="font-display text-2xl font-semibold">{d.size === 100 ? 'The deck is at 100 cards' : `The deck is at ${d.size} cards${d.size > 100 ? `, ${d.size - 100} over` : ''}`}</h3>
        <p className="text-sm text-[var(--muted)]">{d.cut} card{d.cut === 1 ? '' : 's'} moved to {d.to}, each with its reason. A snapshot from before is in History.{d.notes ? ` ${d.notes} line${d.notes === 1 ? '' : 's'} from the session went to your notes.` : ''}</p>
        <p className="text-xs text-[var(--faint)]">Kept in the suggestion log: {d.logged.accepted} cut, {d.logged.refused} of Claude’s cuts kept, {d.logged.left} closer calls left alone, {d.logged.reasons} with a reason.</p>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button className={C.go} onClick={() => onTab('check')}>Check mana and curve</button>
          <button className={C.btn} disabled={busy} onClick={() => act({ action: 'undo' }, async () => { setStep('cuts'); await onChanged(); })}>Undo</button>
          {d.size > 100 && <button className={C.btn} disabled={busy} onClick={() => act({ action: 'reset' })}>Trim the rest</button>}
        </div>
      </section>
    );
  }

  if (over <= 0) {
    return <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">The deck is at 100 or under: nothing needs to come out.</p>;
  }

  const groups = (['cut', 'maybe', 'kept', 'yours'] as TrimTier[]).map((t) => ({ tier: t, items: items.filter((i) => i.tier === t) })).filter((g) => g.items.length);
  const ch = view.run?.changed;

  return (
    <section className="flex flex-col gap-4" data-tour="trim" data-section="Trim">
      <nav aria-label="Trim steps" className="flex flex-wrap items-center gap-1.5">
        <h3 className="mr-2 font-display text-xl font-semibold">Trim to 100 <span className="text-sm font-normal text-[var(--muted)]">· {view.size} cards · {over} to cut</span></h3>
        {([['approach', '1 · What matters'], ['cuts', '2 · Choose cuts'], ['review', '3 · Review and apply']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setStep(id)} aria-current={at === id ? 'step' : undefined} disabled={id !== 'approach' && !view.run}
            className={`${C.pill} disabled:opacity-40 ${at === id ? C.on : C.off}`}>{label}</button>
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

      {/* --- 1: what matters ------------------------------------------------------------- */}
      {at === 'approach' && (
        <div className={`${CARD} flex flex-col gap-3`}>
          <h4 className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold">
            <label htmlFor="trim-box">What matters for these cuts?</label>
            <Tip label="About this box">Your own words here steer the cuts more than anything else Claude reads. In testing, one line like “do not cut ramp” changed which cards were cut. You can leave it empty.</Tip>
          </h4>
          <textarea id="trim-box" value={box} onChange={(e) => setBox(e.target.value)} onBlur={saveBox} rows={Math.min(12, Math.max(3, box.split('\n').length + 1))} maxLength={2000}
            placeholder="Say it the way you would to a friend. e.g. I want more ramp, not less. Cut removal before anything else."
            className={`${C.input} w-full resize-y py-2.5`} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-[var(--muted)]">Tap to add:</span>
            {HINTS.map((h) => <button key={h} type="button" className="min-h-10 rounded-full border border-[var(--border)] bg-[var(--background)] px-3 text-[13px] hover:border-[#d6aa2e]" onClick={() => setBox((b) => addLine(b, h))}>{h}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-x-4">
            <button type="button" className={LINK} disabled={busy} onClick={() => act({ action: 'approach', draft: true })}>Draft from the deck’s numbers · free</button>
            <button type="button" className={LINK} disabled={busy || approachRunning || view.noKey} onClick={() => act({ action: 'approach', claude: true, text: box })}>
              {approachRunning ? 'Claude is adding to it…' : `✦ Have Claude add to it · ${money(view.costs.approach)}`}
            </button>
            <Tip label="About the two links">The draft is worked out by the app from the deck’s numbers and replaces the box. Claude keeps what you wrote, word for word, and adds its own lines below.</Tip>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-[var(--border)] pt-3">
            <p className="min-w-0 flex-[1_1_16rem] text-[13px] text-[var(--muted)]">
              You can leave it empty. Claude also reads your confirmed plan, your notes, your never-cut cards and what you kept or cut on this deck before.{' '}
              <Tip label="What Claude reads for the cut list"><span className="flex flex-col gap-1">{view.reads.map((r) => <span key={r}>• {r}</span>)}<span>Not sent: your other decks, your collection, other profiles.</span></span></Tip>
            </p>
            <span className="flex flex-wrap items-center gap-3">
              {session && <button type="button" className={LINK} disabled={busy || cutsRunning} onClick={() => act({ action: 'reset' })}>Start a new session</button>}
              <button className={TRIM_GO} disabled={busy || cutsRunning || view.noKey} onClick={() => act({ action: 'find', rerun: session })} data-tour="trim-find">
                {cutsRunning ? 'Claude is ranking…' : `✦ Find ${over} cuts${session ? ' again' : ''} · ${cost}`}
              </button>
            </span>
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
              <button className={TRIM_GO} disabled={busy || !n} onClick={() => setStep('review')}>Review and apply</button>
            </div>
            <div role="img" aria-label={`${n} of ${over} chosen`} className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, Math.round((n / over) * 100))}%` }} /></div>
            {/* On a phone the bar stays short: the numbers are on the review step. */}
            <div className="hidden sm:block"><Numbers rows={view.impact.rows} /></div>
          </div>
          {view.run.stale && (
            <p role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-300/[0.05] px-3.5 py-2 text-sm">
              <span className="min-w-0 flex-1">The deck changed since this list was made. Cards no longer in the deck are left out.</span>
              <button className={C.btn} disabled={busy || cutsRunning} onClick={send}>✦ Make a new list</button>
            </p>
          )}

          <div className={`${CARD} flex flex-col gap-1`}>
            {view.run.round > 1 && ch ? (
              <div className="mb-2 flex flex-col gap-1.5 rounded-xl border border-[#3f6b4a] bg-[#141210] p-3 text-[13px]" data-trim-changed>
                <h4 className="text-[15px] font-bold text-[#9bdcae]">What changed, and why</h4>
                {ch.kept.length > 0 && <p><b>Kept, as you said:</b> {names(ch.kept)}.</p>}
                {ch.dropped.length > 0 && <p><b>No longer cuts, though you didn’t name them:</b> {names(ch.dropped)}.</p>}
                <p><b>{ch.fresh ? `${ch.fresh} new cut${ch.fresh === 1 ? '' : 's'}` : 'No new cuts'};</b> {ch.same + ch.yours} the same as before{ch.yours ? `, ${ch.yours} of them the ones you confirmed` : ''}.</p>
                {view.run.reply && <p className="text-[var(--muted)]"><span className={C.ai}>Claude:</span> “{view.run.reply}”</p>}
              </div>
            ) : view.run.notes ? (
              <p className="mb-2 text-sm text-[var(--muted)]"><span className={`font-semibold ${C.ai}`}>✦ Claude:</span> {view.run.notes}</p>
            ) : null}
            {groups.map((g) => (
              <div key={g.tier} className="flex flex-col" data-trim-group={g.tier}>
                <div className="flex flex-wrap items-baseline gap-x-3 pb-1 pt-3"><h4 className="font-display text-lg font-semibold">{TIER_TITLE[g.tier][0]} · {g.items.length}</h4><span className="text-sm text-[var(--muted)]">{TIER_TITLE[g.tier][1]}</span></div>
                {g.items.map((i) => (
                  <Row key={i.name} item={i} cut={cuts.includes(i.name)} choice={choices[i.name]} mark={view.run!.marks?.[i.name] ?? null}
                    open={open[i.name] ?? false} showCard={card[i.name] ?? false}
                    onToggle={() => toggle(i)} onOpen={(v) => setOpen((o) => ({ ...o, [i.name]: v }))} onCard={(v) => setCard((o) => ({ ...o, [i.name]: v }))} onReason={(change) => choose(i, change)} />
                ))}
              </div>
            ))}
            <p className="pt-2 text-xs text-[var(--faint)]">Lands: {view.lands.have} in the deck, usual {view.lands.range[0]}–{view.lands.range[1]}. The app never lets a cut take the deck under {Math.ceil(view.lands.floor)}.</p>
          </div>

          <Session turns={view.turns} ask={view.run.ask} message={message} setMessage={setMessage} marked={marked} cost={cost}
            disabled={busy || cutsRunning || view.noKey} onSend={send} />
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
              {view.messages.length > 0 && (
                <fieldset className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3 text-sm" data-trim-keep-notes>
                  <legend className="flex items-center gap-2 font-semibold">What you said in this session
                    <Tip label="About Keep for next time">The session ends when you apply. Tick a line to save it to your notes on this deck, where the Plan tab and every later AI step read it. Unticked lines are not kept.</Tip>
                  </legend>
                  {view.messages.map((m) => (
                    <label key={m.id} className="flex items-start gap-2.5">
                      <input type="checkbox" className="mt-1" checked={keepNotes.includes(m.id)} onChange={(e) => setKeepNotes((k) => (e.target.checked ? [...k, m.id] : k.filter((x) => x !== m.id)))} />
                      <span className="min-w-0 flex-1"><span className="whitespace-pre-line">“{m.text}”</span> <span className="text-xs text-[var(--muted)]">Keep for next time</span></span>
                    </label>
                  ))}
                </fieldset>
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
              <span className="text-xs text-[var(--faint)]">All counts come from the app’s code, not from Claude. A usual range shows only for a job counted on this deck.</span>
            </div>
          </div>
          <div className={`${CARD} flex flex-wrap items-center gap-x-5 gap-y-3`}>
            <label className="flex min-w-0 flex-[1_1_18rem] flex-wrap items-center gap-2 text-sm">Cut cards go to
              <select value={cutsTo ?? view.cutsTo.id} onChange={(e) => setCutsTo(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm">
                {outs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span className="text-[var(--muted)]">with the reason. A snapshot is saved first.</span>
            </label>
            <button className={C.btn} onClick={() => setStep('cuts')}>Back to the list</button>
            {n > over
              ? <span className="text-sm font-semibold text-amber-300">{hint}</span>
              : <button className={TRIM_GO} disabled={busy || !n} onClick={() => act({ action: 'apply', cutsTo: cutsTo ?? undefined, keepNotes }, async () => { setKeepNotes([]); await onChanged(); })}>{n === over ? `Apply ${n} cuts` : `Apply ${n} cut${n === 1 ? '' : 's'}, stay ${over - n} over`}</button>}
          </div>
        </div>
      )}
    </section>
  );
}

const fmt = (x: number) => (Math.round(x * 10) / 10).toString();

/** What the chosen cuts do to the deck's numbers. A range only for a job counted on the deck (the server leaves the others out). */
function Numbers({ rows }: { rows: TrimView['impact']['rows'] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-[var(--muted)]" aria-label="What the chosen cuts do to the deck">
      {rows.map((r) => (
        <span key={r.id}>{r.label} {r.after !== r.before ? <>{fmt(r.before)} → <b className="text-[var(--foreground)]">{fmt(r.after)}</b></> : <b className="text-[var(--foreground)]">{fmt(r.after)}</b>}{r.range && <span className="text-[var(--faint)]"> ({r.range[0]}–{r.range[1]})</span>}</span>
      ))}
    </div>
  );
}

/** The cut session so far, the owner's turns in gold and Claude's in violet, then the box to say something back. */
function Session({ turns, ask, message, setMessage, marked, cost, disabled, onSend }: {
  turns: TrimTurn[]; ask: string | null; message: string; setMessage: (m: string) => void; marked: number; cost: string; disabled: boolean; onSend: () => void;
}) {
  const can = marked > 0 || !!message.trim();
  return (
    <section className={`${CARD} flex flex-col gap-3`} data-trim-session aria-label="This session">
      <h4 className="flex flex-wrap items-baseline gap-x-2 font-display text-lg font-semibold">This session
        <span className="text-[13px] font-normal text-[var(--muted)]">everything here is sent to Claude each time you send</span>
      </h4>
      <ol className="flex flex-col">
        {turns.map((t, k) => (
          <li key={k} className="flex flex-col gap-0.5 border-t border-[var(--border)] py-2.5 text-[13px]" data-turn={t.kind}>
            {t.kind === 'owner-start' ? (
              <><span className={`text-[11px] font-bold tracking-wide ${C.yours}`}>YOU · AT THE START</span><p className="whitespace-pre-line">{t.text.trim() || 'Nothing said. Claude went by your plan and notes.'}</p></>
            ) : t.kind === 'claude-list' ? (
              <><span className={`text-[11px] font-bold tracking-wide ${C.ai}`}>✦ CLAUDE · LIST {t.round}</span>
                <p>{t.cuts.length} cuts and {t.maybes.length} closer calls.{t.reply ? ` ${t.reply}` : ''}</p>
                {t.ask && <p className={C.ai}>Asked: {t.ask}</p>}</>
            ) : (
              <><span className={`text-[11px] font-bold tracking-wide ${C.yours}`}>YOU</span>
                {t.approach !== undefined && <p>Changed what matters to: “{t.approach || 'nothing'}”</p>}
                {t.marks.filter((m) => m.choice === 'keep').map((m) => <p key={m.name}>Kept <b>{m.name}</b>{reasonWords(m) ? `: “${reasonWords(m)}”` : ''}</p>)}
                {t.marks.some((m) => m.choice === 'cut') && <p>Confirmed {t.marks.filter((m) => m.choice === 'cut').length} cut{t.marks.filter((m) => m.choice === 'cut').length === 1 ? '' : 's'}: {t.marks.filter((m) => m.choice === 'cut').map((m) => `${m.name}${reasonWords(m) ? ` (${reasonWords(m)})` : ''}`).join(', ')}</p>}
                {t.message && <p className="whitespace-pre-line">“{t.message}”</p>}
                {!t.marks.length && !t.message && t.approach === undefined && <p className="text-[var(--muted)]">Asked for the list again, with nothing changed.</p>}</>
            )}
          </li>
        ))}
      </ol>
      <div className={`${C.box} flex flex-col gap-2`}>
        {ask && <p className={`${C.aiBox} text-[13px]`}><span className={`font-bold ${C.ai}`}>✦ Claude asks:</span> {ask}</p>}
        <label htmlFor="trim-say" className="font-bold">Say something back</label>
        <textarea id="trim-say" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1500}
          placeholder="Why did you keep or cut what you did? What should count for more? Or ask why a card is on the list."
          className={`${C.input} w-full resize-y py-2.5`} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-[var(--muted)]">Weigh more:</span>
          {WEIGH.map((w) => <button key={w} type="button" className="min-h-10 rounded-full border border-[var(--border)] bg-[var(--background)] px-3 text-[13px] hover:border-[#d6aa2e]" onClick={() => setMessage(addLine(message, `Weigh ${w} more.`))}>{w}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-[1_1_14rem] text-[13px] text-[var(--muted)]">{marked ? `Goes with ${marked} change${marked === 1 ? '' : 's'} you made on the list.` : 'Mark keeps and cuts on the list, type here, or both.'} Claude answers and updates the list.</p>
          <button className={TRIM_GO} disabled={disabled || !can} onClick={onSend} title={can ? undefined : 'Mark a keep or a cut on the list, or type something, first'}>✦ Send · {cost}</button>
        </div>
      </div>
    </section>
  );
}

function Row({ item, cut, choice, mark, open, showCard, onToggle, onOpen, onCard, onReason }: {
  item: TrimItem; cut: boolean; choice?: TrimChoice; mark: CutMark | null; open: boolean; showCard: boolean;
  onToggle: () => void; onOpen: (v: boolean) => void; onCard: (v: boolean) => void; onReason: (change: Partial<TrimChoice>) => void;
}) {
  const chips = cut ? CUT_CHIPS : KEEP_CHIPS;
  const has = !!choice?.chip || !!choice?.text?.trim();
  // Keeping one of Claude's cuts opens the reason row; on a cut it opens on request.
  const keptCut = !cut && item.tier === 'cut';
  const showReason = open;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--border)] py-2" data-trim-card={item.name}>
      <button onClick={onToggle} aria-pressed={cut} aria-label={`${cut ? 'Keep' : 'Cut'} ${item.name}`}
        className={`min-h-11 w-[5.5rem] shrink-0 rounded-xl border px-2 text-sm font-bold ${cut ? 'border-[#ffb4a8]/70 bg-[#ffb4a8]/10 text-[#ffb4a8]' : 'border-[#4a443b] text-[#9bdcae] hover:bg-[var(--surface-hover)]'}`}>
        {cut ? 'Cut' : item.tier === 'kept' ? 'Cut anyway' : 'Keep'}
      </button>
      {mark && <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold ${MARK_LABEL[mark][1]}`}>{MARK_LABEL[mark][0]}</span>}
      <div className="min-w-0 flex-[1_1_18rem] text-sm">
        <button type="button" onClick={() => onCard(!showCard)} aria-expanded={showCard} className={`font-bold hover:underline ${cut ? 'line-through decoration-[#6b6357]' : keptCut ? 'text-[#9bdcae]' : ''}`}>{item.name}</button>
        {item.flag && <span className="ml-1.5 rounded-full border border-amber-300/60 px-1.5 text-[11px] font-semibold text-amber-300">{item.flag}</span>}
        {' '}<span className="text-[13px] text-[var(--muted)]">{item.why}</span>
        {cut && item.warn && <span className="block text-xs font-semibold text-amber-300">{item.warn}</span>}
        {!showReason && (cut || has) && (
          <button type="button" className="ml-1.5 text-xs text-[var(--muted)] underline hover:text-[var(--foreground)]" onClick={() => onOpen(true)}>
            {has ? `Your reason: ${reasonWords(choice)}` : 'Why cut?'}
          </button>
        )}
      </div>
      {showCard && (
        <div className="flex basis-full flex-wrap items-start gap-3 pl-0 sm:pl-[6.25rem]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {item.card.image && <img src={item.card.image} alt="" loading="lazy" className="w-28 shrink-0 rounded-md" style={{ aspectRatio: '488 / 680' }} />}
          <div className="flex min-w-0 flex-[1_1_14rem] flex-col gap-1 text-xs">
            <span className="flex flex-wrap items-center gap-2">{item.card.manaCost && <ManaCost cost={item.card.manaCost} size={13} />}<span className="text-[var(--muted)]">{item.card.typeLine}</span></span>
            {item.card.text && <p className="whitespace-pre-line text-[var(--muted)]">{item.card.text}</p>}
            {item.with.length > 0 && <span className="text-[var(--muted)]">Works with: {item.with.join(', ')}</span>}
          </div>
        </div>
      )}
      {showReason && (
        <div className="flex basis-full flex-wrap items-center gap-2 pb-1 sm:pl-[6.25rem]" role="group" aria-label={`Why ${cut ? 'cut' : 'keep'} ${item.name}?`}>
          <span className="text-[13px] text-[var(--muted)]">Why {cut ? 'cut' : 'keep'} it?</span>
          {chips.map((c) => (
            <button key={c} type="button" aria-pressed={choice?.chip === c} onClick={() => onReason({ choice: cut ? 'cut' : 'keep', chip: choice?.chip === c ? null : c })}
              className={`min-h-10 rounded-full border px-3 text-[13px] ${choice?.chip === c ? C.on : 'border-[var(--border)] bg-[var(--background)] hover:border-[#d6aa2e]'}`}>{TRIM_CHIP_LABELS[c]}</button>
          ))}
          <input value={choice?.text ?? ''} onChange={(e) => onReason({ choice: cut ? 'cut' : 'keep', text: e.target.value })} maxLength={300}
            placeholder={cut ? 'or say why, e.g. too slow for this deck' : 'or say why, e.g. I keep all my mana dorks'} aria-label={`Why ${cut ? 'cut' : 'keep'} ${item.name}, in your words`}
            className={`${C.input} flex-[1_1_14rem]`} />
          <span className="basis-full text-[13px] text-[#9bdcae]">A reason is applied to similar cards too.{cut ? '' : ' A pet card is also marked never cut.'}</span>
          <button type="button" className="text-xs text-[var(--muted)] underline" onClick={() => onOpen(false)}>Hide</button>
        </div>
      )}
    </div>
  );
}
