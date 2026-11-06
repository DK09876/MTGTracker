'use client';

/**
 * ⌘K (Ctrl-K): jump anywhere by typing. Your decks and lists by name or
 * commander, the app's pages, a few actions - and whatever you typed, as a
 * card search or a rules question. Arrow keys and Enter, or the mouse.
 *
 * Opened from the keyboard or the header's button; a card search started
 * here runs on the Search page (?q=), a rules question is put in the Rules
 * box but not sent - it costs, so that stays a press of Send.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import * as api from '@/lib/api';
import type { List } from '@/lib/db';
import { IdentitySymbols } from './ManaCost';

/** Search here, on the Search page itself: run this text (CustomEvent<string>). */
export const PALETTE_SEARCH = 'mtg:palette-search';
/** Open the palette from a button. */
export const PALETTE_OPEN = 'mtg:palette-open';

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  /** Under the label, smaller: a deck's commander. */
  sub?: string;
  icon?: React.ReactNode;
  /** After the hint, at the row's end: a deck's colours. */
  trail?: React.ReactNode;
  run: () => void;
  /** Words it is found by, beyond its label. */
  words?: string;
}

const PAGES: Array<[string, string, string]> = [
  ['/', 'Search', 'cards find'],
  ['/rules', 'Rules', 'ask question judge'],
  ['/decks', 'Decks', 'commander'],
  ['/lists', 'Lists', 'wishlist'],
  ['/collection', 'Collection', 'owned boxes binders'],
  ['/collection/scan', 'Scan cards', 'camera collection'],
  ['/settings', 'Settings', 'ai model budget profile password'],
];

const art = (l: List) => l.commander?.image_uris?.art_crop ?? l.commander?.card_faces?.[0]?.image_uris?.art_crop ?? null;

