'use client';

/**
 * One card in a grid: the art, the name, and the one control that matters.
 *
 * Deliberately image-led. At search density you recognise a card by its
 * picture long before you read its type line, and the full text is one click
 * away in the detail panel.
 */

import Image from 'next/image';

import ManaCost from './ManaCost';
import { RarityBadge } from './CardDetail';
import type { ScryfallCard } from '@/lib/scryfall';
import { imageOf, priceOf } from '@/lib/scryfall';

interface Props {
  card: ScryfallCard;
  inLists?: string[];
  onSelect: (card: ScryfallCard) => void;
  onAdd?: (card: ScryfallCard) => void;
  footer?: React.ReactNode;
}

export default function CardTile({ card, inLists, onSelect, onAdd, footer }: Props) {
  const image = imageOf(card, 'normal');
  const usd = priceOf(card);

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <button
        onClick={() => onSelect(card)}
        className="relative block w-full text-left"
        aria-label={`Show details for ${card.name}`}
      >
        {image ? (
          <Image
            src={image}
            alt={card.name}
            width={488}
            height={680}
            className="w-full transition-transform duration-200 group-hover:scale-[1.02]"
            unoptimized
          />
        ) : (
          <div className="flex aspect-[488/680] items-center justify-center px-3 text-center text-sm text-[var(--muted)]">
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
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium" title={card.name}>
            {card.name}
          </p>
          <ManaCost cost={card.mana_cost ?? card.card_faces?.[0]?.mana_cost} size={14} />
        </div>

        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <RarityBadge rarity={card.rarity} />
          <span className="truncate uppercase">{card.set}</span>
          <span className="ml-auto tabular-nums">{usd === null ? '—' : `$${usd.toFixed(2)}`}</span>
        </div>

        {onAdd && (
          <button
            onClick={() => onAdd(card)}
            className="mt-auto rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[#221c08] hover:brightness-110"
          >
            Add to list
          </button>
        )}
        {footer}
      </div>
    </div>
  );
}
