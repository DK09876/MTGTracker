'use client';

/**
 * The history beside Search and Rules: "New", then Saved (kept until deleted)
 * and Recent (the newest, by day). A column on wide screens that stays put
 * while a search or conversation is open; on a phone, a "History" button
 * that opens it as a sheet from the bottom.
 *
 * Opening an entry costs no model request: a search replays its stored plan
 * on Scryfall, a conversation shows its stored answers.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { steady } from '@/lib/steady-tap';

export interface HistoryEntry {
  id: string;
  title: string;
  /** One quiet line under the title: "3 steps · Kratos", "2 questions · No: ...". */
  meta?: string;
  /** When it was last used, ISO. */
  at: string;
  saved: boolean;
}

export interface HistoryActions {
  onOpen: (entry: HistoryEntry) => void;
  onSave: (entry: HistoryEntry) => void;
  onUnsave: (entry: HistoryEntry) => void;
  /** Saved entries only. */
  onRename: (entry: HistoryEntry, name: string) => void;
  onDelete: (entry: HistoryEntry) => void;
}

const dayOf = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return 'Earlier';
};

export default function HistoryPanel({ label, newLabel, onNew, entries, active, ...actions }: {
  /** "Search history", "Rules conversations". */
  label: string;
  newLabel: string;
  onNew: () => void;
  entries: HistoryEntry[];
  /** The entry on screen, if any. */
  active: string | null;
} & HistoryActions) {
  const [sheet, setSheet] = useState(false);
  const saved = entries.filter((e) => e.saved);

  useEffect(() => {
    if (!sheet) return;
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(false); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [sheet]);

  const close = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => { setSheet(false); fn(...a); };
  const list = (inSheet: boolean) => (
    <List
      entries={entries}
      active={active}
      newLabel={newLabel}
      onNew={inSheet ? close(onNew) : onNew}
      {...actions}
      onOpen={inSheet ? close(actions.onOpen) : actions.onOpen}
    />
  );

  return (
    <>
      <aside
        aria-label={label}
        className="hidden lg:sticky lg:top-[calc(env(safe-area-inset-top)+5rem)] lg:block lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1"
      >
        {list(false)}
      </aside>

      <button
        onClick={() => setSheet(true)}
        className="mb-3 flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface)] lg:hidden"
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" /></svg>
        History
        {saved.length > 0 && <span className="text-[var(--muted)]">· {saved.length} saved</span>}
      </button>

      {sheet && (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label={label}>
          <button aria-label="Close history" onClick={() => setSheet(false)} className="absolute inset-0 bg-black/60" />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-[var(--border)] bg-[var(--surface)] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
            <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--border)]" />
            <div className="overflow-y-auto">{list(true)}</div>
          </div>
        </div>
      )}
    </>
  );
}

