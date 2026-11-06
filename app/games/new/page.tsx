'use client';

/**
 * Setting up a game: who is playing, where they sit, what each is playing,
 * the starting life and who goes first. Then the life counter.
 *
 * Someone can take more than one seat - two people piloting two decks each
 * at a four-seat table. With "Borrow decks" on, any seat can play any
 * member's deck; the deck's record stays its owner's.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import DeckPicker from '@/components/DeckPicker';
import LayoutThumb from '@/components/LayoutThumb';
import { SeatAvatar } from '@/components/GameBits';
import * as api from '@/lib/api';
import { LAYOUTS, layoutFor } from '@/lib/game-layouts';
import { SEAT_COLOURS, seatLabels } from '@/lib/game-play';

const MAX = 6;
const LIVES = [40, 30, 20];

interface Pick { key: number; memberId: string; deckId: string | null; deckName: string }

let nextKey = 1;

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
  const [borrowing, setBorrowing] = useState(false);
  // The table layout picked for each number of players; the last game's to start with.
  const [layouts, setLayouts] = useState<Record<number, string>>({});
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
      const owned = new Set(Object.values(d.decks).flat().map((x) => x.id));
      const fromLast = lastGame?.seats.filter((s) => here.has(s.memberId))
        .map((s) => ({ key: nextKey++, memberId: s.memberId, deckId: s.deckId && owned.has(s.deckId) ? s.deckId : null, deckName: s.deckName })) ?? [];
      // One deck at one seat: a repeat (an old game from before that rule) takes the player's next free deck.
      for (let k = 0; k < fromLast.length; k++) {
        if (fromLast[k].deckId && fromLast.slice(0, k).some((x) => x.deckId === fromLast[k].deckId)) fromLast[k] = { ...seatFor(fromLast[k].memberId, fromLast.slice(0, k), d.decks), key: fromLast[k].key };
      }
      if (fromLast.length >= 2) {
        setSeats(fromLast);
        setBorrowing(lastGame.borrowing);
      } else {
        const fresh: Pick[] = [];
        for (const m of p.group.members.slice(0, MAX)) fresh.push(seatFor(m.id, fresh, d.decks));
        setSeats(fresh);
      }
      if (lastGame) setLife(lastGame.startingLife);
      const picked: Record<number, string> = {};
      for (const g of [...p.games].reverse()) if (g.layout) picked[g.seats.length] = g.layout;
      setLayouts(picked);
    }).catch((e: Error) => setError(e.message));
  }, [groupId, router]);

  const members = useMemo(() => new Map(page?.group.members.map((m) => [m.id, m]) ?? []), [page]);
  // Every deck by id, with whose it is - to name a borrowed one.
  const owners = useMemo(() => new Map(Object.entries(decks).flatMap(([owner, list]) => list.map((d) => [d.id, { deck: d, owner }] as const))), [decks]);
  const seatsOf = (memberId: string) => seats.filter((s) => s.memberId === memberId).length;

  const addSeat = (memberId: string) => {
    setFirst('random');
    setSeats((all) => (all.length >= MAX ? all : [...all, seatFor(memberId, all, decks)]));
  };
  const removeSeat = (key: number) => { setFirst('random'); setSeats((all) => all.filter((s) => s.key !== key)); };
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
  const borrow = (on: boolean) => {
    setBorrowing(on);
    // Turned off, a seat playing someone else's deck goes back to one of its own.
    if (!on) setSeats((all) => all.map((s, i) => (s.deckId && owners.get(s.deckId)?.owner !== s.memberId ? { ...seatFor(s.memberId, all.slice(0, i), decks), key: s.key } : s)));
  };

  const start = async () => {
    if (!groupId || seats.length < 2) return;
    setStarting(true);
    try {
      const firstSeat = first === 'random' ? Math.floor(Math.random() * seats.length) : first;
      const { id } = await api.startGame(groupId, seats, life, firstSeat, borrowing, layoutFor(seats.length, layouts[seats.length]).id);
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
            const count = seatsOf(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => addSeat(m.id)}
                disabled={seats.length >= MAX}
                aria-label={count ? `Give ${m.name} another seat` : `Give ${m.name} a seat`}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm disabled:opacity-40 ${count ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'border-[var(--border)]'}`}
              >
                <SeatAvatar art={m.art} name={m.name} size={26} />
                {m.name}
                <span aria-hidden className={count ? 'font-bold text-[var(--accent)]' : 'text-[var(--muted)]'}>{count > 1 ? `×${count}` : count ? '✓' : '＋'}</span>
              </button>
            );
          })}
          <Link href={`/games/groups/${page.group.id}?tab=players`} className="rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">＋ Add someone</Link>
        </div>
        <p className="text-xs text-[var(--muted)]">Tap someone to give them a seat; tap again to give them a second deck to pilot. Up to {MAX} seats.</p>
        {seats.length < 2 && <p className="text-sm text-amber-300">Pick at least two seats.</p>}
      </section>

      {seats.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Seats and decks</h2>
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={borrowing} onChange={(e) => borrow(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
              Borrow decks
            </label>
          </div>
          <p className="text-xs text-[var(--muted)]">
            In order round the table, clockwise - so the turn passes the way you sit.
            {borrowing ? ' Anyone can pilot anyone’s deck; a borrowed deck’s win or loss still goes on its owner’s deck, and on the pilot’s record.' : ''}
          </p>
          <ol className="flex flex-col gap-2">
            {seats.map((s, i) => {
              const m = members.get(s.memberId);
              const arrows = (
                <>
                  <button type="button" aria-label={`Move ${m?.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="h-8 w-8 rounded-lg border border-[var(--border)] disabled:opacity-30">↑</button>
                  <button type="button" aria-label={`Move ${m?.name} down`} disabled={i === seats.length - 1} onClick={() => move(i, 1)} className="h-8 w-8 rounded-lg border border-[var(--border)] disabled:opacity-30">↓</button>
                  <button type="button" aria-label={`Remove seat ${i + 1}`} onClick={() => removeSeat(s.key)} className="h-8 w-8 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-red-300">✕</button>
                </>
              );
              return (
                <li key={s.key} className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2.5 sm:flex-row sm:items-center">
                  <span className="flex min-w-0 items-center gap-2 sm:w-44 sm:shrink-0">
                    <span className="w-5 text-center text-sm font-bold" style={{ color: SEAT_COLOURS[i] }}>{i + 1}</span>
                    <SeatAvatar art={m?.art} name={m?.name ?? '?'} seat={i} size={34} />
                    <span className="min-w-0 flex-1 truncate font-semibold" title={m?.name}>{m?.name}</span>
                    <span className="flex shrink-0 gap-1 sm:hidden">{arrows}</span>
                  </span>
                  <DeckPicker
                    seat={i}
                    pilot={m!}
                    members={page.group.members}
                    decks={decks}
                    borrowing={borrowing}
                    value={{ deckId: s.deckId, deckName: s.deckName }}
                    taken={Object.fromEntries(seats.flatMap((x, k) => (x.deckId && k !== i ? [[x.deckId, k]] : [])))}
                    onChange={(c) => setDeck(i, c)}
                  />
                  <span className="flex shrink-0 gap-1 max-sm:hidden">{arrows}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {(LAYOUTS[seats.length] ?? []).length > 1 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Table layout</h2>
          <div className="grid grid-cols-3 gap-2">
            {LAYOUTS[seats.length].map((l) => {
              const on = layoutFor(seats.length, layouts[seats.length]).id === l.id;
              return (
                <button key={l.id} type="button" aria-pressed={on} onClick={() => setLayouts((x) => ({ ...x, [seats.length]: l.id }))}
                  className={`flex flex-col items-center gap-2 rounded-2xl border p-3 text-center ${on ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]' : 'border-[var(--border)] bg-[var(--surface)]'}`}>
                  <span className="grid h-[66px] place-items-center"><LayoutThumb layout={l} size={42} /></span>
                  <span className="text-sm font-semibold">{l.name}</span>
                  <span className="text-[11px] leading-snug text-[var(--muted)]">{l.hint}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-[var(--muted)]">Seat 1 is top left, then clockwise. Lay the phone either way - the board turns to fit - and it can be changed from the game’s menu.</p>
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
            {seatLabels(seats.map((s) => ({ ...s, name: members.get(s.memberId)?.name ?? '?' }))).map((label, i) => (
              <button key={seats[i].key} type="button" aria-pressed={first === i} onClick={() => setFirst(i)}
                className={`rounded-full border px-4 py-1.5 text-sm ${first === i ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'border-[var(--border)]'}`}>{label}</button>
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

/** A new seat for someone: their first deck not already at the table, else the first one. */
function seatFor(memberId: string, taken: Pick[], decks: Record<string, api.PickDeck[]>): Pick {
  const own = decks[memberId] ?? [];
  const used = new Set(taken.map((s) => s.deckId));
  const deck = own.find((d) => !used.has(d.id)) ?? own[0];
  return deck ? { key: nextKey++, memberId, deckId: deck.id, deckName: deck.name } : { key: nextKey++, memberId, deckId: null, deckName: '' };
}
