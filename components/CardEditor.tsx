'use client';

/**
 * Change a card in a deck: which printing it is, foil or not, and which
 * board it sits on. Printings come from Scryfall, newest first, with the
 * finishes each one exists in and their prices.
 */

import Image from 'next/image';
import { useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { Board } from '@/lib/decklist';
import type { Finish, ScryfallCard } from '@/lib/scryfall';

interface Props {
  listId: string;
  card: ScryfallCard;
  finish: Finish;
  board: Board;
  isDeck: boolean;
  /** After a change: the printing now in the deck, to show in the modal. */
  onChanged: (printingId: string) => void;
}

const FINISH_LABEL: Record<Finish, string> = { nonfoil: 'Non-foil', foil: 'Foil', etched: 'Etched' };
const priceFor = (p: api.Printing, finish: Finish) =>
  finish === 'foil' ? p.prices.usd_foil : finish === 'etched' ? p.prices.usd_etched : p.prices.usd;

export default function CardEditor({ listId, card, finish, board, isDeck, onChanged }: Props) {
  const [printings, setPrintings] = useState<api.Printing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!card.oracle_id) return;
    api.printings(card.oracle_id).then(setPrintings).catch(() => setError('Could not load printings'));
  }, [card.oracle_id]);

  const current = printings?.find((p) => p.id === card.id);
  const finishes = (current?.finishes ?? card.finishes ?? ['nonfoil']) as Finish[];

  const change = async (update: { board?: Board; finish?: Finish; printingId?: string }) => {
    setBusy(true);
    setError(null);
    try {
      await api.updateCard(listId, card.id, update);
      onChanged(update.printingId ?? card.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that card');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Finish</span>
          <div className="flex overflow-hidden rounded-lg border border-[var(--border)]" role="group" aria-label="Finish">
            {finishes.map((f) => (
              <button
                key={f}
                disabled={busy}
                aria-pressed={finish === f}
                onClick={() => finish !== f && change({ finish: f })}
                className={`px-3 py-1.5 ${finish === f ? 'bg-[var(--accent)] font-medium text-[#221c08]' : 'text-[var(--muted)] hover:bg-[var(--surface-hover)]'}`}
              >
                {FINISH_LABEL[f] ?? f}
              </button>
            ))}
          </div>
        </div>
        {isDeck && (
          <label className="flex items-center gap-2">
            <span className="text-[var(--muted)]">Board</span>
            <select
              value={board}
              disabled={busy}
              onChange={(e) => change({ board: e.target.value as Board })}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5"
            >
              <option value="main">Main</option>
              <option value="maybe">Maybeboard</option>
              <option value="side">Sideboard</option>
            </select>
          </label>
        )}
      </div>

      <div>
        <p className="mb-2 text-[var(--muted)]">
          Printing{printings ? ` — ${printings.length} to choose from` : ''}
        </p>
        {!printings && !error && <p className="text-[var(--muted)]">Loading printings…</p>}
        {printings && (
          <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
            {printings.map((p) => {
              const price = priceFor(p, finish) ?? p.prices.usd ?? p.prices.usd_foil;
              return (
                <button
                  key={p.id}
                  disabled={busy || p.id === card.id}
                  onClick={() => change({
                    printingId: p.id,
                    // Keep the finish if this printing has it; otherwise its first.
                    ...(p.finishes.includes(finish) ? {} : { finish: (p.finishes[0] ?? 'nonfoil') as Finish }),
                  })}
                  className={`flex flex-col rounded-lg border p-1 text-left text-xs ${p.id === card.id
                    ? 'border-[var(--accent)]'
                    : 'border-[var(--border)] hover:border-[var(--muted)]'}`}
                >
                  {p.image && <Image src={p.image} alt="" width={146} height={204} className="w-full rounded" unoptimized />}
                  <span className="mt-1 truncate uppercase">{p.set} #{p.collectorNumber}</span>
                  <span className="text-[var(--muted)]">{price ? `$${Number(price).toFixed(2)}` : '—'}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
