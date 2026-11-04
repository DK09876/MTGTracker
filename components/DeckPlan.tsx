'use client';

/**
 * The Plan tab: what the deck is built to do, first. The brief in words,
 * the main and second style, how it wins, and the usual role counts - all
 * detected or drafted to start, all the owner's to change. Confirming it
 * unlocks the AI steps elsewhere (Chat, the tagger, Claude's reviews), which
 * read it; the ranges set here are the ones every count uses.
 */

import { useEffect, useState } from 'react';

import AiModelPicker from './AiModelPicker';
import DeckBrief from './DeckBrief';
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
  onTab: (tab: 'tags') => void;
}


export default function DeckPlan({ listId, tags, onTags, version, onPlan, onTab }: Props) {
  const [plan, setPlan] = useState<api.DeckPlanState | 'loading' | 'failed'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.deckPlan(listId).then((p) => { if (!cancelled) { setPlan(p); onPlan(p); } }).catch(() => { if (!cancelled) setPlan('failed'); });
    return () => { cancelled = true; };
    // The brief is saved by the editor; reading the plan again keeps the draft in step.
  }, [listId, version, tags.brief, onPlan]);

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
  const styleOf = (id: string | null) => plan.styles.find((s) => s.id === id);
  const detected = styleOf(plan.detected.primary);

  return (
    <div className="mt-5 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {plan.confirmed
            ? <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-400">✓ Plan confirmed</span>
            : <span className="rounded-full bg-amber-300/15 px-2.5 py-1 font-semibold text-amber-300">Start here: confirm the plan</span>}
          <span className="ml-2 text-[var(--muted)]">{plan.confirmed ? 'Everything else reads it. Change it any time.' : 'Chat and the AI steps wait for it. Most of it is filled in for you.'}</span>
        </p>
        <AiModelPicker area="deck" align="right" />
      </div>

      <DeckBrief listId={listId} tags={tags} onTags={onTags} drafted={plan.brief ? '' : plan.draft} />

      <section data-tour="plan-style" className="flex flex-col gap-3">
        <h3 data-section="Style" className="font-medium">Style</h3>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          Read from the commander&apos;s text and the deck&apos;s own cards: it looks like <span className="text-[var(--foreground)]">{detected?.label}</span>
          {plan.detected.secondary && <> with <span className="text-[var(--foreground)]">{styleOf(plan.detected.secondary)?.label}</span></>}. The style sets the usual counts below.
        </p>
        <div className="flex flex-wrap gap-4">
          <StylePick
            id="plan-style-1" label="Main style" value={plan.style} chosen={plan.chosen.style} styles={plan.styles} disabled={busy}
            onChange={(v) => change({ style: v })}
          />
          <StylePick
            id="plan-style-2" label="Second style" value={plan.style2} chosen={plan.chosen.style2} styles={plan.styles} disabled={busy} allowNone
            onChange={(v) => change({ style2: v })}
          />
        </div>
      </section>

      <section data-tour="plan-wins" className="flex flex-col gap-2">
        <h3 data-section="How it wins" className="font-medium">How it wins</h3>
        {plan.wins.tagged.length + plan.wins.finishers.length ? (
          <ul className="flex flex-wrap gap-1.5 text-sm">
            {plan.wins.tagged.map((n) => <li key={n} className="rounded-full border border-[var(--accent)]/60 bg-[var(--accent)]/10 px-3 py-1">{n}</li>)}
            {plan.wins.finishers.map((n) => <li key={n} className="rounded-full border border-[var(--border)] px-3 py-1 text-[var(--muted)]">{n}</li>)}
          </ul>
        ) : <p className="text-sm text-[var(--muted)]">Nothing reads as a way to win yet.</p>}
        <p className="max-w-3xl text-xs text-[var(--muted)]">
          Gold: cards you tagged as a win condition - the cut list never offers them. Grey: cards that read as finishers.{' '}
          <button onClick={() => onTab('tags')} className="text-[var(--accent)] hover:underline">Tag win conditions on the Tags tab</button>
        </p>
      </section>

      <section data-tour="plan-guidelines" className="flex flex-col gap-3">
        <h3 data-section="Guidelines" className="font-medium">Guidelines</h3>
        <p className="max-w-3xl text-sm text-[var(--muted)]">How many of each the deck should run. They start from the style; change a range and it is yours, kept when the style changes. Tune, Health and the cut list all use these.</p>
        <ul className="flex max-w-xl flex-col gap-1.5">
          {plan.targets.map((t) => <Range key={`${t.role}:${t.range.join("-")}`} target={t} disabled={busy} onChange={(range) => change({ targets: { [t.role]: range } })} />)}
        </ul>
      </section>

      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button data-tour="plan-confirm" onClick={() => change({ confirm: true })} disabled={busy} className="btn-go rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60">
          {plan.confirmed ? 'Save the plan' : 'Confirm the plan'}
        </button>
        <span className="text-sm text-[var(--muted)]">{plan.confirmed ? 'Saved already; this marks it read again.' : 'Unlocks Chat, the tagger and Claude’s reviews.'}</span>
      </div>
    </div>
  );
}

function StylePick({ id, label, value, chosen, styles, disabled, allowNone, onChange }: {
  id: string; label: string; value: string | null; chosen: boolean; styles: api.DeckPlanState['styles'];
  disabled: boolean; allowNone?: boolean; onChange: (v: string | null) => void;
}) {
  const note = styles.find((s) => s.id === value)?.note;
  return (
    <label htmlFor={id} className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1 text-sm">
      <span>{label} <span className="text-xs text-[var(--muted)]">{chosen ? '· yours' : '· as detected'}</span></span>
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '__auto' ? null : e.target.value)}
        className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5"
      >
        {chosen && <option value="__auto">As detected</option>}
        {allowNone && <option value="">None</option>}
        {styles.map((s) => <option key={s.id} value={s.id}>{s.label}{s.cards ? ` · ${s.cards} cards` : ''}</option>)}
      </select>
      {note && <span className="text-xs text-[var(--muted)]">{note}</span>}
    </label>
  );
}

function Range({ target, disabled, onChange }: { target: api.DeckPlanState['targets'][number]; disabled: boolean; onChange: (range: [number, number] | null) => void }) {
  const [lo, setLo] = useState(String(target.range[0]));
  const [hi, setHi] = useState(String(target.range[1]));
  const save = () => {
    const a = Number(lo), b = Number(hi);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 99 || a > b) { setLo(String(target.range[0])); setHi(String(target.range[1])); return; }
    if (a !== target.range[0] || b !== target.range[1]) onChange([a, b]);
  };
  const input = 'w-14 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-center tabular-nums';
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">{target.label}{target.mine && <span className="ml-2 text-xs text-[var(--accent)]">yours</span>}</span>
      <input aria-label={`${target.label}: fewest`} inputMode="numeric" value={lo} disabled={disabled} onChange={(e) => setLo(e.target.value)} onBlur={save} className={input} />
      <span className="text-[var(--muted)]">to</span>
      <input aria-label={`${target.label}: most`} inputMode="numeric" value={hi} disabled={disabled} onChange={(e) => setHi(e.target.value)} onBlur={save} className={input} />
      {target.mine && <button onClick={() => onChange(null)} disabled={disabled} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Style&apos;s {target.styleRange[0]}–{target.styleRange[1]}</button>}
    </li>
  );
}
