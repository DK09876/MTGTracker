'use client';

/**
 * A deck's (or list's) cards: board tabs, and the cards three ways - a grid
 * of pictures, Archidekt-style stacks (each group a column of overlapping
 * cards, the last one whole), or a compact text list with a picture on
 * hover. One size slider (S, M, L to snap) sizes all of them; groups fold;
 * a card opens on a click, or - in Select mode - is picked, so several can
 * be moved, tagged or removed at once. Each card's ⋯ has the quick things.
 *
 * View choices are remembered in this browser, since they are how someone
 * likes to look at every deck, not a property of one deck; folded groups are
 * remembered per deck.
 */

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import ManaCost from './ManaCost';
import Tip from './Tip';
import type { Board } from '@/lib/decklist';
import * as api from '@/lib/api';
import { groupCards, primaryType, type Categories, type GroupBy, type Item, type SortBy } from '@/lib/deckview';
import { filterCards } from '@/lib/filter';
import type { ScryfallCard } from '@/lib/scryfall';
import { imageOf, manaCostOf, priceOf } from '@/lib/scryfall';
import type { RoleCount } from '@/lib/roles';
import { tagKey, tagsByCard, type DeckTags } from '@/lib/tags';
import { useNavBottom } from '@/lib/use-nav-bottom';

export type Entry = Item & { board: Board };

interface Props {
  listId: string;
  entries: Entry[];
  /** The deck's own tags, for grouping by them and tagging from a card's menu. */
  tags?: DeckTags | null;
  onTags?: (tags: DeckTags) => void;
  /** Changes when the deck does, so the role lookup is redone. */
  version?: string;
  /** A deck gets board tabs; a plain list shows everything together. */
  isDeck: boolean;
  onSelect: (card: ScryfallCard) => void;
  onQuantity: (cardId: string, quantity: number) => void;
  onMove: (cardId: string, board: Board) => void;
  /** Ask Chat something about a card ("find a replacement"). */
  onAsk?: (question: string) => void;
}

type View = 'grid' | 'stacks' | 'text';

const BOARDS: Array<[Board, string]> = [['main', 'Main'], ['maybe', 'Maybeboard'], ['side', 'Sideboard']];
const BOARD_NAME: Record<Board, string> = { main: 'the main deck', maybe: 'the maybeboard', side: 'the sideboard' };
const PREFS = 'mtg-deck-view';
// The size slider, in pixels of card width; S, M and L snap to these.
const SIZES = { S: 150, M: 210, L: 270 } as const;
const MIN_SIZE = 140;
const MAX_SIZE = 300;

interface Prefs { view: View; groupBy: GroupBy; sortBy: SortBy; size: number }
const DEFAULT_PREFS: Prefs = { view: 'grid', groupBy: 'type', sortBy: 'name', size: SIZES.M };

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs> & { view?: string };
    // 'visual' was the grid's old name.
    const view: View = saved.view === 'stacks' || saved.view === 'text' ? saved.view : 'grid';
    const size = typeof saved.size === 'number' && saved.size >= MIN_SIZE && saved.size <= MAX_SIZE ? saved.size : SIZES.M;
    return { ...DEFAULT_PREFS, ...saved, view, size };
  } catch {
    return DEFAULT_PREFS;
  }
}

const foldKey = (listId: string) => `mtg-folded:${listId}`;
function loadFolded(listId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(foldKey(listId)) ?? '[]') as string[]); } catch { return new Set(); }
}

const nearest = (size: number) => (size < 180 ? 'S' : size < 240 ? 'M' : 'L');
const money = (entry: Entry) => { const p = priceOf(entry.card, entry.finish); return p === null ? '—' : `$${p.toFixed(2)}`; };

const SHORTCUTS: Array<[string, string]> = [
  ['/', 'Filter the cards'], ['G · S · T', 'Grid, Stacks or Text'], ['[ · ]', 'Cards smaller or bigger'],
  ['X', 'Select cards (again to finish)'], ['A', 'While selecting: pick everything shown'],
  ['Esc', 'Close a menu · clear the selection · stop selecting'], ['N', 'Add cards'], ['1 – 8', 'Switch the deck\'s tabs'],
];

