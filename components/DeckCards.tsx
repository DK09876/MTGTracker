'use client';

/**
 * A deck's (or list's) cards: board tabs, and the cards three ways - a grid
 * of pictures, Archidekt-style stacks (each group a column of overlapping
 * cards, the last one whole), or a compact text list with a picture on
 * hover. One size slider (S, M, L to snap) sizes all of them; groups fold;
 * a card opens on a click, or - in Select mode, or with ⌘/Ctrl/Shift, or a
 * long press on a phone - is picked, so several can be moved, tagged or
 * removed at once. Each card's ⋯ has the quick things.
 *
 * Calm by default: a row's −, + and ⋯ show for the row under the pointer,
 * a collection mark only where something needs doing (a card that's simply
 * yours shows its ✓ on hover), and the list's columns are a choice. Chips
 * above the cards (the deck's tags and roles, where copies are, foils) and
 * the deck at a glance light up the cards behind a number; "Show only
 * these" hides the rest. The filter box finds a card in the deck, or adds
 * one it doesn't have. On a wide screen the card under the pointer shows in
 * a panel beside the list.
 *
 * View choices are remembered in this browser, since they are how someone
 * likes to look at every deck, not a property of one deck; folded groups are
 * remembered per deck.
 */

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import ManaCost from './ManaCost';
import Popover from './Popover';
import StickyBar from './StickyBar';
import Tip from './Tip';
import { canPair, isCompanion, type Slot } from '@/lib/commanders';
import type { Board } from '@/lib/decklist';
import { boardName, DEFAULT_SECTIONS, PURPOSES, type DeckSection, type Purpose } from '@/lib/sections-shared';
import * as api from '@/lib/api';
import { groupCards, primaryType, type Categories, type GroupBy, type Item, type SortBy } from '@/lib/deckview';
import { filterCards, type IsWord } from '@/lib/filter';
import { looksLikeSyntax } from '@/lib/syntax';
import type { ScryfallCard } from '@/lib/scryfall';
import { imageOf, manaCostOf, priceOf } from '@/lib/scryfall';
import type { RoleCount } from '@/lib/roles';
import { nextColor, tagKey, tagsByCard, type DeckTags } from '@/lib/tags';
import { mouseOnly } from '@/lib/mouse-only';

export type Entry = Item & { board: Board; slot?: Slot | null };

/** Cards lit up: by name (from the deck at a glance) or by a test. `n` makes a repeat ask count. */
export interface Light { key: string; label: string; names?: string[]; test?: (e: Entry) => boolean; n?: number }

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
  /** The commander's ⋯ offers changing it. */
  onChangeCommander?: () => void;
  /** A deck's sections beyond Main, and a way to change them. */
  sections?: DeckSection[];
  onSections?: (sections: DeckSection[]) => void;
  /** The commander, to offer a card that could lead beside it as the second commander. */
  commander?: ScryfallCard | null;
  /** Make a card the second commander or the companion, or neither. */
  onSlot?: (cardId: string, slot: Slot | null) => void;
  /** A card's collection mark (CopyMark), drawn on it in every view. */
  mark?: (entry: Entry) => React.ReactNode;
  /** Filter words about a card beyond the card itself: is:held, is:tobuy… */
  isWord?: IsWord<Entry>;
  /** Sets the filter from outside - a count under "Where your copies are" - and brings the cards into view. */
  filterTo?: { text: string; n: number };
  /** Read the deck again after a change made here directly (a finish toggled from the keyboard). */
  onChanged?: () => void;
  /** Light up cards from outside: a curve bar or a role in the deck at a glance. */
  light?: Light;
  /** Shown at the end of the chips: the deck's copies summary. */
  chipsEnd?: React.ReactNode;
}

type View = 'grid' | 'stacks' | 'text';

const PREFS = 'mtg-deck-view';
// The size slider, in pixels of card width; S, M and L snap to these.
const SIZES = { S: 150, M: 210, L: 270 } as const;
const MIN_SIZE = 140;
const MAX_SIZE = 300;

/** The list's optional columns. */
export interface Columns { mana: boolean; price: boolean; type: boolean; tags: boolean }
interface Prefs { view: View; groupBy: GroupBy; sortBy: SortBy; size: number; cols: Columns; preview: boolean; v?: number }
// The compact list fits about forty cards on a screen; pictures are a click away (G, S). Sorted by mana value, as a curve reads.
const DEFAULT_COLS: Columns = { mana: true, price: true, type: false, tags: true };
const DEFAULT_PREFS: Prefs = { view: 'text', groupBy: 'type', sortBy: 'mv', size: SIZES.M, cols: DEFAULT_COLS, preview: true, v: 3 };

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs> & { view?: string };
    // 'visual' was the grid's old name. Before v2 the grid was the default, so a saved grid wasn't a choice: the list takes over once.
    const view: View = !saved.v ? 'text' : saved.view === 'stacks' || saved.view === 'text' ? saved.view : 'grid';
    const size = typeof saved.size === 'number' && saved.size >= MIN_SIZE && saved.size <= MAX_SIZE ? saved.size : SIZES.M;
    // Before v3 name was the only sort anyone had been given: mana value takes over once.
    const sortBy: SortBy = (saved.v ?? 0) < 3 ? 'mv' : saved.sortBy === 'name' || saved.sortBy === 'price' ? saved.sortBy : 'mv';
    return { ...DEFAULT_PREFS, ...saved, view, size, sortBy, cols: { ...DEFAULT_COLS, ...saved.cols }, preview: saved.preview !== false, v: 3 };
  } catch {
    return DEFAULT_PREFS;
  }
}

// The card under the pointer, for the panel beside the list: a small store, so hovering re-draws only the panel.
let hoverId: string | null = null;
const hoverListeners = new Set<() => void>();
function setHover(id: string | null) {
  if (id === hoverId) return;
  hoverId = id;
  for (const l of hoverListeners) l();
}
const subscribeHover = (l: () => void) => { hoverListeners.add(l); return () => { hoverListeners.delete(l); }; };
const useHover = () => useSyncExternalStore(subscribeHover, () => hoverId, () => null);

// Wide enough for the panel beside the list (Tailwind's xl).
const WIDE = '(min-width: 1280px)';
const subscribeWide = (l: () => void) => { const m = matchMedia(WIDE); m.addEventListener('change', l); return () => m.removeEventListener('change', l); };
const useWide = () => useSyncExternalStore(subscribeWide, () => matchMedia(WIDE).matches, () => false);

/** The filter words for where a deck's copies are (lib/copy-status.ts), as chips. */
const STATUS_CHIPS: Array<[string, string]> = [['inbox', 'In a box'], ['otherdeck', 'In another deck'], ['proxy', 'Proxies'], ['tobuy', 'To buy']];
const front = (name: string) => name.split(' // ')[0].trim().toLowerCase();

const foldKey = (listId: string) => `mtg-folded:${listId}`;
function loadFolded(listId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(foldKey(listId)) ?? '[]') as string[]); } catch { return new Set(); }
}

const nearest = (size: number) => (size < 180 ? 'S' : size < 240 ? 'M' : 'L');
const money = (entry: Entry) => { const p = priceOf(entry.card, entry.finish); return p === null ? '—' : `$${p.toFixed(2)}`; };

const SHORTCUTS: Array<[string, string]> = [
  ['N', 'Add cards (type a name, Enter adds it)'], ['/', 'Filter the cards'],
  ['+ · −', 'One more or one fewer of the card under the pointer (or the selected cards)'],
  ['M · B · D', 'Move it to the Maybeboard, the Sideboard, or back to the Deck'],
  ['F', 'Foil on or off'], ['Delete', 'Remove it'],
  ['⌘Z · Ctrl+Z', 'Undo the last change'],
  ['X', 'Select cards (again to finish)'], ['⌘ · Ctrl · Shift-click', 'Pick a card without Select (a long press on a phone)'], ['A', 'While selecting: pick everything shown'],
  ['T · G · S', 'List, Grid or Stacks'], ['[ · ]', 'Cards smaller or bigger'],
  ['Esc', 'Close a menu · clear the selection · stop selecting'], ['1 – 5', 'Switch the deck\'s tabs'], ['?', 'Show these keys'],
];

