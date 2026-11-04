'use client';

/**
 * "⋯": the actions a screen needs now and then, behind one button, so the one
 * it needs most can stand alone. A destructive item asks once more in place
 * ("Delete deck… - sure?") rather than in a browser dialog.
 *
 * The menu is drawn on the page itself, fixed under the button: inside the
 * deck's header, which crops what sticks out, it opened hidden.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MoreItem {
  label: string;
  /** Not needed for an item that only opens a submenu. */
  onClick?: () => void | Promise<void>;
  /** A list behind this item ("Move to folder ▸"), opened on hover or tap and scrolled when long. */
  submenu?: MoreItem[];
  danger?: boolean;
  /** Ask before doing it: shown in place of the label until tapped again. */
  confirm?: string;
}

export default function MoreMenu({ items, label = 'More actions' }: { items: MoreItem[]; label?: string }) {
  // Where the menu sits on screen, from the button; null while closed.
  // `above` is the button's top: where the menu ends when it opens upwards.
  const [at, setAt] = useState<{ top: number; right: number; above: number } | null>(null);
  const open = at !== null;
  const [asking, setAsking] = useState<number | null>(null);
  // An open submenu: beside the menu where it fits, otherwise in its place (phones).
  const [sub, setSub] = useState<{ index: number; top: number; left?: number; right?: number } | null>(null);
  const [subFilter, setSubFilter] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const close = () => { setAt(null); setAsking(null); setSub(null); setSubFilter(''); };

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
    setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right), above: r.top - 4 });
    setAsking(null);
  };

  // Too little room below (the phone's tab bar counts): open upwards instead, measured before it paints.
  useLayoutEffect(() => {
    if (!at || !popup.current) return;
    const floor = window.innerHeight - (document.querySelector('[data-bottom-nav]')?.getBoundingClientRect().height ?? 0) - 8;
    const h = popup.current.getBoundingClientRect().height;
    if (at.top + h > floor && at.above - h >= 8) popup.current.style.top = `${at.above - h}px`;
    else popup.current.style.top = `${Math.max(8, Math.min(at.top, floor - h))}px`;
  });
  const SUB_WIDTH = 224;
  const openSub = (i: number, el: HTMLElement) => {
    if (sub?.index === i) return;
    const r = el.getBoundingClientRect();
    const menu = popup.current!.getBoundingClientRect();
    setSubFilter('');
    // Kept on screen: the list is at most ~300px tall (a find box and 16rem of rows).
    const top = Math.max(8, Math.min(r.top - 5, window.innerHeight - 308));
    if (menu.right + SUB_WIDTH + 4 <= window.innerWidth) setSub({ index: i, top, left: menu.right + 4 });
    else if (menu.left - SUB_WIDTH - 4 >= 0) setSub({ index: i, top, right: window.innerWidth - menu.left + 4 });
    else setSub({ index: i, top: -1 });
  };
  const pick = async (item: MoreItem, i: number, el?: HTMLElement) => {
    if (item.submenu) { if (el) openSub(i, el); return; }
    if (item.confirm && asking !== i) { setAsking(i); return; }
    close();
    await item.onClick?.();
  };
  const row = (item: MoreItem, i: number, inSub = false) => (
    <button
      key={item.label}
      role="menuitem"
      aria-haspopup={item.submenu ? 'menu' : undefined}
      aria-expanded={item.submenu ? sub?.index === i : undefined}
      onClick={(e) => (inSub ? (close(), void item.onClick?.()) : pick(item, i, e.currentTarget))}
      // Hovering another item closes an open submenu; hovering this one opens its own.
      onMouseEnter={inSub ? undefined : (e) => { if (item.submenu) openSub(i, e.currentTarget); else if (sub && sub.top !== -1) setSub(null); }}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)] ${sub?.index === i && !inSub ? 'bg-[var(--surface-hover)]' : ''} ${item.danger ? 'text-red-400' : ''} ${i > 0 && item.danger && !inSub ? 'mt-1 border-t border-[var(--border)] pt-2' : ''}`}
    >
      <span className="min-w-0 truncate">
        {asking === i && !inSub ? item.confirm : item.label}
        {asking === i && !inSub && <span className="mt-0.5 block text-xs text-[var(--muted)]">Tap again to confirm</span>}
      </span>
      {item.submenu && <span aria-hidden className="text-[var(--muted)]">›</span>}
    </button>
  );
  const subItems = sub ? (items[sub.index].submenu ?? []).filter((x) => x.label.toLowerCase().includes(subFilter.trim().toLowerCase())) : [];
  const subList = sub && (
    <>
      {(items[sub.index].submenu?.length ?? 0) > 8 && (
        <input
          // Focused only with a mouse: on a phone it would throw up the keyboard.
          autoFocus={typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches}
          value={subFilter}
          onChange={(e) => setSubFilter(e.target.value)}
          placeholder="Find…"
          aria-label="Find"
          className="mb-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
      )}
      <div className="max-h-64 overflow-y-auto">
        {subItems.map((x, j) => row(x, j, true))}
        {!subItems.length && <p className="px-3 py-2 text-sm text-[var(--muted)]">Nothing matches.</p>}
      </div>
    </>
  );

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
          {sub?.top === -1 ? (
            // No room beside the menu: the list takes its place, with a way back.
            <div className="w-[min(15rem,calc(100vw-1rem))]">
              <button onClick={() => setSub(null)} className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm text-[var(--muted)] hover:bg-[var(--surface-hover)]">
                ‹ {items[sub.index].label}
              </button>
              {subList}
            </div>
          ) : items.map((item, i) => row(item, i))}
          {sub && sub.top !== -1 && (
            <div
              role="menu"
              aria-label={items[sub.index].label}
              style={{ position: 'fixed', top: sub.top, left: sub.left, right: sub.right, width: SUB_WIDTH }}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
            >
              {subList}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
