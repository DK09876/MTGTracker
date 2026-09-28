'use client';

/**
 * Adding cards to the collection by hand: type a name, pick the printing you
 * are holding (newest first, with the finishes each comes in), foil or not,
 * how many, and which box. The scanner hands over a card it has read and
 * skips the typing.
 */

import Image from 'next/image';
import { useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { Location } from '@/lib/collection';
import type { Finish, ScryfallCard } from '@/lib/scryfall';
import { dismissKeyboard, steady } from '@/lib/steady-tap';
import { exactName } from '@/lib/syntax';

interface Props {
  locations: Location[];
  location: string;
  onLocation: (name: string) => void;
  /** A card to start from - from the scanner - instead of typing a name. */
  card?: ScryfallCard | null;
  onAdded: (added: { card: ScryfallCard; quantity: number; finish: Finish; location: string; count: number }) => void;
  /** Shown instead of the name box when a card was handed over. */
  compact?: boolean;
}

const FINISH_LABEL: Record<Finish, string> = { nonfoil: 'Non-foil', foil: 'Foil', etched: 'Etched' };
const input = 'rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]';

export default function AddToCollection({ locations, location, onLocation, card: given, onAdded, compact }: Props) {
  const [name, setName] = useState('');
  const [names, setNames] = useState<string[]>([]);
  const [base, setBase] = useState<ScryfallCard | null>(given ?? null);
  const [printings, setPrintings] = useState<api.Printing[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(given?.id ?? null);
  const [finish, setFinish] = useState<Finish>('nonfoil');
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newBox, setNewBox] = useState<string | null>(null);

  // A new card from the scanner remounts this (the parent keys it by card),
  // so the state above starts from it.
  useEffect(() => {
    if (compact || name.trim().length < 2 || base?.name === name) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.autocomplete(name, controller.signal).then((n) => setNames(n.slice(0, 6))).catch(() => {});
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [name, base, compact]);

  // Every printing of the card, to pick the one in hand.
  useEffect(() => {
    if (!base?.oracle_id) return;
    let cancelled = false;
    api.printings(base.oracle_id).then((p) => { if (!cancelled) setPrintings(p); }).catch(() => { if (!cancelled) setPrintings([]); });
    return () => { cancelled = true; };
  }, [base?.oracle_id]);

  const pickName = async (n: string) => {
    dismissKeyboard();
    setName(n);
    setNames([]);
    setError(null);
    setPrintings(null);
    try {
      const r = await api.search(exactName(n));
      const found = r.cards[0] ?? null;
      setBase(found);
      setChosen(found?.id ?? null);
      if (!found) setError(`Could not find ${n}`);
    } catch {
      setError('Could not look that card up');
    }
  };

  const printing = printings?.find((p) => p.id === chosen) ?? null;
  // The printing that was read or picked comes first, where it can be seen.
  const [firstId] = useState(given?.id ?? null);
  const shown = printings && firstId
    ? [...printings.filter((p) => p.id === firstId), ...printings.filter((p) => p.id !== firstId)]
    : printings;
  const finishes = (printing?.finishes ?? base?.finishes ?? ['nonfoil']) as Finish[];
  const shownFinish = finishes.includes(finish) ? finish : finishes[0] ?? 'nonfoil';

  const add = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      const where = newBox?.trim() || location;
      const r = await api.addToCollection(chosen, { quantity, finish: shownFinish, location: where });
      if (newBox?.trim()) { onLocation(newBox.trim()); setNewBox(null); }
      onAdded({ card: r.card, quantity, finish: shownFinish, location: where, count: r.count });
      setQuantity(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that card');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      {!compact && (
        <div className="relative">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { e.preventDefault(); pickName(names[0] ?? name.trim()); } }}
            placeholder="Card name"
            aria-label="Card name"
            enterKeyHint="search"
            className={`${input} w-full`}
          />
          {names.length > 0 && base?.name !== name && (
            <ul className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg" role="listbox">
              {names.map((n) => (
                <li key={n} role="option" aria-selected={false}>
                  <button {...steady(() => pickName(n))} className="w-full px-3 py-2.5 text-left hover:bg-[var(--surface-hover)]">{n}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {base && (
        <>
          <div>
            <p className="mb-1.5 text-[var(--muted)]">
              {base.name} — printing{printings ? ` (${printings.length})` : ''}
            </p>
            {!printings && <p className="text-[var(--muted)]">Loading printings…</p>}
            {printings && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {(shown ?? []).map((p) => (
                  <button
                    key={p.id}
                    {...steady(() => setChosen(p.id))}
                    aria-pressed={p.id === chosen}
                    className={`flex w-24 shrink-0 flex-col rounded-lg border p-1 text-left text-xs ${p.id === chosen ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
                  >
                    {p.image && <Image src={p.image} alt="" width={92} height={128} className="w-full rounded" unoptimized />}
                    <span className="mt-1 truncate uppercase">{p.set} #{p.collectorNumber}</span>
                    <span className="truncate text-[var(--muted)]">{p.setName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex overflow-hidden rounded-lg border border-[var(--border)]" role="group" aria-label="Finish">
              {finishes.map((f) => (
                <button
                  key={f}
                  aria-pressed={shownFinish === f}
                  onClick={() => setFinish(f)}
                  className={`min-h-10 px-3 ${shownFinish === f ? 'bg-[var(--accent)] font-medium text-[#221c08]' : 'text-[var(--muted)]'}`}
                >
                  {FINISH_LABEL[f] ?? f}
                </button>
              ))}
            </div>
            <div className="flex items-center overflow-hidden rounded-lg border border-[var(--border)]" role="group" aria-label="How many">
              <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="One fewer" className="min-h-10 w-10 text-lg">−</button>
              <span className="w-8 text-center tabular-nums" aria-live="polite">{quantity}</span>
              <button onClick={() => setQuantity((q) => Math.min(99, q + 1))} aria-label="One more" className="min-h-10 w-10 text-lg">+</button>
            </div>
            {newBox === null ? (
              <select
                value={location}
                onChange={(e) => (e.target.value === '\u0000new' ? setNewBox('') : onLocation(e.target.value))}
                aria-label="Box"
                className={`${input} max-w-[12rem]`}
              >
                {locations.map((l) => <option key={l.name} value={l.name}>{l.name || 'Unsorted'}</option>)}
                <option value={'\u0000new'}>New box…</option>
              </select>
            ) : (
              <input
                value={newBox}
                onChange={(e) => setNewBox(e.target.value)}
                autoFocus
                placeholder="New box or binder"
                aria-label="New box or binder"
                className={`${input} w-44`}
              />
            )}
          </div>

          <button
            disabled={!chosen || busy}
            {...steady(add)}
            className="min-h-11 rounded-xl bg-[var(--accent)] px-4 font-medium text-[#221c08] disabled:opacity-50"
          >
            {busy ? 'Adding…' : `Add ${quantity} to ${newBox?.trim() || location || 'Unsorted'}`}
          </button>
        </>
      )}
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
