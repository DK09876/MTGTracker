'use client';

/**
 * "Which card did you mean?" - the one panel every page shows when the owner's words could be several cards, or
 * look like a misspelt name (lib/card-names.ts, AGENTS.md "Reading the owner's words"). Shown before any AI call:
 * a near match is never taken silently. The cards are shown by picture, to pick by; a misspelt name can also be
 * answered "None of these".
 */

import Image from 'next/image';

import CardText from '@/components/CardText';
import type { NamedChoice } from '@/lib/card-names';
import { steady } from '@/lib/steady-tap';

const button = 'min-h-10 rounded-full border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';

interface Props {
  choice: NamedChoice;
  /** What the owner asked, shown under the heading. */
  question?: string;
  onPick: (name: string) => void;
  /** "None of these", for a misspelt name: carry on without a card for those words. */
  onNone?: () => void;
  onCancel?: () => void;
  id?: string;
}

export default function CardChoice({ choice: c, question, onPick, onNone, onCancel, id = 'which-card' }: Props) {
  return (
    <section id={id} className="mt-5 flex scroll-mt-20 flex-col gap-5 rounded-2xl border border-[var(--accent)]/50 p-4" aria-label="Which card?">
      <div>
        <h2 className="font-medium">
          {c.typo ? <>No card is named “{c.mention}”. Did you mean…</> : <>Which {c.mention[0].toUpperCase() + c.mention.slice(1)} did you mean?</>}
        </h2>
        {question && <p className="text-sm text-[var(--muted)]">For: <CardText text={question} /></p>}
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {c.options.map((o) => (
            <button key={o.name} {...steady(() => onPick(o.name))} className="flex flex-col gap-1 rounded-xl border border-[var(--border)] p-2 text-left text-sm hover:border-[var(--accent)]">
              {o.image && <Image src={o.image} alt="" width={244} height={340} className="w-full rounded-lg" unoptimized />}
              <span>{o.name}</span>
            </button>
          ))}
        </div>
        {c.typo && onNone && <button {...steady(onNone)} className={`${button} mt-3`}>None of these</button>}
      </div>
      {onCancel && <button onClick={onCancel} className={`${button} self-start`}>Cancel</button>}
    </section>
  );
}
