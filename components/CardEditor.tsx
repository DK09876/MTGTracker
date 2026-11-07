'use client';

/**
 * Change a card in a deck: which printing it is, foil or not, and which
 * board it sits on. Printings come from Scryfall, newest first, with the
 * finishes each one exists in and their prices. "From your collection"
 * narrows them to the copies you own: picking one in a box swaps it in for
 * the copy the deck holds.
 */

import Image from 'next/image';
import { useEffect, useState } from 'react';

import * as api from '@/lib/api';
import { isProxy, variantBadges } from '@/lib/copy-variant';
import type { Board } from '@/lib/decklist';
import { DEFAULT_SECTIONS, type DeckSection } from '@/lib/sections-shared';
import type { Finish, ScryfallCard } from '@/lib/scryfall';

interface Props {
  listId: string;
  card: ScryfallCard;
  finish: Finish;
  board: Board;
  isDeck: boolean;
  /** After a change: the printing now in the deck, to show in the modal. */
  onChanged: (printingId: string) => void;
  /** A deck's sections beyond Main. */
  sections?: DeckSection[];
  /** The deck's commander: no section, and changes go to the deck itself. */
  commander?: boolean;
  /** Where the deck's copies of this card are, for "From your collection". */
  holding?: Holding;
  /** Showing only your copies: kept by the page, so it stays across a new printing. */
  mine?: boolean;
  onMine?: (mine: boolean) => void;
}

type Holding = api.DeckOwnership['cards'][number];

/** A copy you own: one the deck holds, or one in a box. */
interface OwnedCopy {
  where: 'deck' | 'box';
  cardId: string;
  set: string;
  number: string;
  finish: Finish;
  location: string;
  variant: string;
  quantity: number;
}

const box = (name: string) => name || 'Unsorted';

const FINISH_LABEL: Record<Finish, string> = { nonfoil: 'Non-foil', foil: 'Foil', etched: 'Etched' };
const priceFor = (p: api.Printing, finish: Finish) =>
  finish === 'foil' ? p.prices.usd_foil : finish === 'etched' ? p.prices.usd_etched : p.prices.usd;

