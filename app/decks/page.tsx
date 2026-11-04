'use client';

/**
 * Your decks, sorted and filtered, and a new one: a name, a commander
 * picked from a search, and optionally a pasted list or an Archidekt link.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import CommanderPicker from '@/components/CommanderPicker';
import DeckFolderBar, { DECK_DRAG, type FolderPick } from '@/components/DeckFolderBar';
import ImportResult from '@/components/ImportResult';
import ManaCost, { IdentitySymbols } from '@/components/ManaCost';
import MoreMenu from '@/components/MoreMenu';
import PasteFormats from '@/components/PasteFormats';
import * as api from '@/lib/api';
import type { List } from '@/lib/db';
import { DECKLIST_EXAMPLE, MOXFIELD_REFUSES, readDeckBox } from '@/lib/deck-links';
import { parseDecklist } from '@/lib/decklist';
import { identityStyle } from '@/lib/identity';
import type { ImportSummary } from '@/lib/import-into';
import { imageOf } from '@/lib/scryfall';

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

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Decks</h1>
          {decks.length > 0 && (
            <p className="mt-1 text-sm text-[var(--muted)] tabular-nums">
              {decks.length} deck{decks.length === 1 ? '' : 's'} · ${decks.reduce((n, d) => n + d.totalValue, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} in all
              {decks.some((d) => d.totalCards < 100) && <> · {decks.filter((d) => d.totalCards < 100).length} short of 100</>}
            </p>
          )}
        </div>
        {!creating && (
          <button data-tour="new-deck" onClick={() => setCreating(true)} className="btn-go rounded-full px-4 py-2 font-semibold">
            ＋ New deck
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={create} className="mt-4 flex flex-col gap-4 rounded-xl border border-[var(--border)] p-4">
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
              Bring a deck <span className="opacity-70">(optional) - paste its list, or a link to it on Archidekt. Moxfield links aren&apos;t supported: use its Export and paste the list.</span>{' '}
              <PasteFormats />
            </span>
            <textarea
              value={decklist}
              onChange={(e) => { setDecklist(e.target.value); setError(null); }}
              // Tall enough for the whole example while empty.
              rows={decklist.trim() ? 10 : 16}
              placeholder={`https://archidekt.com/decks/…\n\nor a list:\n${DECKLIST_EXAMPLE}`}
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
              className="rounded-xl bg-[var(--accent)] px-4 py-2 font-medium text-[#221c08] hover:brightness-110 disabled:opacity-60"
            >
              {busy ? (box.kind === 'link' ? 'Fetching the deck…' : decklist.trim() ? 'Importing…' : 'Creating…') : 'Create deck'}
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setError(null); }}
              className="rounded-xl border border-[var(--border)] px-4 py-2 hover:bg-[var(--surface)]"
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
        <p className="mt-10 text-center text-[var(--muted)]">No decks yet.</p>
      )}
      {!loading && decks.length > 0 && !shown.length && !filtered && (
        <p className="mt-8 text-center text-sm text-[var(--muted)]">
          {folderPick === 'none' ? 'Every deck is in a folder.' : 'Nothing in this folder yet. Drag a deck onto it, or use a deck’s ⋯ → Move to.'}
        </p>
      )}

      {decks.length > 0 && (
        <DeckFolderBar
          folders={folders.folders}
          counts={counts}
          active={folderPick}
          onPick={(folder) => changeView({ folder })}
          naming={naming}
          setNaming={(on) => { setNaming(on); if (!on) setToFile(null); }}
          onCreate={async (folderName) => {
            try {
              const folder = await api.createFolder(folderName);
              if (toFile) await api.placeDeck(toFile, folder.id);
              setToFile(null);
              await refreshFolders();
              changeView({ folder: folder.id });
              return null;
            } catch (e) { return e instanceof Error ? e.message : 'Could not make that folder'; }
          }}
          onRename={async (id, folderName) => {
            try { await api.renameFolder(id, folderName); await refreshFolders(); return null; } catch (e) { return e instanceof Error ? e.message : 'Could not rename that folder'; }
          }}
          onDelete={async (id) => { await api.deleteFolder(id); changeView({ folder: 'all' }); await refreshFolders(); }}
          onDrop={(deckId, folderId) => void fileDeck(deckId, folderId)}
        />
      )}

      {decks.length > 0 && (
        <div data-tour="deck-sort" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a deck or commander"
            aria-label="Find a deck or commander"
            className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 outline-none focus:border-[var(--accent)] sm:w-64"
          />
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
                  className={`rounded-full p-1 transition ${on ? 'bg-[var(--accent)]/25 ring-1 ring-[var(--accent)]' : 'opacity-55 hover:opacity-100'}`}
                >
                  <ManaCost cost={`{${c}}`} size={18} />
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs">
            <input type="checkbox" checked={view.short} onChange={(e) => changeView({ short: e.target.checked })} />
            Not 100 yet
          </label>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--muted)]">
            Sort
            <select
              value={view.sort}
              onChange={(e) => changeView({ sort: e.target.value as Sort })}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--foreground)]"
            >
              {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          {filtered && (
            <p className="basis-full text-xs text-[var(--muted)]">
              {shown.length ? `Showing ${shown.length} of ${folderPick === 'all' ? decks.length : folderPick === 'none' ? counts.none : counts.byFolder[folderPick] ?? 0}.` : 'No decks match.'}{' '}
              <button onClick={() => { setQuery(''); changeView({ colours: [], short: false }); }} className="underline hover:text-[var(--foreground)]">Clear</button>
            </p>
          )}
        </div>
      )}

      <div data-tour="deck-grid" className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(16.5rem,1fr))] gap-3">
        {shown.map((deck) => {
          const art = deck.commander ? deck.commander.image_uris?.art_crop ?? deck.commander.card_faces?.[0]?.image_uris?.art_crop ?? imageOf(deck.commander, 'normal') : null;
          const total = deck.totalCards;
          const identity = deck.commander?.color_identity ?? [];
          return (
            // Each deck in its commander's colours, its art on the cover; its ⋯ sits beside the link, not in it.
            <div
              key={deck.id}
              className="relative"
              // Dragged onto a folder above, it goes in it.
              onDragStart={(e) => { e.dataTransfer.setData(DECK_DRAG, deck.id); e.dataTransfer.effectAllowed = 'move'; }}
            >
            <Link
              href={`/decks/${deck.id}`}
              style={identityStyle(identity)}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--c1)_30%,var(--border))] bg-[var(--surface)] transition-[border-color,box-shadow] duration-200 hover:border-[color-mix(in_srgb,var(--c1)_60%,var(--border))] hover:shadow-[0_10px_28px_color-mix(in_srgb,var(--c1)_22%,transparent)]"
            >
              {/* Nothing on the tile moves or is filtered on hover - a lift, a scale or a brightness filter
                  each left seams on the art's edges; the border and glow show it instead.
                  The art is framed from near its top, where the faces are. */}
              <div className="relative h-36 overflow-hidden bg-[var(--surface)]">
                {art ? <Image src={art} alt="" width={626} height={457} className="absolute inset-0 h-full w-full object-cover object-[50%_22%]" unoptimized />
                  : <div aria-hidden className="id-glow absolute -inset-6 blur-xl" />}
                {/* Only the bottom fades, under the name: a shade or a fade over the whole art washed it out. */}
                <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-b from-transparent to-[var(--surface)]" />
                <span className="absolute left-3 top-3"><IdentitySymbols identity={identity.join('')} size={18} /></span>
              </div>
              <div className="relative -mt-5 flex flex-1 flex-col gap-0.5 px-3.5 pb-3.5">
                <p className="truncate font-display text-lg font-extrabold leading-tight" title={deck.name}>{deck.name}</p>
                <p className="truncate text-sm text-[var(--muted)]">{deck.commander?.name ?? 'No commander'}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs font-bold tabular-nums">
                  <span className={`rounded-full px-2.5 py-1 ${total === 100 ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{total} / 100</span>
                  {deck.totalValue > 0 && <span className="rounded-full bg-white/5 px-2.5 py-1">${deck.totalValue.toFixed(2)}</span>}
                </div>
              </div>
              <div aria-hidden className="id-grad h-[3px]" />
            </Link>
            <div data-tour="deck-tile-more" className="absolute right-2 top-2 z-10 rounded-full bg-black/45 backdrop-blur">
              <MoreMenu
                label={`More for ${deck.name}`}
                items={[
                  { label: 'Duplicate', onClick: async () => { await api.duplicateList(deck.id); setDecks(await api.fetchLists('deck')); await refreshFolders(); } },
                  ...folders.folders.filter((f) => f.id !== placed[deck.id]).map((f) => ({ label: `Move to ${f.name}`, onClick: () => fileDeck(deck.id, f.id) })),
                  ...(placed[deck.id] ? [{ label: `Take out of ${folders.folders.find((f) => f.id === placed[deck.id])?.name ?? 'its folder'}`, onClick: () => fileDeck(deck.id, null) }] : []),
                  { label: folders.folders.length ? 'New folder with this deck…' : 'Put in a new folder…', onClick: () => { setToFile(deck.id); setNaming(true); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
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
  );
}
