'use client';

/**
 * Your decks, sorted and filtered, and a new one: a name, a commander
 * picked from a search, and optionally a pasted list or an Archidekt link.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import CommanderPicker from '@/components/CommanderPicker';
import { DECK_DRAG, FolderPill, FolderRail, type FolderPick, type FolderProps } from '@/components/DeckFolders';
import EmptyState from '@/components/EmptyState';
import ImportResult from '@/components/ImportResult';
import ManaCost, { IdentitySymbols } from '@/components/ManaCost';
import MoreMenu from '@/components/MoreMenu';
import PasteFormats from '@/components/PasteFormats';
import StickyBar from '@/components/StickyBar';
import * as api from '@/lib/api';
import type { List } from '@/lib/db';
import { MOXFIELD_REFUSES, readDeckBox } from '@/lib/deck-links';
import { parseDecklist } from '@/lib/decklist';
import { identityStyle, MANA } from '@/lib/identity';
import type { ImportSummary } from '@/lib/import-into';
import { imageOf } from '@/lib/scryfall';
import { useNavBottom } from '@/lib/use-nav-bottom';

type Sort = 'recent' | 'name' | 'commander' | 'price' | 'created';
const SORTS: Array<[Sort, string]> = [['recent', 'Recently edited'], ['name', 'Name'], ['commander', 'Commander'], ['price', 'Price'], ['created', 'Newest']];
const COLOURS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
// How the grid is sorted and which colours it shows, remembered in this browser.
const VIEW_KEY = 'mtg-decks-view';
interface View { sort: Sort; colours: string[]; short: boolean; folder: FolderPick }
const DEFAULT_VIEW: View = { sort: 'recent', colours: [], short: false, folder: 'all' };

function loadView(): View {
  try { return { ...DEFAULT_VIEW, ...(JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<View> | null) }; } catch { return DEFAULT_VIEW; }
}

/** The decks the toolbar lets through, in its order. Colours: the deck has every one picked; C is colourless. */
function shownDecks(decks: List[], view: View, query: string, placed: Record<string, string>): List[] {
  const q = query.trim().toLowerCase();
  const out = decks.filter((d) => {
    if (view.folder === 'none' ? !!placed[d.id] : view.folder !== 'all' && placed[d.id] !== view.folder) return false;
    if (q && !d.name.toLowerCase().includes(q) && !(d.commander?.name.toLowerCase().includes(q))) return false;
    if (view.short && d.totalCards === 100) return false;
    const id = d.commander?.color_identity ?? [];
    if (view.colours.includes('C')) return id.length === 0 && view.colours.length === 1;
    return view.colours.every((c) => id.includes(c));
  });
  const by: Record<Sort, (a: List, b: List) => number> = {
    recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    name: (a, b) => a.name.localeCompare(b.name),
    commander: (a, b) => (a.commander?.name ?? '~').localeCompare(b.commander?.name ?? '~') || a.name.localeCompare(b.name),
    price: (a, b) => b.totalValue - a.totalValue,
  };
  return out.sort(by[view.sort]);
}

/** The label that rides the pointer while a deck is dragged: its colours and name. */
function dragChip(name: string, identity: string[]): HTMLElement {
  const colours = 'WUBRG'.split('').filter((c) => identity.includes(c)).map((c) => MANA[c]);
  const chip = document.createElement('div');
  chip.style.cssText = 'position:fixed;top:-1000px;left:-1000px;display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;'
    + 'background:#221f1b;border:1px solid #d6aa2e;color:#f0e9dd;font:600 13px Figtree,system-ui,sans-serif;white-space:nowrap;max-width:240px;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  const dot = document.createElement('span');
  dot.style.cssText = `width:12px;height:12px;border-radius:4px;flex-shrink:0;background:${colours.length > 1 ? `linear-gradient(90deg,${colours.join(',')})` : colours[0] ?? '#6c655b'}`;
  const label = document.createElement('span');
  label.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
  label.textContent = name;
  chip.append(dot, label);
  document.body.append(chip);
  return chip;
}

