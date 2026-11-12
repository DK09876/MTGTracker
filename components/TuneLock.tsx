'use client';

/**
 * Tune before and after the plan is confirmed. Before: a locked page that
 * says why and leads to the Plan tab (the plan can be confirmed with
 * everything on Not sure). After: one line above Tune while no generated tag
 * has been accepted, pointing to the Tags tab, and which model Tune runs on.
 */

import { C, PlanStatusLine, usePlanState } from './PlanTab';

export function TuneLocked({ listId, version, onPlan }: { listId: string; version: string; onPlan: () => void }) {
  const { state } = usePlanState(listId, version);
  return (
    <div className="mt-4 flex flex-col gap-4">
      <PlanStatusLine state={state} />
      <section data-section="Tune is locked" className={`${C.sec} flex flex-col gap-3 border-[#d6aa2e]`}>
        <h2 className="font-display text-[19px] font-bold">Tune opens when you confirm the plan</h2>
        <p className="text-[var(--muted)]">Tune works toward what you said the deck should be, so it needs you to say it first. You can confirm with everything left on Not sure: it takes one click and no AI.</p>
        <div><button type="button" className={C.go} onClick={onPlan}>Go to the Plan tab</button></div>
      </section>
    </div>
  );
}

export function TuneLead({ listId, version, onTags }: { listId: string; version: string; onTags: () => void }) {
  const { state } = usePlanState(listId, version);
  return (
    <div className="mt-4 flex flex-col gap-3">
      <PlanStatusLine state={state} />
      {state && !state.generatedAccepted && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[#141210] px-3 py-2.5 text-sm">
          <span className="min-w-0 flex-[1_1_16rem]">No tags have been generated for this deck yet. They help you read the deck, and Find can search your collection for any tag you accept.</span>
          <button type="button" className={C.btn} onClick={onTags}>Generate tags</button>
        </div>
      )}
      <p className="text-[13px] text-[var(--muted)]">Every AI step on the deck pages runs on Claude Opus. There is no cheaper model to pick.</p>
    </div>
  );
}
