'use client';

/**
 * A small ⓘ that explains the thing next to it: why a rule exists, where a
 * default comes from, what the AI is sent. It opens on hover or focus, and
 * on a tap for touch screens; Escape or a tap elsewhere closes it. The text
 * is drawn on the page itself, fixed by the button, so a container that
 * clips its children cannot cut it off.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** What the tip says; a few short lines at most. */
  children: React.ReactNode;
  /** What the ⓘ is about, for screen readers: "Why this rule". */
  label?: string;
  className?: string;
}

export default function Tip({ children, label = 'More about this', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  const place = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(320, window.innerWidth - 24);
    const x = Math.max(12, Math.min(window.innerWidth - width - 12, r.left + r.width / 2 - width / 2));
    const above = r.bottom + 180 > window.innerHeight && r.top > 200;
    setAt({ x, y: above ? r.top - 8 : r.bottom + 8, above });
  };
  const show = () => { place(); setOpen(true); };

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!button.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const move = () => setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', move, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', move, true); };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (open) setOpen(false); else show(); }}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border)] align-middle text-[10px] font-semibold leading-none text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--foreground)] ${className}`}
      >
        i
      </button>
      {open && at && createPortal(
        <div
          id={id}
          role="tooltip"
          style={{ left: at.x, top: at.y, width: Math.min(320, window.innerWidth - 24), transform: at.above ? 'translateY(-100%)' : undefined }}
          className="pointer-events-none fixed z-[90] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-[var(--foreground)] shadow-xl"
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
