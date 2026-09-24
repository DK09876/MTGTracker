'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';

import AddCardsPanel from '@/components/AddCardsPanel';
import CardEditor from '@/components/CardEditor';
import CardModal from '@/components/CardModal';
import CommanderPicker from '@/components/CommanderPicker';
import DeckCards, { type Entry } from '@/components/DeckCards';
import DeckHealth from '@/components/DeckHealth';
import ImportResult from '@/components/ImportResult';
import * as api from '@/lib/api';
import type { List, ListedCard } from '@/lib/db';
import { formatDecklist, type Board } from '@/lib/decklist';
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
  const [addOpen, setAddOpen] = useState(false);
  const [section, setSection] = useState<'cards' | 'health'>('cards');
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

  const deck = list.kind === 'deck';
  // The commander is one of the 100: it leads the main board, and the
  // counts and value include it - "100 / 100", never "99 cards". The
  // sideboard and maybeboard are not in the deck, so not in the totals.
  const entries: Entry[] = deck && list.commander
    ? [{ card: list.commander, quantity: 1, finish: list.commanderFinish, board: 'main', commander: true }, ...cards]
    : cards;
  const main = entries.filter((e) => !deck || e.board === 'main');
  const value = main.reduce((sum, c) => sum + (priceOf(c.card, c.finish) ?? 0) * c.quantity, 0);
  const copies = main.reduce((sum, c) => sum + c.quantity, 0);
  const unique = main.length;
  const deckSize = copies;
  const maybe = entries.filter((e) => e.board === 'maybe').reduce((n, e) => n + e.quantity, 0);
  const side = entries.filter((e) => e.board === 'side').reduce((n, e) => n + e.quantity, 0);
  // By name, so another printing of a card still counts as "in the deck".
  const inDeck = new Map<string, Board>(entries.map((e) => [e.card.name.split(' // ')[0], e.board]));
  const selectedEntry = selected ? cards.find((c) => c.card.id === selected.id) : undefined;

  const moveCard = async (cardId: string, board: Board) => {
    setCards((prev) => prev.map((c) => (c.card.id === cardId ? { ...c, board } : c)));
    try {
      await api.updateCard(id, cardId, { board });
    } finally {
      await load().catch(() => {});
    }
  };

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
            {deck
              ? <span className={deckSize === 100 ? 'text-[var(--foreground)]' : ''}>{deckSize} / 100 cards</span>
              : <>{copies} card{copies === 1 ? '' : 's'}</>}
            {unique !== copies && <> · {unique} unique</>}
            {value > 0 && <> · ${value.toFixed(2)}</>}
            {maybe > 0 && <> · {maybe} on maybeboard</>}
            {side > 0 && <> · {side} in sideboard</>}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-[#221c08] hover:brightness-110"
          >
            Add cards
          </button>
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

      {deck && (
        <div className="mt-5 inline-flex overflow-hidden rounded-lg border border-[var(--border)] text-sm" role="tablist" aria-label="Deck view">
          {([['cards', 'Cards'], ['health', 'Deck health']] as const).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={section === value}
              onClick={() => setSection(value)}
              className={`px-4 py-1.5 ${section === value ? 'bg-[var(--surface-hover)] font-medium text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {deck && section === 'health' ? (
        <DeckHealth
          listId={id}
          commander={list.commander?.name ?? null}
          version={`${list.updatedAt}:${list.commander?.id ?? ''}`}
        />
      ) : (
        <DeckCards
          entries={entries}
          isDeck={deck}
          onSelect={setSelected}
          onQuantity={changeQuantity}
          onMove={moveCard}
        />
      )}

      <CardModal
        card={selected}
        onClose={() => setSelected(null)}
        actions={selectedEntry && (
          <CardEditor
            key={selectedEntry.card.id}
            listId={id}
            card={selectedEntry.card}
            finish={selectedEntry.finish}
            board={selectedEntry.board}
            isDeck={deck}
            onChanged={async (printingId) => {
              const data = await api.fetchList(id);
              setList(data.list);
              setCards(data.cards);
              setSelected(data.cards.find((c) => c.card.id === printingId)?.card ?? null);
            }}
          />
        )}
      />

      {addOpen && (
        <AddCardsPanel
          listId={id}
          commander={deck ? list.commander?.name ?? null : null}
          inDeck={inDeck}
          onAdded={() => { load().catch(() => {}); }}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}
