'use client';

/**
 * A button that opens a small panel of settings under it - "View ▾" on a
 * deck's cards. Drawn on the page itself through a portal, fixed under the
 * button and kept on screen (flipped above it when there is no room below),
 * so a card or header that crops its children can never hide it.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { bottomFloor } from '@/lib/bottom-floor';

export default function Popover({ label, children, className = '', panelClassName = 'w-72', align = 'left', ...rest }: {
  /** The button's face. */
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  panelClassName?: string;
  align?: 'left' | 'right';
  'aria-label'?: string;
  'data-tour'?: string;
}) {
  const [at, setAt] = useState<{ top: number; left: number; right: number; above: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !panel.current?.contains(t)) close();
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); button.current?.focus(); } };
    // Fixed to the screen: it closes rather than float away when the page scrolls.
    const scrolled = (e: Event) => { if (!panel.current?.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', close);
    };
  }, [at]);

  useLayoutEffect(() => {
    if (!at || !panel.current) return;
    const r = panel.current.getBoundingClientRect();
    const floor = bottomFloor(12);
    panel.current.style.top = `${at.top + r.height > floor && at.above - r.height >= 8 ? at.above - r.height : Math.max(8, Math.min(at.top, floor - r.height))}px`;
    const left = align === 'right' ? at.right - r.width : at.left;
    panel.current.style.left = `${Math.max(8, Math.min(left, window.innerWidth - r.width - 8))}px`;
  });

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => {
          if (at) { setAt(null); return; }
          const r = button.current!.getBoundingClientRect();
          setAt({ top: r.bottom + 6, left: r.left, right: r.right, above: r.top - 6 });
        }}
        aria-haspopup="dialog"
        aria-expanded={!!at}
        aria-label={rest['aria-label']}
        data-tour={rest['data-tour']}
        className={className}
      >
        {label}
      </button>
      {at && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label={rest['aria-label']}
          style={{ position: 'fixed', top: at.top, left: at.left }}
          className={`z-[80] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-2xl ${panelClassName}`}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
