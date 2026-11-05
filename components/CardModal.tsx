'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

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

  // Through a portal: inside the page, an ancestor's stacking context let
  // sticky bars draw over the backdrop.
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative flex min-h-full items-start justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:items-center">
        <div
          data-tour="card-modal"
          role="dialog"
          aria-modal="true"
          aria-label={card.name}
          className="relative w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl"
        >
          {/* ✕ floats at the top right while a tall card scrolls (phones), taking no room from the card. */}
          <div className="sticky top-0 z-10 -mr-3 -mt-3 flex h-0 justify-end">
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface)]/85 text-[var(--muted)] backdrop-blur hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
            >
              ✕
            </button>
          </div>
          <CardDetail card={card} />
          {actions && <div className="mt-5 border-t border-[var(--border)] pt-4">{actions}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
