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
      {thread.length > 1 && (
        <p className="mb-1.5 text-xs text-[var(--muted)]">
          {thread.map((step, i) => (
            <span key={i}>
              {i > 0 && <span aria-hidden> › </span>}
              <span className={i === thread.length - 1 ? 'text-[var(--foreground)]' : ''}>{step}</span>
            </span>
          ))}
        </p>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Refine this search — “only instants”, “under $3”, “for Atraxa instead”"
          aria-label="Refine this search"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          Refine
        </button>
      </div>
    </form>
  );
}
