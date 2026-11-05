'use client';

/**
 * After an import where more than one card could be the second commander,
 * or the companion: which is it? Asked once, on the page, until answered.
 */

import Image from 'next/image';
import { useState } from 'react';

import * as api from '@/lib/api';
import type { SlotQuestion } from '@/lib/commanders';
import type { ListedCard } from '@/lib/db';
import { imageOf } from '@/lib/scryfall';

interface Props {
  listId: string;
  questions: SlotQuestion[];
  cards: ListedCard[];
  onAnswered: () => Promise<void> | void;
}

export default function SlotQuestions({ listId, questions, cards, onAnswered }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!questions.length) return null;
  const answer = async (change: Parameters<typeof api.setSlot>[1]) => {
    setBusy(true);
    setError(null);
    try { await api.setSlot(listId, change); await onAnswered(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save that'); } finally { setBusy(false); }
  };
  return (
    <div className="mt-4 flex flex-col gap-3">
      {questions.map((q) => {
        const options = q.options.map((id) => cards.find((c) => c.card.id === id)?.card).filter((c): c is NonNullable<typeof c> => !!c);
        if (!options.length) return null;
        return (
          <section key={q.kind} className="flex flex-col gap-2 rounded-2xl border border-[var(--accent)]/50 bg-[var(--accent)]/[0.06] p-3 text-sm">
            <p>
              <b>{q.kind === 'partner' ? 'Which card is your second commander?' : 'Which card is your companion?'}</b>{' '}
              <span className="text-[var(--muted)]">
                {q.kind === 'partner'
                  ? 'More than one card in this list could lead the deck beside your commander. The one you pick counts as one of the 100 and is never offered as a cut.'
                  : 'More than one card outside the deck could be its companion. It sits outside the 100.'}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {options.map((card) => (
                <button key={card.id} disabled={busy} onClick={() => answer({ cardId: card.id, slot: q.kind })}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 pl-1 pr-3 hover:border-[var(--accent)] disabled:opacity-50">
                  {imageOf(card, 'small') && <Image src={imageOf(card, 'small')!} alt="" width={28} height={39} className="rounded-sm" unoptimized />}
                  {card.name}
                </button>
              ))}
              <button disabled={busy} onClick={() => answer({ dismiss: q.kind })} className="rounded-lg px-3 py-1 text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50">
                {q.kind === 'partner' ? 'None: one commander' : 'None'}
              </button>
            </div>
            {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
          </section>
        );
      })}
    </div>
  );
}
