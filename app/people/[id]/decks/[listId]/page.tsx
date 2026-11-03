'use client';

/** A deck someone shows others: read only, grouped by card type. */

import Image from 'next/image';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';

import ManaCost from '@/components/ManaCost';
import * as api from '@/lib/api';
import { primaryType } from '@/lib/deckview';
import { identityStyle } from '@/lib/identity';
import { imageOf, manaCostOf } from '@/lib/scryfall';

export default function SharedDeck({ params }: { params: Promise<{ id: string; listId: string }> }) {
  const { id, listId } = use(params);
  const [deck, setDeck] = useState<Awaited<ReturnType<typeof api.personDeck>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.personDeck(id, listId).then(setDeck).catch((e) => setError(e instanceof Error ? e.message : 'Could not load')); }, [id, listId]);
  if (error) return <p className="mt-8 text-center text-red-400">{error}</p>;
  if (!deck) return <p className="mt-8 text-center text-[var(--muted)]">Loading…</p>;

  const groups = new Map<string, typeof deck.cards>();
  for (const c of deck.cards) groups.set(primaryType(c.card), [...(groups.get(primaryType(c.card)) ?? []), c]);
  const commander = deck.list.commander;

  return (
    <div className="flex flex-col gap-6" style={identityStyle(commander?.color_identity ?? null)}>
      <Link href={`/people/${id}`} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">← Back to the profile</Link>
      <div className="flex flex-wrap items-end gap-5">
        {commander && imageOf(commander, 'normal') && (
          <Image src={imageOf(commander, 'normal')!} alt={commander.name} width={180} height={251} className="rounded-xl" unoptimized />
        )}
        <div>
          <h1 className="font-display text-4xl font-bold"><span className="id-text">{deck.list.name}</span></h1>
          <p className="text-sm text-[var(--muted)]">{commander?.name ?? 'No commander'} · {deck.list.totalCards} cards · read only</p>
        </div>
      </div>
      <div className="columns-1 gap-6 sm:columns-2 lg:columns-3">
        {[...groups.entries()].map(([type, cards]) => (
          <section key={type} className="mb-5 break-inside-avoid">
            <h2 className="mb-1.5 text-sm font-semibold text-[var(--muted)]">{type} ({cards.reduce((n, c) => n + c.quantity, 0)})</h2>
            <ul className="flex flex-col gap-0.5 text-sm">
              {cards.map((c) => (
                <li key={c.card.id} className="flex justify-between gap-2">
                  <span>{c.quantity > 1 && `${c.quantity} `}{c.card.name}</span>
                  <ManaCost cost={manaCostOf(c.card)} size={13} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
