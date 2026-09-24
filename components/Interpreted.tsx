'use client';

/**
 * What a search was taken to mean, and how it ran.
 *
 * The query that ran is shown, and editable, rather than hidden behind the
 * results. A wrong translation is then one keystroke from fixed instead of a
 * mystery, and reading the query is how the syntax gets learned.
 *
 * Underneath, collapsed, is every step: what the AI was asked, which
 * commander it resolved to, each query sent to Scryfall or Spellbook in
 * plain English and as written, and how many results it found.
 */

import { useState } from 'react';

import ManaCost from './ManaCost';
import type { Interpretation, Step } from '@/lib/interpret';

interface Props {
  interpretation: Interpretation;
  trace: Step[];
  onRun: (query: string) => void;
}

export default function Interpreted(props: Props) {
  // Keyed by the query it was given, so a new search resets the draft.
  return <Editor key={props.interpretation.query} {...props} />;
}

function Editor({ interpretation, trace, onRun }: Props) {
  const [draft, setDraft] = useState(interpretation.query);
  const edited = draft.trim() !== interpretation.query;
  const { via, kind, explanation, note, commander } = interpretation;

  // Syntax typed by hand needs no echo, only the collapsed record.
  const quiet = via === 'syntax' && !explanation && !note && !commander;
  // A combo query is Commander Spellbook's syntax, run by a different route.
  const editable = kind === 'cards' && (interpretation.query !== '' || !!commander);

  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
      {!quiet && (
        <>
          {explanation && (
            <p>
              <span className="text-[var(--accent)]" aria-hidden>✦ </span>
              {explanation}
            </p>
          )}
          {commander && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[var(--muted)]">
              <span>For</span>
              <span className="font-medium text-[var(--foreground)]">{commander.name}</span>
              <ManaCost cost={commander.manaCost} size={13} />
              <a href={commander.edhrecUrl} target="_blank" rel="noreferrer" className="underline hover:text-[var(--foreground)]">
                EDHREC ↗
              </a>
            </p>
          )}
          {note && <p className="mt-1 text-[var(--muted)]">{note}</p>}
          {editable && (
            <form
              onSubmit={(e) => { e.preventDefault(); onRun(draft.trim()); }}
              className="mt-2 flex items-center gap-2"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={commander ? `Anything for ${commander.name}` : undefined}
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
          {editable && commander && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              {commander.name}&apos;s colours and Commander legality are added when it runs.
            </p>
          )}
        </>
      )}

      {trace.length > 0 && (
        <details className={quiet ? '' : 'mt-2'}>
          <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
            How this search ran
          </summary>
          <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-xs">
            {trace.map((step, i) => (
              <li key={i}>
                <span>{step.text}</span>
                {step.count !== undefined && (
                  <span className="text-[var(--muted)]">
                    {' '}→ {step.count.toLocaleString()} {step.unit ?? 'card'}{step.count === 1 ? '' : 's'}
                  </span>
                )}
                {step.described && <p className="mt-0.5 text-[var(--muted)]">{step.described}</p>}
                {step.query && (
                  <code className="mt-0.5 block break-all font-mono text-[11px] text-[var(--muted)]">{step.query}</code>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
