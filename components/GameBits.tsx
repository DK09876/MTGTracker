'use client';

/** Small pieces the game pages share: a player's picture and a win-rate bar. */

import { SEAT_COLOURS } from '@/lib/game-play';
import { winRate } from '@/lib/game-stats';

/** A round picture: the commander's art when there is one, else the first letter on the seat's colour. */
export function SeatAvatar({ art, name, seat, size = 32, ring }: { art: string | null | undefined; name: string; seat?: number; size?: number; ring?: boolean }) {
  const colour = seat === undefined ? 'var(--accent)' : SEAT_COLOURS[seat % SEAT_COLOURS.length];
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center overflow-hidden rounded-full font-display font-bold text-[#141210]"
      style={{ width: size, height: size, fontSize: size * 0.42, background: colour, boxShadow: ring ? `0 0 0 2px var(--background), 0 0 0 4px ${colour}` : undefined }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {art ? <img src={art} alt="" className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}
    </span>
  );
}

/** "38%" with a thin bar, and the record beside it. */
export function WinRate({ wins, games, wide = false }: { wins: number; games: number; wide?: boolean }) {
  const rate = winRate(wins, games);
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="w-10 text-right font-bold">{games ? `${rate}%` : '-'}</span>
      {/* The bar is a glance for wider screens; on a phone the number says it. */}
      <span aria-hidden className={`h-1.5 overflow-hidden rounded-full bg-white/10 max-sm:hidden ${wide ? 'w-28' : 'w-14'}`}>
        <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${rate}%` }} />
      </span>
      <span className="text-xs text-[var(--muted)]"><span className="text-emerald-300">{wins}</span>–<span className="text-red-300">{games - wins}</span></span>
    </span>
  );
}

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
export const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
