'use client';

/**
 * "⋯": the actions a screen needs now and then, behind one button, so the one
 * it needs most can stand alone. A destructive item asks once more in place
 * ("Delete deck… - sure?") rather than in a browser dialog.
 *
 * The menu is drawn on the page itself, fixed under the button: inside the
 * deck's header, which crops what sticks out, it opened hidden.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MoreItem {
  label: string;
  onClick: () => void | Promise<void>;
  danger?: boolean;
  /** Ask before doing it: shown in place of the label until tapped again. */
  confirm?: string;
}

export default function MoreMenu({ items, label = 'More actions' }: { items: MoreItem[]; label?: string }) {
  // Where the menu sits on screen, from the button; null while closed.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const open = at !== null;
  const [asking, setAsking] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const close = () => { setAt(null); setAsking(null); };

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !popup.current?.contains(t)) close();
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // Fixed to the screen, so it closes rather than float away when the page moves.
    const moved = () => close();
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', moved);
    };
  }, [open]);

  const toggle = () => {
    if (open) { close(); return; }
    const r = box.current!.getBoundingClientRect();
    setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setAsking(null);
  };

  const pick = async (item: MoreItem, i: number) => {
    if (item.confirm && asking !== i) { setAsking(i); return; }
    close();
    await item.onClick();
  };

  return (
    <div className="relative" ref={box}>
      <button
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-full min-h-9 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-lg leading-none hover:bg-[var(--surface-hover)]"
      >
        ⋯
      </button>
      {at && createPortal(
        <div
          ref={popup}
          role="menu"
          style={{ position: 'fixed', top: at.top, right: at.right }}
          className="z-[80] min-w-[13rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => pick(item, i)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)] ${item.danger ? 'text-red-400' : ''} ${i > 0 && item.danger ? 'mt-1 border-t border-[var(--border)] pt-2' : ''}`}
            >
              {asking === i ? item.confirm : item.label}
              {asking === i && <span className="mt-0.5 block text-xs text-[var(--muted)]">Tap again to confirm</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
