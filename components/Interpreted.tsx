'use client';

/**
 * What a search was taken to mean, above its results.
 *
 * The translated query is shown, and editable, rather than hidden behind the
 * results. A wrong translation is then one keystroke from fixed instead of a
 * mystery, and reading the query is how the syntax gets learned.
 */

import { useState } from 'react';

import type { Interpretation } from '@/lib/interpret';

interface Props {
  interpretation: Interpretation;
  onRun: (query: string) => void;
}

export default function Interpreted({ interpretation, onRun }: Props) {
  // Keyed by the query it was given, so a new search resets the draft.
  return <Editor key={interpretation.query} interpretation={interpretation} onRun={onRun} />;
}

function Editor({ interpretation, onRun }: Props) {
  const [draft, setDraft] = useState(interpretation.query);
  const edited = draft.trim() !== interpretation.query;
  const { via, explanation, note } = interpretation;

  // Syntax typed by hand needs no echo; only show it when there is news.
  if (via === 'syntax' && !explanation && !note) return null;

  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
      {explanation && (
        <p>
          <span className="text-[var(--accent)]" aria-hidden>✦ </span>
          {explanation}
        </p>
      )}
      {note && <p className="text-[var(--muted)]">{note}</p>}
      {interpretation.query && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (draft.trim()) onRun(draft.trim()); }}
          className="mt-2 flex items-center gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Scryfall query used for this search"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--accent)]"
          />
          {edited && (
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-medium text-[#221c08] hover:brightness-110"
            >
              Run
            </button>
          )}
        </form>
      )}
    </div>
  );
}
