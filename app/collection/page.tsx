'use client';

/**
 * The collection: every card this profile owns, by box or binder, and the
 * copies their decks have taken.
 *
 * A copy is in one place - a box, or a deck that pulled it. Decks pull from
 * here on their Collection tab; changing a deck returns what it no longer
 * needs to the box it came from. A box's count is what belongs to it: the
 * copies in it and those decks took from it. Filter with the same syntax as
 * a deck (t:creature, c:g, name words), by box, or to what decks hold.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import AddToCollection from '@/components/AddToCollection';
import CardModal from '@/components/CardModal';
import EmptyState from '@/components/EmptyState';
import MoreMenu from '@/components/MoreMenu';
import StickyBar from '@/components/StickyBar';
import Tip from '@/components/Tip';
import * as api from '@/lib/api';
import type { BoxCopies, DeckCopies } from '@/lib/collection';
import { isProxy, variantBadges } from '@/lib/copy-variant';
import { filterCards } from '@/lib/filter';
import { imageOf, priceOf, type Finish } from '@/lib/scryfall';
import { steady } from '@/lib/steady-tap';


type Where = { kind: 'all' } | { kind: 'box'; name: string } | { kind: 'decks' };
type Sort = 'name' | 'value' | 'recent';
type Row = (BoxCopies & { deck?: undefined }) | (DeckCopies & { deck: true; location: string; addedAt: string });

const input = 'rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]';
const button = 'min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const boxName = (name: string) => name || 'Unsorted';
const rowKey = (r: Row) => `${r.deck ? `d:${r.listId}` : 'b'}:${r.card.id}:${r.finish}:${r.location}:${r.variant}`;
const valueOf = (r: Row) => (isProxy(r.variant) ? 0 : r.quantity * (priceOf(r.card, r.finish) ?? 0));

export default function CollectionPage() {
  const [state, setState] = useState<api.CollectionState | null>(() => api.peekCollection() ?? null);
  const [error, setError] = useState<string | null>(null);
  const [where, setWhere] = useState<Where>({ kind: 'all' });
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [panel, setPanel] = useState<'add' | 'import' | 'box' | null>(null);
  const [location, setLocation] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);

  // A deck card's mark links here with ?q="Name": every copy of that card.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the address on arrival
    if (q) setFilter(q);
  }, []);
  const load = useCallback(() => api.collection().then(setState).catch((e) => setError(e instanceof Error ? e.message : 'Could not load')), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const rows: Row[] = useMemo(() => {
    if (!state) return [];
    const boxes: Row[] = state.boxes;
    const decks: Row[] = state.decks.map((d) => ({ ...d, deck: true as const, location: d.fromLocation, addedAt: '' }));
    // A box shows what belongs to it: the copies in it, and those its decks took.
    const chosen = where.kind === 'all' ? [...boxes, ...decks]
      : where.kind === 'decks' ? decks
        : [...boxes, ...decks].filter((b) => b.location === where.name);
    const { results } = filterCards(chosen, filter);
    return [...results].sort((a, b) => sort === 'value' ? valueOf(b) - valueOf(a)
      : sort === 'recent' ? (b.addedAt ?? '').localeCompare(a.addedAt ?? '')
        : a.card.name.localeCompare(b.card.name));
  }, [state, where, filter, sort]);
  const unsupported = useMemo(() => filterCards([], filter).unsupported, [filter]);

  const setCount = async (r: BoxCopies, quantity: number) => {
    const before = r.quantity;
    setState(await api.setCollectionCount(r.card.id, r.finish, r.location, quantity, r.variant));
    if (quantity === 0) {
      setToast({
        text: `Removed ${r.card.name} from ${boxName(r.location)}`,
        undo: async () => setState(await api.setCollectionCount(r.card.id, r.finish, r.location, before, r.variant)),
      });
    }
  };

  if (error) return <p className="mt-8 text-center text-red-400">{error}</p>;
  if (!state) return <p className="mt-8 text-center text-[var(--muted)]">Loading your collection…</p>;
  const { totals, locations } = state;
  // Nothing in it yet: the page is one invitation, not empty filters and tabs.
  const empty = !totals.copies && !totals.inDecks && !locations.some((l) => l.name);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 data-tour="collection-head" className="font-display text-3xl font-extrabold">Collection</h1>
          {!empty && (<>
            <p className="mt-1 text-sm tabular-nums text-[var(--muted)]">
              {totals.copies.toLocaleString()} card{totals.copies === 1 ? '' : 's'} · {totals.unique.toLocaleString()} different · {money(totals.value)}
            </p>
            <p data-testid="where-totals" className="mt-0.5 flex items-center gap-1 text-xs tabular-nums text-[var(--muted)]">
              {totals.inBoxes.toLocaleString()} in boxes and binders · {totals.inDecks.toLocaleString()} in decks
              {totals.proxies > 0 && <> · {totals.proxies} prox{totals.proxies === 1 ? 'y' : 'ies'}</>}
              <Tip label="How the counts add up">
                <p>Every card is in one place: in a box or binder, or in a deck that took it from one.</p>
                <p className="mt-1.5">{totals.inBoxes.toLocaleString()} in boxes + {totals.inDecks.toLocaleString()} in decks = {totals.copies.toLocaleString()} cards.</p>
                <p className="mt-1.5">A box&apos;s number counts both: the cards in it, and the ones decks took from it.</p>
                {totals.proxies > 0 && <p className="mt-1.5">Proxies are counted as cards, but not in the value.</p>}
              </Tip>
            </p>
          </>)}
        </div>
        {!empty && (
          <div className="flex gap-2">
            <Link href="/collection/scan" className={`${button} inline-flex items-center`}>Scan</Link>
            <MoreMenu items={[
              { label: panel === 'import' ? 'Close the import' : 'Import a CSV', onClick: () => setPanel(panel === 'import' ? null : 'import') },
              { label: 'Export as CSV', onClick: () => { window.location.href = api.collectionExportUrl(); } },
            ]} />
          </div>
        )}
      </div>

      {empty && panel === null && (
        <EmptyState
          title="Start your collection"
          actions={<>
            <button onClick={() => setPanel('add')} className="btn-go rounded-full px-5 py-2 text-sm font-semibold">＋ Add cards</button>
            <Link href="/collection/scan" className="rounded-full border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--surface-hover)]">Scan with the camera</Link>
            <button onClick={() => setPanel('import')} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--surface-hover)]">Import a CSV</button>
          </>}
        >
          Keep track of what you own, box by box. Decks then show which cards you already have.
          Imports take exports from Mythic Tools, ManaBox, Moxfield, Deckbox and TCGplayer.
        </EmptyState>
      )}

      {panel === 'add' && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <AddToCollection
            locations={locations}
            location={location}
            onLocation={setLocation}
            onAdded={({ card, quantity, finish, location: box, count }) => {
              load();
              setToast({
                text: `Added ${quantity}× ${card.name} to ${boxName(box)}`,
                undo: async () => setState(await api.setCollectionCount(card.id, finish, box, count - quantity)),
              });
            }}
          />
        </section>
      )}
      {panel === 'import' && (
        <ImportPanel locations={locations} onDone={(summary) => { load(); setToast({ text: summary }); }} />
      )}

      {!empty && <>
      <div className="mt-5 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Where">
        <Chip on={where.kind === 'all'} onClick={() => setWhere({ kind: 'all' })}>All · {totals.copies.toLocaleString()}</Chip>
        {locations.filter((l) => l.count + l.inDecks > 0 || l.name).map((l) => (
          <Chip key={l.name} on={where.kind === 'box' && where.name === l.name} onClick={() => setWhere({ kind: 'box', name: l.name })}>
            {l.kind === 'binder' ? '📒' : '📦'} {boxName(l.name)} · {(l.count + l.inDecks).toLocaleString()}
          </Chip>
        ))}
        {totals.inDecks > 0 && (
          <Chip on={where.kind === 'decks'} onClick={() => setWhere({ kind: 'decks' })}>🂠 In decks · {totals.inDecks.toLocaleString()}</Chip>
        )}
        <Chip on={panel === 'box'} onClick={() => setPanel(panel === 'box' ? null : 'box')}>+ Box</Chip>
      </div>
      {where.kind === 'box' && (() => {
        const l = locations.find((x) => x.name === where.name);
        if (!l || !l.inDecks) return null;
        return (
          <p data-testid="box-split" className="mt-1 text-xs tabular-nums text-[var(--muted)]">
            {boxName(l.name)}: {l.count.toLocaleString()} in the {l.kind} · {l.inDecks.toLocaleString()} out in decks · {(l.count + l.inDecks).toLocaleString()} in all
          </p>
        );
      })()}
      {panel === 'box' && <BoxPanel where={where} locations={locations} onDone={(w) => { load(); if (w) setWhere(w); setPanel(null); }} />}

      {/* Filter, sort and Add cards stay under the top bar as the collection scrolls. */}
      <StickyBar className="mt-1" rowClassName="flex gap-2 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter — t:creature, c:g, sol ring"
          aria-label="Filter the collection"
          className={`${input} min-w-0 flex-1`}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className={`${input} w-auto shrink-0 max-sm:max-w-[7.5rem]`}>
          <option value="name">Name</option>
          <option value="value">Value</option>
          <option value="recent">Recently added</option>
        </select>
        <button
          onClick={() => { setPanel(panel === 'add' ? null : 'add'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          aria-label="Add cards"
          className="min-h-10 shrink-0 whitespace-nowrap rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[#221c08]"
        >
          ＋<span className="max-sm:hidden"> Add cards</span>
        </button>
      </StickyBar>
      {unsupported.length > 0 && <p className="mt-1 text-xs text-amber-400">Not understood: {unsupported.join(', ')}</p>}

      {!totals.copies && (
        <p className="mt-10 text-center text-[var(--muted)]">Nothing in {where.kind === 'box' ? boxName(where.name) : 'here'} yet.</p>
      )}
      {totals.copies > 0 && !rows.length && <p className="mt-8 text-center text-[var(--muted)]">No cards match.</p>}

      {rows.length > 0 && <ul className="mt-3 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
        {rows.slice(0, 500).map((r) => (
          <CollectionRow
            key={rowKey(r)}
            row={r}
            onOpen={() => setSelected(r)}
            onCount={r.deck ? undefined : (n) => setCount(r as BoxCopies, n)}
          />
        ))}
      </ul>}
      {rows.length > 500 && <p className="mt-2 text-center text-xs text-[var(--muted)]">Showing 500 of {rows.length} — filter to narrow it down.</p>}
      </>}

      <CardModal
        card={selected?.card ?? null}
        onClose={() => setSelected(null)}
        actions={selected && (
          <div className="flex flex-col gap-3">
            {selected.deck
              ? <p className="text-sm text-[var(--muted)]">In <Link className="underline" href={`/decks/${selected.listId}`}>{selected.listName}</Link>, taken from {boxName(selected.location)}. Return it from the deck&apos;s Collection tab.</p>
              : <MoveCopies row={selected} locations={locations} onMoved={(s) => { setState(s); setSelected(null); }} />}
            <AllCopies state={state} row={selected} />
          </div>
        )}
      />

      {toast && (
        <div role="status" className="fixed bottom-[calc(var(--nav-h)+0.75rem)] sm:bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[#221c08] shadow-lg">
          <span className="min-w-0 flex-1">{toast.text}</span>
          {toast.undo && (
            <button {...steady(() => { const u = toast.undo!; setToast(null); u().catch(() => {}); })} className="min-h-9 shrink-0 rounded-lg bg-[#221c08]/15 px-3 font-semibold">Undo</button>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-sm ${on ? 'border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)]'}`}
    >
      {children}
    </button>
  );
}

const FINISH: Record<Finish, string> = { nonfoil: '', foil: 'Foil', etched: 'Etched' };

/** Language, condition, proxy and the like, as small badges. */
function Badges({ variant }: { variant: string }) {
  const badges = variantBadges(variant);
  if (!badges.length) return null;
  return <>{badges.map((b) => (
    <span key={b.text} title={b.title} className={`ml-1 inline-block rounded px-1 align-[1px] text-[10px] font-semibold leading-4 ${b.text === 'Proxy' ? 'bg-amber-400/20 text-amber-300' : 'bg-white/10 text-[var(--foreground)]'}`}>{b.text}</span>
  ))}</>;
}

/** Every copy of a card: which box each is in, and which deck holds which - and the box it came from. */
function AllCopies({ state, row }: { state: api.CollectionState; row: Row }) {
  const same = (r: { card: { oracle_id?: string; id: string } }) => (r.card.oracle_id ?? r.card.id) === (row.card.oracle_id ?? row.card.id);
  const boxes = state.boxes.filter(same);
  const decks = state.decks.filter(same);
  const total = [...boxes, ...decks].reduce((n, r) => n + r.quantity, 0);
  const print = (r: BoxCopies | DeckCopies) => <>
    {(r.card.set ?? '').toUpperCase()} #{r.card.collector_number}{FINISH[r.finish] && <> · {FINISH[r.finish]}</>}<Badges variant={r.variant} />
  </>;
  return (
    <section aria-label="Where your copies are" className="text-sm">
      <p className="font-semibold">Where your {total} cop{total === 1 ? 'y is' : 'ies are'}</p>
      <ul className="mt-1 space-y-1 text-[var(--muted)]">
        {boxes.map((b) => (
          <li key={`b:${b.card.id}:${b.finish}:${b.location}:${b.variant}`} className="flex gap-2">
            <span className="w-8 shrink-0 tabular-nums text-[var(--foreground)]">{b.quantity}×</span>
            <span className="min-w-0">in {boxName(b.location)} <span className="text-xs">· {print(b)}</span></span>
          </li>
        ))}
        {decks.map((d) => (
          <li key={`d:${d.listId}:${d.card.id}:${d.finish}:${d.fromLocation}:${d.variant}`} className="flex gap-2">
            <span className="w-8 shrink-0 tabular-nums text-[var(--foreground)]">{d.quantity}×</span>
            <span className="min-w-0">in <Link className="underline" href={`/decks/${d.listId}`}>{d.listName}</Link>, from {boxName(d.fromLocation)} <span className="text-xs">· {print(d)}</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CollectionRow({ row, onOpen, onCount }: { row: Row; onOpen: () => void; onCount?: (n: number) => void }) {
  const image = imageOf(row.card, 'small');
  const price = isProxy(row.variant) ? null : priceOf(row.card, row.finish);
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {image ? <Image src={image} alt="" width={40} height={56} className="shrink-0 rounded" unoptimized /> : <span className="h-14 w-10 shrink-0 rounded bg-[var(--surface)]" />}
        <span className="min-w-0">
          <span className="block truncate text-sm">{row.card.name}<Badges variant={row.variant} /></span>
          <span className="block truncate text-xs text-[var(--muted)]">
            {(row.card.set ?? '').toUpperCase()} #{row.card.collector_number}
            {FINISH[row.finish] && <> · <span className="text-[var(--foreground)]">{FINISH[row.finish]}</span></>}
            {' · '}{row.deck ? <>in {row.listName}, from {boxName(row.location)}</> : boxName(row.location)}
            {price !== null && <> · ${price.toFixed(2)}</>}
          </span>
        </span>
      </button>
      {onCount ? (
        <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-[var(--border)]">
          <button onClick={() => onCount(row.quantity - 1)} aria-label={`One fewer ${row.card.name}`} className="h-9 w-9">−</button>
          <span className="w-7 text-center text-sm tabular-nums">{row.quantity}</span>
          <button onClick={() => onCount(row.quantity + 1)} aria-label={`One more ${row.card.name}`} className="h-9 w-9">+</button>
        </div>
      ) : (
        <span className="shrink-0 text-sm tabular-nums text-[var(--muted)]">×{row.quantity}</span>
      )}
    </li>
  );
}

function MoveCopies({ row, locations, onMoved }: { row: BoxCopies; locations: api.CollectionState['locations']; onMoved: (s: api.CollectionState) => void }) {
  const [to, setTo] = useState(row.location);
  const [finish, setFinish] = useState<Finish>(row.finish);
  const [quantity, setQuantity] = useState(row.quantity);
  const [busy, setBusy] = useState(false);
  const finishes = (row.card.finishes ?? ['nonfoil']) as Finish[];
  const changed = to !== row.location || finish !== row.finish;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-[var(--muted)]">Move</span>
      <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} aria-label="How many" className={input}>
        {Array.from({ length: row.quantity }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <span className="text-[var(--muted)]">to</span>
      <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Box" className={input}>
        {locations.map((l) => <option key={l.name} value={l.name}>{boxName(l.name)}</option>)}
      </select>
      {finishes.length > 1 && (
        <select value={finish} onChange={(e) => setFinish(e.target.value as Finish)} aria-label="Finish" className={input}>
          {finishes.map((f) => <option key={f} value={f}>{f === 'nonfoil' ? 'Non-foil' : f === 'foil' ? 'Foil' : 'Etched'}</option>)}
        </select>
      )}
      <button
        disabled={!changed || busy}
        onClick={async () => { setBusy(true); try { onMoved(await api.moveCopies(row.card.id, row.finish, row.location, { location: to, finish, quantity }, row.variant)); } finally { setBusy(false); } }}
        className="min-h-10 rounded-lg bg-[var(--accent)] px-4 font-medium text-[#221c08] disabled:opacity-50"
      >
        Move
      </button>
    </div>
  );
}

function ImportPanel({ locations, onDone }: { locations: api.CollectionState['locations']; onDone: (summary: string) => void }) {
  const [text, setText] = useState('');
  const [location, setLocation] = useState('');
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<api.CollectionImportPreview | null>(null);
  const [result, setResult] = useState<api.CollectionImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [before, setBefore] = useState<{ at: string; copies: number } | null>(null);

  const changed = (next: string) => { setText(next); setPreview(null); setResult(null); setBefore(null); setError(null); };
  const readFile = async (file: File | undefined) => {
    if (file) changed(await file.text());
  };
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.previewCollectionImport(text, location);
      setPreview(p);
      // A file imported before most likely means "make it match", not "add it twice".
      if (p.before) setMode('replace');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that');
    } finally {
      setBusy(false);
    }
  };
  const run = async (again = false) => {
    setBusy(true);
    setError(null);
    setBefore(null);
    try {
      const r = await api.importCollection(text, location, { mode, again });
      setResult(r);
      setPreview(null);
      if (r.copies) onDone(`${r.mode === 'replace' ? 'Collection replaced with' : 'Imported'} ${r.copies.toLocaleString()} cards (${r.unique.toLocaleString()} different) from ${r.format === 'text' ? 'the list' : r.format}`);
    } catch (e) {
      if (e instanceof api.ImportedBefore) setBefore(e.before);
      else setError(e instanceof Error ? e.message : 'Could not import that');
    } finally {
      setBusy(false);
    }
  };
  const when = (at: string) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section data-testid="import-panel" className="mt-4 flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
      <p className="text-[var(--muted)]">
        A CSV exported from Mythic Tools, ManaBox, Moxfield, Deckbox or TCGplayer, or a plain list (&ldquo;4 Opt (m21) 59 *F*&rdquo;).
        Their boxes, binders and containers become boxes here; language, condition and proxies are kept on each card.
      </p>
      <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => readFile(e.target.files?.[0])} className="text-sm" aria-label="Choose a file" />
      <textarea value={text} onChange={(e) => changed(e.target.value)} rows={6} placeholder="…or paste it here" className={input} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[var(--muted)]">Cards without a box go to</span>
        <select value={location} onChange={(e) => { setLocation(e.target.value); setPreview(null); }} className={input} aria-label="Box for the import">
          {locations.map((l) => <option key={l.name} value={l.name}>{boxName(l.name)}</option>)}
        </select>
        {!preview && (
          <button disabled={!text.trim() || busy} onClick={check} className="min-h-10 rounded-lg bg-[var(--accent)] px-4 font-medium text-[#221c08] disabled:opacity-50">
            {busy ? 'Reading…' : 'Check the file'}
          </button>
        )}
      </div>

      {preview && (
        <div data-testid="import-preview" className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-3">
          <div>
            <p className="font-semibold">
              {preview.copies.toLocaleString()} cards in {preview.rows.toLocaleString()} lines{preview.format !== 'text' && preview.format !== 'CSV' ? `, a ${preview.format} export` : ''}
            </p>
            <ul className="mt-1 text-[var(--muted)]">
              {preview.locations.map((l) => (
                <li key={l.name}>{l.kind === 'binder' ? '📒' : '📦'} {boxName(l.name)} · {l.copies.toLocaleString()}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {[preview.foil && `${preview.foil} foil`, preview.etched && `${preview.etched} etched`, preview.otherLanguage && `${preview.otherLanguage} not in English`, preview.proxies && `${preview.proxies} prox${preview.proxies === 1 ? 'y' : 'ies'} (kept, marked as proxies)`].filter(Boolean).join(' · ')}
            </p>
          </div>
          {preview.before && (
            <p role="alert" className="text-amber-300">
              You imported this exact file on {when(preview.before.at)}. Adding it again would count every card twice.
            </p>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Add or replace</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={mode === 'add'} onChange={() => setMode('add')} className="mt-1" />
              <span><b>Add to my collection</b> <span className="text-[var(--muted)]">- these cards go on top of the {preview.current.copies.toLocaleString()} there now.</span></span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-1" />
              <span>
                <b>Replace my collection</b> <span className="text-[var(--muted)]">- the collection becomes exactly this file.</span>
                {(preview.current.copies > 0 || preview.current.inDecks > 0) && (
                  <span className="block text-xs text-amber-300">
                    Removes the {preview.current.copies.toLocaleString()} cards in your boxes now
                    {preview.current.inDecks > 0 && <>, and your decks let go of the {preview.current.inDecks.toLocaleString()} they hold (their cards stay; import each deck again to link its copies)</>}.
                  </span>
                )}
              </span>
            </label>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => run()} className="min-h-10 rounded-lg bg-[var(--accent)] px-4 font-medium text-[#221c08] disabled:opacity-50">
              {busy ? 'Importing…' : mode === 'replace' ? 'Replace my collection' : `Add ${preview.copies.toLocaleString()} cards`}
            </button>
            <button disabled={busy} onClick={() => setPreview(null)} className={button}>Back</button>
          </div>
          {busy && <p className="text-xs text-[var(--muted)]">Finding every card - a few thousand take a minute.</p>}
        </div>
      )}
      {before && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-amber-300">
          <span>You imported this file on {when(before.at)} ({before.copies.toLocaleString()} cards). Adding it again counts every card twice.</span>
          <button onClick={() => run(true)} className={button}>Add it again anyway</button>
        </div>
      )}
      {error && <p className="text-red-400">{error}</p>}
      {result && (
        <div className="rounded-lg border border-[var(--border)] p-3">
          <p>✓ {result.copies.toLocaleString()} cards {result.mode === 'replace' ? 'in your collection now' : 'added'} ({result.unique.toLocaleString()} different){result.format !== 'text' ? `, read as a ${result.format} export` : ''}.</p>
          {result.missing.length > 0 && (
            <details className="mt-1 text-amber-400">
              <summary>⚠ {result.missing.length} cards not found</summary>
              <pre className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">{result.missing.join('\n')}</pre>
            </details>
          )}
          {result.byName.length > 0 && (
            <details className="mt-1 text-amber-400">
              <summary>⚠ {result.byName.length} had a set and number for a different card — added by name instead</summary>
              <pre className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">{result.byName.join('\n')}</pre>
            </details>
          )}
          {result.unreadable.length > 0 && <p className="mt-1 text-amber-400">⚠ {result.unreadable.length} lines could not be read.</p>}
        </div>
      )}
    </section>
  );
}

function BoxPanel({ where, locations, onDone }: { where: Where; locations: api.CollectionState['locations']; onDone: (w?: Where) => void }) {
  const current = where.kind === 'box' && where.name ? locations.find((l) => l.name === where.name) : undefined;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'box' | 'binder'>('box');
  const [rename, setRename] = useState(current?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const act = async (work: () => Promise<unknown>, next?: Where) => {
    setError(null);
    try { await work(); onDone(next); } catch (e) { setError(e instanceof Error ? e.message : 'Could not do that'); }
  };
  return (
    <section className="mt-2 flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) act(() => api.addLocation(name.trim(), kind), { kind: 'box', name: name.trim() }); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New box or binder" aria-label="New box or binder" className={`${input} min-w-0 flex-1`} />
        <select value={kind} onChange={(e) => setKind(e.target.value as 'box' | 'binder')} className={input} aria-label="Kind">
          <option value="box">Box</option>
          <option value="binder">Binder</option>
        </select>
        <button disabled={!name.trim()} className="min-h-10 rounded-lg bg-[var(--accent)] px-4 font-medium text-[#221c08] disabled:opacity-50">Make it</button>
      </form>
      {current && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          <span className="text-[var(--muted)]">{current.name}:</span>
          <input value={rename} onChange={(e) => setRename(e.target.value)} aria-label="Rename the box" className={`${input} min-w-0 flex-1`} />
          <button disabled={!rename.trim() || rename.trim() === current.name} onClick={() => act(() => api.renameLocation(current.name, rename.trim()), { kind: 'box', name: rename.trim() })} className={button}>Rename</button>
          <button onClick={() => act(() => api.renameLocation(current.name, current.name, current.kind === 'box' ? 'binder' : 'box'))} className={button}>
            Make it a {current.kind === 'box' ? 'binder' : 'box'}
          </button>
          <button onClick={() => act(() => api.deleteLocation(current.name), { kind: 'box', name: '' })} className={`${button} text-red-400`}>Delete (cards go to Unsorted)</button>
        </div>
      )}
      {error && <p className="text-red-400">{error}</p>}
    </section>
  );
}

