'use client';

/**
 * Tune before and after the plan is confirmed. Before: what the app has for
 * the deck's plan, with Confirm right there (one click, no AI) or a way to
 * set it up first on the Plan tab. After: one line above Tune while no
 * generated tag has been accepted, pointing to the Tags tab.
 */

import { useState } from 'react';

import { C, MARK, usePlanState } from './PlanTab';
import Tip from './Tip';
import * as api from '@/lib/api';
import { COMMANDER_ROLES } from '@/lib/plan-help-shared';

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-[var(--border)] py-2.5 last:border-b-0">
    <dt className="text-[var(--muted)]">{k}</dt>
    <dd className="min-w-0 break-words text-right">{children}</dd>
  </div>
);
const Who = ({ by }: { by: string }) => (by === 'ai' ? <span className={`ml-1.5 text-[11px] font-bold ${MARK.ai[1]}`}>{MARK.ai[0]}</span> : null);

export function TuneLocked({ listId, version, onPlan, onConfirmed }: { listId: string; version: string; onPlan: () => void; onConfirmed: () => void }) {
  const { state: s, setState, error, setError } = usePlanState(listId, version);
  const [saving, setSaving] = useState(false);
  if (!s) return error ? <p className="mt-8 text-center text-red-400">{error}</p> : <p className="mt-8 text-center text-[var(--muted)]">Reading the plan…</p>;

  const waiting = s.open.suggestions + s.open.questions;
  const roles = s.commander.roles.filter((r) => r !== 'unsure').map((id) => COMMANDER_ROLES.find((r) => r.id === id)?.label ?? id);
  const text = s.plan.text.trim();
  const confirm = async () => {
    setSaving(true); setError(null);
    try { setState(await api.planHelpAct(listId, { action: 'confirm' })); onConfirmed(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not confirm the plan'); } finally { setSaving(false); }
  };
  return (
    <section data-section="Tune is locked" data-section-state={waiting ? `${waiting} waiting on Plan` : 'confirm below'} data-section-tone="text-[#e8c558]" className={`${C.sec} mt-4 flex flex-col gap-3 border-[#d6aa2e]`}>
      <h2 className="flex flex-wrap items-center gap-2 font-display text-[21px] font-bold">Tune works toward your plan
        <Tip label="Why Tune waits for the plan">Every cut and swap Tune suggests is judged against what you say the deck should be. Confirming takes one click and no AI; anything left on Not sure stays that way until you set it.</Tip></h2>
      <p className="text-[var(--muted)]">{waiting ? 'AI left suggestions on the Plan tab. Accept or skip them there, then confirm.' : 'Here is what the app has for this deck. Confirm it as it is, or set it up first.'}</p>
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <dl className="border-t border-[var(--border)] text-[15px]">
          <Row k={`What ${s.commanderNames} does`}>{roles.length ? <>{roles.join(', ')}<Who by={s.commander.by} /></> : 'Not sure'}</Row>
          <Row k="Bracket">{s.bracket.value !== null ? <>Bracket {s.bracket.value}<Who by={s.bracket.by} /></> : 'Not sure'}</Row>
          <Row k="How it wins">{text ? <span className="line-clamp-2 text-left sm:text-right">{text}<Who by={s.plan.by} /></span> : 'Not sure'}</Row>
          <Row k="Ways to win">{s.wins.length ? s.wins.map((w, i) => <span key={w.id}>{i ? ', ' : ''}{w.name}<Who by={w.by} />{!w.cards.length && <span className="text-[var(--muted)]"> (no cards left)</span>}</span>) : 'None yet'}</Row>
          <Row k="Never cut">{[...s.neverCut.commanders.length ? [s.neverCut.commanders.length > 1 ? 'The commanders' : 'The commander'] : [], ...s.neverCut.cards.length ? [`${s.neverCut.cards.length} more ${s.neverCut.cards.length === 1 ? 'card' : 'cards'}`] : []].join(' and ') || 'Nothing'}</Row>
          <Row k="Jobs counted">{s.jobs.length === 6 ? 'All six' : s.jobs.length ? s.jobs.join(', ') : 'None'}</Row>
        </dl>
        <div className="flex flex-col gap-2.5">
          {waiting ? (
            <button type="button" className={`${C.go} min-h-12 text-[15px]`} onClick={onPlan}>Look at {waiting} on the Plan tab</button>
          ) : (
            <>
              <button type="button" className={`${C.go} min-h-12 text-[15px]`} disabled={saving} onClick={() => void confirm()}>{saving ? 'Confirming…' : 'Confirm and open Tune'}</button>
              <button type="button" className={C.btn} onClick={onPlan}>Set up the plan first</button>
            </>
          )}
          <p className="text-[13px] text-[var(--muted)]">Confirming changes nothing in the deck. You can change the plan any time after.</p>
          {error && <p role="alert" className="text-[13px] text-red-300">{error}</p>}
        </div>
      </div>
    </section>
  );
}
