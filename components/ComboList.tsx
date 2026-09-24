'use client';

/**
 * Combos from Commander Spellbook, each with the cards it needs.
 *
 * The card a search was about - the commander, or the card you asked to
 * combo with - is in every combo, so it is named once in the header instead
 * of repeated as a tile. The rest are ordinary tiles: open them, add them to
 * a list.
 */

import CardTile from './CardTile';
import ManaCost from './ManaCost';
import type { ScryfallCard } from '@/lib/scryfall';
import type { Combo } from '@/lib/spellbook';

interface Props {
  combos: Combo[];
  cards: ScryfallCard[];
  inLists: Record<string, string[]>;
  /** The card every combo was searched for, if any. */
  anchor?: string;
  onSelect: (card: ScryfallCard) => void;
  onAdd?: (card: ScryfallCard) => void;
  /** The caller's own buttons on each piece, in place of "Add to list". */
  actions?: (card: ScryfallCard) => React.ReactNode;
  dense?: boolean;
}

const front = (name: string) => name.split(' // ')[0];

export default function ComboList({ combos, cards, inLists, anchor, onSelect, onAdd, actions, dense }: Props) {
  const byName = new Map<string, ScryfallCard>();
  for (const card of cards) {
    byName.set(card.name, card);
    byName.set(front(card.name), card);
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {combos.map((combo) => {
        const pieces = combo.cards.filter((name) => !anchor || front(name) !== front(anchor));
        const withAnchor = pieces.length < combo.cards.length;
        return (
          <section key={combo.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <h3 className="min-w-0 flex-1 font-medium">
                {combo.produces.slice(0, 3).join(' · ')}
                {combo.produces.length > 3 && (
                  <span className="text-[var(--muted)]"> · +{combo.produces.length - 3} more</span>
                )}
              </h3>
              <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                {combo.identity && <ManaCost cost={[...combo.identity].map((c) => `{${c}}`).join('')} size={14} />}
                {combo.price !== null && <span className="tabular-nums">${combo.price.toFixed(2)}</span>}
                {combo.popularity !== null && <span>in {combo.popularity.toLocaleString()} decks</span>}
                <a href={combo.url} target="_blank" rel="noreferrer" className="underline hover:text-[var(--foreground)]">
                  Spellbook ↗
                </a>
              </div>
            </header>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {withAnchor ? `${anchor} + ` : ''}{pieces.length} card{pieces.length === 1 ? '' : 's'}
            </p>

            <div className={`mt-3 grid gap-3 ${dense ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}>
              {pieces.map((name) => {
                const card = byName.get(name) ?? byName.get(front(name));
                return card ? (
                  <CardTile key={name} card={card} inLists={inLists[card.id]} onSelect={onSelect} onAdd={onAdd} footer={actions?.(card)} />
                ) : (
                  <div key={name} className="flex aspect-[488/680] items-center justify-center rounded-xl border border-[var(--border)] p-3 text-center text-sm text-[var(--muted)]">
                    {name}
                  </div>
                );
              })}
            </div>

            {(combo.steps || combo.prerequisites) && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-[var(--muted)] hover:text-[var(--foreground)]">How it works</summary>
                {combo.prerequisites && (
                  <p className="oracle mt-2 text-[var(--muted)]">Needs: {combo.prerequisites}</p>
                )}
                {combo.steps && <p className="oracle mt-2">{combo.steps}</p>}
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