// Ranked: the label starting with it, then a word in it starting with it, then anywhere.
function score(item: Item, q: string): number {
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 3;
  const words = `${label} ${item.words ?? ''}`.toLowerCase();
  if (words.split(/[\s,–-]+/).some((w) => w.startsWith(q))) return 2;
  return words.includes(q) ? 1 : 0;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [lists, setLists] = useState<List[] | null>(null);
  const router = useRouter();
  const path = usePathname();
  const input = useRef<HTMLInputElement>(null);
  const listBox = useRef<HTMLDivElement>(null);

  // Opened fresh each time: nothing typed, the first row picked.
  const show = (next: boolean) => {
    if (next) { setText(''); setActive(0); }
    setOpen(next);
  };
  const showRef = useRef(show);
  useEffect(() => { showRef.current = show; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => { if (!o) { setText(''); setActive(0); } return !o; });
      }
    };
    const onOpen = () => showRef.current(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_OPEN, onOpen);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener(PALETTE_OPEN, onOpen); };
  }, []);

  useEffect(() => {
    if (!open) return;
    // Read fresh each time it opens: a deck made a minute ago is in it.
    api.fetchLists().then(setLists).catch(() => setLists([]));
    const t = setTimeout(() => input.current?.focus(), 10);
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(t); document.body.style.overflow = ''; };
  }, [open]);

  const go = (href: string) => { setOpen(false); router.push(href); };

  const items = useMemo<Item[]>(() => {
    const q = text.trim().toLowerCase();
    const decks = (lists ?? []).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((l): Item => ({
      id: `l:${l.id}`,
      group: l.kind === 'deck' ? 'Decks' : 'Lists',
      label: l.name,
      // The commander under the name, not beside it: on a phone the two fought for one line and the name lost.
      sub: l.kind === 'deck' ? (l.commander ? (l.commander.name !== l.name ? l.commander.name : undefined) : 'No commander yet') : undefined,
      hint: l.kind === 'deck' ? `${l.totalCards}/100` : `${l.totalCards} card${l.totalCards === 1 ? '' : 's'}`,
      // A fixed-size picture leads every row, so names line up whatever the colours: five pips in that
      // slot pushed the name under them.
      icon: l.kind === 'deck'
        ? (art(l)
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={art(l)!} alt="" aria-hidden className="h-5 w-7 rounded-[4px] object-cover object-[50%_30%] ring-1 ring-white/10" />
          : <span aria-hidden className="h-5 w-7 rounded-[4px] bg-[linear-gradient(135deg,var(--surface-hover),var(--border))] ring-1 ring-white/10" />)
        : <span aria-hidden className="text-[var(--muted)]">≡</span>,
      trail: l.kind === 'deck' && l.commander ? <IdentitySymbols identity={(l.commander.color_identity ?? []).join('') || 'C'} size={12} /> : undefined,
      words: l.commander?.name,
      run: () => go(`/${l.kind === 'deck' ? 'decks' : 'lists'}/${l.id}`),
    }));
    const pages = PAGES.map(([href, label, words]): Item => ({ id: `p:${href}`, group: 'Go to', label, words, run: () => go(href) }));
    const actions: Item[] = [
      { id: 'a:new-deck', group: 'Actions', label: 'New deck', words: 'create build import', run: () => go('/decks?new') },
    ];
    if (!q) return [...decks.filter((d) => d.group === 'Decks').slice(0, 5), ...actions, ...pages];
    const found = [...decks, ...actions, ...pages]
      .map((item) => ({ item, s: score(item, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.item)
      .slice(0, 8);
    const raw = text.trim();
    return [
      ...found,
      {
        id: 'x:search', group: 'Ask', label: `Search cards for “${raw}”`, hint: 'Search',
        run: () => {
          setOpen(false);
          if (path === '/') window.dispatchEvent(new CustomEvent(PALETTE_SEARCH, { detail: raw }));
          else router.push(`/?q=${encodeURIComponent(raw)}`);
        },
      },
      { id: 'x:rules', group: 'Ask', label: `Ask a rules question: “${raw}”`, hint: 'Rules', run: () => go(`/rules?q=${encodeURIComponent(raw)}`) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, lists, path]);

  useEffect(() => {
    listBox.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run(); }
  };

  let lastGroup = '';
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-3 pt-[max(4rem,12vh)]" onKeyDown={onKey}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Jump to" className="palette-in relative flex max-h-[min(32rem,70vh)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--surface)] shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden className="shrink-0 text-[var(--muted)]" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" strokeLinecap="round" /></svg>
          <input
            ref={input}
            value={text}
            onChange={(e) => { setText(e.target.value); setActive(0); }}
            placeholder="Decks, pages, cards, rules questions…"
            aria-label="Jump to"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${active}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--faint)]"
          />
          <kbd className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] sm:block">esc</kbd>
        </div>
        <div ref={listBox} id="palette-list" role="listbox" className="overflow-y-auto overscroll-contain p-1.5">
          {lists === null && !text && <p className="px-3 py-2 text-sm text-[var(--muted)]">Loading your decks…</p>}
          {items.map((item, i) => {
            const head = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {head && <p className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--faint)]">{head}</p>}
                <button
                  id={`palette-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => { if (i !== active) setActive(i); }}
                  onClick={item.run}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === active ? 'bg-[var(--surface-hover)] text-[var(--foreground)]' : 'text-[var(--foreground)]/85'}`}
                >
                  <span className="flex w-7 shrink-0 items-center justify-center">{item.icon ?? <span aria-hidden className="text-[var(--muted)]">{item.group === 'Ask' ? '✦' : item.group === 'Actions' ? '＋' : '→'}</span>}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{item.label}</span>
                    {item.sub && <span className="truncate text-xs text-[var(--muted)]">{item.sub}</span>}
                  </span>
                  {item.hint && <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{item.hint}</span>}
                  {item.trail && <span className="shrink-0">{item.trail}</span>}
                  {i === active && <kbd aria-hidden className="hidden text-[11px] text-[var(--muted)] sm:block">↵</kbd>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="hidden items-center gap-4 border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--faint)] sm:flex">
          <span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span className="ml-auto"><kbd>⌘</kbd><kbd>K</kbd> anywhere</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The header's way in: "Jump to… ⌘K" on wide screens, a magnifier on phones. */
export function PaletteButton() {
  const [mac, setMac] = useState(true);
  useEffect(() => {
    const read = () => setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    read();
  }, []);
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(PALETTE_OPEN))}
      aria-label="Jump to (⌘K)"
      className="flex h-8 items-center gap-2 rounded-full border border-[var(--border)] px-2.5 text-xs text-[var(--muted)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--border))] hover:text-[var(--foreground)] xl:w-48 xl:px-3"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" strokeLinecap="round" /></svg>
      <span className="hidden flex-1 text-left xl:block">Jump to…</span>
      <kbd className="hidden rounded border border-[var(--border)] px-1 text-[10px] xl:block">{mac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}
