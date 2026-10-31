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

import Image from 'next/image';

import ManaCost, { IdentitySymbols } from './ManaCost';
import type { CommanderRef, Interpretation, Step } from '@/lib/interpret';

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
    <div className="mt-4 flex flex-col gap-3 text-sm">
      {commander && <CommanderBanner commander={commander} />}
      {!quiet && (
        <div className="flex flex-col gap-1.5">
          {explanation && (
            <p>
              <span className="text-[var(--c1)]" aria-hidden>✦ </span>
              {explanation}
            </p>
          )}
          {note && <p className="text-[var(--muted)]">{note}</p>}
          {editable && (
            <form
              onSubmit={(e) => { e.preventDefault(); onRun(draft.trim()); }}
              className="flex items-center gap-2"
            >
              <span className="shrink-0 text-xs text-[var(--muted)]">Read as</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={commander ? `Anything for ${commander.name}` : undefined}
                aria-label="Scryfall query used for this search"
                title={commander ? `${commander.name}'s colours and Commander legality are added when it runs` : undefined}
                spellCheck={false}
                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 font-mono text-xs outline-none focus:border-[var(--c1)]"
              />
              {edited && (
                <button type="submit" className="btn-go rounded-full px-3 py-1 text-xs font-semibold">
                  Run
                </button>
              )}
            </form>
          )}
        </div>
      )}

      {trace.length > 0 && (
        <details>
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

/**
 * The commander a search is for, on a stage of its own: its art blurred
 * behind its name, mana cost and colours, and a link to EDHREC.
 */
function CommanderBanner({ commander }: { commander: CommanderRef }) {
  // Scryfall serves each size at the same path: the art crop sits beside "normal".
  const art = commander.image?.replace('/normal/', '/art_crop/');
  return (
    <div className="relative isolate overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--c1)_35%,var(--border))]">
      <div aria-hidden className="id-glow absolute -inset-8 -z-20 opacity-80 blur-2xl" />
      {art && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art} alt="" aria-hidden className="absolute inset-0 -z-20 h-full w-full scale-110 object-cover opacity-60 blur-md saturate-125" />
      )}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-[var(--background)]/95 via-[var(--background)]/75 to-[var(--background)]/30" />
      <div className="flex flex-wrap items-center gap-4 px-4 py-3">
        {commander.image && (
          <Image src={commander.image} alt="" width={64} height={89} className="w-14 shrink-0 rounded-[5%/3.6%] shadow-lg sm:w-16" unoptimized />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground)]/60">For your commander</p>
          <p className="font-display text-lg font-extrabold leading-tight [text-wrap:balance] sm:text-2xl">{commander.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--foreground)]/75">
            {/* A pair of partners has no one cost: their colours instead. */}
            {commander.manaCost ? <ManaCost cost={commander.manaCost} size={15} /> : <IdentitySymbols identity={commander.identity} size={15} />}
          </p>
        </div>
        <a href={commander.edhrecUrl} target="_blank" rel="noreferrer" className="glass rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-white/10">
          EDHREC ↗
        </a>
      </div>
    </div>
  );
}