export default function DeckCards({ listId, entries, tags, onTags, version, isDeck, onSelect, onQuantity, onMove, onAsk, onChangeCommander, sections = DEFAULT_SECTIONS, onSections, commander, onSlot, mark, isWord, filterTo, onChanged, light: lightFrom, chipsEnd }: Props) {
  // The card under the pointer, for the card keys; a ref, so hovering doesn't re-render the deck.
  const hovered = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const over = (e: MouseEvent) => {
      hovered.current = (e.target as HTMLElement).closest?.('[data-card-id]') as HTMLElement | null;
      if (hovered.current?.dataset.cardId) setHover(hovered.current.dataset.cardId);
    };
    document.addEventListener('mouseover', over);
    return () => document.removeEventListener('mouseover', over);
  }, []);
  const [help, setHelp] = useState(false);
  const [boardPicked, setBoard] = useState<Board>('main');
  // A section deleted elsewhere falls back to Main.
  const board: Board = boardPicked === 'main' || sections.some((x) => x.id === boardPicked) ? boardPicked : 'main';
  const tabs: Array<{ id: Board; name: string }> = [{ id: 'main', name: 'Main' }, ...sections];
  const nameOf = (b: Board) => boardName(sections, b);
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
    if (!filterTo) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a filter asked for from outside
    setFilter(filterTo.text);
    setBoard('main');
    filterBox.current?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [filterTo]);

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

  // The built-in tags (Scryfall's roles): for grouping by tags, and the chips that light cards up.
  const [roles, setRoles] = useState<RoleCount[] | null>(null);
  useEffect(() => {
    if (!isDeck) return;
    let cancelled = false;
    api.deckRoles(listId).then((r) => { if (!cancelled) setRoles(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isDeck, listId, version]);

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
  const { results: matched, unsupported } = filterCards(onBoard, filter, isWord);

  // Cards lit up by a chip or the deck at a glance; the rest dim, or hide with "Show only these".
  const [light, setLight] = useState<Light | null>(null);
  const [only, setOnly] = useState(false);
  useEffect(() => {
    if (!lightFrom) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a light asked for from outside
    setLight(lightFrom);
    setOnly(false);
    setBoard('main');
    filterBox.current?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [lightFrom]);
  const lit = useMemo(() => {
    if (!light) return null;
    if (light.test) return light.test;
    const names = new Set((light.names ?? []).map(front));
    return (e: Entry) => names.has(front(e.card.name)) || names.has(e.card.name.toLowerCase());
  }, [light]);
  const shown = lit && only ? matched.filter(lit) : matched;
  const dims = (e: Entry) => !!lit && !only && !lit(e) && !picked.has(e.card.id);
  const toggleLight = (next: Light) => {
    if (light?.key === next.key) { setLight(null); setOnly(false); } else setLight(next);
  };
  const groups = groupCards(shown, groupBy, prefs.sortBy, categories);
  // In Stacks, the maybeboard sits beside the main deck as one more column.
  const maybe = isDeck && board === 'main' && prefs.view === 'stacks' ? filterCards(entries.filter((e) => e.board === 'maybe'), filter, isWord).results : [];
  const columns = maybe.length ? [...groups, { key: '__maybe', label: nameOf('maybe'), count: maybe.reduce((n, e) => n + e.quantity, 0), items: maybe, color: undefined }] : groups;
  const order = columns.flatMap((g) => (folded.has(g.key) ? [] : g.items.map((e) => e.card.id)));
  const waiting = groupBy === 'tag' && (!tags || !roles);
  const noTags = groupBy === 'tag' && tags && !tags.tags.some((t) => t.status === 'accepted');
  const copies = (b: Board) => entries.filter((e) => e.board === b).reduce((n, e) => n + e.quantity, 0);
  const accepted = (tags?.tags ?? []).filter((t) => t.status === 'accepted');

  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); lastPicked.current = null; };
  // A click opens the card - or, while selecting, or with ⌘, Ctrl or Shift held, picks it (shift-click picks a range).
  const activate = (entry: Entry, e: Pick<React.MouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>) => {
    const shift = e.shiftKey;
    if (!selecting && !e.metaKey && !e.ctrlKey && !shift) { onSelect(entry.card); return; }
    if (entry.commander && !selecting) { onSelect(entry.card); return; }
    setSelecting(true);
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
  // A bulk action is one change in the history: one Undo puts all of it back.
  const bulk = async (work: (e: Entry) => Promise<void> | void) => {
    setBusy(true);
    try { await api.inBatch(async () => { for (const e of pickedEntries) await work(e); }); stopSelecting(); } finally { setBusy(false); }
  };
  const tagCards = async (tagId: string, list: Entry[]) => {
    let latest: DeckTags | null = null;
    await api.inBatch(async () => { for (const e of list) latest = await api.setCardTag(listId, tagKey(e.card), tagId, true); });
    if (latest) onTags?.(latest);
  };
  /** A new tag, made right here; answers its id. */
  const makeTag = async (name: string): Promise<string | null> => {
    const n = name.trim().slice(0, 60);
    if (!n) return null;
    const existing = (tags?.tags ?? []).find((t) => t.name.toLowerCase() === n.toLowerCase());
    if (existing) return existing.id;
    const made = await api.createTag(listId, { name: n, color: nextColor((tags?.tags ?? []).map((t) => t.color)) });
    onTags?.(made);
    return made.created ?? made.tags.find((t) => t.name === n)?.id ?? null;
  };
  const [newTag, setNewTag] = useState<string | null>(null);

  // A long press on a phone picks a card, as ⌘-click does with a mouse; the tap that ends it doesn't open the card.
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const pressed = useRef(false);
  const touchPick = {
    onPointerDown: (e: React.PointerEvent) => {
      // A long press that no tap followed mustn't swallow the next tap.
      pressed.current = false;
      if (e.pointerType === 'mouse') return;
      const id = ((e.target as HTMLElement).closest('[data-card-id]') as HTMLElement | null)?.dataset.cardId;
      const entry = id ? entries.find((x) => x.card.id === id && !x.commander) : undefined;
      if (!entry) return;
      press.current = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
        press.current = null;
        pressed.current = true;
        setSelecting(true);
        setPicked((prev) => new Set(prev).add(entry.card.id));
        lastPicked.current = entry.card.id;
        navigator.vibrate?.(10);
      }, 480) };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) { clearTimeout(press.current.timer); press.current = null; }
    },
    onPointerUp: () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } },
    onPointerCancel: () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } },
    onClickCapture: (e: React.MouseEvent) => { if (pressed.current) { pressed.current = false; e.preventDefault(); e.stopPropagation(); } },
  };

  // The filter box adds a card the deck doesn't have: names that start with what's typed, the first on Enter.
  const [quick, setQuick] = useState<{ q: string; cards: api.QuickCard[] } | null>(null);
  const [addNote, setAddNote] = useState<{ text: string; ok: boolean } | null>(null);
  const typed = filter.trim();
  const canAdd = typed.length >= 3 && !looksLikeSyntax(typed) && !matched.length && !!onBoard.length;
  useEffect(() => {
    if (!canAdd) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.quickCards(listId, typed).then((r) => { if (!cancelled) setQuick({ q: typed, cards: r.cards.slice(0, 4) }); }).catch(() => {});
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [canAdd, typed, listId]);
  const offers = canAdd && quick?.q === typed ? quick.cards : [];
  const addQuick = async (card: api.QuickCard, toMaybe: boolean) => {
    const to: Board = toMaybe && isDeck ? 'maybe' : board;
    setFilter('');
    setQuick(null);
    try {
      await api.addCard(listId, card.id, 1, to);
      setAddNote({ text: `Added ${card.name} to ${isDeck ? nameOf(to) : 'the list'}`, ok: true });
      onChanged?.();
    } catch {
      setAddNote({ text: `Couldn't add ${card.name}`, ok: false });
    }
    setTimeout(() => setAddNote(null), 3500);
  };

  // The chips: your tags, then the built-in roles, then where the copies are and foils. Counts are copies on this board.
  const chips = useMemo(() => {
    if (!isDeck) return [] as Array<Light & { count: number; tone?: string; color?: string }>;
    const n = (test: (e: Entry) => boolean) => onBoard.filter(test).reduce((k, e) => k + e.quantity, 0);
    const out: Array<Light & { count: number; tone?: string; color?: string }> = [];
    for (const t of accepted) {
      const test = (e: Entry) => (onCard.get(tagKey(e.card)) ?? []).some(({ tag }) => tag.id === t.id);
      out.push({ key: `tag:${t.id}`, label: t.name, test, count: n(test), color: t.color });
    }
    for (const r of [...(roles ?? [])].filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 6)) {
      const names = new Set(r.cards.map(front));
      const test = (e: Entry) => names.has(front(e.card.name));
      out.push({ key: `role:${r.id}`, label: r.label, test, count: n(test) });
    }
    // Where copies are counts cards, not copies: the summary beside them counts the copies.
    if (isWord) for (const [word, label] of STATUS_CHIPS) {
      const test = (e: Entry) => isWord(e, word) === true;
      out.push({ key: `is:${word}`, label, test, count: onBoard.filter(test).length, tone: word });
    }
    const foil = (e: Entry) => e.finish !== 'nonfoil';
    out.push({ key: 'foil', label: 'Foil or etched', test: foil, count: n(foil) });
    const gc = (e: Entry) => !!e.card.game_changer;
    out.push({ key: 'gc', label: 'Game Changers', test: gc, count: n(gc) });
    return out.filter((c) => c.count > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accepted follows tags
  }, [isDeck, onBoard, tags, roles, onCard, isWord]);
  const litCount = lit ? onBoard.filter(lit).reduce((k, e) => k + e.quantity, 0) : 0;
  const wide = useWide();
  const panel = isDeck && prefs.view === 'text' && prefs.preview && wide && shown.length > 0;

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
        else if (light) { setLight(null); setOnly(false); }
        else if (picked.size) setPicked(new Set());
        else if (selecting) stopSelecting();
        return;
      }
      // Card keys act on the selected cards, or else the one under the pointer (or focused).
      const targets = (): Entry[] => {
        if (picked.size) return pickedEntries;
        const el = (document.activeElement?.closest('[data-card-id]') as HTMLElement | null) ?? hovered.current;
        const id = el?.dataset.cardId;
        const one = id ? entries.find((x) => x.card.id === id && !x.commander) : undefined;
        return one ? [one] : [];
      };
      const cardKey = (work: (x: Entry) => Promise<void> | void) => {
        const list = targets();
        if (!list.length) return false;
        e.preventDefault();
        void api.inBatch(async () => { for (const x of list) await work(x); });
        return true;
      };
      if (k === '?') { e.preventDefault(); setHelp((v) => !v); return; }
      if (k === '+' || k === '=') { if (cardKey((x) => onQuantity(x.card.id, x.quantity + 1))) return; }
      if (k === '-' || k === '_') { if (cardKey((x) => onQuantity(x.card.id, x.quantity - 1))) return; }
      if (k === 'delete' || k === 'backspace') { if (cardKey((x) => onQuantity(x.card.id, 0))) return; }
      if (isDeck && k === 'm') { if (cardKey((x) => (x.board === 'maybe' ? undefined : onMove(x.card.id, 'maybe')))) return; }
      if (isDeck && k === 'b') { if (cardKey((x) => (x.board === 'side' ? undefined : onMove(x.card.id, 'side')))) return; }
      if (isDeck && k === 'd') { if (cardKey((x) => (x.board === 'main' ? undefined : onMove(x.card.id, 'main')))) return; }
      if (k === 'f') { if (cardKey((x) => api.updateCard(listId, x.card.id, { finish: x.finish === 'nonfoil' ? 'foil' : 'nonfoil' }).then(() => onChanged?.()))) return; }
      if (k === '/') { e.preventDefault(); filterBox.current?.focus(); }
      else if (k === 'g' || k === 's' || k === 't') setPrefs((p) => ({ ...p, view: k === 'g' ? 'grid' : k === 's' ? 'stacks' : 'text' }));
      else if (k === '[' || k === ']') setPrefs((p) => ({ ...p, size: Math.max(MIN_SIZE, Math.min(MAX_SIZE, p.size + (k === ']' ? 20 : -20))) }));
      else if (k === 'x') { if (selecting) stopSelecting(); else setSelecting(true); }
      else if (k === 'a' && selecting) setPicked(new Set(order));
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  const size = prefs.size;
  // A card that's simply yours shows its ✓ only on hover: the marks that stay are the ones that need something done.
  const quietMark = (e: Entry) => isWord?.(e, 'held') === true;
  const openMenu = (entry: Entry, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ entry, x: Math.max(8, Math.min(window.innerWidth - 240, r.right - 228)), y: r.bottom + 6, up: r.bottom + 330 > window.innerHeight });
  };

  return (
    <div className="mt-5" style={{ ['--card' as string]: `${size}px` }}>
      {isDeck && (
        <>
        <div data-tour="boards" className="flex items-end gap-1 overflow-x-auto border-b border-[var(--border)] [scrollbar-width:none]">
          <div role="tablist" aria-label="Sections" className="flex gap-1">
            {tabs.map(({ id, name }) => (
              <button
                key={id}
                role="tab"
                aria-selected={board === id}
                onClick={() => { setBoard(id); setPicked(new Set()); }}
                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${board === id
                  ? 'border-[var(--c1)] text-[var(--foreground)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'}`}
              >
                {name} <span className="ml-1 text-xs text-[var(--muted)]">{copies(id)}</span>
              </button>
            ))}
          </div>
          {onSections && <NewSection listId={listId} onMade={(next, made) => { onSections(next); setBoard(made); }} />}
        </div>
        {board !== 'main' && onSections && (
          <SectionTools key={board} listId={listId} section={sections.find((x) => x.id === board)!} count={copies(board)} maybeName={nameOf('maybe')} onChanged={onSections} onDeleted={() => setBoard('main')} />
        )}
        </>
      )}

      {/* Sticks under the top bar as the cards scroll: one row to swipe on a phone, wrapped on wider screens. */}
      <StickyBar data-tour="card-tools" className="mt-1"
        rowClassName="flex items-center gap-2 overflow-x-auto py-2 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
        <input
          ref={filterBox}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && offers.length) { e.preventDefault(); void addQuick(offers[0], e.shiftKey); }
          }}
          placeholder="Find or add a card  ( / )"
          title="Find a card by name or Scryfall syntax - t:creature, c:rg, cmc<=3. A name the deck doesn't have can be added with Enter."
          aria-label="Find a card, or add one"
          className="min-w-[11rem] flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-sm outline-none focus:border-[var(--c1)]"
        />
        <Pick label="Group" value={groupBy} onPick={(v) => setPrefs((p) => ({ ...p, groupBy: v }))}
          options={[['type', 'Type'], ...(isDeck ? [['tag', 'Tags & roles'] as [GroupBy, string]] : []), ['mv', 'Mana value'], ['none', 'None']]} />
        <Pick label="Sort" value={prefs.sortBy} onPick={(v) => setPrefs((p) => ({ ...p, sortBy: v }))}
          options={[['mv', 'Mana value'], ['name', 'Name'], ['price', 'Price']]} />
        <div className="flex shrink-0 overflow-hidden rounded-full border border-[var(--border)] text-sm" role="group" aria-label="View">
          {(['grid', 'stacks', 'text'] as View[]).map((v) => (
            <button
              key={v}
              data-view={v}
              onClick={() => setPrefs((p) => ({ ...p, view: v }))}
              aria-pressed={prefs.view === v}
              className={`px-3 py-1.5 ${prefs.view === v ? 'bg-[var(--surface-hover)] text-[var(--foreground)]' : 'text-[var(--muted)]'}`}
            >
              {v === 'grid' ? 'Grid' : v === 'stacks' ? 'Stacks' : 'List'}
            </button>
          ))}
        </div>
        {/* Group, sort, size and the shortcuts: set once in a while, so behind one button. */}
        <Popover
          data-tour="card-size"
          aria-label="View options"
          label={<>View <span aria-hidden className="text-[10px] opacity-60">▾</span></>}
          className="shrink-0 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] aria-expanded:text-[var(--foreground)]"
        >
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <p className="mb-1.5 text-xs font-medium text-[var(--muted)]">In the list</p>
              <span className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {([['mana', 'Mana cost'], ['price', 'Price'], ['type', 'Type'], ...(isDeck ? [['tags', 'Tag dots'] as [keyof Columns, string]] : [])] as Array<[keyof Columns, string]>).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={prefs.cols[k]} onChange={(e) => setPrefs((p) => ({ ...p, cols: { ...p.cols, [k]: e.target.checked } }))} className="accent-[var(--c1)]" />
                    {label}
                  </label>
                ))}
              </span>
              {isDeck && (
                <label className="mt-2 flex items-center gap-1.5 text-xs max-xl:hidden">
                  <input type="checkbox" checked={prefs.preview} onChange={(e) => setPrefs((p) => ({ ...p, preview: e.target.checked }))} className="accent-[var(--c1)]" />
                  The card beside the list
                </label>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-[var(--muted)]">Card size</p>
              <input type="range" min={MIN_SIZE} max={MAX_SIZE} step={5} value={size} aria-label="Card size"
                onChange={(e) => setPrefs((p) => ({ ...p, size: Number(e.target.value) }))} className="w-full accent-[var(--c1)]" />
              <span className="flex justify-between px-0.5 text-[11px] leading-none">
                {(Object.keys(SIZES) as Array<keyof typeof SIZES>).map((k) => (
                  <button key={k} type="button" onClick={() => setPrefs((p) => ({ ...p, size: SIZES[k] }))} aria-label={`Card size ${k}`}
                    className={`rounded px-1 ${nearest(size) === k ? 'font-bold text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}>{k}</button>
                ))}
              </span>
            </div>
            <button type="button" onClick={() => setHelp(true)} className="border-t border-[var(--border)] pt-2.5 text-left text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] sm:hidden">Keyboard shortcuts</button>
            <details className="border-t border-[var(--border)] pt-2.5 max-sm:hidden">
              <summary className="cursor-pointer text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)]">Keyboard shortcuts</summary>
              <span className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {SHORTCUTS.map(([k, v]) => <span key={k} className="contents"><kbd className="font-mono text-[11px] text-[var(--c1)]">{k}</kbd><span className="text-[var(--muted)]">{v}</span></span>)}
              </span>
            </details>
          </div>
        </Popover>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button data-tour="select-cards" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting} title="Or ⌘/Ctrl-click a card (a long press on a phone)"
            className={`rounded-full border px-3.5 py-1.5 text-sm ${selecting ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}>
            {selecting ? `${picked.size} selected · Done` : 'Select'}
          </button>
        </div>
      </StickyBar>
      {(chips.length > 0 || chipsEnd) && (
        <div role="group" aria-label="Light up cards" className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 pt-0.5 [scrollbar-width:none] sm:flex-wrap">
          {chips.map((c, i) => {
            const on = light?.key === c.key;
            const sep = i > 0 && chips[i - 1].key.split(':')[0] !== c.key.split(':')[0];
            return (
              <span key={c.key} className="contents">
                {sep && <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-[var(--border)]" />}
                <button type="button" data-chip={c.key} aria-pressed={on} onClick={() => toggleLight(c)}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ${on
                    ? 'border-[var(--c1)] bg-[color-mix(in_srgb,var(--c1)_14%,transparent)] text-[var(--foreground)]'
                    : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'}`}>
                  {c.color && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: c.color }} />}
                  {c.label} <b className={`font-semibold tabular-nums ${CHIP_TONE[c.tone ?? ''] ?? 'text-[var(--foreground)]'}`}>{c.count}</b>
                </button>
              </span>
            );
          })}
          {chipsEnd && <span className="flex shrink-0 items-center gap-1 sm:ml-auto">{chipsEnd}</span>}
        </div>
      )}
      {light && (
        <div role="status" className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-[color-mix(in_srgb,var(--c1)_45%,transparent)] bg-[color-mix(in_srgb,var(--c1)_9%,transparent)] px-3 py-1.5 text-sm">
          <span><b className="tabular-nums">{litCount}</b> lit up · {light.label}</span>
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} className="accent-[var(--c1)]" /> Show only these
          </label>
          <button type="button" onClick={() => { setLight(null); setOnly(false); }} className="ml-auto text-xs text-[var(--c1)] hover:underline">Clear (Esc)</button>
        </div>
      )}
      {offers.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" data-add-offers>
          <span className="text-[var(--muted)]">Not in {isDeck ? nameOf(board) : 'the list'}. Add:</span>
          {offers.map((c, i) => (
            <button key={c.id} type="button" onClick={(e) => void addQuick(c, e.shiftKey)}
              title={c.inDeck ? `Already in ${nameOf(c.inDeck as Board)}` : undefined}
              className={`rounded-full border px-3 py-0.5 ${i === 0 ? 'border-[var(--c1)] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'}`}>
              {c.name}{c.inDeck && <span className="ml-1 text-[10px] text-[var(--faint)]">· in {nameOf(c.inDeck as Board)}</span>}
            </button>
          ))}
          <span className="text-xs text-[var(--faint)] max-sm:hidden">Enter adds the first{isDeck && board !== 'maybe' ? ' · Shift+Enter to the Maybeboard' : ''}</span>
        </div>
      )}
      {addNote && <p role="status" className={`mt-2 text-xs ${addNote.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{addNote.text}</p>}
      {unsupported.length > 0 && (
        <p className="mt-2 text-xs text-amber-400">
          Ignoring {unsupported.map((u) => `"${u}"`).join(', ')} — not supported here.
          Supported: name, t, o, c/id, cmc/mv, usd, pow, tou, r, set, a, kw, is, and - to exclude.
        </p>
      )}

      {!onBoard.length && (
        <p className="mt-10 text-center text-[var(--muted)]">
          {isDeck && board !== 'main'
            ? `Nothing in ${nameOf(board)} yet — move cards here from a card's ⋯${board === 'maybe' ? ', or use Maybe when adding' : ''}.`
            : 'Nothing here yet — use Add cards.'}
        </p>
      )}
      {waiting && onBoard.length > 0 && <p className="mt-3 text-xs text-[var(--muted)]">Loading tags…</p>}
      {noTags && <p className="mt-3 text-xs text-[var(--muted)]">None of your own tags yet - the built-in ones are shown; make your own under Your tags on the Plan tab, or open a card to tag it.</p>}
      {groupBy === 'tag' && categories && <p className="mt-3 text-xs text-[var(--muted)]">Your tags first, then the built-in ones from Scryfall (marked auto). A card with several tags is listed under each.</p>}
      {onBoard.length > 0 && !shown.length && !offers.length && <p className="mt-10 text-center text-[var(--muted)]">Nothing here matches that filter.</p>}

      <div {...touchPick} className={`[-webkit-touch-callout:none] ${panel ? 'grid grid-cols-[minmax(0,1fr)_13rem] items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_16rem]' : ''}`}>
      <div className="min-w-0">
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
                      <StackCard key={entry.card.id} entry={entry} first={i === 0} picked={picked.has(entry.card.id)} selecting={selecting} mark={mark?.(entry)} quiet={quietMark(entry)} dim={dims(entry)}
                        onActivate={(e) => activate(entry, e)} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
      // The list runs in two columns on a wide screen, so about 50 cards fit at once; a group stays in one column.
      <div className={prefs.view === 'text' ? 'xl:columns-2 xl:gap-5' : undefined}>
      {columns.map((group) => {
        const shut = folded.has(group.key);
        const heading = groupBy !== 'none' || group.key === 'commander';
        const sums = groupSums(group.items);
        return (
          <section key={group.key} className={prefs.view === 'text' ? 'break-inside-avoid pt-6' : 'mt-6'}>
            {heading && (
              <button onClick={() => fold(group.key)} aria-expanded={!shut} data-section={group.label} data-section-count={group.count}
                className="mb-2 flex w-full items-center gap-2 text-sm font-medium text-[var(--muted)] [break-after:avoid] hover:text-[var(--foreground)]">
                <span aria-hidden className={`inline-block transition-transform ${shut ? '-rotate-90' : ''}`}>▾</span>
                {group.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: group.color }} aria-hidden="true" />}
                <span style={group.color ? { color: group.color } : undefined}>{group.label}</span>
                <span className="tabular-nums">({group.count})</span>
                <span className="ml-auto text-xs font-normal tabular-nums text-[var(--faint)]">
                  {sums.avg !== null && group.key !== 'commander' && <span title="Average mana value of its spells">avg {sums.avg.toFixed(1)} · </span>}${sums.price.toFixed(2)}
                </span>
              </button>
            )}
            {!shut && (prefs.view === 'grid' ? (
              <div data-tour="card-grid" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(var(--card), calc(50% - 6px)), 1fr))' }}>
                {group.items.map((entry) => (
                  <GridCard key={entry.card.id} entry={entry} isDeck={isDeck} picked={picked.has(entry.card.id)} selecting={selecting} mark={mark?.(entry)} quiet={quietMark(entry)} dim={dims(entry)}
                    onActivate={(e) => activate(entry, e)} onQuantity={onQuantity} onMenu={(el) => openMenu(entry, el)} />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                {group.items.map((entry) => (
                  <TextRow key={entry.card.id} entry={entry} isDeck={isDeck} size={size} picked={picked.has(entry.card.id)} selecting={selecting} mark={mark?.(entry)} quiet={quietMark(entry)} dim={dims(entry)}
                    cols={prefs.cols} hoverPicture={!panel}
                    tagDots={isDeck ? (onCard.get(tagKey(entry.card)) ?? []).map(({ tag }) => tag) : []}
                    onActivate={(e) => activate(entry, e)} onQuantity={onQuantity} onMenu={(el) => openMenu(entry, el)} />
                ))}
              </ul>
            ))}
          </section>
        );
      })}
      </div>
      )}
      </div>
      {panel && (
        <SidePanel entries={entries} fallback={onBoard[0]} isDeck={isDeck} moveTo={(e) => tabs.filter((t) => t.id !== e.board)} nameOf={nameOf}
          tags={onCard} onOpen={onSelect} onMove={onMove} onAsk={onAsk} onMenu={openMenu} />
      )}
      </div>

      {selecting && (
        <div data-tour="selection-bar" className="sticky bottom-[calc(var(--nav-h,0px)+5.5rem)] z-20 mt-6 flex items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] sm:flex-wrap sm:whitespace-normal rounded-2xl border border-[var(--accent)]/60 bg-[var(--surface-hover)] p-3 text-sm shadow-xl lg:bottom-4">
          <b className="tabular-nums">{picked.size} selected</b>
          <span className="text-xs text-[var(--muted)] max-sm:hidden">click cards to pick them · shift-click a range · A picks all shown</span>
          {isDeck && tabs.filter((t) => t.id !== board).map((t) => (
            <button key={t.id} disabled={!pickedEntries.length || busy} onClick={() => bulk((e) => onMove(e.card.id, t.id))}
              className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface)] disabled:opacity-40">To {t.name}</button>
          ))}
          {isDeck && (newTag === null ? (
            <select aria-label="Tag the selected cards" disabled={!pickedEntries.length || busy} value=""
              onChange={async (e) => {
                const tagId = e.target.value;
                if (!tagId) return;
                if (tagId === '__new') { setNewTag(''); return; }
                setBusy(true); try { await tagCards(tagId, pickedEntries); stopSelecting(); } finally { setBusy(false); }
              }}
              className="rounded-full border border-[var(--border)] bg-transparent px-3 py-1 disabled:opacity-40">
              <option value="">Tag…</option>
              {accepted.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="__new">New tag…</option>
            </select>
          ) : (
            <form className="flex items-center gap-1" onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try { const id = await makeTag(newTag); if (id) { await tagCards(id, pickedEntries); stopSelecting(); } } finally { setBusy(false); setNewTag(null); }
            }}>
              <input autoFocus value={newTag} onChange={(e) => setNewTag(e.target.value)} maxLength={60} placeholder="New tag" aria-label="New tag name"
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNewTag(null); } }}
                className="w-32 rounded-full border border-[var(--border)] bg-transparent px-3 py-1" />
              <button disabled={busy} className="rounded-full border border-[var(--border)] px-3 py-1">Tag them</button>
            </form>
          ))}
          <button disabled={!pickedEntries.length || busy} onClick={() => bulk((e) => onQuantity(e.card.id, 0))}
            className="rounded-full border border-[var(--border)] px-3 py-1 text-red-300 hover:bg-[var(--surface)] disabled:opacity-40">Remove</button>
          <button onClick={() => (picked.size ? setPicked(new Set()) : stopSelecting())} className="ml-auto rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface)]">
            {picked.size ? 'Clear' : 'Done'} (Esc)
          </button>
        </div>
      )}

      {help && createPortal(
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={() => setHelp(false)}>
          <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}
            className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Keyboard shortcuts</h2>
              <button onClick={() => setHelp(false)} aria-label="Close" className="rounded-lg px-2 text-[var(--muted)] hover:text-[var(--foreground)]">✕</button></div>
            <span className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {SHORTCUTS.map(([k, v]) => <span key={k} className="contents"><kbd className="whitespace-nowrap font-mono text-xs text-[var(--c1)]">{k}</kbd><span className="text-[var(--muted)]">{v}</span></span>)}
            </span>
          </div>
        </div>,
        document.body,
      )}
      {menu && (
        <QuickMenu
          {...menu}
          isDeck={isDeck}
          tags={accepted}
          moveTo={tabs.filter((t) => t.id !== menu.entry.board)}
          slotOptions={isDeck && onSlot && !menu.entry.slot && menu.entry.card.id !== commander?.id ? {
            partner: !!commander && menu.entry.board === 'main' && canPair(commander, menu.entry.card),
            companion: isCompanion(menu.entry.card),
          } : null}
          onSlot={onSlot ? (slot) => onSlot(menu.entry.card.id, slot) : undefined}
          onClose={() => setMenu(null)}
          onOpen={() => onSelect(menu.entry.card)}
          onMove={(b) => onMove(menu.entry.card.id, b)}
          onTag={(tagId) => tagCards(tagId, [menu.entry])}
          onNewTag={async (name) => { const id = await makeTag(name); if (id) await tagCards(id, [menu.entry]); }}
          onKeep={() => api.keepCard(listId, menu.entry.card.oracle_id ?? menu.entry.card.id, true)}
          onAsk={onAsk && !menu.entry.commander ? () => onAsk(`Suggest replacements for ${menu.entry.card.name} that fit the plan.`) : undefined}
          onChangeCommander={menu.entry.commander && !menu.entry.slot ? onChangeCommander : undefined}
          onRemove={() => onQuantity(menu.entry.card.id, 0)}
        />
      )}
    </div>
  );
}

