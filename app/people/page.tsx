'use client';

/** Everyone on the app, each with their favourite commander as their picture. */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import Avatar from '@/components/Avatar';
import * as api from '@/lib/api';

export default function PeoplePage() {
  const [people, setPeople] = useState<api.PersonCard[] | null>(null);
  useEffect(() => { api.peopleList().then((r) => setPeople(r.people)).catch(() => setPeople([])); }, []);
  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-3xl font-bold">People</h1>
      <p className="text-sm text-[var(--muted)]">Open someone to see their favourite commander and the decks they show. Decks are private until their owner makes them public.</p>
      {!people && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {people?.map((p) => (
          <li key={p.id}>
            <Link href={`/people/${p.id}`} className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center hover:border-[var(--accent)]">
              <Avatar art={p.art} name={p.name} size={80} />
              <span className="font-semibold">{p.name}</span>
              <span className="text-xs text-[var(--muted)]">
                {p.commander ? p.commander.split(',')[0] : 'No favourite yet'} · {p.publicDecks} deck{p.publicDecks === 1 ? '' : 's'} shown
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
