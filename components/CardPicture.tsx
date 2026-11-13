'use client';

/**
 * A card's picture in a box that keeps the card's shape before, during and
 * after loading (handoff 9, D 12): while the picture comes from the card-image
 * site, the box shows the card's name and a quiet loading mark; if it fails,
 * it says so with a retry. Nothing moves when the picture arrives.
 */

import Image from 'next/image';
import { useState } from 'react';

export default function CardPicture({ src, name, className = '', retry = true }: { src: string; name: string; className?: string; /** No retry button where the picture can't be clicked (the hover card). */ retry?: boolean }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [tries, setTries] = useState(0);
  const url = tries ? `${src}${src.includes('?') ? '&' : '?'}retry=${tries}` : src;
  return (
    <span className={`relative block aspect-[488/680] w-full overflow-hidden rounded-[4.75%_/_3.5%] bg-[var(--surface)] ${className}`} data-card-picture={state}>
      {state !== 'ok' && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 border border-[var(--border)] p-3 text-center rounded-[inherit]">
          <span className="text-sm font-semibold">{name}</span>
          {state === 'loading'
            ? <span className="h-1 w-16 overflow-hidden rounded-full bg-[var(--border)]"><span className="id-grad block h-full w-1/3 animate-[slide_1.6s_ease-in-out_infinite] rounded-full motion-reduce:animate-none" /></span>
            : <span className="flex flex-col items-center gap-1.5 text-xs text-[var(--muted)]">The picture didn’t load.
              {retry && <button type="button" onClick={() => { setState('loading'); setTries((t) => t + 1); }} className="pointer-events-auto rounded-full border border-[var(--border)] px-3 py-0.5 text-[var(--foreground)] hover:bg-[var(--surface-hover)]">Try again</button>}</span>}
        </span>
      )}
      <Image key={url} src={url} alt={name} width={488} height={680} unoptimized onLoad={() => setState('ok')} onError={() => setState('failed')}
        className={`relative h-full w-full object-cover transition-opacity duration-200 ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`} />
    </span>
  );
}
