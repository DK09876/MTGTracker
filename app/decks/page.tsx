'use client';

/**
 * Your decks, and a new one: a name, a commander picked from a search, and
 * optionally a decklist pasted from Moxfield, Archidekt, Arena or MTGO.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import CommanderPicker from '@/components/CommanderPicker';
import ImportResult from '@/components/ImportResult';
import { IdentitySymbols } from '@/components/ManaCost';
import * as api from '@/lib/api';
import type { List } from '@/lib/db';
import { identityStyle } from '@/lib/identity';
import type { ImportSummary } from '@/lib/import-into';
import { imageOf } from '@/lib/scryfall';

export default function DecksPage() {
  const router = useRouter();
  const [decks, setDecks] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [commander, setCommander] = useState<api.CommanderOption | null>(null);
  const [decklist, setDecklist] = useState('');
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<{ id: string; result: ImportSummary } | null>(null);

  useEffect(() => {
    api.fetchLists('deck').then(setDecks).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const deckName = name.trim() || commander?.name;
    if (!deckName) { setError('Give the deck a name or pick a commander'); return; }
    setBusy(true);
    setError(null);
    try {
      const { list, imported: result } = await api.createDeck(deckName, commander?.id ?? null, decklist);
      // Show what an import did before moving on; otherwise go straight in.
      if (result && (result.missing.length || result.unreadable.length)) {
        setDecks((prev) => [...prev, list]);
        setImported({ id: list.id, result });
      } else {
        router.push(`/decks/${list.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that deck');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Decks</h1>
          {decks.length > 0 && (
            <p className="mt-1 text-sm text-[var(--muted)] tabular-nums">
              {decks.length} deck{decks.length === 1 ? '' : 's'} · ${decks.reduce((n, d) => n + d.totalValue, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} in all
              {decks.some((d) => d.totalCards < 100) && <> · {decks.filter((d) => d.totalCards < 100).length} short of 100</>}
            </p>
          )}
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)} className="btn-go rounded-full px-4 py-2 font-semibold">
            ＋ New deck
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={create} className="mt-4 flex flex-col gap-4 rounded-xl border border-[var(--border)] p-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[var(--muted)]">Commander</span>
            <CommanderPicker value={commander} onChange={setCommander} autoFocus />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[var(--muted)]">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={commander?.name ?? 'Defaults to the commander’s name'}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-base outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[var(--muted)]">
              Import a decklist <span className="opacity-70">(optional — paste from Moxfield, Archidekt, Arena or MTGO)</span>
            </span>
            <textarea
              value={decklist}
              onChange={(e) => setDecklist(e.target.value)}
              rows={8}
              placeholder={'1x Kratos, God of War (SLD) 2207\n1x Sol Ring (SOC) 128\n33x Mountain (ACR) 107'}
              spellCheck={false}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 font-mono text-xs outline-none focus:border-[var(--accent)]"
            />
            {!commander && decklist.trim() && (
              <span className="text-xs text-[var(--muted)]">
                No commander picked: the list&apos;s &ldquo;Commander&rdquo; section is used, or its first card if that can be one —
                otherwise you can pick it from the deck&apos;s legendary cards afterwards.
              </span>
            )}
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              disabled={busy}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 font-medium text-[#221c08] hover:brightness-110 disabled:opacity-60"
            >
              {busy ? (decklist.trim() ? 'Importing…' : 'Creating…') : 'Create deck'}
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setError(null); }}
              className="rounded-xl border border-[var(--border)] px-4 py-2 hover:bg-[var(--surface)]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {imported && (
        <div className="mt-4">
          <ImportResult result={imported.result} />
          <Link href={`/decks/${imported.id}`} className="mt-2 inline-block text-sm text-[var(--accent)] underline">
            Open the deck →
          </Link>
        </div>
      )}

      {!creating && error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {loading && <p className="mt-8 text-[var(--muted)]">Loading…</p>}
      {!loading && !decks.length && !creating && (
        <p className="mt-10 text-center text-[var(--muted)]">No decks yet.</p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {decks.map((deck) => {
          const art = deck.commander ? deck.commander.image_uris?.art_crop ?? deck.commander.card_faces?.[0]?.image_uris?.art_crop ?? imageOf(deck.commander, 'normal') : null;
          const total = deck.totalCards;
          const identity = deck.commander?.color_identity ?? [];
          return (
            // Each deck in its commander's colours, its art on the cover.
            <Link
              key={deck.id}
              href={`/decks/${deck.id}`}
              style={identityStyle(identity)}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--c1)_30%,var(--border))] bg-[var(--surface)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_color-mix(in_srgb,var(--c1)_22%,transparent)]"
            >
              <div className="relative h-32 overflow-hidden">
                <div aria-hidden className="id-glow absolute -inset-6 blur-xl" />
                {art && <Image src={art} alt="" width={626} height={457} className="absolute inset-0 h-full w-full object-cover opacity-80 transition duration-500 group-hover:scale-105" unoptimized />}
                <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--surface)]" />
                <span className="absolute left-3 top-3"><IdentitySymbols identity={identity.join('')} size={18} /></span>
              </div>
              <div className="relative -mt-6 flex flex-1 flex-col gap-1 px-4 pb-4">
                <p className="font-display text-xl font-extrabold leading-tight">{deck.name}</p>
                <p className="truncate text-sm text-[var(--muted)]">{deck.commander?.name ?? 'No commander'}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-bold tabular-nums">
                  <span className={`rounded-full px-2.5 py-1 ${total === 100 ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{total} / 100</span>
                  {deck.totalValue > 0 && <span className="rounded-full bg-white/5 px-2.5 py-1">${deck.totalValue.toFixed(2)}</span>}
                </div>
              </div>
              <div aria-hidden className="id-grad h-[3px]" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
