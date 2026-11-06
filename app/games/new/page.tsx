'use client';

/**
 * Setting up a game: who is playing, where they sit, what each is playing,
 * the starting life and who goes first. Then the life counter.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { SeatAvatar } from '@/components/GameBits';
import * as api from '@/lib/api';
import { SEAT_COLOURS } from '@/lib/game-play';

const MAX = 6;
const LIVES = [40, 30, 20];
const OTHER = '__other';

interface Pick { memberId: string; deckId: string | null; deckName: string }

export default function NewGamePage() {
  // Read from the address in the browser: this page is built ahead, without its query.
  const [groupId, setGroupId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const fromLink = () => setGroupId(new URLSearchParams(window.location.search).get('group'));
    fromLink();
  }, []);
  const router = useRouter();
  const [page, setPage] = useState<api.GroupPage | null>(null);
  const [decks, setDecks] = useState<Record<string, api.PickDeck[]>>({});
  const [seats, setSeats] = useState<Pick[]>([]);
  const [life, setLife] = useState(40);
  const [first, setFirst] = useState<number | 'random'>('random');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    Promise.all([api.playgroup(groupId), api.playgroupDecks(groupId)]).then(([p, d]) => {
      if (p.live[0]) { router.replace(`/games/play/${p.live[0].id}`); return; }
      setPage(p);
      setDecks(d.decks);
      // The last game's table, in its seats and with the same decks; else everyone (up to six).
      const lastGame = p.games[0];
      const here = new Set(p.group.members.map((m) => m.id));
      const pick = (memberId: string, deckId: string | null = null, deckName = ''): Pick => {
        const own = d.decks[memberId] ?? [];
        const deck = (deckId && own.find((x) => x.id === deckId)) || (!deckName ? own[0] : undefined);
        return deck ? { memberId, deckId: deck.id, deckName: deck.name } : { memberId, deckId: null, deckName };
      };
      const fromLast = lastGame?.seats.filter((s) => here.has(s.memberId)).map((s) => pick(s.memberId, s.deckId, s.deckName)) ?? [];
      setSeats(fromLast.length >= 2 ? fromLast : p.group.members.slice(0, MAX).map((m) => pick(m.id)));
      if (lastGame) setLife(lastGame.startingLife);
    }).catch((e: Error) => setError(e.message));
  }, [groupId, router]);

  const members = useMemo(() => new Map(page?.group.members.map((m) => [m.id, m]) ?? []), [page]);
  const seated = new Set(seats.map((s) => s.memberId));

  const toggle = (memberId: string) => {
    setFirst('random');
    setSeats((all) => {
      if (all.some((s) => s.memberId === memberId)) return all.filter((s) => s.memberId !== memberId);
      if (all.length >= MAX) return all;
      const own = decks[memberId] ?? [];
      return [...all, own[0] ? { memberId, deckId: own[0].id, deckName: own[0].name } : { memberId, deckId: null, deckName: '' }];
    });
  };
  const move = (i: number, by: number) => {
    setFirst('random');
    setSeats((all) => {
      const j = i + by;
      if (j < 0 || j >= all.length) return all;
      const next = [...all];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const setDeck = (i: number, change: Partial<Pick>) => setSeats((all) => all.map((s, k) => (k === i ? { ...s, ...change } : s)));

  const start = async () => {
    if (!groupId || seats.length < 2) return;
    setStarting(true);
    try {
      const firstSeat = first === 'random' ? Math.floor(Math.random() * seats.length) : first;
      const { id } = await api.startGame(groupId, seats, life, firstSeat);
      router.push(`/games/play/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the game');
      setStarting(false);
    }
  };

  if (groupId === undefined) return null;
  if (!groupId) return <p className="text-sm text-[var(--muted)]">Pick a playgroup on <Link href="/games" className="underline">Games</Link> first.</p>;
  if (error && !page) return <p className="text-sm text-red-300">{error}</p>;
  if (!page) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <Link href={`/games/groups/${page.group.id}`} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">← {page.group.name}</Link>
        <h1 className="font-display text-3xl font-bold">New game</h1>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Who’s playing</h2>
        <div className="flex flex-wrap gap-2">
          {page.group.members.map((m) => {
            const on = seated.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(m.id)}
                disabled={!on && seats.length >= MAX}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm disabled:opacity-40 ${on ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'border-[var(--border)]'}`}
              >
                <SeatAvatar art={m.art} name={m.name} size={26} />
                {m.name}
                {on && <span aria-hidden className="text-[var(--accent)]">✓</span>}
              </button>
            );
          })}
          <Link href={`/games/groups/${page.group.id}?tab=players`} className="rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">＋ Add someone</Link>
        </div>
        {seats.length < 2 && <p className="text-sm text-amber-300">Pick at least two players.</p>}
      </section>

      {seats.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Seats and decks</h2>
          <p className="text-xs text-[var(--muted)]">In order round the table, clockwise - so the turn passes the way you sit.</p>
          <ol className="flex flex-col gap-2">
            {seats.map((s, i) => {
              const m = members.get(s.memberId);
              const own = decks[s.memberId] ?? [];
              const chosen = own.find((d) => d.id === s.deckId);
              const typing = !s.deckId;
              const arrows = (
                <>
                  <button type="button" aria-label={`Move ${m?.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="h-8 w-8 rounded-lg border border-[var(--border)] disabled:opacity-30">↑</button>
                  <button type="button" aria-label={`Move ${m?.name} down`} disabled={i === seats.length - 1} onClick={() => move(i, 1)} className="h-8 w-8 rounded-lg border border-[var(--border)] disabled:opacity-30">↓</button>
                </>
              );
              return (
                <li key={s.memberId} className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2.5 sm:flex-row sm:items-center">
                  <span className="flex min-w-0 items-center gap-2 sm:w-44 sm:shrink-0">
                    <span className="w-5 text-center text-sm font-bold" style={{ color: SEAT_COLOURS[i] }}>{i + 1}</span>
                    <SeatAvatar art={chosen?.commander?.art ?? m?.art} name={m?.name ?? '?'} seat={i} size={34} />
                    <span className="min-w-0 flex-1 truncate font-semibold" title={m?.name}>{m?.name}</span>
                    <span className="flex shrink-0 gap-1 sm:hidden">{arrows}</span>
                  </span>
                  <div className="flex min-w-0 flex-1 gap-2">
                    {own.length > 0 && (
                      <select
                        aria-label={`${m?.name}’s deck`}
                        value={typing ? OTHER : s.deckId!}
                        onChange={(e) => {
                          const d = own.find((x) => x.id === e.target.value);
                          setDeck(i, d ? { deckId: d.id, deckName: d.name } : { deckId: null, deckName: '' });
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
                      >
                        {own.map((d) => <option key={d.id} value={d.id}>{d.name}{d.commander ? ` - ${d.commander.name.split(',')[0]}` : ''}</option>)}
                        <option value={OTHER}>Another deck…</option>
                      </select>
                    )}
                    {typing && (
                      <input
                        aria-label={`${m?.name}’s deck name`}
                        value={s.deckName}
                        onChange={(e) => setDeck(i, { deckName: e.target.value })}
                        placeholder="Deck or commander (optional)"
                        maxLength={60}
                        className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
                      />
                    )}
                  </div>
                  <span className="flex shrink-0 gap-1 max-sm:hidden">{arrows}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Starting life</h2>
        <div className="flex flex-wrap items-center gap-2">
          {LIVES.map((l) => (
            <button key={l} type="button" aria-pressed={life === l} onClick={() => setLife(l)}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold tabular-nums ${life === l ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'border-[var(--border)]'}`}>{l}</button>
          ))}
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            or
            <input type="number" min={1} max={999} value={life} onChange={(e) => setLife(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
              className="w-20 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] tabular-nums" />
          </label>
        </div>
      </section>

      {seats.length >= 2 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Going first</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={first === 'random'} onClick={() => setFirst('random')}
              className={`rounded-full border px-4 py-1.5 text-sm ${first === 'random' ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'border-[var(--border)]'}`}>🎲 Pick at random</button>
            {seats.map((s, i) => (
              <button key={s.memberId} type="button" aria-pressed={first === i} onClick={() => setFirst(i)}
                className={`rounded-full border px-4 py-1.5 text-sm ${first === i ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'border-[var(--border)]'}`}>{members.get(s.memberId)?.name}</button>
            ))}
          </div>
        </section>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}
      <button type="button" onClick={start} disabled={seats.length < 2 || starting} className="btn-go self-start rounded-full px-7 py-3 font-semibold disabled:opacity-40">
        {starting ? 'Starting…' : `Start the game${seats.length >= 2 ? ` · ${seats.length} players` : ''}`}
      </button>
    </div>
  );
}
