'use client';

/**
 * What to change: the combos the deck already has, the ones it is a single
 * card from (with that card one click away), and where to look first for
 * cuts. Combos come from Commander Spellbook; cuts from EDHREC and the
 * role counts.
 */

import Image from 'next/image';
import { useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { ListedCard } from '@/lib/db';
import type { Board } from '@/lib/decklist';

interface Props {
  listId: string;
  cards: ListedCard[];
  commander: string | null;
  version: string;
  onAdd: (cardId: string, board: Board) => Promise<void>;
  onMove: (cardId: string, board: Board) => void;
  onRemove: (cardId: string) => void;
}

const front = (name: string) => name.split(' // ')[0];

export default function DeckSuggestions({ listId, cards, commander, version, onAdd, onMove, onRemove }: Props) {
  const [insights, setInsights] = useState<api.DeckInsights | 'loading' | 'failed'>('loading');
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api.deckInsights(listId)
      .then((i) => { if (!cancelled) setInsights(i); })
      .catch(() => { if (!cancelled) setInsights('failed'); });
    return () => { cancelled = true; };
  }, [listId, version]);

  if (insights === 'loading') return <p className="mt-8 text-center text-[var(--muted)]">Looking for combos and cuts…</p>;
  if (insights === 'failed') return <p className="mt-8 text-center text-red-400">Couldn&apos;t work out suggestions just now — try again in a moment.</p>;

  const idOf = new Map(cards.map((c) => [front(c.card.name), c.card.id]));
  const short = commander?.split(',')[0] ?? 'this commander';
  const add = async (id: string, board: Board) => {
    setAdded((prev) => new Set(prev).add(id));
    try { await onAdd(id, board); } catch { setAdded((prev) => { const next = new Set(prev); next.delete(id); return next; }); }
  };

  return (
    <div className="mt-5 flex flex-col gap-8">
      <Section
        title={`Combos in this deck${insights.combos ? ` (${insights.combos.included.length})` : ''}`}
        subtitle="Every piece is already in the list. From Commander Spellbook."
      >
        {!insights.combos && <Unavailable />}
        {insights.combos?.included.length === 0 && <p className="text-sm text-[var(--muted)]">None found.</p>}
        <ul className="flex flex-col gap-2">
          {insights.combos?.included.map((c) => (
            <li key={c.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
              <ComboHeader produces={c.produces} url={c.url} />
              <p className="mt-1 text-[var(--muted)]">{c.cards.join(' + ')}</p>
              {c.steps && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--foreground)]">How it works</summary>
                  <p className="oracle mt-1 text-xs">{c.steps}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={`One card away${insights.combos ? ` (${insights.combos.toAdd.length})` : ''}`}
        subtitle={`Cards that would complete a combo with what the deck already has, in ${short}'s colours.`}
      >
        {!insights.combos && <Unavailable />}
        {insights.combos?.toAdd.length === 0 && <p className="text-sm text-[var(--muted)]">None found.</p>}
        <ul className="flex flex-col gap-2">
          {insights.combos?.toAdd.map((m) => (
            <li key={m.name} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                {m.image && <Image src={m.image} alt="" width={40} height={56} className="rounded" unoptimized />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    Completes {m.combos.length} combo{m.combos.length === 1 ? '' : 's'} · {m.price ? `$${Number(m.price).toFixed(2)}` : 'no price'}
                  </p>
                </div>
                {m.id && (added.has(m.id) ? (
                  <span className="text-xs text-[var(--muted)]">Added</span>
                ) : (
                  <span className="flex gap-1">
                    <button onClick={() => add(m.id!, 'main')} className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[#221c08] hover:brightness-110">+ Add</button>
                    <button onClick={() => add(m.id!, 'maybe')} className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface-hover)]">Maybe</button>
                  </span>
                ))}
              </div>
              <ul className="mt-2 flex flex-col gap-1 border-t border-[var(--border)] pt-2">
                {m.combos.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span>
                      <span className="text-[var(--foreground)]">{c.produces.slice(0, 2).join(' · ')}</span>
                      <span className="text-[var(--muted)]"> — with {c.have.join(' + ')}</span>
                    </span>
                    <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-[var(--muted)] underline hover:text-[var(--foreground)]">Spellbook ↗</a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Cuts to consider" subtitle="Where to look first when the deck needs room. Prompts, not verdicts.">
        {insights.cuts.length === 0 && (
          <p className="text-sm text-[var(--muted)]">Nothing stands out: every role is within its guideline{commander ? '' : ', and without a commander there is no EDHREC data to compare with'}.</p>
        )}
        <div className="flex flex-col gap-4">
          {insights.cuts.map((group) => (
            <div key={group.title} className="rounded-xl border border-[var(--border)]">
              <div className="border-b border-[var(--border)] px-4 py-2.5">
                <p className="text-sm font-medium">{group.title}</p>
                <p className="text-xs text-[var(--muted)]">{group.detail}</p>
              </div>
              <ul className="divide-y divide-[var(--border)]">
                {group.cards.map((card) => {
                  const id = idOf.get(front(card.name));
                  return (
                    <li key={card.name} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{card.name}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {card.inclusion === null ? `not on EDHREC's list for ${short}` : `in ${Math.round(card.inclusion * 100)}% of decks`}
                      </span>
                      {id && (
                        <span className="flex gap-1">
                          <button onClick={() => onMove(id, 'maybe')} className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface-hover)]">To maybe</button>
                          <button onClick={() => onRemove(id)} className="rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-red-400">Remove</button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-medium">{title}</h3>
      {subtitle && <p className="mb-3 text-sm text-[var(--muted)]">{subtitle}</p>}
      {children}
    </section>
  );
}

function ComboHeader({ produces, url }: { produces: string[]; url: string }) {
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="font-medium">{produces.slice(0, 3).join(' · ')}{produces.length > 3 ? ` · +${produces.length - 3} more` : ''}</span>
      <a href={url} target="_blank" rel="noreferrer" className="text-xs text-[var(--muted)] underline hover:text-[var(--foreground)]">Spellbook ↗</a>
    </p>
  );
}

function Unavailable() {
  return <p className="text-sm text-[var(--muted)]">Couldn&apos;t reach Commander Spellbook just now.</p>;
}
