'use client';

/**
 * The card popup for the whole app (AGENTS.md, "Showing text"): any card name anywhere opens it, by the card or by
 * name alone. It shows the card from Scryfall's data (CardDetail) and its other printings, each with its set and
 * price; pressing one shows that printing. Mounted once, in the layout. A page with its own popup and actions for
 * the card (a deck's) opens that one instead, through CardTextContext.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

import CardModal from './CardModal';
import * as api from '@/lib/api';
import { lookCard } from '@/lib/card-cache';
import type { ScryfallCard } from '@/lib/scryfall';

let shown: ScryfallCard | null = null;
const listeners = new Set<() => void>();
const set = (c: ScryfallCard | null) => { shown = c; for (const l of listeners) l(); };

/** Open the card popup: with the card, or with a name (looked up first through the app's card cache). */
export function openCard(card: ScryfallCard | string): void {
  if (typeof card !== 'string') { set(card); return; }
  void lookCard(card).then((s) => { if (s.status === 'found') set(s.card); });
}

export default function CardPopup() {
  const card = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => shown, () => null);
  return <CardModal card={card} onClose={() => set(null)} actions={card ? <Printings card={card} onPick={set} /> : null} />;
}

/** The card's other printings: set, number and price; the one shown is marked. */
function Printings({ card, onPick }: { card: ScryfallCard; onPick: (c: ScryfallCard) => void }) {
  const [list, setList] = useState<api.Printing[] | null>(null);
  const [failed, setFailed] = useState(false);
  const oracle = card.oracle_id;
  useEffect(() => {
    if (!oracle) return;
    let stop = false;
    api.printings(oracle).then((p) => { if (!stop) { setList(p); setFailed(false); } }).catch(() => { if (!stop) setFailed(true); });
    return () => { stop = true; };
  }, [oracle]);
  if (!oracle) return null;
  if (failed) return <p className="text-sm text-[var(--muted)]">Couldn’t load the other printings just now.</p>;
  if (!list) return <p className="text-sm text-[var(--muted)]">Loading printings…</p>;
  const show = async (id: string) => {
    const r = await fetch(`${process.env.NEXT_PUBLIC_MTG_BASE_PATH ?? ''}/api/cards?id=${encodeURIComponent(id)}`).then((x) => x.json() as Promise<{ card?: ScryfallCard }>).catch(() => ({ card: undefined }));
    if (r.card) onPick(r.card);
  };
  return (
    <div className="flex flex-col gap-2" data-printings>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">Printings · {list.length}</h3>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {list.map((p) => {
          const usd = p.prices.usd ?? p.prices.usd_foil ?? p.prices.usd_etched;
          const on = p.id === card.id;
          return (
            <li key={p.id} className="shrink-0">
              <button type="button" onClick={() => void show(p.id)} aria-pressed={on} title={`${p.setName} #${p.collectorNumber}`}
                className={`flex w-[92px] flex-col items-center gap-1 rounded-lg border p-1.5 text-[11px] ${on ? 'border-[var(--accent)]' : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.image ? <img src={p.image} alt="" loading="lazy" className="w-full rounded" /> : <span className="aspect-[488/680] w-full rounded bg-[var(--background)]" />}
                <span className="w-full truncate text-center uppercase text-[var(--muted)]">{p.set} · {p.collectorNumber}</span>
                <span className="tabular-nums">{usd ? `$${usd}` : '—'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
