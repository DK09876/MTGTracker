'use client';

/**
 * A card name Chat marked that the app couldn't find (handoff 10, item 39).
 * It stays a link. On hover, focus or tap it looks the card up once by its
 * exact name: the card-shaped loading box while it looks, the card if found
 * (kept, so the next hover is instant), "Couldn't find this card" with a
 * retry if not. Nothing is looked up until the owner points at it.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import CardPicture from './CardPicture';
import type { LookupState } from '@/lib/card-lookup';
import { imageOf, type ScryfallCard } from '@/lib/scryfall';

const WIDTH = 220;

export default function LookupName({ name, state, onLook, onOpen }: {
  name: string;
  state: LookupState<ScryfallCard>;
  /** Look it up (retry: after a miss). */
  onLook: (retry?: boolean) => void;
  onOpen: (card: ScryfallCard) => void;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // A tap shows the box until the next tap elsewhere (a phone has no hover).
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!pinned) return;
    const off = () => { setPinned(false); setAt(null); };
    const t = setTimeout(() => document.addEventListener('click', off, { once: true }), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', off); };
  }, [pinned]);
  const place = (x: number, y: number) => {
    const h = WIDTH * 1.4;
    setAt({ x: x + 24 + WIDTH > window.innerWidth ? Math.max(8, x - WIDTH - 24) : x + 24, y: Math.min(window.innerHeight - h - 10, Math.max(10, y - h / 2)) });
  };
  const src = state.status === 'found' ? imageOf(state.card, 'normal') : null;
  return (
    <>
      <button type="button" data-lookup-name={name} data-lookup={state.status}
        onPointerEnter={(e) => { if (e.pointerType !== 'mouse') return; place(e.clientX, e.clientY); onLook(); }} onMouseMove={(e) => { if (at && !pinned) place(e.clientX, e.clientY); }} onMouseLeave={() => { if (!pinned) setAt(null); }}
        onFocus={(e) => { if (!e.currentTarget.matches(':focus-visible')) return; const r = e.currentTarget.getBoundingClientRect(); place(r.right, r.top + r.height / 2); onLook(); }}
        onBlur={() => { if (!pinned) setAt(null); }}
        onClick={(e) => {
          if (state.status === 'found') { setAt(null); onOpen(state.card); return; }
          const r = e.currentTarget.getBoundingClientRect();
          place(r.left, r.bottom + WIDTH * 0.7);
          setPinned(true);
          // A tap shows the box and looks up once; after a miss, only "Try again" asks again (review PR56, 17).
          if (state.status === 'idle') onLook();
        }}
        className="inline text-left underline decoration-dotted decoration-[var(--muted)] underline-offset-[3px] hover:text-[var(--accent)]">
        {name}
      </button>
      {at && createPortal(
        <span className={`fixed z-[80] block drop-shadow-[0_12px_30px_rgba(0,0,0,0.6)] ${state.status === 'missing' ? '' : 'pointer-events-none'}`} style={{ left: at.x, top: at.y, width: WIDTH }} data-lookup-preview={state.status}>
          {src ? <CardPicture src={src} name={name} retry={false} />
            : state.status === 'missing' ? (
              <span className="flex aspect-[488/680] w-full flex-col items-center justify-center gap-2 rounded-[4.75%_/_3.5%] border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                <span className="text-sm font-semibold">{name}</span>
                <span className="text-xs text-[var(--muted)]">Couldn’t find this card.</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); onLook(true); }} className="rounded-full border border-[var(--border)] px-3 py-0.5 text-xs hover:bg-[var(--surface-hover)]" data-lookup-retry>Try again</button>
              </span>
            ) : (
              <span className="flex aspect-[488/680] w-full flex-col items-center justify-center gap-2 rounded-[4.75%_/_3.5%] border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
                <span className="text-sm font-semibold">{name}</span>
                <span className="h-1 w-16 overflow-hidden rounded-full bg-[var(--border)]"><span className="id-grad block h-full w-1/3 animate-[slide_1.6s_ease-in-out_infinite] rounded-full motion-reduce:animate-none" /></span>
              </span>
            )}
        </span>,
        document.body,
      )}
    </>
  );
}
