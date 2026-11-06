'use client';

/**
 * Games: the playgroups you are in, a way into each one's game night, and
 * any game left running.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import EmptyState from '@/components/EmptyState';
import { SeatAvatar, shortDate } from '@/components/GameBits';
import * as api from '@/lib/api';

export default function GamesPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<api.GroupSummary[] | null>(api.peek<{ groups: api.GroupSummary[] }>('playgroups')?.groups ?? null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.playgroups().then((r) => setGroups(r.groups)).catch((e: Error) => setError(e.message)); }, []);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const { group } = await api.createPlaygroup(name);
      router.push(`/games/groups/${group.id}?tab=players`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not make the playgroup'); }
  };

  const form = (
    <form onSubmit={(e) => { e.preventDefault(); create(); }} className="flex w-full max-w-md gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Friday Commander"
        aria-label="Playgroup name"
        maxLength={60}
        className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm outline-none focus:border-[var(--accent)]"
      />
      <button type="submit" disabled={!name.trim()} className="btn-go rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-40">Create</button>
    </form>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold">Games</h1>
        {!!groups?.length && !naming && (
          <button type="button" onClick={() => setNaming(true)} className="ml-auto rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:border-[var(--accent)]">＋ New playgroup</button>
        )}
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      {naming && !!groups?.length && form}
      {!groups && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {groups && !groups.length && (
        <EmptyState title="Start a playgroup" actions={form}>
          A playgroup is the people you play with. Add your friends - anyone on the app, or a guest by name - then start a game: the phone keeps everyone’s life, and every game counts toward who wins and which decks win.
        </EmptyState>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups?.map((g) => (
          <li key={g.id} className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <Link href={`/games/groups/${g.id}`} className="group flex flex-col gap-2">
              <p className="truncate font-display text-xl font-extrabold group-hover:text-[var(--accent)]" title={g.name}>{g.name}</p>
              <div className="flex items-center gap-2">
                <span className="flex -space-x-2">
                  {g.members.slice(0, 6).map((m, i) => <SeatAvatar key={m.id} art={m.art} name={m.name} seat={i} size={28} ring />)}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {g.members.length} player{g.members.length === 1 ? '' : 's'} · {g.games} game{g.games === 1 ? '' : 's'}{g.lastPlayed ? ` · last ${shortDate(g.lastPlayed)}` : ''}
                </span>
              </div>
            </Link>
            <div className="mt-auto flex gap-2">
              {g.live ? (
                <Link href={`/games/play/${g.live}`} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold">Back to the game</Link>
              ) : (
                <Link href={`/games/new?group=${g.id}`} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold">Start a game</Link>
              )}
              <Link href={`/games/groups/${g.id}`} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:border-[var(--accent)]">Stats</Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
