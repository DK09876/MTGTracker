'use client';

/**
 * Refine the search you are looking at: "only instants", "under $3",
 * "what about Atraxa instead". The model is given the search that ran and
 * changes only what the follow-up asks, so each one narrows or redirects
 * rather than starting over. The chain so far is shown above the box.
 */

import { useState } from 'react';

interface Props {
  /** Each request so far, the original search first. */
  thread: string[];
  busy: boolean;
  onSubmit: (text: string) => void;
}

export default function FollowUp({ thread, busy, onSubmit }: Props) {
  const [draft, setDraft] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const text = draft.trim();
        if (!text || busy) return;
        onSubmit(text);
        setDraft('');
      }}
      className="mt-3"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {thread.length > 1 && thread.slice(1).map((step, i) => (
          <span
            key={i}
            className={`rounded-full px-3 py-1 text-xs ${i === thread.length - 2 ? 'ring-id text-[var(--foreground)]' : 'border border-[var(--border)] text-[var(--muted)]'}`}
            title={`Refinement ${i + 1}`}
          >
            {step}
          </span>
        ))}
        <label className="flex min-w-[14rem] flex-1 items-center gap-1.5 rounded-full border border-dashed border-[var(--border)] px-3 focus-within:border-[var(--c1)]">
          <span aria-hidden className="text-[var(--muted)]">＋</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Refine: “only instants”, “under $3”, “for Atraxa instead”"
            aria-label="Refine this search"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
          />
          {draft.trim() && (
            <button type="submit" disabled={busy} className="btn-go -mr-2 rounded-full px-3 py-0.5 text-xs font-semibold disabled:opacity-50">
              Refine
            </button>
          )}
        </label>
      </div>
    </form>
  );
}
