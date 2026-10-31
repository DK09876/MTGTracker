'use client';

/**
 * "⋯": the actions a screen needs now and then, behind one button, so the one
 * it needs most can stand alone. A destructive item asks once more in place
 * ("Delete deck… - sure?") rather than in a browser dialog.
 */

import { useEffect, useRef, useState } from 'react';

export interface MoreItem {
  label: string;
  onClick: () => void | Promise<void>;
  danger?: boolean;
  /** Ask before doing it: shown in place of the label until tapped again. */
  confirm?: string;
}

export default function MoreMenu({ items, label = 'More actions' }: { items: MoreItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setAsking(null); } };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setAsking(null); } };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const pick = async (item: MoreItem, i: number) => {
    if (item.confirm && asking !== i) { setAsking(i); return; }
    setOpen(false);
    setAsking(null);
    await item.onClick();
  };

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => { setOpen((o) => !o); setAsking(null); }}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-full min-h-9 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-lg leading-none hover:bg-[var(--surface-hover)]"
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 min-w-[13rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl">
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
        </div>
      )}
    </div>
  );
}
