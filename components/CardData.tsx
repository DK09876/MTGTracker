'use client';

/**
 * Settings: the card data kept on the Pi - how fresh it is, what it holds,
 * and a button to refresh it now. Search still asks Scryfall live.
 */

import { useCallback, useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { CardDataStatus } from '@/lib/card-store';

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function CardData() {
  const [status, setStatus] = useState<CardDataStatus | null>(null);
  const [started, setStarted] = useState(false);
  const load = useCallback(() => { api.cardData().then((r) => setStatus(r.status)).catch(() => {}); }, []);
  useEffect(() => {
    load();
    window.addEventListener(api.JOBS_CHANGED, load);
    return () => window.removeEventListener(api.JOBS_CHANGED, load);
  }, [load]);

  const refresh = async () => {
    setStarted(true);
    await api.refreshCardData().catch(() => setStarted(false));
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Card data</h2>
        <button onClick={refresh} disabled={started} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--surface-hover)] disabled:opacity-50">
          {started ? 'Refreshing — see the jobs menu' : 'Refresh now'}
        </button>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Every card&apos;s text, images and roles are kept on the Pi and refreshed from Scryfall&apos;s daily files around 3 AM,
        with today&apos;s prices for the cards in your lists. Decks, roles and the AI never wait on Scryfall; search still asks it live.
      </p>
      {status && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Last refresh</p>
            <p className={`text-sm font-medium ${status.error ? 'text-red-300' : ''}`}>
              {status.error ? `Failed: ${status.error}` : status.refreshedAt ? when(status.refreshedAt) : 'Not yet'}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Cards kept</p>
            <p className="text-sm font-medium">{status.cards.toLocaleString()} <span className="font-normal text-[var(--muted)]">· {status.tagged.toLocaleString()} with built-in tags</span></p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Prices updated</p>
            <p className="text-sm font-medium">{status.prices.toLocaleString()} printings</p>
          </div>
        </div>
      )}
    </section>
  );
}