function List({ entries, active, newLabel, onNew, ...actions }: {
  entries: HistoryEntry[]; active: string | null; newLabel: string; onNew: () => void;
} & HistoryActions) {
  const saved = entries.filter((e) => e.saved);
  const recent = entries.filter((e) => !e.saved);
  const days = [...new Set(recent.map((e) => dayOf(e.at)))];
  return (
    <div className="flex flex-col gap-4">
      <button
        {...steady(onNew)}
        className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--surface-hover)]"
      >
        <span aria-hidden>＋</span> {newLabel}
      </button>

      <section aria-label="Saved">
        <h3 className="mb-1 flex items-baseline justify-between px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          <span><span aria-hidden className="text-[var(--accent)]">★</span> Saved</span>
          <span className="font-normal normal-case tracking-normal">kept until you delete</span>
        </h3>
        {saved.length === 0 && <p className="px-2 text-xs text-[var(--muted)]">Nothing saved yet. Use ⋯ › Save on one below.</p>}
        {saved.map((e) => <Row key={e.id} entry={e} on={e.id === active} {...actions} />)}
      </section>

      {recent.length > 0 && (
        <section aria-label="Recent">
          <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">Recent</h3>
          {days.map((day) => (
            <div key={day}>
              <p className="mx-2 mb-0.5 mt-2 text-[11px] text-[var(--muted)]">{day}</p>
              {recent.filter((e) => dayOf(e.at) === day).map((e) => <Row key={e.id} entry={e} on={e.id === active} {...actions} />)}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Row({ entry, on, onOpen, onSave, onUnsave, onRename, onDelete }: { entry: HistoryEntry; on: boolean } & HistoryActions) {
  // Where the menu opens, in the window: drawn over the page so the panel's
  // own scrolling cannot clip it, and upwards when there is no room below.
  const [menu, setMenu] = useState<{ right: number; top?: number; bottom?: number } | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);

  const toggle = () => {
    setSure(false);
    if (menu) { setMenu(null); return; }
    const r = trigger.current!.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    setMenu(window.innerHeight - r.bottom < 150 ? { right, bottom: window.innerHeight - r.top + 4 } : { right, top: r.bottom + 4 });
  };

  useEffect(() => {
    if (!menu) return;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popup.current?.contains(t) && !trigger.current?.contains(t)) { setMenu(null); setSure(false); }
    };
    const away = () => { setMenu(null); setSure(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') away(); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    // It is placed once; a scroll or resize closes it rather than leave it adrift.
    window.addEventListener('resize', away);
    document.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', away);
      document.removeEventListener('scroll', away, true);
    };
  }, [menu]);

  if (naming !== null) {
    return (
      <form
        className="flex gap-1 px-1 py-1"
        onSubmit={(e) => { e.preventDefault(); if (naming.trim()) onRename(entry, naming.trim()); setNaming(null); }}
      >
        <input
          value={naming}
          onChange={(e) => setNaming(e.target.value)}
          autoFocus
          maxLength={120}
          aria-label="Name"
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-base outline-none focus:border-[var(--accent)] sm:text-sm"
        />
        <button className="rounded-md bg-[var(--accent)] px-2 text-xs font-medium text-[#221c08]">Save</button>
        <button type="button" onClick={() => setNaming(null)} className="px-1 text-xs text-[var(--muted)]">Cancel</button>
      </form>
    );
  }

  const item = 'block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]';
  return (
    <div className={`relative rounded-lg ${on ? 'bg-[var(--surface-hover)] shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-[var(--surface)]'}`}>
      <button {...steady(() => onOpen(entry))} aria-current={on ? 'true' : undefined} className="flex w-full min-w-0 flex-col py-1.5 pl-2 pr-9 text-left">
        <span className="truncate text-sm">
          {entry.saved && <span aria-hidden className="mr-1 text-[var(--accent)]">★</span>}{entry.title}
        </span>
        {entry.meta && <span className="truncate text-[11px] text-[var(--muted)]">{entry.meta}</span>}
      </button>
      <button
        ref={trigger}
        onClick={toggle}
        aria-label={`More for “${entry.title}”`}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
      >
        ⋯
      </button>
      {menu && createPortal(
        <div
          ref={popup}
          role="menu"
          style={{ position: 'fixed', right: menu.right, top: menu.top, bottom: menu.bottom }}
          className="z-[80] min-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
        >
          {entry.saved ? (
            <>
              <button role="menuitem" className={item} onClick={() => { setMenu(null); setNaming(entry.title); }}>Rename</button>
              <button role="menuitem" className={item} onClick={() => { setMenu(null); onUnsave(entry); }}>☆ Unsave</button>
            </>
          ) : (
            <button role="menuitem" className={item} onClick={() => { setMenu(null); onSave(entry); }}>★ Save</button>
          )}
          <button
            role="menuitem"
            className={`${item} text-red-400`}
            onClick={() => { if (!sure) { setSure(true); return; } setMenu(null); onDelete(entry); }}
          >
            {sure ? 'Delete - sure?' : 'Delete'}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
