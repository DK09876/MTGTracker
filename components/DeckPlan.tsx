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
import Tip from './Tip';
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
        <h3 data-section="Style" className="flex items-center gap-2 font-medium">Style <Tip label="What the style does">Read from the commander&apos;s text and from how many of the deck&apos;s cards share it. It moves the usual counts (a discard deck runs more card draw), and the cut list keeps cards that fit it.</Tip></h3>
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

      <section data-tour="plan-flip" className="flex flex-col gap-2">
        <h3 data-section="Flip turn" className="flex items-center gap-2 font-medium">
          Flip turn
          <Tip label="What the flip turn is">
            The mana the deck needs before it stops setting up and starts doing its thing - usually the commander&apos;s mana value, but sometimes a key engine or multiplier.
            The ramp and land guidelines follow it: about 12 ramp and 36 lands at 4 mana, one more ramp card for each mana above that.
          </Tip>
        </h3>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            The deck gets going at
            <select value={plan.flip.value} disabled={busy} onChange={(e) => change({ flip: Number(e.target.value) })}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} mana</option>)}
            </select>
          </label>
          <span className="text-xs text-[var(--muted)]">{plan.flip.mine ? 'yours' : 'the commander\u2019s mana value'}</span>
          {plan.flip.mine && <button onClick={() => change({ flip: null })} disabled={busy} className="text-xs text-[var(--accent)] hover:underline">Back to the commander&apos;s</button>}
        </div>
        <p className="max-w-3xl text-xs text-[var(--muted)]">Playtest starts with a goal from it: {plan.flip.value} mana by turn {Math.max(3, plan.flip.value - 1)}.</p>
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
        <p className="max-w-3xl text-sm text-[var(--muted)]">How many of each built-in tag the deck should run. They start from the flip turn and the style; change a range and it is yours, kept when those change. Tune, Health and the cut list all use these.</p>
        <ul className="flex max-w-xl flex-col gap-1.5">
          <Range key={`lands:${plan.lands.join('-')}`} target={{ role: 'lands', label: 'Lands', range: plan.lands, styleRange: plan.landsDefault, mine: plan.lands.join() !== plan.landsDefault.join() }}
            tip={GUIDE_TIPS.lands} disabled={busy} onChange={(range) => change({ targets: { lands: range } })} />
          {plan.targets.map((t) => <Range key={`${t.role}:${t.range.join('-')}`} target={t} tip={GUIDE_TIPS[t.role]} disabled={busy} onChange={(range) => change({ targets: { [t.role]: range } })} />)}
        </ul>
      </section>

      <section data-tour="plan-packages" className="flex flex-col gap-3">
        <h3 data-section="Theme packages" className="flex items-center gap-2 font-medium">
          Theme packages
          <Tip label="What a theme package is">
            Each of your tags is a package of cards that do one thing. Eight cards give about a 46% chance of one in your opening hand and 62% by turn 4;
            sixteen give about 87% by turn 4, so make a key theme bigger. An engine wants at least 12 enablers and about half as many payoffs.
          </Tip>
        </h3>
        {plan.packages.length ? (
          <ul className="flex max-w-xl flex-col gap-1.5">
            {plan.packages.map((p) => {
              const over = p.count > p.size;
              return (
                <li key={p.tagId} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">{p.name}{p.kind && <span className="ml-2 text-xs text-[var(--muted)]">{p.kind}</span>}</span>
                  <span className={`tabular-nums ${p.count < p.size ? 'text-amber-300' : over ? 'text-[var(--muted)]' : 'text-emerald-400'}`}>{p.count} of</span>
                  <select aria-label={`${p.name}: package size`} value={p.size} disabled={busy} onChange={(e) => change({ packages: { [p.tagId]: Number(e.target.value) === 8 ? null : Number(e.target.value) } })}
                    className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
                    {[...new Set([4, 6, 8, 10, 12, 16, 20, p.size])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}{n === 8 ? ' (usual)' : n === 16 ? ' (key theme)' : ''}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-[var(--muted)]">No theme tags yet - make some on the Tags tab and each becomes a package here.</p>}
        <p className="max-w-3xl text-xs text-[var(--muted)]">The cut list trims a package over its size first, and keeps the cards of one at or under it.</p>
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

// Why each guideline is what it is, for its ⓘ.
const GUIDE_TIPS: Record<string, string> = {
  lands: 'About 36 lands for a deck that gets going at 4 mana, a land more for every two mana above that. With 12 ramp that is about 48 mana sources - roughly a 75% chance of three in your opening seven.',
  ramp: 'Ramp gets you ahead: a 4-drop on turn 3, or two spells in a turn. Two-mana rocks are the workhorses; three is the top end. Too much ramp and too few lands, and you spend turn 2 hunting for your third land.',
  draw: 'Three kinds, worth mixing: dig (look deeper for what you need), steady card advantage (a stream of extra cards), and refills (a new hand after you have emptied yours - one or two is plenty).',
  removal: 'Enough to answer what would beat you, not so much the deck turns reactive. Flexible and instant-speed first: removal that hits one thing leaves two opponents untouched.',
  wipe: 'One or two, for when there is simply too much on the table to answer one at a time.',
};

function Range({ target, tip, disabled, onChange }: { target: api.DeckPlanState['targets'][number]; tip?: string; disabled: boolean; onChange: (range: [number, number] | null) => void }) {
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
      <span className="min-w-0 flex-1">{target.label} {tip && <Tip label={`About ${target.label}`}>{tip}</Tip>}{target.mine && <span className="ml-2 text-xs text-[var(--accent)]">yours</span>}</span>
      <input aria-label={`${target.label}: fewest`} inputMode="numeric" value={lo} disabled={disabled} onChange={(e) => setLo(e.target.value)} onBlur={save} className={input} />
      <span className="text-[var(--muted)]">to</span>
      <input aria-label={`${target.label}: most`} inputMode="numeric" value={hi} disabled={disabled} onChange={(e) => setHi(e.target.value)} onBlur={save} className={input} />
      {target.mine && <button onClick={() => onChange(null)} disabled={disabled} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Back to {target.styleRange[0]}–{target.styleRange[1]}</button>}
    </li>
  );
}
