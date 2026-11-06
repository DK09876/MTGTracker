'use client';

/**
 * A finished game: how everyone ended, life over the game, what happened
 * in order. Its winner, decks and note can be fixed here afterwards.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useRef, useState } from 'react';

import { clock, shortDate } from '@/components/GameBits';
import MoreMenu from '@/components/MoreMenu';
import * as api from '@/lib/api';
import { formatDuration, lifeOverTime, SEAT_COLOURS, type GameEvent } from '@/lib/game-play';

export default function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [game, setGame] = useState<api.Game | null>(null);
  const [decks, setDecks] = useState<Record<string, api.PickDeck[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [fixing, setFixing] = useState(false);

  useEffect(() => {
    api.game(id).then(({ game: g }) => {
      if (g.status === 'live') { router.replace(`/games/play/${id}`); return; }
      setGame(g);
      setNote(g.note);
      api.playgroupDecks(g.groupId).then((d) => setDecks(d.decks)).catch(() => {});
    }).catch((e: Error) => setError(e.message));
  }, [id, router]);

  const edit = async (change: Parameters<typeof api.editGame>[1]) => {
    try { setGame((await api.editGame(id, change)).game); } catch (e) { setError(e instanceof Error ? e.message : 'Could not change the game'); }
  };

  if (error && !game) return <p className="text-sm text-red-300">{error}</p>;
  if (!game) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  const winner = game.seats.find((s) => s.won);
  const length = game.endedAt ? Date.parse(game.endedAt) - Date.parse(game.startedAt) : null;
  const first = game.events.find((e) => e.k === 'out');
  const order = [...game.seats].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/games/groups/${game.groupId}?tab=games`} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">← Games</Link>
          <h1 className="font-display text-3xl font-bold">{winner ? `${winner.name} won` : 'A draw'}</h1>
          <p className="text-sm text-[var(--muted)]">
            {shortDate(game.startedAt)}, {clock(game.startedAt)}{length ? ` · ${formatDuration(length)}` : ''}{game.rounds ? ` · ${game.rounds} round${game.rounds === 1 ? '' : 's'}` : ''} · {game.seats.length} players · {game.startingLife} life
          </p>
        </div>
        <MoreMenu
          label="More for this game"
          items={[
            { label: fixing ? 'Done fixing' : 'Fix the winner or decks', onClick: () => setFixing((f) => !f) },
            { label: 'Delete game…', danger: true, confirm: 'Delete this game? It comes out of the stats.', onClick: async () => { await api.deleteGame(id); router.push(`/games/groups/${game.groupId}?tab=games`); } },
          ]}
        />
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}

      <ul className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {order.map((s) => {
          const own = decks[s.memberId] ?? [];
          return (
            <li key={s.seat} className={`relative flex flex-col overflow-hidden rounded-2xl border bg-[var(--surface)] ${s.won ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}>
              <div className="relative h-24">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {s.commander?.art ? <img src={s.commander.art} alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_25%]" />
                  : <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${SEAT_COLOURS[s.seat]} 50%, var(--surface)), var(--surface))` }} />}
                <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[var(--surface)] to-transparent" />
                <span className="absolute right-2 top-2 font-display text-3xl font-extrabold tabular-nums drop-shadow">{s.life ?? '-'}</span>
                {s.won && <span className="absolute left-2 top-2 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-bold text-[#221c08]">WINNER</span>}
              </div>
              <div className="flex flex-col gap-0.5 px-3 pb-3">
                <p className="flex items-center gap-1.5 truncate font-semibold"><span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEAT_COLOURS[s.seat] }} />{s.name}</p>
                {fixing && own.length > 0 ? (
                  <select
                    aria-label={`${s.name}’s deck`}
                    value={s.deckId ?? ''}
                    onChange={(e) => { const d = own.find((x) => x.id === e.target.value); if (d) edit({ seat: { seat: s.seat, deckId: d.id, deckName: d.name } }); }}
                    className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-1.5 py-1 text-xs"
                  >
                    {!s.deckId && <option value="">{s.deckName || 'No deck named'}</option>}
                    {own.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                ) : (
                  <p className="truncate text-xs text-[var(--muted)]">{s.deckName || 'No deck named'}</p>
                )}
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {s.place ? (s.won ? '1st' : `${ordinal(s.place)}`) : ''}{s.seat === game.firstSeat ? ' · went first' : ''}{first && first.k === 'out' && first.s === s.seat ? ' · out first' : ''}{s.cmdDealt ? ` · ${s.cmdDealt} commander dmg` : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {fixing && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          <span className="text-[var(--muted)]">Winner</span>
          {game.seats.map((s) => (
            <button key={s.seat} type="button" aria-pressed={s.won} onClick={() => edit({ winner: s.seat })}
              className={`rounded-full border px-3 py-1 ${s.won ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'border-[var(--border)]'}`}>{s.name}</button>
          ))}
          <button type="button" aria-pressed={!winner} onClick={() => edit({ winner: null })}
            className={`rounded-full border px-3 py-1 ${!winner ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'border-[var(--border)]'}`}>Draw</button>
        </div>
      )}

      <LifeChart game={game} />

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Note</h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note !== game.note) edit({ note }); }}
          placeholder="What happened - the combo, the misplay, the deal that went wrong…"
          rows={2}
          maxLength={2000}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm outline-none focus:border-[var(--accent)]"
        />
      </section>

      {game.events.length > 0 && (
        <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <summary className="cursor-pointer text-sm font-semibold">Everything that happened <span className="font-normal text-[var(--muted)]">· {game.events.length} changes</span></summary>
          <ol className="mt-3 flex flex-col gap-1 text-sm">
            {game.events.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-16 shrink-0 tabular-nums text-[var(--muted)]">{clock(new Date(e.t).toISOString())}</span>
                <span>{line(e, game)}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function line(e: GameEvent, game: api.Game) {
  const name = (s: number) => game.seats[s]?.name ?? 'Someone';
  if (e.k === 'life') return `${name(e.s)} ${e.d < 0 ? `lost ${-e.d}` : `gained ${e.d}`} life`;
  if (e.k === 'cmd') return e.d > 0 ? `${name(e.s)} took ${e.d} commander damage from ${name(e.from)}` : `${name(e.s)}: ${-e.d} commander damage from ${name(e.from)} taken back`;
  if (e.k === 'poison') return e.d > 0 ? `${name(e.s)} got ${e.d} poison` : `${name(e.s)} lost ${-e.d} poison`;
  if (e.k === 'out') return `${name(e.s)} is out`;
  return 'Turn passed';
}

/** Life for each player over the game, by time; hover for everyone's life at that moment. */
function LifeChart({ game }: { game: api.Game }) {
  const rows = useMemo(() => lifeOverTime(game.seats.length, game.startingLife, game.firstSeat, game.events), [game]);
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the box's own width, so text stays its size from a phone to a wide screen.
  const [W, setW] = useState(720);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!box.current) return;
    const watch = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    watch.observe(box.current);
    return () => watch.disconnect();
  }, [rows.length]);
  if (rows.length < 3) return null;
  const H = 240, L = 34, R = 10, T = 10, B = 24;
  const start = Date.parse(game.startedAt);
  const times = rows.map((r) => r.t ?? start);
  const t0 = Math.min(start, ...times), t1 = Math.max(...times, t0 + 1);
  const all = rows.flatMap((r) => r.life);
  const lo = Math.min(0, ...all), hi = Math.max(game.startingLife, ...all);
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const ticks = [lo, Math.round((lo + hi) / 2), hi].filter((v, i, a) => a.indexOf(v) === i);
  // Steps, not slopes: life changes all at once.
  const path = (seat: number) => rows.map((r, i) => `${i ? `H${x(times[i]).toFixed(1)}V` : `M${x(times[i]).toFixed(1)},`}${y(r.life[seat]).toFixed(1)}`).join('');
  const at = hover !== null ? rows[hover] : null;
  const mins = Math.round((t1 - t0) / 60000);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Life</h2>
        <ul className="flex flex-wrap gap-3 text-xs">
          {game.seats.map((s) => (
            <li key={s.seat} className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: SEAT_COLOURS[s.seat] }} />
              {s.name}{at ? <b className="tabular-nums">{at.life[s.seat]}</b> : null}
            </li>
          ))}
        </ul>
        {at?.t && <span className="ml-auto text-xs tabular-nums text-[var(--muted)]">{clock(new Date(at.t).toISOString())}</span>}
      </div>
      <div ref={box} className="mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block max-w-full touch-none"
        role="img"
        aria-label={`Life over ${mins} minutes`}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          let best = 0;
          times.forEach((t, i) => { if (Math.abs(x(t) - px) < Math.abs(x(times[best]) - px)) best = i; });
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={v === 0 ? 1.5 : 1} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{v}</text>
          </g>
        ))}
        <text x={L} y={H - 6} fontSize="11" fill="var(--muted)">start</text>
        <text x={W - R} y={H - 6} textAnchor="end" fontSize="11" fill="var(--muted)">{formatDuration(t1 - t0)}</text>
        {hover !== null && <line x1={x(times[hover])} x2={x(times[hover])} y1={T} y2={H - B} stroke="var(--muted)" strokeDasharray="3 3" />}
        {game.seats.map((s) => <path key={s.seat} d={path(s.seat)} fill="none" stroke={SEAT_COLOURS[s.seat]} strokeWidth={2} strokeLinejoin="round" />)}
        {hover !== null && game.seats.map((s) => (
          <circle key={s.seat} cx={x(times[hover])} cy={y(rows[hover].life[s.seat])} r={4} fill={SEAT_COLOURS[s.seat]} stroke="var(--surface)" strokeWidth={2} />
        ))}
      </svg>
      </div>
    </section>
  );
}

function ordinal(n: number) {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}