export default function DeckCards({ listId, entries, tags, onTags, version, isDeck, onSelect, onQuantity, onMove, onAsk }: Props) {
  const [board, setBoard] = useState<Board>('main');
  const navBottom = useNavBottom();
  const [filter, setFilter] = useState('');
  const [prefs, setPrefs] = useState<Prefs>(() => (typeof window === 'undefined' ? DEFAULT_PREFS : loadPrefs()));
  const [folded, setFolded] = useState<Set<string>>(() => (typeof window === 'undefined' ? new Set() : loadFolded(listId)));
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const lastPicked = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ entry: Entry; x: number; y: number; up: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const filterBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* not remembered, still works */ }
  }, [prefs]);
  const fold = (key: string) => setFolded((f) => {
    const next = new Set(f);
    if (next.has(key)) next.delete(key); else next.add(key);
    try { localStorage.setItem(foldKey(listId), JSON.stringify([...next])); } catch { /* fine */ }
    return next;
  });

  // A plain list has no tags or roles; it groups as it did before.
  // Roles and tags are one idea now: grouping by "role" is grouping by tags, built-in ones included.
  const asked: GroupBy = prefs.groupBy === 'role' ? 'tag' : prefs.groupBy;
  const groupBy: GroupBy = !isDeck && asked === 'tag' ? 'type' : asked;

  // The built-in tags (Scryfall's roles) are looked up only when someone groups by tags.
  const [roles, setRoles] = useState<RoleCount[] | null>(null);
  useEffect(() => {
    if (!isDeck || groupBy !== 'tag') return;
    let cancelled = false;
    api.deckRoles(listId).then((r) => { if (!cancelled) setRoles(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isDeck, groupBy, listId, version]);

  const onCard = useMemo(() => tagsByCard(tags ?? { brief: '', overview: '', tags: [], cardTags: [] }), [tags]);
  const categories = useMemo((): Categories | undefined => {
    if (groupBy === 'tag' && tags && roles) {
      // Your tags first, then the built-in ones from Scryfall, then lands.
      const byName = new Map<string, string[]>();
      for (const r of roles) for (const name of r.cards) byName.set(name, [...(byName.get(name) ?? []), `role:${r.id}`]);
      return {
        of: (card) => primaryType(card) === 'Lands' ? ['lands']
          : [...(onCard.get(tagKey(card)) ?? []).map(({ tag }) => tag.id), ...(byName.get(card.name) ?? [])],
        order: [
          ...tags.tags.filter((t) => t.status === 'accepted').map((t) => ({ key: t.id, label: t.name, color: t.color })),
          ...roles.filter((r) => r.count > 0).map((r) => ({ key: `role:${r.id}`, label: `${r.label} · auto` })),
          { key: 'lands', label: 'Lands' },
        ],
        none: 'Untagged',
      };
    }
    return undefined;
  }, [groupBy, tags, roles, onCard]);

  const onBoard = isDeck ? entries.filter((e) => e.board === board) : entries;
  const { results: shown, unsupported } = filterCards(onBoard, filter);
  const groups = groupCards(shown, groupBy, prefs.sortBy, categories);
  // In Stacks, the maybeboard sits beside the main deck as one more column.
  const maybe = isDeck && board === 'main' && prefs.view === 'stacks' ? filterCards(entries.filter((e) => e.board === 'maybe'), filter).results : [];
  const columns = maybe.length ? [...groups, { key: '__maybe', label: 'Maybeboard', count: maybe.reduce((n, e) => n + e.quantity, 0), items: maybe, color: undefined }] : groups;
  const order = columns.flatMap((g) => (folded.has(g.key) ? [] : g.items.map((e) => e.card.id)));
  const waiting = groupBy === 'tag' && (!tags || !roles);
  const noTags = groupBy === 'tag' && tags && !tags.tags.some((t) => t.status === 'accepted');
  const copies = (b: Board) => entries.filter((e) => e.board === b).reduce((n, e) => n + e.quantity, 0);
  const accepted = (tags?.tags ?? []).filter((t) => t.status === 'accepted');

  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); lastPicked.current = null; };
  // A click opens the card - or, while selecting, picks it (shift-click picks a range).
  const activate = (entry: Entry, shift: boolean) => {
    if (!selecting) { onSelect(entry.card); return; }
    const id = entry.card.id;
    // Read the last pick now: the update below runs later, after it has moved on.
    const from = lastPicked.current;
    setPicked((prev) => {
      const next = new Set(prev);
      if (shift && from) {
        const [a, b] = [order.indexOf(from), order.indexOf(id)].sort((x, y) => x - y);
        if (a >= 0) for (const x of order.slice(a, b + 1)) next.add(x);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastPicked.current = id;
  };
  const pickedEntries = entries.filter((e) => picked.has(e.card.id) && !e.commander);
  const bulk = async (work: (e: Entry) => Promise<void> | void) => {
    setBusy(true);
    try { for (const e of pickedEntries) await work(e); stopSelecting(); } finally { setBusy(false); }
  };
  const tagCards = async (tagId: string, list: Entry[]) => {
    let latest: DeckTags | null = null;
    for (const e of list) latest = await api.setCardTag(listId, tagKey(e.card), tagId, true);
    if (latest) onTags?.(latest);
  };

  // Shortcuts on this tab; the deck's tab keys (1-8, N) are the page's.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) {
        if (e.key === 'Escape' && t === filterBox.current) filterBox.current.blur();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (menu) setMenu(null);
        else if (picked.size) setPicked(new Set());
        else if (selecting) stopSelecting();
        return;
      }
      if (k === '/') { e.preventDefault(); filterBox.current?.focus(); }
      else if (k === 'g' || k === 's' || k === 't') setPrefs((p) => ({ ...p, view: k === 'g' ? 'grid' : k === 's' ? 'stacks' : 'text' }));
      else if (k === '[' || k === ']') setPrefs((p) => ({ ...p, size: Math.max(MIN_SIZE, Math.min(MAX_SIZE, p.size + (k === ']' ? 20 : -20))) }));
      else if (k === 'x') { if (selecting) stopSelecting(); else setSelecting(true); }
      else if (k === 'a' && selecting) setPicked(new Set(order));
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  const select = (className: string) =>
    `min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--c1)] sm:flex-none ${className}`;
  const size = prefs.size;
  const openMenu = (entry: Entry, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ entry, x: Math.max(8, Math.min(window.innerWidth - 240, r.right - 228)), y: r.bottom + 6, up: r.bottom + 330 > window.innerHeight });
  };

  return (
    <div className="mt-5" style={{ ['--card' as string]: `${size}px` }}>
      {isDeck && (
        <div data-tour="boards" role="tablist" className="flex gap-1 border-b border-[var(--border)]">
          {BOARDS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={board === id}
              onClick={() => { setBoard(id); setPicked(new Set()); }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${board === id
                ? 'border-[var(--c1)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'}`}
            >
              {label} <span className="ml-1 text-xs text-[var(--muted)]">{copies(id)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Sticks under the top bar as the cards scroll: one row to swipe on a phone, wrapped on wider screens. */}
      <div data-tour="card-tools" style={{ top: navBottom }}
        className="sticky z-20 -mx-4 mt-3 flex items-center gap-2 overflow-x-auto bg-[var(--background)]/92 px-4 py-2 backdrop-blur [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:rounded-b-2xl sm:px-0">
        <input
          ref={filterBox}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter (/) — t:creature, c:rg, cmc<=3"
          aria-label="Filter this list"
          className="min-w-[11rem] flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-sm outline-none focus:border-[var(--c1)]"
        />
        <div className="flex shrink-0 overflow-hidden rounded-full border border-[var(--border)] text-sm" role="group" aria-label="View">
          {(['grid', 'stacks', 'text'] as View[]).map((v) => (
            <button
              key={v}
              data-view={v}
              onClick={() => setPrefs((p) => ({ ...p, view: v }))}
              aria-pressed={prefs.view === v}
              className={`px-3 py-1.5 ${prefs.view === v ? 'bg-[var(--surface-hover)] text-[var(--foreground)]' : 'text-[var(--muted)]'}`}
            >
              {v === 'grid' ? 'Grid' : v === 'stacks' ? 'Stacks' : 'Text'}
            </button>
          ))}
        </div>
        <div data-tour="card-size" className="flex shrink-0 items-center gap-2 text-sm">
          <span className="text-[var(--muted)]">Size</span>
          <span className="flex w-36 flex-col">
            <input type="range" min={MIN_SIZE} max={MAX_SIZE} step={5} value={size} aria-label="Card size"
              onChange={(e) => setPrefs((p) => ({ ...p, size: Number(e.target.value) }))} className="w-full accent-[var(--accent)]" />
            <span className="flex justify-between px-0.5 text-[11px] leading-none">
              {(Object.keys(SIZES) as Array<keyof typeof SIZES>).map((k) => (
                <button key={k} type="button" onClick={() => setPrefs((p) => ({ ...p, size: SIZES[k] }))} aria-label={`Card size ${k}`}
                  className={`rounded px-1 ${nearest(size) === k ? 'font-bold text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}>{k}</button>
              ))}
            </span>
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          <select aria-label="Group by" value={groupBy} onChange={(e) => setPrefs((p) => ({ ...p, groupBy: e.target.value as GroupBy }))} className={select('')}>
            <option value="type">Group: type</option>
            <option value="mv">Group: mana value</option>
            {isDeck && <option value="tag">Group: tags</option>}
            <option value="none">No groups</option>
          </select>
          <select aria-label="Sort by" value={prefs.sortBy} onChange={(e) => setPrefs((p) => ({ ...p, sortBy: e.target.value as SortBy }))} className={select('')}>
            <option value="name">Sort: name</option>
            <option value="mv">Sort: mana value</option>
            <option value="price">Sort: price</option>
          </select>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button data-tour="select-cards" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting}
            className={`rounded-full border px-3.5 py-1.5 text-sm ${selecting ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}>
            {selecting ? `${picked.size} selected · Done` : 'Select'}
          </button>
          <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--muted)] max-sm:hidden">
            Shortcuts
            <Tip label="Keyboard shortcuts">
              <span className="font-semibold">Keyboard shortcuts</span>
              <span className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {SHORTCUTS.map(([k, v]) => <span key={k} className="contents"><span className="font-mono text-[11px] text-[var(--accent)]">{k}</span><span>{v}</span></span>)}
              </span>
            </Tip>
          </span>
        </div>
      </div>
      {unsupported.length > 0 && (
        <p className="mt-2 text-xs text-amber-400">
          Ignoring {unsupported.map((u) => `"${u}"`).join(', ')} — not supported here.
          Supported: name, t, o, c/id, cmc/mv, usd, pow, tou, r, set, a, kw, is, and - to exclude.
        </p>
      )}

      {!onBoard.length && (
        <p className="mt-10 text-center text-[var(--muted)]">
          {isDeck && board !== 'main'
            ? `Nothing on the ${board === 'maybe' ? 'maybeboard' : 'sideboard'} yet — move cards here from a card's ⋯, or use Maybe when adding.`
            : 'Nothing here yet — use Add cards.'}
        </p>
      )}
      {waiting && onBoard.length > 0 && <p className="mt-3 text-xs text-[var(--muted)]">Loading tags…</p>}
      {noTags && <p className="mt-3 text-xs text-[var(--muted)]">None of your own tags yet - the built-in ones are shown; make your own on the Tags tab, or open a card to tag it.</p>}
      {groupBy === 'tag' && categories && <p className="mt-3 text-xs text-[var(--muted)]">Your tags first, then the built-in ones from Scryfall (marked auto). A card with several tags is listed under each.</p>}
      {onBoard.length > 0 && !shown.length && <p className="mt-10 text-center text-[var(--muted)]">Nothing here matches that filter.</p>}

      {prefs.view === 'stacks' ? (
        <div data-tour="card-grid" className="mt-5 flex flex-wrap items-start gap-3.5">
          {columns.map((group) => {
            const isMaybe = group.key === '__maybe';
            const shut = folded.has(group.key);
            return (
              <section key={group.key} className={`flex flex-col ${isMaybe ? 'opacity-85' : ''}`} style={{ width: 'min(var(--card), calc(50% - 7px))' }}>
                <button onClick={() => fold(group.key)} aria-expanded={!shut} data-section={group.label} data-section-count={group.count}
                  className={`mb-2 flex items-baseline justify-between gap-2 rounded-xl border bg-[var(--surface)] px-2.5 py-1.5 text-left text-sm ${isMaybe ? 'border-dashed border-[var(--border)]' : 'border-[var(--border)]'}`}>
                  <span className="flex min-w-0 items-center gap-1.5 font-semibold">
                    <span aria-hidden className={`text-[var(--muted)] transition-transform ${shut ? '-rotate-90' : ''}`}>▾</span>
                    {group.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: group.color }} aria-hidden="true" />}
                    <span className="truncate">{group.label}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{group.count}</span>
                </button>
                {!shut && (
                  <div>
                    {group.items.map((entry, i) => (
                      <StackCard key={entry.card.id} entry={entry} first={i === 0} picked={picked.has(entry.card.id)} selecting={selecting}
                        onActivate={(shift) => activate(entry, shift)} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : columns.map((group) => {
        const shut = folded.has(group.key);
        const heading = groupBy !== 'none' || group.key === 'commander';
        return (
          <section key={group.key} className="mt-6">
            {heading && (
              <button onClick={() => fold(group.key)} aria-expanded={!shut} data-section={group.label} data-section-count={group.count}
                className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]">
                <span aria-hidden className={`inline-block transition-transform ${shut ? '-rotate-90' : ''}`}>▾</span>
                {group.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: group.color }} aria-hidden="true" />}
                <span style={group.color ? { color: group.color } : undefined}>{group.label}</span>
                <span className="tabular-nums">({group.count})</span>
              </button>
            )}
            {!shut && (prefs.view === 'grid' ? (
              <div data-tour="card-grid" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(var(--card), calc(50% - 6px)), 1fr))' }}>
                {group.items.map((entry) => (
                  <GridCard key={entry.card.id} entry={entry} isDeck={isDeck} picked={picked.has(entry.card.id)} selecting={selecting}
                    onActivate={(shift) => activate(entry, shift)} onQuantity={onQuantity} onMenu={(el) => openMenu(entry, el)} />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                {group.items.map((entry) => (
                  <TextRow key={entry.card.id} entry={entry} isDeck={isDeck} size={size} picked={picked.has(entry.card.id)} selecting={selecting}
                    tagDots={isDeck ? (onCard.get(tagKey(entry.card)) ?? []).map(({ tag }) => tag) : []}
                    onActivate={(shift) => activate(entry, shift)} onQuantity={onQuantity} onMenu={(el) => openMenu(entry, el)} />
                ))}
              </ul>
            ))}
          </section>
        );
      })}

      {selecting && (
        <div data-tour="selection-bar" className="sticky bottom-[calc(var(--nav-h,0px)+5.5rem)] z-20 mt-6 flex items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] sm:flex-wrap sm:whitespace-normal rounded-2xl border border-[var(--accent)]/60 bg-[var(--surface-hover)] p-3 text-sm shadow-xl lg:bottom-4">
          <b className="tabular-nums">{picked.size} selected</b>
          <span className="text-xs text-[var(--muted)] max-sm:hidden">click cards to pick them · shift-click a range · A picks all shown</span>
          {isDeck && (['main', 'maybe', 'side'] as Board[]).filter((b) => b !== board).map((b) => (
            <button key={b} disabled={!pickedEntries.length || busy} onClick={() => bulk((e) => onMove(e.card.id, b))}
              className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface)] disabled:opacity-40">To {BOARD_NAME[b].replace('the ', '')}</button>
          ))}
          {isDeck && accepted.length > 0 && (
            <select aria-label="Tag the selected cards" disabled={!pickedEntries.length || busy} value=""
              onChange={async (e) => { const tagId = e.target.value; if (!tagId) return; setBusy(true); try { await tagCards(tagId, pickedEntries); stopSelecting(); } finally { setBusy(false); } }}
              className="rounded-full border border-[var(--border)] bg-transparent px-3 py-1 disabled:opacity-40">
              <option value="">Tag…</option>
              {accepted.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <button disabled={!pickedEntries.length || busy} onClick={() => bulk((e) => onQuantity(e.card.id, 0))}
            className="rounded-full border border-[var(--border)] px-3 py-1 text-red-300 hover:bg-[var(--surface)] disabled:opacity-40">Remove</button>
          <button onClick={() => (picked.size ? setPicked(new Set()) : stopSelecting())} className="ml-auto rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface)]">
            {picked.size ? 'Clear' : 'Done'} (Esc)
          </button>
        </div>
      )}

      {menu && (
        <QuickMenu
          {...menu}
          isDeck={isDeck}
          tags={accepted}
          onClose={() => setMenu(null)}
          onOpen={() => onSelect(menu.entry.card)}
          onMove={(b) => onMove(menu.entry.card.id, b)}
          onTag={(tagId) => tagCards(tagId, [menu.entry])}
          onKeep={() => api.keepCard(listId, menu.entry.card.oracle_id ?? menu.entry.card.id, true)}
          onAsk={onAsk ? () => onAsk(`Suggest replacements for ${menu.entry.card.name} that fit the plan.`) : undefined}
          onRemove={() => onQuantity(menu.entry.card.id, 0)}
        />
      )}
    </div>
  );
}

// --- the three views' cards --------------------------------------------------------

function Picture({ card, className = '' }: { card: ScryfallCard; className?: string }) {
  const src = imageOf(card, 'normal');
  return src
    ? <Image src={src} alt={card.name} width={488} height={680} className={`block aspect-[488/680] h-auto w-full rounded-[4.75%/3.4%] bg-black/30 ${className}`} unoptimized />
    : <span className={`flex aspect-[488/680] w-full items-center justify-center rounded-[4.75%/3.4%] border border-[var(--border)] bg-[var(--surface)] p-2 text-center text-xs ${className}`}>{card.name}</span>;
}

// How many copies. In Stacks it sits at the right end of the name bar, so the name stays readable.
const Badge = ({ n, right = false }: { n: number; right?: boolean }) => (n > 1
  ? <span className={`pointer-events-none absolute top-0 z-[2] flex h-7 min-w-7 items-center justify-center bg-black/85 px-2 text-xs font-bold tabular-nums text-white ${right ? 'right-0 rounded-bl-xl rounded-tr-lg' : 'left-0 rounded-br-xl rounded-tl-lg'}`}>×{n}</span>
  : null);

const Check = ({ on, left = false }: { on: boolean; left?: boolean }) => (
  <span aria-hidden className={`pointer-events-none absolute ${left ? 'left-1.5' : 'right-1.5'} top-1.5 z-[3] flex h-5 w-5 items-center justify-center rounded-md border-2 text-xs font-extrabold ${on ? 'border-[var(--accent)] bg-[var(--accent)] text-[#1c0d06]' : 'border-white bg-black/50'}`}>{on ? '✓' : ''}</span>
);

function GridCard({ entry, isDeck, picked, selecting, onActivate, onQuantity, onMenu }: {
  entry: Entry; isDeck: boolean; picked: boolean; selecting: boolean;
  onActivate: (shift: boolean) => void; onQuantity: Props['onQuantity']; onMenu: (el: HTMLElement) => void;
}) {
  const { card, quantity } = entry;
  return (
    <div className="group relative flex flex-col gap-1">
      <button onClick={(e) => onActivate(e.shiftKey)} aria-pressed={selecting ? picked : undefined}
        aria-label={selecting ? `Pick ${card.name}` : `Show details for ${card.name}`}
        className={`relative block w-full text-left ${selecting ? 'cursor-copy' : ''}`}>
        <Picture card={card} className={picked ? 'outline outline-[3px] -outline-offset-[3px] outline-[var(--accent)]' : ''} />
        <Badge n={quantity} />
        {selecting && <Check on={picked} />}
        {entry.commander && <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#221c08]">Commander</span>}
      </button>
      {!selecting && !entry.commander && (
        // The quick controls show on hover, or keyboard focus.
        <div className="absolute right-1.5 top-1.5 z-[2] flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <button onClick={() => onQuantity(card.id, quantity - 1)} aria-label={`One fewer ${card.name}`} className="h-7 w-7 rounded-lg bg-black/80 text-sm text-white hover:bg-black">−</button>
          <button onClick={() => onQuantity(card.id, quantity + 1)} aria-label={`One more ${card.name}`} className="h-7 w-7 rounded-lg bg-black/80 text-sm text-white hover:bg-black">+</button>
          <button onClick={(e) => onMenu(e.currentTarget)} aria-label={`More for ${card.name}`} aria-haspopup="menu" className="h-7 w-7 rounded-lg bg-black/80 text-sm text-white hover:bg-black">⋯</button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-0.5 text-xs text-[var(--muted)]">
        <span className="truncate">{entry.finish !== 'nonfoil' ? <span className="uppercase">{entry.finish}</span> : isDeck ? '' : card.set?.toUpperCase()}</span>
        <span className="tabular-nums">{money(entry)}</span>
      </div>
    </div>
  );
}

function StackCard({ entry, first, picked, selecting, onActivate }: {
  entry: Entry; first: boolean; picked: boolean; selecting: boolean; onActivate: (shift: boolean) => void;
}) {
  // Each card shows its name bar - about 13.5% of the card - until the last, shown whole.
  return (
    <button onClick={(e) => onActivate(e.shiftKey)} aria-pressed={selecting ? picked : undefined}
      aria-label={selecting ? `Pick ${entry.card.name}` : `Show details for ${entry.card.name}`}
      // A percentage margin is of the column's width, which is the card's: it works at any size.
      style={{ marginTop: first ? 0 : '-120.5%' }}
      className={`relative block w-full rounded-[4.75%/3.4%] text-left shadow-[0_-2px_10px_rgba(0,0,0,0.45)] transition-transform hover:z-10 hover:-translate-y-1.5 hover:scale-[1.03] focus-visible:z-10 focus-visible:-translate-y-1.5 motion-reduce:transition-none ${selecting ? 'cursor-copy' : ''}`}>
      <Picture card={entry.card} className={picked ? 'outline outline-[3px] -outline-offset-[3px] outline-[var(--accent)]' : ''} />
      <Badge n={entry.quantity} right />
      {selecting && <Check on={picked} left />}
    </button>
  );
}

function TextRow({ entry, isDeck, size, picked, selecting, tagDots, onActivate, onQuantity, onMenu }: {
  entry: Entry; isDeck: boolean; size: number; picked: boolean; selecting: boolean; tagDots: Array<{ id: string; name: string; color: string }>;
  onActivate: (shift: boolean) => void; onQuantity: Props['onQuantity']; onMenu: (el: HTMLElement) => void;
}) {
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  // The picture on hover is as big as the card size, half again for reading.
  const width = Math.round(size * 1.5);
  const place = (e: React.MouseEvent) => {
    const h = width * 1.4;
    const x = e.clientX + 24 + width > window.innerWidth ? e.clientX - width - 24 : e.clientX + 24;
    setPreview({ x, y: Math.min(window.innerHeight - h - 10, Math.max(10, e.clientY - h / 2)) });
  };
  const src = imageOf(entry.card, 'normal');
  return (
    <li className={`flex items-center gap-3 px-3 py-1.5 text-sm ${picked ? 'bg-[var(--accent)]/10' : ''}`}>
      {selecting && (
        <button onClick={(e) => onActivate(e.shiftKey)} aria-pressed={picked} aria-label={`Pick ${entry.card.name}`}
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 text-xs font-extrabold ${picked ? 'border-[var(--accent)] bg-[var(--accent)] text-[#1c0d06]' : 'border-[var(--muted)]'}`}>{picked ? '✓' : ''}</button>
      )}
      <span className="w-6 text-right tabular-nums text-[var(--muted)]">{entry.quantity}</span>
      <button onClick={(e) => onActivate(e.shiftKey)} onMouseEnter={(e) => { if (!selecting && src) place(e); }} onMouseMove={(e) => { if (preview) place(e); }} onMouseLeave={() => setPreview(null)}
        className="min-w-0 flex-1 truncate text-left hover:text-[var(--accent)]">
        {entry.card.name}
        {entry.finish !== 'nonfoil' && <span className="ml-2 text-[10px] uppercase text-[var(--muted)]">{entry.finish}</span>}
      </button>
      {tagDots.length > 0 && (
        <span className="hidden items-center gap-1 sm:flex" title={tagDots.map((t) => t.name).join(', ')}>
          {tagDots.map((t) => <span key={t.id} className="h-2 w-2 rounded-full" style={{ background: t.color }} />)}
        </span>
      )}
      <ManaCost cost={manaCostOf(entry.card)} size={13} />
      <span className="w-16 text-right tabular-nums text-[var(--muted)]">{money(entry)}</span>
      {!entry.commander && !selecting && (
        <span className="flex items-center gap-1">
          <button onClick={() => onQuantity(entry.card.id, entry.quantity - 1)} aria-label={`One fewer ${entry.card.name}`} className="h-6 w-6 rounded border border-[var(--border)] hover:bg-[var(--surface-hover)]">−</button>
          <button onClick={() => onQuantity(entry.card.id, entry.quantity + 1)} aria-label={`One more ${entry.card.name}`} className="h-6 w-6 rounded border border-[var(--border)] hover:bg-[var(--surface-hover)]">+</button>
          {isDeck && <button onClick={(e) => onMenu(e.currentTarget)} aria-label={`More for ${entry.card.name}`} aria-haspopup="menu" className="h-6 w-6 rounded border border-[var(--border)] hover:bg-[var(--surface-hover)]">⋯</button>}
        </span>
      )}
      {preview && src && createPortal(
        <span className="pointer-events-none fixed z-[80] block drop-shadow-[0_12px_30px_rgba(0,0,0,0.6)]" style={{ left: preview.x, top: preview.y, width }}>
          <Image src={src} alt="" width={488} height={680} className="h-auto w-full rounded-[4.75%/3.4%]" unoptimized />
        </span>,
        document.body,
      )}
    </li>
  );
}

// --- a card's ⋯ ---------------------------------------------------------------------

function QuickMenu({ entry, x, y, up, isDeck, tags, onClose, onOpen, onMove, onTag, onKeep, onAsk, onRemove }: {
  entry: Entry; x: number; y: number; up: boolean; isDeck: boolean; tags: Array<{ id: string; name: string }>;
  onClose: () => void; onOpen: () => void; onMove: (b: Board) => void; onTag: (tagId: string) => Promise<void> | void;
  onKeep: () => Promise<unknown> | void; onAsk?: () => void; onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tagging, setTagging] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const close = () => onClose();
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('scroll', close, true); };
  }, [onClose]);
  const act = (work: () => void | Promise<unknown>) => async () => { await work(); onClose(); };
  const item = 'block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--surface)] focus-visible:bg-[var(--surface)] outline-none';
  return createPortal(
    <div ref={ref} role="menu" aria-label={`${entry.card.name}: quick actions`} data-tour="card-menu"
      style={{ left: x, top: up ? undefined : y, bottom: up ? window.innerHeight - y + 40 : undefined }}
      className="fixed z-[85] w-56 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-1 shadow-xl">
      <button role="menuitem" className={item} onClick={act(onOpen)}>Open {entry.card.name.split(' // ')[0]}</button>
      <hr className="my-1 border-[var(--border)]" />
      {isDeck && (['main', 'maybe', 'side'] as Board[]).filter((b) => b !== entry.board && !entry.commander).map((b) => (
        <button key={b} role="menuitem" className={item} onClick={act(() => onMove(b))}>Move to {BOARD_NAME[b]}</button>
      ))}
      {isDeck && tags.length > 0 && (tagging ? (
        <div className="max-h-48 overflow-y-auto border-y border-[var(--border)] py-1">
          {tags.map((t) => <button key={t.id} role="menuitem" className={`${item} pl-6`} onClick={act(() => onTag(t.id))}>{t.name}</button>)}
        </div>
      ) : <button role="menuitem" className={item} onClick={() => setTagging(true)}>Add a tag ▸</button>)}
      {isDeck && !entry.commander && <button role="menuitem" className={item} onClick={async () => { await onKeep(); setDone('Kept: never offered as a cut'); setTimeout(onClose, 900); }}>Never cut this ★</button>}
      <button role="menuitem" className={item} onClick={act(onOpen)}>Change printing or finish…</button>
      {onAsk && <button role="menuitem" className={item} onClick={act(onAsk)}>Find a replacement</button>}
      {!entry.commander && (
        <>
          <hr className="my-1 border-[var(--border)]" />
          <button role="menuitem" className={`${item} text-red-300`} onClick={act(onRemove)}>Remove from {isDeck ? 'the deck' : 'the list'}</button>
        </>
      )}
      {done && <p role="status" className="px-3 py-1.5 text-xs text-emerald-400">{done}</p>}
    </div>,
    document.body,
  );
}
