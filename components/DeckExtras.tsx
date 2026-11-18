'use client';

/**
 * What a deck needs on the table beyond its cards: the tokens and emblems its cards make, and the other pieces
 * Scryfall files with them (The Monarch, The Initiative, Day // Night, dungeons, meld results). From each card's
 * related parts (Scryfall's all_parts), one per name and type, each with the deck cards that make it. Pictures
 * come straight from Scryfall by id; a click or tap opens the card popup, read by id (tokens share names).
 */

import { useMemo, useState } from 'react';

import CardName from './CardName';
import { openFullCard } from './CardText';
import { extrasOf, type ExtraKind as Kind } from '@/lib/deck-extras';
import type { ScryfallCard } from '@/lib/scryfall';

const TITLE: Record<Kind, string> = { token: 'Tokens', emblem: 'Emblems', other: 'Other pieces' };
const image = (id: string, size: 'small' | 'normal' = 'normal') => `https://cards.scryfall.io/${size}/front/${id[0]}/${id[1]}/${id}.jpg`;

export default function DeckExtras({ cards }: { cards: ScryfallCard[] }) {
  const extras = useMemo(() => extrasOf(cards), [cards]);
  const [open, setOpen] = useState(true);
  if (!extras.length) return null;
  const groups = (['token', 'emblem', 'other'] as Kind[]).map((k) => ({ k, rows: extras.filter((e) => e.kind === k) })).filter((g) => g.rows.length);
  return (
    <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-deck-extras>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left">
        <span className="font-display text-lg font-bold">Tokens &amp; extras <span className="text-sm font-normal text-[var(--muted)]">· {extras.length}</span></span>
        <span className="text-xs text-[var(--muted)]">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-[var(--border)] px-4 py-3">
          <p className="text-[13px] text-[var(--muted)]">What your cards put on the table that isn’t in the deck: worth having the tokens and markers ready.</p>
          {groups.map((g) => (
            <div key={g.k} className="flex flex-col gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">{TITLE[g.k]} · {g.rows.length}</h3>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
                {g.rows.map((e) => {
                  const stub = { id: e.id, name: e.name, image_uris: { normal: image(e.id) } } as unknown as ScryfallCard;
                  return (
                    <li key={`${e.name}|${e.typeLine}`} className="flex min-w-0 flex-col gap-1" data-extra={e.name}>
                      <button type="button" onClick={() => openFullCard(stub)} aria-label={`Open ${e.name}`} className="block overflow-hidden rounded-[4.75%_/_3.5%]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image(e.id, 'small')} alt="" loading="lazy" className="w-full" />
                      </button>
                      <CardName name={e.name} card={stub} onOpen={openFullCard} className="text-sm font-semibold" />
                      <span className="truncate text-[11px] text-[var(--muted)]" title={e.typeLine}>{e.typeLine.replace(/^Token\s*/, '') || 'Token'}</span>
                      <span className="line-clamp-2 text-[11px] text-[var(--faint)]" title={e.from.join(', ')}>from {e.from.join(', ')}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
