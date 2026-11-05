'use client';

/**
 * One card in a grid: the art, the name, and the one control that matters.
 *
 * Deliberately image-led. At search density you recognise a card by its
 * picture long before you read its type line, and the full text is one click
 * away in the detail panel.
 */

import Image from 'next/image';

import Tilt from './Tilt';
import type { Finish, ScryfallCard } from '@/lib/scryfall';
import { imageOf, priceOf } from '@/lib/scryfall';
import { steady } from '@/lib/steady-tap';

interface Props {
  card: ScryfallCard;
  inLists?: string[];
  /** Copies owned, any printing. */
  owned?: number;
  onSelect: (card: ScryfallCard) => void;
  onAdd?: (card: ScryfallCard) => void;
  footer?: React.ReactNode;
  /** Foil or etched copies are labelled and priced as such. */
  finish?: Finish;
  /** Just the picture: for small cards, where the details are a click away. */
  compact?: boolean;
  /** Copies, shown on the picture when compact and more than one. */
  quantity?: number;
}

export default function CardTile({ card, inLists, owned, onSelect, onAdd, footer, finish = 'nonfoil', compact = false, quantity = 1 }: Props) {
  const image = imageOf(card, 'normal');
  const usd = priceOf(card, finish);

  return (
    <div className="rise flex flex-col gap-2">
      <button
        onClick={() => onSelect(card)}
        className="relative block w-full text-left"
        aria-label={`Show details for ${card.name}`}
      >
        {image ? (
          <Tilt foil={finish !== 'nonfoil'} className="rounded-[4.75%/3.4%]">
            <Image src={image} alt={card.name} width={488} height={680} className="w-full" unoptimized />
          </Tilt>
        ) : (
          <div className="flex aspect-[488/680] items-center justify-center rounded-[4.75%/3.4%] border border-[var(--border)] bg-[var(--surface)] px-3 text-center text-sm text-[var(--muted)]">
            {card.name}
          </div>
        )}
        {inLists && inLists.length > 0 && (
          <span
            className="absolute right-2 top-2 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-[#221c08]"
            title={`In ${inLists.join(', ')}`}
          >
            in {inLists.length === 1 ? inLists[0] : `${inLists.length} lists`}
          </span>
        )}
        {owned ? (
          <span className="absolute bottom-2 left-2 rounded-full bg-[#14120f]/85 px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)]" title="In your collection, any printing">
            ✓ Own {owned}
          </span>
        ) : null}
        {compact && quantity > 1 && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-[#14120f]/85 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[var(--foreground)] ring-1 ring-[var(--border)]">×{quantity}</span>
        )}
      </button>

      {/* Under the picture, one quiet line: the name (the cost and rarity are on the card), set and price, and Add. */}
      {!compact && <div className="flex flex-1 flex-col gap-1.5 px-0.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-tight" title={card.name}>{card.name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] tabular-nums text-[var(--muted)]">
              <span className="uppercase" title={card.set_name}>{card.set}</span>
              {finish !== 'nonfoil' && <span className="font-semibold text-[var(--foreground)]/80">· {finish === 'etched' ? 'Etched' : 'Foil'}</span>}
              <span>· {usd === null ? '—' : `$${usd.toFixed(2)}`}</span>
            </p>
          </div>
          {onAdd && (
            <button
              {...steady(() => onAdd(card))}
              aria-label={`Add ${card.name} to a list`}
              title="Add to a list"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-base text-[var(--muted)] transition-colors hover:border-[var(--c1)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
            >
              ＋
            </button>
          )}
        </div>
        {footer}
      </div>}
    </div>
  );
}
