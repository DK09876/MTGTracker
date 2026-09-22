'use client';

import { useEffect, useRef } from 'react';

import CardDetail from './CardDetail';
import type { ScryfallCard } from '@/lib/scryfall';

export default function CardModal({
  card,
  onClose,
  actions,
}: {
  card: ScryfallCard | null;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  // Held in a ref so the effect does not depend on a prop that callers
  // recreate on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [card]);

  if (!card) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative flex min-h-full items-start justify-center p-4 sm:items-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={card.name}
          className="relative w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl"
        >
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 rounded-lg px-2 py-1 text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          >
            ✕
          </button>
          <CardDetail card={card} />
          {actions && <div className="mt-5 border-t border-[var(--border)] pt-4">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