// --- the three views' cards --------------------------------------------------------

type Activate = (e: Pick<React.MouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>) => void;

/** A group's heading numbers: the average mana value of its spells (lands left out), and its price. */
function groupSums(items: Entry[]): { avg: number | null; price: number } {
  let price = 0;
  let mv = 0;
  let spells = 0;
  for (const e of items) {
    price += (priceOf(e.card, e.finish) ?? 0) * e.quantity;
    if (primaryType(e.card) !== 'Lands') { mv += (e.card.cmc ?? 0) * e.quantity; spells += e.quantity; }
  }
  return { avg: spells ? mv / spells : null, price };
}

// The count's colour on a chip for where copies are, as the marks have it (CopyMark).
const CHIP_TONE: Record<string, string> = { inbox: 'text-sky-400', otherdeck: 'text-violet-400', proxy: 'text-amber-300', tobuy: 'text-rose-400' };

// A collection mark that's only a ✓: shown on hover or focus, and not at all on a touch screen.
const quietClass = 'opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(hover:none)]:hidden';

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

function GridCard({ entry, isDeck, picked, selecting, mark, quiet, dim, onActivate, onQuantity, onMenu }: {
  entry: Entry; isDeck: boolean; picked: boolean; selecting: boolean; mark?: React.ReactNode; quiet: boolean; dim: boolean;
  onActivate: Activate; onQuantity: Props['onQuantity']; onMenu: (el: HTMLElement) => void;
}) {
  const { card, quantity } = entry;
  return (
    <div data-card-id={entry.card.id} className={`group group/card relative flex flex-col gap-1 transition-opacity ${dim ? 'opacity-25' : ''}`}>
      <button onClick={(e) => onActivate(e)} aria-pressed={selecting ? picked : undefined}
        aria-label={selecting ? `Pick ${card.name}` : `Show details for ${card.name}`}
        className={`relative block w-full text-left ${selecting ? 'cursor-copy' : ''}`}>
        <Picture card={card} className={picked ? 'outline outline-[3px] -outline-offset-[3px] outline-[var(--accent)]' : ''} />
        <Badge n={quantity} />
        {selecting && <Check on={picked} />}
        {(entry.commander || entry.slot === 'companion') && <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#221c08]">{entry.slot === 'companion' ? 'Companion' : 'Commander'}</span>}
        {card.game_changer && <GameChanger className="absolute bottom-2 right-2" />}
      </button>
      {!selecting && (
        // The quick controls show on hover, or keyboard focus. The commander has no −/+, just its ⋯.
        <div className="absolute right-1.5 top-1.5 z-[2] flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:bottom-[calc(1.75rem+6px)] [@media(hover:none)]:left-1.5 [@media(hover:none)]:right-auto [@media(hover:none)]:top-auto [@media(hover:none)]:opacity-100">
          {!entry.commander && <>
            {/* On touch screens only the ⋯: three buttons on every card covered its text. */}
            <button onClick={() => onQuantity(card.id, quantity - 1)} aria-label={`One fewer ${card.name}`} className="h-7 w-7 rounded-lg bg-black/80 text-sm text-white hover:bg-black [@media(hover:none)]:hidden">−</button>
            <button onClick={() => onQuantity(card.id, quantity + 1)} aria-label={`One more ${card.name}`} className="h-7 w-7 rounded-lg bg-black/80 text-sm text-white hover:bg-black [@media(hover:none)]:hidden">+</button>
          </>}
          <button onClick={(e) => onMenu(e.currentTarget)} aria-label={`More for ${card.name}`} aria-haspopup="menu" className="h-7 w-7 rounded-lg bg-black/80 text-sm text-white hover:bg-black">⋯</button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-0.5 text-xs text-[var(--muted)]">
        {mark && <span className={`flex ${quiet ? quietClass : ''}`}>{mark}</span>}
        <span className="mr-auto truncate">{entry.finish !== 'nonfoil' ? <span className="uppercase">{entry.finish}</span> : isDeck ? '' : card.set?.toUpperCase()}</span>
        <span className="tabular-nums">{money(entry)}</span>
      </div>
    </div>
  );
}

function StackCard({ entry, first, picked, selecting, mark, quiet, dim, onActivate }: {
  entry: Entry; first: boolean; picked: boolean; selecting: boolean; mark?: React.ReactNode; quiet: boolean; dim: boolean; onActivate: Activate;
}) {
  // The mark sits in the name bar's right end, left of the copies badge and the Game Changer badge.
  const right = (entry.card.game_changer ? (entry.quantity > 1 ? 48 : 4) + 42 : 0) || (entry.quantity > 1 ? 34 : 4);
  // Each card shows its name bar - about 13.5% of the card - until the last, shown whole.
  return (
    // A percentage margin is of the column's width, which is the card's: it works at any size.
    // Hovered (or focused), it opens up: the cards under it slide down so the whole card shows (globals.css .stack-card).
    <div style={{ marginTop: first ? 0 : '-120.5%' }} className={`stack-card group/card relative hover:z-10 focus-within:z-10 ${dim ? '[&>button]:brightness-[.35]' : ''}`}>
      <button data-card-id={entry.card.id} onClick={(e) => onActivate(e)} aria-pressed={selecting ? picked : undefined}
        aria-label={selecting ? `Pick ${entry.card.name}` : `Show details for ${entry.card.name}`}
        className={`relative block w-full rounded-[4.75%/3.4%] text-left shadow-[0_-2px_10px_rgba(0,0,0,0.45)] ${selecting ? 'cursor-copy' : ''}`}>
        <Picture card={entry.card} className={picked ? 'outline outline-[3px] -outline-offset-[3px] outline-[var(--accent)]' : ''} />
        <Badge n={entry.quantity} right />
        {entry.card.game_changer && <GameChanger className={`absolute top-1 ${entry.quantity > 1 ? 'right-12' : 'right-1'}`} />}
        {selecting && <Check on={picked} left />}
      </button>
      {mark && !selecting && <span className={`absolute top-1 z-[3] ${quiet ? quietClass : ''}`} style={{ right }}>{mark}</span>}
    </div>
  );
}

function TextRow({ entry, isDeck, size, picked, selecting, mark, quiet, dim, cols, hoverPicture, tagDots, onActivate, onQuantity, onMenu }: {
  entry: Entry; isDeck: boolean; size: number; picked: boolean; selecting: boolean; mark?: React.ReactNode; quiet: boolean; dim: boolean;
  cols: Columns; hoverPicture: boolean; tagDots: Array<{ id: string; name: string; color: string }>;
  onActivate: Activate; onQuantity: Props['onQuantity']; onMenu: (el: HTMLElement) => void;
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
  const type = (entry.card.type_line ?? entry.card.card_faces?.[0]?.type_line ?? '').split(' // ')[0].split(' — ')[0];
  // A deck is mostly one of each: the count shows only when there are more (a list keeps it, since counts are its point).
  const count = isDeck && entry.quantity === 1 ? '' : entry.quantity;
  // The buttons: for the row under the pointer (or focused) with a mouse; just the ⋯ on a touch screen.
  const hoverOnly = '[@media(hover:hover)]:absolute [@media(hover:hover)]:right-2 [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:-translate-y-1/2 [@media(hover:hover)]:hidden [@media(hover:hover)]:group-hover/card:flex [@media(hover:hover)]:group-focus-within/card:flex';
  return (
    <li data-card-id={entry.card.id} className={`group/card relative flex break-inside-avoid items-center gap-2 px-2.5 py-1 text-sm transition-opacity sm:gap-3 sm:px-3 sm:py-0.5 [@media(hover:hover)]:hover:bg-[var(--surface-hover)] ${picked ? 'bg-[var(--accent)]/10' : ''} ${dim ? 'opacity-30' : ''}`}>
      {selecting && (
        <button onClick={(e) => onActivate(e)} aria-pressed={picked} aria-label={`Pick ${entry.card.name}`}
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 text-xs font-extrabold ${picked ? 'border-[var(--accent)] bg-[var(--accent)] text-[#1c0d06]' : 'border-[var(--muted)]'}`}>{picked ? '✓' : ''}</button>
      )}
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">{count}{count !== '' && isDeck ? '×' : ''}</span>
      <button onClick={(e) => onActivate(e)} onPointerEnter={mouseOnly((e) => { if (hoverPicture && !selecting && src) place(e); })} onPointerMove={mouseOnly((e) => { if (preview) place(e); })} onMouseLeave={() => setPreview(null)}
        className="min-w-0 flex-1 truncate text-left hover:text-[var(--accent)]">
        {entry.card.name}
        {entry.finish !== 'nonfoil' && <span className="ml-2 text-[10px] uppercase text-[var(--muted)]">{entry.finish}</span>}
        {entry.slot === 'companion' && <span className="ml-2 text-[10px] font-bold uppercase text-[var(--accent)]">Companion</span>}
      </button>
      {/* Kept small in a row, even on a phone, so the name keeps its room. */}
      {mark && <span className={`flex shrink-0 [&_button]:!h-5 [&_button]:!w-5 [&_button]:!text-[11px] ${quiet ? quietClass : ''}`}>{mark}</span>}
      {entry.card.game_changer && <GameChanger />}
      {cols.tags && tagDots.length > 0 && (
        <span className="hidden items-center gap-1 sm:flex" title={tagDots.map((t) => t.name).join(', ')}>
          {tagDots.map((t) => <span key={t.id} className="h-2 w-2 rounded-full" style={{ background: t.color }} />)}
        </span>
      )}
      {cols.type && <span className="hidden w-24 shrink-0 truncate text-xs text-[var(--muted)] sm:inline">{type}</span>}
      {cols.mana && <span className="flex w-[4.75rem] shrink-0 justify-end max-sm:w-auto"><ManaCost cost={manaCostOf(entry.card)} size={13} /></span>}
      {cols.price && <span className="hidden w-14 shrink-0 text-right tabular-nums text-[var(--muted)] sm:inline">{money(entry)}</span>}
      {!selecting && (!entry.commander || isDeck) && (
        <span className={`flex shrink-0 items-center gap-1 rounded-md bg-[var(--surface-hover)] [@media(hover:hover)]:pl-2 ${hoverOnly}`}>
          {!entry.commander && <>
            <button onClick={() => onQuantity(entry.card.id, entry.quantity - 1)} aria-label={`One fewer ${entry.card.name}`} className={`h-6 w-6 rounded border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] sm:h-5 sm:w-5 sm:leading-none ${isDeck ? '[@media(hover:none)]:hidden' : ''}`}>−</button>
            <button onClick={() => onQuantity(entry.card.id, entry.quantity + 1)} aria-label={`One more ${entry.card.name}`} className={`h-6 w-6 rounded border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] sm:h-5 sm:w-5 sm:leading-none ${isDeck ? '[@media(hover:none)]:hidden' : ''}`}>+</button>
          </>}
          {isDeck && <button onClick={(e) => onMenu(e.currentTarget)} aria-label={`More for ${entry.card.name}`} aria-haspopup="menu" className="h-7 w-7 rounded border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] sm:h-5 sm:w-5 sm:leading-none">⋯</button>}
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

/**
 * The card under the pointer, beside the list on a wide screen: its picture, what it is, and the quick things.
 * It follows the pointer (a store, so the list doesn't redraw); before any hover it shows the first card.
 */
function SidePanel({ entries, fallback, isDeck, moveTo, nameOf, tags, onOpen, onMove, onAsk, onMenu }: {
  entries: Entry[]; fallback?: Entry; isDeck: boolean; moveTo: (e: Entry) => Array<{ id: Board; name: string }>; nameOf: (b: Board) => string;
  tags: ReturnType<typeof tagsByCard>; onOpen: (card: ScryfallCard) => void; onMove: (cardId: string, board: Board) => void;
  onAsk?: (question: string) => void; onMenu: (entry: Entry, el: HTMLElement) => void;
}) {
  const id = useHover();
  const entry = (id ? entries.find((e) => e.card.id === id) : undefined) ?? fallback;
  if (!entry) return null;
  const { card } = entry;
  const src = imageOf(card, 'normal');
  const its = (tags.get(tagKey(card)) ?? []).map(({ tag }) => tag);
  const btn = 'w-full rounded-lg border border-[var(--border)] px-2.5 py-1 text-left text-xs hover:bg-[var(--surface-hover)]';
  return (
    <aside aria-label="The card under the pointer" data-side-panel className="sticky top-28 mt-6 flex flex-col gap-2">
      <button type="button" onClick={() => onOpen(card)} aria-label={`Open ${card.name}`} className="block">
        {src
          ? <Image src={src} alt={card.name} width={488} height={680} className="h-auto w-full rounded-[4.75%/3.4%] shadow-[0_12px_30px_rgba(0,0,0,0.45)]" unoptimized />
          : <span className="flex aspect-[488/680] items-center justify-center rounded-xl border border-[var(--border)] p-3 text-center text-sm">{card.name}</span>}
      </button>
      <div>
        <p className="font-semibold leading-tight">{card.name}</p>
        <p className="text-xs text-[var(--muted)]">{card.type_line ?? card.card_faces?.[0]?.type_line} · {money(entry)}{entry.finish !== 'nonfoil' ? ` · ${entry.finish}` : ''}{isDeck && entry.board !== 'main' ? ` · ${nameOf(entry.board)}` : ''}</p>
      </div>
      {its.length > 0 && (
        <p className="flex flex-wrap gap-1">{its.map((t) => <span key={t.id} className="flex items-center gap-1 rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] text-[var(--muted)]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />{t.name}</span>)}</p>
      )}
      <div className="flex flex-col gap-1">
        {isDeck && !entry.commander && moveTo(entry).slice(0, 2).map((t) => (
          <button key={t.id} type="button" className={btn} onClick={() => onMove(card.id, t.id)}>To {t.name}</button>
        ))}
        {onAsk && !entry.commander && <button type="button" className={btn} onClick={() => onAsk(`Suggest replacements for ${card.name} that fit the plan.`)}>Find a replacement</button>}
        <button type="button" className={btn} onClick={(e) => onMenu(entry, e.currentTarget)} aria-haspopup="menu">More…</button>
      </div>
      <p className="text-[11px] text-[var(--faint)]">Follows the pointer. Turn it off under View.</p>
    </aside>
  );
}

/** Group or Sort: a small select that reads as a chip. */
function Pick<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: Array<[T, string]>; onPick: (v: T) => void }) {
  return (
    <label className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-3 text-sm text-[var(--muted)]">
      {label}
      <select value={value} onChange={(e) => onPick(e.target.value as T)} aria-label={label}
        className="cursor-pointer rounded-full bg-transparent py-1.5 pl-1 pr-2 text-[var(--foreground)] outline-none">
        {options.map(([v, text]) => <option key={v} value={v} className="bg-[var(--surface)]">{text}</option>)}
      </select>
    </label>
  );
}

/** A Game Changer: a card on the list that decides which brackets a deck can be in. */
function GameChanger({ className = '' }: { className?: string }) {
  return (
    <span title="Game Changer: a card that pushes a deck toward the higher brackets. Bracket 3 allows up to three; brackets 1 and 2 allow none."
      className={`pointer-events-none z-[2] inline-flex shrink-0 items-center gap-0.5 rounded-md border border-[#f08bb4]/60 bg-black/75 px-1.5 text-[10px] font-bold leading-[18px] text-[#f5a3c4] ${className}`}>
      <span aria-hidden>◆</span> GC<span className="sr-only"> (Game Changer)</span>
    </span>
  );
}

// --- sections --------------------------------------------------------------------

const PURPOSE_ORDER: Purpose[] = ['in', 'out', 'list'];

function PurposeHelp() {
  return (
    <Tip label="What a section's purpose does">
      <span className="flex flex-col gap-1.5">
        {PURPOSE_ORDER.map((p) => <span key={p}><b>{PURPOSES[p].label}:</b> {PURPOSES[p].why}</span>)}
        <span className="text-[var(--muted)]">Only Main is the deck. The name is yours; the purpose is how tuning treats the section.</span>
      </span>
    </Tip>
  );
}

/** "+ Section": a name and a purpose, made at once. */
function NewSection({ listId, onMade }: { listId: string; onMade: (sections: DeckSection[], made: Board) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('list');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) {
    return <button onClick={() => setOpen(true)} className="mb-1 ml-1 shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-sm text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">＋ Section</button>;
  }
  const make = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { section, sections } = await api.addSection(listId, name, purpose);
      onMade(sections, section.id);
      setOpen(false);
      setName('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add it'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={make} className="mb-1 ml-1 flex shrink-0 items-center gap-1.5 text-sm">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wishlist" aria-label="Section name" maxLength={40} autoFocus
        className="w-32 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 outline-none focus:border-[var(--c1)]" />
      <select value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)} aria-label="What it's for"
        className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
        {PURPOSE_ORDER.map((p) => <option key={p} value={p}>{PURPOSES[p].label}</option>)}
      </select>
      <PurposeHelp />
      <button disabled={busy || !name.trim()} className="rounded-lg bg-[var(--accent)] px-2.5 py-1 font-semibold text-[#221c08] disabled:opacity-50">Add</button>
      <button type="button" onClick={() => { setOpen(false); setError(null); }} className="px-1 text-[var(--muted)]">Cancel</button>
      {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
    </form>
  );
}

/** The open section's name, purpose and, for the owner's own, delete - with the confirm on the page. */
function SectionTools({ listId, section, count, maybeName, onChanged, onDeleted }: {
  listId: string; section: DeckSection; count: number; maybeName: string; onChanged: (sections: DeckSection[]) => void; onDeleted: () => void;
}) {
  const [name, setName] = useState(section.name);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (change: { name?: string; purpose?: Purpose }) => {
    setError(null);
    try { onChanged((await api.changeSection(listId, section.id, change)).sections); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save it'); }
  };
  const remove = async () => {
    try { const { sections } = await api.deleteSection(listId, section.id); onDeleted(); onChanged(sections); } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete it'); }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <label className="flex items-center gap-1.5 text-[var(--muted)]">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== section.name) void save({ name }); else setName(section.name); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} maxLength={40} aria-label="Section name"
          className="w-36 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[var(--foreground)] outline-none focus:border-[var(--c1)]" />
      </label>
      <label className="flex items-center gap-1.5 text-[var(--muted)]">
        For
        <select value={section.purpose} onChange={(e) => void save({ purpose: e.target.value as Purpose })} aria-label="What this section is for"
          className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[var(--foreground)]">
          {PURPOSE_ORDER.map((p) => <option key={p} value={p}>{PURPOSES[p].label}</option>)}
        </select>
        <PurposeHelp />
      </label>
      {!section.builtIn && (confirming ? (
        <span className="flex flex-wrap items-center gap-2">
          <span>Delete {section.name}?{count ? ` Its ${count} card${count === 1 ? '' : 's'} move to ${maybeName}.` : ''}</span>
          <button onClick={remove} className="rounded-lg border border-red-400/60 px-2.5 py-1 text-red-300 hover:bg-red-400/10">Delete</button>
          <button onClick={() => setConfirming(false)} className="px-1 text-[var(--muted)]">Keep it</button>
        </span>
      ) : <button onClick={() => (count ? setConfirming(true) : void remove())} className="text-[var(--muted)] hover:text-red-300">Delete section</button>)}
      {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

// --- a card's ⋯ ---------------------------------------------------------------------

function QuickMenu({ entry, x, y, up, isDeck, tags, moveTo, slotOptions, onSlot, onClose, onOpen, onMove, onTag, onNewTag, onKeep, onAsk, onRemove, onChangeCommander }: {
  entry: Entry; x: number; y: number; up: boolean; isDeck: boolean; tags: Array<{ id: string; name: string }>;
  moveTo: Array<{ id: Board; name: string }>; slotOptions: { partner: boolean; companion: boolean } | null; onSlot?: (slot: Slot | null) => void;
  onClose: () => void; onOpen: () => void; onMove: (b: Board) => void; onTag: (tagId: string) => Promise<void> | void; onNewTag: (name: string) => Promise<void>;
  onKeep: () => Promise<unknown> | void; onAsk?: () => void; onRemove: () => void; onChangeCommander?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tagging, setTagging] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
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
      // Never taller than the room it has: above the phone's bottom bar, below the top of the screen.
      style={{ left: x, top: up ? undefined : y, bottom: up ? window.innerHeight - y + 40 : undefined,
        maxHeight: up ? y - 48 : window.innerHeight - y - (window.innerWidth < 1024 ? 96 : 8) }}
      className="fixed z-[85] w-56 overflow-y-auto overscroll-contain rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-1 shadow-xl">
      <button role="menuitem" className={item} onClick={act(onOpen)}>Open {entry.card.name.split(' // ')[0]}</button>
      <hr className="my-1 border-[var(--border)]" />
      {isDeck && !entry.commander && moveTo.map((t) => (
        <button key={t.id} role="menuitem" className={item} onClick={act(() => onMove(t.id))}>Move to {t.name}</button>
      ))}
      {onSlot && slotOptions?.partner && <button role="menuitem" className={item} onClick={act(() => onSlot('partner'))}>Make it the second commander</button>}
      {onSlot && slotOptions?.companion && <button role="menuitem" className={item} onClick={act(() => onSlot('companion'))}>Make it the companion</button>}
      {onSlot && entry.slot && (
        <button role="menuitem" className={item} onClick={act(() => onSlot(null))}>
          {entry.slot === 'partner' ? 'Not a commander: back to the 99' : 'Not the companion'}
        </button>
      )}
      {isDeck && (tagging ? (
        <div className="max-h-56 overflow-y-auto border-y border-[var(--border)] py-1">
          {tags.map((t) => <button key={t.id} role="menuitem" className={`${item} pl-6`} onClick={act(() => onTag(t.id))}>{t.name}</button>)}
          {naming === null
            ? <button role="menuitem" className={`${item} pl-6 text-[var(--muted)]`} onClick={() => setNaming('')}>New tag…</button>
            : (
              <form className="flex gap-1 px-2 py-1" onSubmit={async (e) => { e.preventDefault(); if (naming.trim()) { await onNewTag(naming); onClose(); } }}>
                <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} maxLength={60} placeholder="New tag" aria-label="New tag name"
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm" />
                <button className="rounded-lg border border-[var(--border)] px-2 text-sm">Add</button>
              </form>
            )}
        </div>
      ) : <button role="menuitem" className={item} onClick={() => setTagging(true)}>Add a tag ▸</button>)}
      {isDeck && !entry.commander && <button role="menuitem" className={item} onClick={async () => { await onKeep(); setDone('Kept: never offered as a cut'); setTimeout(onClose, 900); }}>Never cut this ★</button>}
      <button role="menuitem" className={item} onClick={act(onOpen)}>Change printing or finish…</button>
      {onAsk && <button role="menuitem" className={item} onClick={act(onAsk)}>Find a replacement</button>}
      {onChangeCommander && <button role="menuitem" className={item} onClick={act(onChangeCommander)}>Change commander…</button>}
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

