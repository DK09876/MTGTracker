'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';

import CardModal from '@/components/CardModal';
import CommanderPicker from '@/components/CommanderPicker';
import ImportResult from '@/components/ImportResult';
import CardTile from '@/components/CardTile';
import * as api from '@/lib/api';
import { filterCards } from '@/lib/filter';
import type { List, ListedCard } from '@/lib/db';
import { formatDecklist } from '@/lib/decklist';
import { canLead } from '@/lib/import';
import type { ImportSummary } from '@/lib/import-into';
import type { ScryfallCard } from '@/lib/scryfall';
import { imageOf, priceOf, typeLineOf } from '@/lib/scryfall';

export default function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [list, setList] = useState<List | null>(null);
  const [cards, setCards] = useState<ListedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [filter, setFilter] = useState('');
  const [changingCommander, setChangingCommander] = useState(false);
  const [importing, setImporting] = useState(false);
  const [decklist, setDecklist] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [imported, setImported] = useState<ImportSummary | null>(null);
  const [rejected, setRejected] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const data = await api.fetchList(id);
    setList(data.list);
    setCards(data.cards);
    setDraftName(data.list.name);
  }, [id]);

  // Fetched on mount, with a guard so a slow response cannot write into a
  // page the user has already navigated away from.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.fetchList(id);
        if (cancelled) return;
        setList(data.list);
        setCards(data.cards);
        setDraftName(data.list.name);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load that list');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const changeQuantity = async (cardId: string, quantity: number) => {
    // Optimistic: the round trip is fast but the grid should not flicker.
    setCards((prev) =>
      quantity <= 0
        ? prev.filter((c) => c.card.id !== cardId)
        : prev.map((c) => (c.card.id === cardId ? { ...c, quantity } : c)),
    );
    try {
      await api.setQuantity(id, cardId, quantity);
    } finally {
      // Re-read either way: on success to pick up the recalculated totals,
      // on failure to undo the optimistic change.
      await load().catch(() => {});
    }
  };

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (error) return <p className="text-red-400">{error}</p>;
  if (!list) return null;

  // Filtering runs over the stored payloads, so it never touches the network.
  const { results: shown, unsupported } = filterCards(cards, filter);
  const deck = list.kind === 'deck';
  // A Commander deck is 100 cards with the commander, so every count and
  // total here includes it - "100 / 100", never "99 cards".
  const commander = deck && list.commander ? 1 : 0;
  const commanderValue = commander ? priceOf(list.commander!, list.commanderFinish) ?? 0 : 0;
  const value = shown.reduce((sum, c) => sum + (priceOf(c.card, c.finish) ?? 0) * c.quantity, 0) + (filter ? 0 : commanderValue);
  const copies = shown.reduce((sum, c) => sum + c.quantity, 0) + (filter ? 0 : commander);
  const unique = shown.length + (filter ? 0 : commander);
  const filtered = shown.length !== cards.length;
  const deckSize = cards.reduce((sum, c) => sum + c.quantity, 0) + commander;

  // "Edit as text": the deck as it stands, in the same format it imports.
  const openText = () => {
    setDecklist(formatDecklist(deck ? list.commander : null, cards, list.commanderFinish));
    setImported(null);
    setRejected(false);
    setImporting(true);
  };

  /** Save the text back: the list becomes exactly what it says. */
  const saveText = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportBusy(true);
    try {
      const { imported: result, ok } = await api.replaceDecklist(id, decklist);
      setImported(result);
      setRejected(!ok);
      if (ok) {
        setImporting(false);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that list');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div>
      <Link href={deck ? '/decks' : '/lists'} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
        ← All {deck ? 'decks' : 'lists'}
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {renaming ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (draftName.trim()) {
                  await api.renameList(id, draftName.trim());
                  await load();
                }
                setRenaming(false);
              }}
              className="flex gap-2"
            >
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                autoFocus
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-lg"
              />
              <button className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[#221c08]">
                Save
              </button>
            </form>
          ) : (
            <h1 className="truncate text-xl font-semibold">{list.name}</h1>
          )}
          <p className="mt-1 text-sm text-[var(--muted)]">
            {deck && !filtered
              ? <span className={deckSize === 100 ? 'text-[var(--foreground)]' : ''}>{deckSize} / 100 cards</span>
              : <>{copies} card{copies === 1 ? '' : 's'}</>}
            {unique !== copies && <> · {unique} unique</>}
            {value > 0 && <> · ${value.toFixed(2)}</>}
            {filtered && <> · filtered from {cards.length}</>}
          </p>
        </div>

        <div className="flex gap-2 text-sm">
          <button
            onClick={() => (importing ? setImporting(false) : openText())}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface)]"
          >
            Edit as text
          </button>
          {!renaming && (
            <button
              onClick={() => setRenaming(true)}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface)]"
            >
              Rename
            </button>
          )}
          <button
            onClick={async () => {
              if (!confirm(`Delete "${list.name}"? The cards stay in any other lists.`)) return;
              await api.deleteList(id);
              router.push(deck ? '/decks' : '/lists');
            }}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-red-400 hover:bg-[var(--surface)]"
          >
            Delete
          </button>
        </div>
      </div>

      {deck && (
        <div className="mt-4">
          {list.commander && !changingCommander ? (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
              <button onClick={() => setSelected(list.commander)} aria-label={`Show details for ${list.commander.name}`}>
                {imageOf(list.commander, 'small') && (
                  <Image src={imageOf(list.commander, 'small')!} alt="" width={56} height={78} className="rounded" unoptimized />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Commander</p>
                <p className="truncate font-medium">{list.commander.name}</p>
                <p className="truncate text-sm text-[var(--muted)]">{typeLineOf(list.commander)}</p>
              </div>
              <button
                onClick={() => setChangingCommander(true)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)]"
              >
                Change
              </button>
            </div>
          ) : (
            <div>
              {!list.commander && cards.some((c) => canLead(c.card)) && (
                // A flat decklist sorts the commander in with the rest.
                <div className="mb-4">
                  <p className="mb-1.5 text-sm text-[var(--muted)]">Commander from this deck?</p>
                  <div className="flex flex-wrap gap-2">
                    {cards.filter((c) => canLead(c.card)).map(({ card }) => (
                      <button
                        key={card.id}
                        onClick={async () => { await api.setCommander(id, card.id, true); await load(); }}
                        className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 pl-1 pr-3 text-sm hover:border-[var(--accent)]"
                      >
                        {imageOf(card, 'small') && <Image src={imageOf(card, 'small')!} alt="" width={28} height={39} className="rounded-sm" unoptimized />}
                        {card.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="mb-1.5 text-sm text-[var(--muted)]">{list.commander ? 'New commander' : 'Or search for one'}</p>
              <CommanderPicker
                value={null}
                autoFocus={changingCommander}
                onChange={async (picked) => {
                  if (!picked) return;
                  await api.setCommander(id, picked.id);
                  setChangingCommander(false);
                  await load();
                }}
              />
              {changingCommander && (
                <button onClick={() => setChangingCommander(false)} className="mt-2 text-sm text-[var(--muted)] underline">
                  Keep {list.commander?.name}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {importing && (
        <form onSubmit={saveText} className="mt-4 flex flex-col gap-2">
          <p className="text-sm text-[var(--muted)]">
            Edit the list, or paste a new one over it. Saving makes the {deck ? 'deck' : 'list'} exactly this —
            same format as Moxfield, Archidekt, Arena and MTGO.
          </p>
          <textarea
            value={decklist}
            onChange={(e) => { setDecklist(e.target.value); setRejected(false); }}
            rows={Math.min(24, Math.max(8, decklist.split('\n').length + 1))}
            autoFocus
            placeholder={'1 Sol Ring (SOC) 128\n33 Mountain (ACR) 107'}
            spellCheck={false}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 font-mono text-xs outline-none focus:border-[var(--accent)]"
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button disabled={importBusy} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-[#221c08] disabled:opacity-60">
              {importBusy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setImporting(false)} className="rounded-lg border border-[var(--border)] px-3 py-1.5">
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(decklist);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch { /* clipboard blocked: the text is still there to select */ }
              }}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </form>
      )}
      {imported && rejected && (
        <p className="mt-3 text-sm text-amber-400">Nothing was changed — fix the lines below and save again.</p>
      )}
      {imported && (rejected || imported.commander) && <ImportResult result={imported} applied={!rejected} />}

      {cards.length > 0 && (
        <div className="mt-5">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter this list — t:creature, c:rg, cmc<=3, usd>5, -t:land"
            aria-label="Filter this list"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          {unsupported.length > 0 && (
            <p className="mt-2 text-xs text-amber-400">
              Ignoring {unsupported.map((u) => `"${u}"`).join(', ')} — not supported here.
              Supported: name, t, o, c/id, cmc/mv, usd, pow, tou, r, set, a, kw, is, and - to exclude.
            </p>
          )}
        </div>
      )}

      {!cards.length ? (
        <p className="mt-12 text-center text-[var(--muted)]">
          Nothing here yet. <Link href="/" className="text-[var(--accent)] underline">Search for a card</Link> to add one.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map(({ card, quantity, finish }) => (
            <CardTile
              key={card.id}
              card={card}
              finish={finish}
              onSelect={setSelected}
              footer={
                <div className="mt-auto flex items-center gap-2">
                  <button
                    onClick={() => changeQuantity(card.id, quantity - 1)}
                    aria-label={`One fewer ${card.name}`}
                    className="h-8 w-8 rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)]"
                  >
                    −
                  </button>
                  <span className="min-w-[2ch] text-center text-sm tabular-nums">{quantity}</span>
                  <button
                    onClick={() => changeQuantity(card.id, quantity + 1)}
                    aria-label={`One more ${card.name}`}
                    className="h-8 w-8 rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)]"
                  >
                    +
                  </button>
                  <button
                    onClick={() => changeQuantity(card.id, 0)}
                    aria-label={`Remove ${card.name}`}
                    className="ml-auto rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              }
            />
          ))}
        </div>
      )}

      {cards.length > 0 && !shown.length && (
        <p className="mt-12 text-center text-[var(--muted)]">Nothing in this list matches that filter.</p>
      )}

      <CardModal card={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
