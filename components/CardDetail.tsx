'use client';

/**
 * A card, shown properly.
 *
 * The image is the fastest way to recognise a card, but it is not readable at
 * list density and it does not tell you what a list is worth, so the text is
 * laid out alongside rather than left to the picture. Double-faced cards get
 * both halves - showing only the front hides half the card's rules.
 */

import Image from 'next/image';

import ManaCost from './ManaCost';
import type { ScryfallCard } from '@/lib/scryfall';
import { imageOf, priceOf, typeLineOf } from '@/lib/scryfall';

const RARITY: Record<string, string> = {
  common: 'bg-[#3a342b] text-[#ded5c6]',
  uncommon: 'bg-[#4a5560] text-[#d5e3ee]',
  rare: 'bg-[#5d5024] text-[#f0dfa0]',
  mythic: 'bg-[#6b2f1c] text-[#f5c0a3]',
  special: 'bg-[#4b2c54] text-[#e8ccf0]',
  bonus: 'bg-[#4b2c54] text-[#e8ccf0]',
};

export function RarityBadge({ rarity }: { rarity?: string }) {
  if (!rarity) return null;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${RARITY[rarity] ?? RARITY.common}`}>
      {rarity}
    </span>
  );
}

export function Price({ card }: { card: ScryfallCard }) {
  const usd = priceOf(card);
  if (usd === null) return <span className="text-[var(--muted)]">—</span>;
  return <span className="tabular-nums">${usd.toFixed(2)}</span>;
}

/** The faces worth rendering: both halves of a transforming card, else one. */
function facesOf(card: ScryfallCard) {
  if (card.card_faces?.length) {
    return card.card_faces.map((face) => ({
      name: face.name,
      manaCost: face.mana_cost,
      typeLine: face.type_line,
      oracle: face.oracle_text,
      flavor: face.flavor_text,
      stats: face.power ? `${face.power}/${face.toughness}` : face.loyalty ? `Loyalty ${face.loyalty}` : null,
    }));
  }
  return [{
    name: card.name,
    manaCost: card.mana_cost,
    typeLine: card.type_line,
    oracle: card.oracle_text,
    flavor: card.flavor_text,
    stats: card.power ? `${card.power}/${card.toughness}` : card.loyalty ? `Loyalty ${card.loyalty}` : null,
  }];
}

export default function CardDetail({ card }: { card: ScryfallCard }) {
  const image = imageOf(card, 'normal');
  const faces = facesOf(card);

  return (
    <div className="flex flex-col gap-5 sm:flex-row">
      {image && (
        <div className="mx-auto w-[244px] shrink-0 sm:mx-0">
          <Image
            src={image}
            alt={card.name}
            width={488}
            height={680}
            className="w-full rounded-[4.75%_/_3.5%] shadow-lg"
            unoptimized
          />
        </div>
      )}

      <div className="min-w-0 flex-1 space-y-4">
        {faces.map((face, i) => (
          <div key={i} className={i > 0 ? 'border-t border-[var(--border)] pt-4' : ''}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold">{face.name}</h2>
              <ManaCost cost={face.manaCost} />
            </div>
            {face.typeLine && <p className="mt-1 text-sm text-[var(--muted)]">{face.typeLine}</p>}
            {face.oracle && <p className="oracle mt-2 text-sm leading-relaxed">{face.oracle}</p>}
            {face.flavor && (
              <p className="oracle mt-2 border-l-2 border-[var(--border)] pl-3 text-sm italic text-[var(--muted)]">
                {face.flavor}
              </p>
            )}
            {face.stats && <p className="mt-2 text-sm font-semibold">{face.stats}</p>}
          </div>
        ))}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--border)] pt-4 text-sm sm:grid-cols-3">
          <Fact label="Set">
            {card.set_name ?? '—'}
            {card.collector_number && <span className="text-[var(--muted)]"> #{card.collector_number}</span>}
          </Fact>
          <Fact label="Rarity"><RarityBadge rarity={card.rarity} /></Fact>
          <Fact label="Price (USD)"><Price card={card} /></Fact>
          {card.artist && <Fact label="Artist">{card.artist}</Fact>}
          {card.released_at && <Fact label="Released">{card.released_at}</Fact>}
          {typeof card.cmc === 'number' && <Fact label="Mana value">{card.cmc}</Fact>}
        </dl>

        {card.legalities && <Legalities legalities={card.legalities} />}

        {card.scryfall_uri && (
          <a
            href={card.scryfall_uri}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm text-[var(--accent)] underline"
          >
            View on Scryfall
          </a>
        )}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/** Only the formats people actually ask about, and only where it is legal. */
const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper'];

function Legalities({ legalities }: { legalities: Record<string, string> }) {
  const legal = FORMATS.filter((f) => legalities[f] === 'legal');
  if (!legal.length) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Legal in</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {legal.map((format) => (
          <span key={format} className="rounded bg-[var(--surface-hover)] px-2 py-0.5 text-xs capitalize">
            {format}
          </span>
        ))}
      </div>
    </div>
  );
}

export { typeLineOf };
