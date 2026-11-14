'use client';

/**
 * A card's name you can look at: hovering shows the card's picture beside
 * the pointer, as on the Cards tab (focusing it with the keyboard shows it
 * beside the name), and a click (a tap on a phone) opens the card the way
 * clicking it in the card view does. A name that isn't in the deck stays
 * plain text.
 */

import CardPicture from './CardPicture';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { imageOf, type ScryfallCard } from '@/lib/scryfall';

const WIDTH = 220;

export default function CardName({ name, card, onOpen, className = '' }: { name: string; card?: ScryfallCard; onOpen?: (card: ScryfallCard) => void; className?: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const src = card ? imageOf(card, 'normal') : null;
  if (!card) return <span className={className}>{name}</span>;
  const place = (e: React.MouseEvent) => {
    const h = WIDTH * 1.4;
    const x = e.clientX + 24 + WIDTH > window.innerWidth ? e.clientX - WIDTH - 24 : e.clientX + 24;
    setAt({ x, y: Math.min(window.innerHeight - h - 10, Math.max(10, e.clientY - h / 2)) });
  };
  return (
    <>
      <button type="button" data-card-name={name} onClick={() => { setAt(null); onOpen?.(card); }}
        onMouseEnter={(e) => { if (src) place(e); }} onMouseMove={(e) => { if (at) place(e); }} onMouseLeave={() => setAt(null)}
        // Focus shows it too, beside the name, so the keyboard reads the card as the pointer does.
        onFocus={(e) => { if (!src || !e.currentTarget.matches(':focus-visible')) return; const r = e.currentTarget.getBoundingClientRect(); place({ clientX: r.right, clientY: r.top + r.height / 2 } as React.MouseEvent); }}
        onBlur={() => setAt(null)}
        className={`inline text-left underline decoration-dotted decoration-[var(--muted)] underline-offset-[3px] hover:text-[var(--accent)] ${className}`}>
        {name}
      </button>
      {at && src && createPortal(
        <span className="pointer-events-none fixed z-[80] block drop-shadow-[0_12px_30px_rgba(0,0,0,0.6)]" style={{ left: at.x, top: at.y, width: WIDTH }} data-card-preview>
          <CardPicture src={src} name={name} retry={false} />
        </span>,
        document.body,
      )}
    </>
  );
}

/** Names in a line, each one a CardName, joined by `sep`. */
export function CardNames({ names, cardOf, onOpen, sep = ', ' }: { names: string[]; cardOf: (name: string) => ScryfallCard | undefined; onOpen?: (card: ScryfallCard) => void; sep?: string }) {
  return <>{names.map((n, i) => <span key={`${n}-${i}`}>{i > 0 && sep}<CardName name={n} card={cardOf(n)} onOpen={onOpen} /></span>)}</>;
}