export default function DecksPage() {
  const router = useRouter();
  // Shown at once from last time, then refreshed.
  const [decks, setDecks] = useState<List[]>(() => api.peekLists('deck') ?? []);
  const [loading, setLoading] = useState(() => !api.peekLists('deck'));
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [commander, setCommander] = useState<api.CommanderOption | null>(null);
  const [decklist, setDecklist] = useState('');
  // A suggested first list when starting from a commander with nothing pasted.
  const [starter, setStarter] = useState(true);
  const [ownedFirst, setOwnedFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<{ id: string; result: ImportSummary } | null>(null);
  const [view, setView] = useState<View>(() => (typeof window === 'undefined' ? DEFAULT_VIEW : loadView()));
  const [query, setQuery] = useState('');
  const changeView = (patch: Partial<View>) => setView((v) => {
    const next = { ...v, ...patch };
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(next)); } catch { /* fine */ }
    return next;
  });
  // Folders, and which one each deck is in.
  const [folders, setFolders] = useState<api.DeckFolders>(() => api.peek<api.DeckFolders>(api.paths.folders) ?? { folders: [], placed: {} });
  const [naming, setNaming] = useState(false);
  // A deck waiting for the folder being named ("New folder with this deck").
  const [toFile, setToFile] = useState<string | null>(null);
  const placed = folders.placed;
  // A folder that is gone (deleted elsewhere) shows everything.
  const folderPick: FolderPick = view.folder === 'all' || view.folder === 'none' || folders.folders.some((f) => f.id === view.folder) ? view.folder : 'all';
  const shown = shownDecks(decks, { ...view, folder: folderPick }, query, placed);
  const filtered = !!query.trim() || view.colours.length > 0 || view.short;
  const counts = {
    all: decks.length,
    none: decks.filter((d) => !placed[d.id]).length,
    byFolder: decks.reduce<Record<string, number>>((n, d) => { if (placed[d.id]) n[placed[d.id]] = (n[placed[d.id]] ?? 0) + 1; return n; }, {}),
  };
  // Where the top bar ends: the folder rail sits just under it.
  const navHeight = useNavBottom();
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The deck being dragged to a folder: it dims, and the folders show they take it.
  const [dragging, setDragging] = useState<string | null>(null);
  // The deck under the pointer tints the page behind the grid.
  const [glow, setGlow] = useState<string[] | null>(null);
  const folderColours: Record<string, string[]> = { all: [], none: [] };
  for (const d of decks) {
    const keys = ['all', placed[d.id] ?? 'none'];
    for (const k of keys) folderColours[k] = [...new Set([...(folderColours[k] ?? []), ...(d.commander?.color_identity ?? [])])];
  }
  const refreshFolders = () => api.fetchFolders().then(setFolders).catch(() => {});
  const fileDeck = async (deckId: string, folderId: string | null) => {
    // Shown moved at once; the answer confirms it.
    setFolders((f) => {
      const next = { ...f.placed };
      if (folderId) next[deckId] = folderId; else delete next[deckId];
      return { ...f, placed: next };
    });
    try { await api.placeDeck(deckId, folderId); } catch (e) { setError(e instanceof Error ? e.message : 'Could not move that deck'); }
    await refreshFolders();
  };

  useEffect(() => {
    api.fetchLists('deck').then(setDecks).catch((e) => setError(e.message)).finally(() => setLoading(false));
    api.fetchFolders().then(setFolders).catch(() => {});
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    // A link or a list brings its own name (a list takes its commander's).
    const deckName = name.trim() || commander?.name || (box.kind === 'link' || box.kind === 'list' ? '' : null);
    if (deckName === null || deckName === undefined) { setError('Pick a commander, or paste a list or a link'); return; }
    setBusy(true);
    setError(null);
    try {
      const { list, imported: result } = await api.createDeck(deckName, commander, decklist,
        commander && !decklist.trim() && starter ? { ownedFirst } : undefined);
      // Made while a folder is open: it goes in that folder.
      if (folderPick !== 'all' && folderPick !== 'none') await api.placeDeck(list.id, folderPick).then(refreshFolders).catch(() => {});
      // Show what an import did before moving on; otherwise go straight in.
      if (result && (result.missing.length || result.unreadable.length || result.outvoted)) {
        setDecks((prev) => [...prev, list]);
        setImported({ id: list.id, result });
      } else {
        router.push(`/decks/${list.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that deck');
    } finally {
      setBusy(false);
    }
  };

  const box = readDeckBox(decklist);
  const moxfield = box.kind === 'link' && box.link!.site === 'moxfield';
  // The list's own Commander line, to warn when a different commander is picked.
  const listCommander = box.kind === 'list' ? parseDecklist(decklist).entries.find((e) => e.section === 'commander')?.name ?? null : null;
  const clash = !!commander && !!listCommander && listCommander.split(' // ')[0].toLowerCase() !== commander.name.split(' // ')[0].toLowerCase();
  const blocked = box.kind === 'both' || box.kind === 'links' || box.kind === 'unknown-link' || moxfield;

  const folderProps: FolderProps = {
    folders: folders.folders, counts, colours: folderColours, active: folderPick,
    onPick: (folder) => changeView({ folder }),
    naming, setNaming: (on) => { setNaming(on); if (!on) setToFile(null); },
    onCreate: async (folderName) => {
      try {
        const folder = await api.createFolder(folderName);
        if (toFile) await api.placeDeck(toFile, folder.id);
        setToFile(null);
        await refreshFolders();
        changeView({ folder: folder.id });
        return null;
      } catch (e) { return e instanceof Error ? e.message : 'Could not make that folder'; }
    },
    onRename: async (id, folderName) => {
      try { await api.renameFolder(id, folderName); await refreshFolders(); return null; } catch (e) { return e instanceof Error ? e.message : 'Could not rename that folder'; }
    },
    onDelete: async (id) => { await api.deleteFolder(id); changeView({ folder: 'all' }); await refreshFolders(); },
    onDrop: (deckId, folderId) => void fileDeck(deckId, folderId),
  };
  const colourButtons = (
    <div role="group" aria-label="Colours" className="flex items-center gap-1">
      {COLOURS.map((c) => {
        const on = view.colours.includes(c);
        return (
          <button
            key={c}
            aria-pressed={on}
            title={c === 'C' ? 'Colourless' : `Has ${c}`}
            aria-label={c === 'C' ? 'Colourless' : `Has ${c}`}
            onClick={() => changeView({ colours: on ? view.colours.filter((x) => x !== c) : c === 'C' ? ['C'] : [...view.colours.filter((x) => x !== 'C'), c] })}
            // On, a colour lights up in its own colour.
            style={on ? { borderColor: MANA[c], background: `color-mix(in srgb, ${MANA[c]} 26%, var(--surface))`, boxShadow: `0 0 12px color-mix(in srgb, ${MANA[c]} 50%, transparent)` } : undefined}
            className={`rounded-full border p-1 transition ${on ? '' : 'border-transparent opacity-55 hover:opacity-100'}`}
          >
            <ManaCost cost={`{${c}}`} size={18} />
          </button>
        );
      })}
    </div>
  );
  const notHundred = (
    <label className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border)] px-3 py-1.5 text-xs">
      <input type="checkbox" checked={view.short} onChange={(e) => changeView({ short: e.target.checked })} />
      Not 100 yet
    </label>
  );
  const sortSelect = (
    <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
      Sort
      <select
        value={view.sort}
        onChange={(e) => changeView({ sort: e.target.value as Sort })}
        className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--foreground)]"
      >
        {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
  );
  const narrowed = view.colours.length + (view.short ? 1 : 0);

  return (
    <div>
      {/* The deck under the pointer tints the page, faintly. */}
      <div
        aria-hidden
        style={identityStyle(glow ?? [])}
        className={`pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(70rem_45rem_at_20%_15%,color-mix(in_srgb,var(--c1)_14%,transparent),transparent_70%),radial-gradient(60rem_40rem_at_85%_90%,color-mix(in_srgb,var(--c3)_11%,transparent),transparent_70%)] transition-opacity duration-500 ${glow?.length ? 'opacity-100' : 'opacity-0'}`}
      />
      <div className={decks.length ? 'lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-6' : ''}>
        {decks.length > 0 && (
          // Beside the decks on wide screens, staying put as they scroll.
          <aside className="hidden lg:sticky lg:block" style={{ top: navHeight + 16 }}>
            <FolderRail {...folderProps} dragging={!!dragging} />
          </aside>
        )}
        <div className="min-w-0">
          <div>
            <h1 className="font-display text-3xl font-extrabold">{folderPick === 'all' ? 'Decks' : folderPick === 'none' ? 'Unfiled' : folders.folders.find((f) => f.id === folderPick)?.name ?? 'Decks'}</h1>
            {decks.length > 0 && (
              <p className="mt-1 text-sm text-[var(--muted)] tabular-nums">
                {decks.length} deck{decks.length === 1 ? '' : 's'} · ${decks.reduce((n, d) => n + d.totalValue, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} in all
                {decks.some((d) => d.totalCards < 100) && <> · {decks.filter((d) => d.totalCards < 100).length} short of 100</>}
              </p>
            )}
          </div>

          {/* One toolbar, the same at the top and once scrolled: it sticks under the nav and takes a backdrop. */}
          <StickyBar data-tour="deck-sort" className="mt-2" rowClassName="flex items-center gap-2 py-2.5 text-sm">
            {decks.length > 0 && <div className="lg:hidden"><FolderPill {...folderProps} /></div>}
            {decks.length > 0 && (
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a deck"
                aria-label="Find a deck or commander"
                className="min-h-10 w-full min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 outline-none focus:border-[var(--accent)] sm:max-w-64 sm:flex-none lg:min-h-0"
              />
            )}
            {decks.length > 0 && <div className="hidden items-center gap-2 md:flex">{colourButtons}{notHundred}</div>}
            {decks.length > 0 && <div className="ml-auto hidden md:block">{sortSelect}</div>}
            {decks.length > 0 && (
              <button
                onClick={() => setFiltersOpen(true)}
                aria-label={narrowed ? `Filter and sort (${narrowed} on)` : 'Filter and sort'}
                className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-[var(--surface)] md:hidden ${narrowed ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                {narrowed > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-[#221c08]">{narrowed}</span>}
              </button>
            )}
            {!creating && (decks.length > 0 || loading) && (
              <button data-tour="new-deck" onClick={() => setCreating(true)} aria-label="New deck" className={`btn-go flex shrink-0 items-center justify-center rounded-full font-semibold max-md:h-10 max-md:w-10 md:px-4 md:py-2 ${decks.length ? '' : 'ml-auto'}`}>
                ＋<span className="max-md:hidden">&nbsp;New deck</span>
              </button>
            )}
          </StickyBar>
          {filtered && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              {shown.length ? `Showing ${shown.length} of ${folderPick === 'all' ? decks.length : folderPick === 'none' ? counts.none : counts.byFolder[folderPick] ?? 0}.` : 'No decks match.'}{' '}
              <button onClick={() => { setQuery(''); changeView({ colours: [], short: false }); }} className="underline hover:text-[var(--foreground)]">Clear</button>
            </p>
          )}

          {creating && (
            <form onSubmit={create} className="mt-4 flex max-w-3xl flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/50 p-5">
              <h2 className="font-display text-lg font-bold">New deck</h2>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--muted)]">Commander</span>
                <CommanderPicker value={commander} onChange={setCommander} autoFocus />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--muted)]">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={commander?.name ?? 'Defaults to the commander’s name'}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-base outline-none focus:border-[var(--accent)]"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-[var(--muted)]">
                  Bring a deck <span className="opacity-70">(optional) - an Archidekt link or a pasted list. From Moxfield, paste its Export.</span>{' '}
                  <PasteFormats />
                </span>
                <textarea
                  value={decklist}
                  onChange={(e) => { setDecklist(e.target.value); setError(null); }}
                  // Short while empty - it is optional - and growing with what is pasted.
                  rows={decklist.trim() ? Math.min(18, Math.max(6, decklist.split('\n').length + 1)) : 4}
                  placeholder={'https://archidekt.com/decks/…\n\nor a list:\n1 Sol Ring\n1 Lightning Bolt *F*\n…'}
                  spellCheck={false}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 font-mono text-xs outline-none focus:border-[var(--accent)]"
                />
                {box.kind === 'link' && !moxfield && (
                  <span data-tour="deck-link" className="text-xs text-emerald-400">
                    An Archidekt link: the deck - its name, commander, boards and printings - is fetched when you create it. Public and unlisted decks only.
                  </span>
                )}
                {blocked && (
                  <span role="alert" className="text-xs text-amber-300">
                    {moxfield ? MOXFIELD_REFUSES
                      : box.kind === 'both' ? 'There is a link and a list here. Remove one of them - the deck comes from the link or from the list, not both.'
                      : box.kind === 'links' ? 'There are two links here. Keep the one for this deck.'
                        : 'That link is not one I can read (Archidekt links are). Paste the list instead.'}
                  </span>
                )}
                {!commander && box.kind === 'list' && (
                  <span className="text-xs text-[var(--muted)]">
                    No commander picked: {listCommander ? <>the list&apos;s commander, {listCommander}, is used</> : <>the list&apos;s first card is used if it can be a commander - otherwise you can pick one from the deck&apos;s legendary cards afterwards</>}.
                    {!name.trim() && ' The deck is named after its commander.'}
                  </span>
                )}
                {clash && (
                  <span className="text-xs text-amber-300">
                    The list names {listCommander} as its commander, but you picked {commander!.name}. Yours is used, and {listCommander} goes in the deck as a card.
                  </span>
                )}
              </label>
              {commander && !decklist.trim() && (
                <div data-tour="starter" className="flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={starter} onChange={(e) => setStarter(e.target.checked)} className="mt-1" />
                    <span>
                      Start with a suggested list
                      <span className="block text-xs text-[var(--muted)]">
                        About 99 cards: ramp, draw, removal and protection first, then what fits {commander.name.split(',')[0]} best, and lands
                        for its colours. No AI, no Game Changers - a starting point to tune on the Tune tab.
                      </span>
                    </span>
                  </label>
                  {starter && (
                    <label className="ml-6 flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={ownedFirst} onChange={(e) => setOwnedFirst(e.target.checked)} />
                      Cards I own first
                    </label>
                  )}
                </div>
              )}
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  disabled={busy || blocked}
                  className="btn-go rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  {busy ? (box.kind === 'link' ? 'Fetching the deck…' : decklist.trim() ? 'Importing…' : 'Creating…') : 'Create deck'}
                </button>
                <button
                  type="button"
                  onClick={() => { setCreating(false); setError(null); }}
                  className="rounded-full px-4 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {imported && (
            <div className="mt-4">
              <ImportResult result={imported.result} />
              <Link href={`/decks/${imported.id}`} className="mt-2 inline-block text-sm text-[var(--accent)] underline">
                Open the deck →
              </Link>
            </div>
          )}

          {!creating && error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          {loading && <p className="mt-8 text-[var(--muted)]">Loading…</p>}
          {!loading && !decks.length && !creating && (
            <EmptyState
              title="Build your first deck"
              actions={<button onClick={() => setCreating(true)} className="btn-go rounded-full px-5 py-2 text-sm font-semibold">＋ New deck</button>}
            >
              Pick a commander and start from a suggested list, or bring a deck you already have - paste its list or an Archidekt link.
              <p className="mt-3 text-xs">New here? The <span className="rounded-full border border-[var(--border)] px-1.5">?</span> at the top walks you through a sample deck.</p>
            </EmptyState>
          )}
          {!loading && decks.length > 0 && !shown.length && !filtered && (
            <p className="mt-6 rounded-2xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--muted)]">
              {folderPick === 'none' ? 'Every deck is in a folder.' : 'Nothing in this folder yet. Drag a deck onto it, or use a deck’s ⋯ → Move to.'}
            </p>
          )}
          <div data-tour="deck-grid" className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] sm:gap-3">
        {shown.map((deck) => {
          const art = deck.commander ? deck.commander.image_uris?.art_crop ?? deck.commander.card_faces?.[0]?.image_uris?.art_crop ?? imageOf(deck.commander, 'normal') : null;
          const total = deck.totalCards;
          const identity = deck.commander?.color_identity ?? [];
          return (
            // Each deck in its commander's colours, its art on the cover; its ⋯ sits beside the link, not in it.
            <div
              key={deck.id}
              className={`relative transition-opacity ${dragging === deck.id ? 'opacity-40' : ''}`}
              onMouseEnter={() => setGlow(identity)}
              onMouseLeave={() => setGlow(null)}
              // Dragged onto a folder in the rail, it goes in it.
              onDragStart={(e) => {
                e.dataTransfer.setData(DECK_DRAG, deck.id);
                e.dataTransfer.effectAllowed = 'move';
                // A small label rides the pointer instead of a ghost of the whole tile.
                const chip = dragChip(deck.name, identity);
                e.dataTransfer.setDragImage(chip, 14, 16);
                setTimeout(() => chip.remove(), 0);
                setDragging(deck.id);
              }}
              onDragEnd={() => setDragging(null)}
            >
            <Link
              href={`/decks/${deck.id}`}
              style={identityStyle(identity)}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--c1)_30%,var(--border))] bg-[var(--surface)] bg-[linear-gradient(105deg,color-mix(in_srgb,var(--c1)_15%,var(--surface)),color-mix(in_srgb,var(--c2)_15%,var(--surface))_55%,color-mix(in_srgb,var(--c3)_15%,var(--surface)))] transition-[border-color,box-shadow] duration-200 hover:border-[color-mix(in_srgb,var(--c1)_60%,var(--border))] hover:shadow-[0_10px_28px_color-mix(in_srgb,var(--c1)_22%,transparent)]"
            >
              {/* Nothing on the tile moves or is filtered on hover - a lift, a scale or a brightness filter
                  each left seams on the art's edges; the border and glow show it instead.
                  The art is framed from near its top, where the faces are. */}
              <div className="relative h-24 overflow-hidden [mask-image:linear-gradient(to_bottom,black_58%,transparent)] sm:h-36">
                {art ? <Image src={art} alt="" width={626} height={457} draggable={false} className="absolute inset-0 h-full w-full object-cover object-[50%_22%]" unoptimized />
                  : <div aria-hidden className="id-glow absolute -inset-6 blur-xl" />}
                {/* Only the art's bottom fades, under the name, into the tile's own colours (a shade over all of it washed it out). */}
                <span className="absolute left-2.5 top-2.5 sm:left-3 sm:top-3"><IdentitySymbols identity={identity.join('')} size={16} /></span>
              </div>
              <div className="relative -mt-4 flex flex-1 flex-col gap-0.5 px-2.5 pb-2.5 sm:-mt-5 sm:px-3.5 sm:pb-3.5">
                <p className="truncate font-display text-sm font-extrabold leading-tight sm:text-lg" title={deck.name}>{deck.name}</p>
                <p className="truncate text-xs text-[var(--muted)] sm:text-sm">{deck.commander?.name ?? 'No commander'}</p>
                <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-bold tabular-nums sm:mt-1.5 sm:gap-1.5 sm:text-xs">
                  <span className={`rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 ${total === 100 ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{total} / 100</span>
                  {deck.totalValue > 0 && <span className="rounded-full bg-white/5 px-2 py-0.5 sm:px-2.5 sm:py-1">${deck.totalValue.toFixed(2)}</span>}
                </div>
              </div>
              {/* The colour bar glows brighter under the pointer. */}
              <div aria-hidden className="id-grad h-1 shadow-[0_-4px_16px_color-mix(in_srgb,var(--c2)_45%,transparent)] transition-[height,box-shadow] duration-200 group-hover:h-[7px] group-hover:shadow-[0_-6px_24px_color-mix(in_srgb,var(--c2)_75%,transparent)] sm:h-[5px]" />
            </Link>
            <div data-tour="deck-tile-more" className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/45 backdrop-blur sm:right-2 sm:top-2">
              <MoreMenu
                label={`More for ${deck.name}`}
                items={[
                  { label: 'Duplicate', onClick: async () => { await api.duplicateList(deck.id); setDecks(await api.fetchLists('deck')); await refreshFolders(); } },
                  // Up to three folders are listed here; more go behind "Move to folder ›", in a list that scrolls.
                  ...(() => {
                    const others = folders.folders.filter((f) => f.id !== placed[deck.id]).map((f) => ({ label: f.name, onClick: () => fileDeck(deck.id, f.id) }));
                    return others.length > 3 ? [{ label: 'Move to folder', submenu: others }] : others.map((o) => ({ ...o, label: `Move to ${o.label}` }));
                  })(),
                  ...(placed[deck.id] ? [{ label: `Take out of ${folders.folders.find((f) => f.id === placed[deck.id])?.name ?? 'its folder'}`, onClick: () => fileDeck(deck.id, null) }] : []),
                  { label: folders.folders.length ? 'New folder with this deck…' : 'Put in a new folder…', onClick: () => { setToFile(deck.id); setNaming(true); } },
                  {
                    label: 'Delete deck…',
                    danger: true,
                    confirm: `Delete “${deck.name}”? Copies pulled from boxes go back to them.`,
                    onClick: async () => { await api.deleteList(deck.id); setDecks((all) => all.filter((d) => d.id !== deck.id)); },
                  },
                ]}
              />
            </div>
            </div>
          );
        })}
          </div>
        </div>
      </div>

      {filtersOpen && createPortal(
        // Phones: the colours, Not 100 yet and Sort in a sheet.
        <div role="dialog" aria-label="Filter and sort" className="fixed inset-0 z-[70] flex flex-col justify-end">
          <button aria-label="Close" onClick={() => setFiltersOpen(false)} className="flex-1 bg-black/55" />
          <div className="flex flex-col gap-4 rounded-t-3xl border-t border-[var(--border)] bg-[var(--surface)] px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2.5">
            <span aria-hidden className="mx-auto block h-1 w-10 rounded-full bg-[var(--border)]" />
            <div className="flex flex-col gap-2"><span className="text-[11px] font-bold uppercase tracking-wider text-[var(--faint)]">Colours</span>{colourButtons}</div>
            <div className="flex items-center justify-between gap-3">{notHundred}{sortSelect}</div>
            <div className="flex gap-2">
              <button onClick={() => changeView({ colours: [], short: false })} className="min-h-11 flex-1 rounded-xl border border-[var(--border)]">Clear</button>
              <button onClick={() => setFiltersOpen(false)} className="min-h-11 flex-1 rounded-xl bg-[var(--accent)] font-semibold text-[#221c08]">Done</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
