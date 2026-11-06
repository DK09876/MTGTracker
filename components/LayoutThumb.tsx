'use client';

/**
 * A little picture of a table layout: the board's shape, a box per seat in
 * its colour, and a mark showing which way each one faces.
 */

import { SEAT_COLOURS } from '@/lib/game-play';
import type { Layout } from '@/lib/game-layouts';

export default function LayoutThumb({ layout, size = 44 }: { layout: Layout; size?: number }) {
  const wide = layout.canvas === 'landscape';
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 gap-[2px] rounded-[5px] border border-white/15 bg-black p-[2px]"
      style={{ gridTemplateColumns: layout.cols, gridTemplateRows: layout.rows, width: wide ? size * 1.5 : size, height: wide ? size : size * 1.5 }}
    >
      {layout.spots.map((s, i) => (
        <span key={i} className="grid place-items-center rounded-[3px]" style={{ gridRow: s.row, gridColumn: s.col, background: `color-mix(in srgb, ${SEAT_COLOURS[i]} 70%, #000)` }}>
          {/* The arrow points at the player, the way a panel's text reads for them. */}
          <span className="block text-[8px] font-black leading-none text-white" style={{ transform: `rotate(${s.rot}deg)` }}>▼</span>
        </span>
      ))}
    </span>
  );
}
