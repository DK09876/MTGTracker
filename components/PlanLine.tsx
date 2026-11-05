'use client';

/**
 * The deck's plan, as one line at the top of a tab that reads it (Tune,
 * Tags): enough to remember what it says, the whole of it a tap away. The
 * full paragraph on every tab pushed the tab's own work below the fold.
 */

import { useState } from 'react';

export default function PlanLine({ brief, label = 'Plan', note, action, onAction, ...rest }: {
  brief: string;
  label?: string;
  /** After the plan, muted: the deck's style. */
  note?: string | null;
  action: string;
  onAction: () => void;
  'data-tour'?: string;
}) {
  const [open, setOpen] = useState(false);
  const text = brief.trim();
  return (
    <div data-tour={rest['data-tour']} className="flex max-w-3xl items-baseline gap-3 text-sm">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--faint)]">{label}</span>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!text}
        aria-expanded={open}
        title={open ? 'Show less' : 'Show the whole plan'}
        className={`min-w-0 flex-1 text-left text-[var(--foreground)]/85 ${open ? '' : 'truncate'} ${text ? 'hover:text-[var(--foreground)]' : 'text-[var(--muted)]'}`}
      >
        {text || 'Not written yet.'}
        {note && <span className="text-[var(--muted)]"> · {note}</span>}
      </button>
      <button onClick={onAction} className="shrink-0 text-[var(--c1)] hover:underline">{action}</button>
    </div>
  );
}