export default function CardEditor({ listId, card, finish, board, isDeck, onChanged, sections = DEFAULT_SECTIONS, commander = false, holding, mine = false, onMine }: Props) {
  const [printings, setPrintings] = useState<api.Printing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!card.oracle_id) return;
    api.printings(card.oracle_id).then(setPrintings).catch(() => setError('Could not load printings'));
  }, [card.oracle_id]);

  const current = printings?.find((p) => p.id === card.id);
  const finishes = (current?.finishes ?? card.finishes ?? ['nonfoil']) as Finish[];

  const apply = async (update: { board?: Board; finish?: Finish; printingId?: string }) => {
    if (commander) {
      await api.setCommanderPrinting(listId, { commanderId: update.printingId, commanderFinish: update.finish });
    } else {
      await api.updateCard(listId, card.id, update);
    }
  };

  const change = async (update: { board?: Board; finish?: Finish; printingId?: string }) => {
    setBusy(true);
    setError(null);
    try {
      await apply(update);
      onChanged(update.printingId ?? card.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that card');
    } finally {
      setBusy(false);
    }
  };

  const owned: OwnedCopy[] = holding ? [
    ...holding.pulledCopies.map((p) => ({ ...p, where: 'deck' as const, location: p.fromLocation })),
    ...holding.inBoxes.map((b) => ({ ...b, where: 'box' as const })),
  ] : [];
  const ownedCount = owned.reduce((n, c) => n + c.quantity, 0);
  const imageOf = new Map((printings ?? []).map((p) => [p.id, p.image]));

  // The deck becomes this copy: its printing and finish, and for one in a
  // box, the copy itself - the one the deck held goes back to its box.
  const pickCopy = async (c: OwnedCopy) => {
    if (!holding) return;
    setBusy(true);
    setError(null);
    try {
      const update = {
        ...(c.cardId !== card.id ? { printingId: c.cardId } : {}),
        ...(c.finish !== finish ? { finish: c.finish } : {}),
      };
      if (update.printingId || update.finish) await apply(update);
      if (c.where === 'box') {
        if (holding.short === 0 && holding.pulled > 0) await api.deckCollection(listId, { action: 'return', key: holding.key, quantity: 1 });
        await api.deckCollection(listId, {
          action: 'pull', key: holding.key, quantity: 1,
          from: { cardId: c.cardId, finish: c.finish, location: c.location, variant: c.variant },
        });
      }
      onChanged(c.cardId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use that copy');
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
        {isDeck && !commander && (
          <label className="flex items-center gap-2">
            <span className="text-[var(--muted)]">Section</span>
            <select
              value={board}
              disabled={busy}
              onChange={(e) => change({ board: e.target.value as Board })}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5"
            >
              <option value="main">Main</option>
              {sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[var(--muted)]">
            {mine && holding && onMine
              ? `Your copies — ${ownedCount}`
              : `Printing${printings ? ` — ${printings.length} to choose from` : ''}`}
          </p>
          {holding && onMine && (
            <div className="flex overflow-hidden rounded-lg border border-[var(--border)] text-xs" role="group" aria-label="Show printings">
              {([[false, 'All printings'], [true, `From your collection (${ownedCount})`]] as const).map(([value, label]) => (
                <button
                  key={label}
                  aria-pressed={mine === value}
                  onClick={() => onMine?.(value)}
                  className={`px-2.5 py-1 ${mine === value ? 'bg-[var(--surface-hover)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--surface-hover)]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {mine && holding && onMine && (
          <>
            {owned.length === 0 && (
              <p className="text-[var(--muted)]">No copies in your boxes{holding.inDecks.length ? '' : ' or decks'}.</p>
            )}
            {owned.length > 0 && (
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
                {owned.map((c) => {
                  const current = c.where === 'deck' && c.cardId === card.id && c.finish === finish;
                  const image = imageOf.get(c.cardId);
                  const notes = [c.finish !== 'nonfoil' ? FINISH_LABEL[c.finish] : '', ...variantBadges(c.variant).map((v) => v.text)].filter(Boolean);
                  return (
                    <button
                      key={`${c.where}:${c.cardId}:${c.finish}:${c.location}:${c.variant}`}
                      disabled={busy || current}
                      onClick={() => pickCopy(c)}
                      title={c.where === 'box' ? `Use this copy from ${box(c.location)}` : 'The copy in this deck'}
                      className={`flex flex-col rounded-lg border p-1 text-left text-xs ${current
                        ? 'border-[var(--accent)]'
                        : 'border-[var(--border)] hover:border-[var(--muted)]'}`}
                    >
                      {image
                        ? <Image src={image} alt="" width={146} height={204} className={`w-full rounded ${isProxy(c.variant) ? 'opacity-70' : ''}`} unoptimized />
                        : <span className="flex aspect-[146/204] w-full items-center justify-center rounded bg-[var(--surface-hover)] text-[var(--muted)]">{card.name}</span>}
                      <span className="mt-1 truncate uppercase">{c.set} #{c.number}</span>
                      {notes.length > 0 && <span className="truncate text-[var(--muted)]">{notes.join(' · ')}</span>}
                      <span className={`truncate ${c.where === 'deck' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`}>
                        {c.where === 'deck' ? 'In this deck' : box(c.location)}{c.quantity > 1 ? ` ×${c.quantity}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {holding.inDecks.length > 0 && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Also in {holding.inDecks.map((d) => `${d.listName}${d.quantity > 1 ? ` ×${d.quantity}` : ''}`).join(', ')}.
              </p>
            )}
          </>
        )}
        {!(mine && holding && onMine) && !printings && !error && <p className="text-[var(--muted)]">Loading printings…</p>}
        {!(mine && holding && onMine) && printings && (
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
