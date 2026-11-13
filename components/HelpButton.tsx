'use client';

/**
 * "?" in the header: a few lines on the page you are on, and a guided tour
 * of it, run on the sample profile so every step shows something real.
 */

import { reached } from '@/lib/reach';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { guideFor } from '@/lib/tour-guides';
import { endTour, startTour, useTour } from '@/lib/tour-state';

const BASE = process.env.NEXT_PUBLIC_MTG_BASE_PATH ?? '';

export default function HelpButton() {
  const path = usePathname();
  const tour = useTour();
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const guide = guideFor(path);

  useEffect(() => {
    if (!at) return;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !popup.current?.contains(t)) setAt(null);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [at]);

  const toggle = () => {
    if (at) { setAt(null); return; }
    const r = button.current!.getBoundingClientRect();
    setAt({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };

  const start = async () => {
    if (!guide) return;
    setBusy(true);
    setError(null);
    try {
      const res = await reached(`${BASE}/api/tour`, { method: 'POST' });
      const body = await res.json() as { deckId?: string; error?: string };
      if (!res.ok || !body.deckId) throw new Error(body.error ?? 'Could not start the tour');
      const first = guide.steps[0]?.path?.(body.deckId) ?? path;
      startTour(guide.id, body.deckId, `${window.location.pathname}${window.location.search}`, `${BASE}${first}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the tour');
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={button}
        onClick={toggle}
        aria-label="Help for this page"
        aria-haspopup="dialog"
        aria-expanded={!!at}
        className="grid h-8 w-8 place-items-center rounded-full border border-[var(--border)] text-sm font-semibold text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
      >
        ?
      </button>
      {at && createPortal(
        <div
          ref={popup}
          role="dialog"
          aria-label="Help"
          style={{ position: 'fixed', top: at.top, right: at.right }}
          className="z-[80] w-[22rem] max-w-[calc(100vw-1rem)] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Help · {guide?.title ?? 'This page'}</p>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {(guide?.help ?? ['Pick a page from the top bar; each one has its own help and tour.']).map((line) => (
              <li key={line} className="flex gap-2"><span aria-hidden className="text-[var(--accent)]">•</span><span>{line}</span></li>
            ))}
          </ul>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {tour ? (
              <button onClick={endTour} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]">End the tour</button>
            ) : guide && guide.steps.length > 0 && (
              <button onClick={start} disabled={busy} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-60">
                {busy ? 'Getting the sample ready…' : 'Start guided tour'}
              </button>
            )}
            {!tour && guide && guide.steps.length > 0 && <span className="text-xs text-[var(--muted)]">Uses sample data; yours is untouched</span>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
