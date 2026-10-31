'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';

import AddCardsPanel from '@/components/AddCardsPanel';
import CardEditor from '@/components/CardEditor';
import CardModal from '@/components/CardModal';
import CardTags from '@/components/CardTags';
import CommanderPicker from '@/components/CommanderPicker';
import DeckCards, { type Entry } from '@/components/DeckCards';
import DeckCollection from '@/components/DeckCollection';
import DeckHealth from '@/components/DeckHealth';
import DeckSuggestions from '@/components/DeckSuggestions';
import DeckTags from '@/components/DeckTags';
import ImportResult from '@/components/ImportResult';
import { IdentitySymbols } from '@/components/ManaCost';
import MoreMenu from '@/components/MoreMenu';
import * as api from '@/lib/api';
import type { List, ListedCard } from '@/lib/db';
import { formatDecklist, type Board } from '@/lib/decklist';
import { identityStyle } from '@/lib/identity';
import { canLead } from '@/lib/import';
import type { ImportSummary } from '@/lib/import-into';
import type { ScryfallCard } from '@/lib/scryfall';
import type { DeckTags as Tags } from '@/lib/tags';
import { imageOf, priceOf } from '@/lib/scryfall';

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
  const [section, setSection] = useState<'cards' | 'tags' | 'health' | 'suggestions' | 'collection'>('cards');
  const [tags, setTags] = useState<Tags | null>(null);
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

  // A deck's tags load alongside it; a plain list has none.
  const isDeck = list?.kind === 'deck';
  useEffect(() => {
    if (!isDeck) return;
    let cancelled = false;
    api.deckTags(id).then((t) => { if (!cancelled) setTags(t); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, isDeck]);

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
  // Tags are for anything in the deck, the commander included.
  const selectedInDeck = !!selected && entries.some((e) => e.card.id === selected.id);

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

  // A deck takes on its commander's colours, its art behind the header.
  const hero = deck && !!list.commander && !changingCommander;
  const heroArt = list.commander ? list.commander.image_uris?.art_crop ?? list.commander.card_faces?.[0]?.image_uris?.art_crop ?? null : null;

  return (
    <div style={deck && list.commander ? identityStyle(list.commander.color_identity ?? []) : undefined}>
      <Link href={deck ? '/decks' : '/lists'} className="relative z-10 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
        ← All {deck ? 'decks' : 'lists'}
      </Link>

      {/* A deck's header: its commander's art behind a name in its colours. */}
      <div className={`relative isolate mt-2 ${hero ? '-mx-4 overflow-hidden px-4 pb-4 pt-20 sm:mx-0 sm:rounded-3xl sm:px-6 sm:pt-24' : ''}`}>
        {hero && (
          <>
            <div aria-hidden className="id-glow absolute -inset-10 -z-20 opacity-70 blur-2xl" />
            {heroArt && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroArt} alt="" aria-hidden className="absolute inset-0 -z-20 h-full w-full scale-110 object-cover object-[50%_25%] opacity-70 blur-[3px] saturate-125" />
            )}
            <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-[var(--background)]/10 via-[var(--background)]/60 to-[var(--background)]" />
          </>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
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
                  aria-label="Name"
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-lg"
                />
                <button className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold">Save</button>
                <button type="button" onClick={() => setRenaming(false)} className="px-2 text-sm text-[var(--muted)]">Cancel</button>
              </form>
            ) : (
              <h1 className={`font-display font-extrabold leading-[1.05] [text-wrap:balance] ${deck ? 'id-text text-3xl sm:text-4xl' : 'text-3xl'}`}>{list.name}</h1>
            )}
            {deck && list.commander && !changingCommander && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--foreground)]/85">
                <IdentitySymbols identity={(list.commander.color_identity ?? []).join('')} size={17} />
                <button onClick={() => setSelected(list.commander)} className="hover:underline">{list.commander.name}</button>
                <button onClick={() => setChangingCommander(true)} className="text-xs text-[var(--muted)] underline hover:text-[var(--foreground)]">Change</button>
              </p>
            )}
            <p className="mt-3 flex flex-wrap gap-1.5 text-xs font-bold tabular-nums">
              {deck
                ? <span className={`rounded-full px-2.5 py-1 ${deckSize === 100 ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{deckSize} / 100</span>
                : <span className="rounded-full bg-white/5 px-2.5 py-1">{copies} card{copies === 1 ? '' : 's'}</span>}
              {value > 0 && <span className="rounded-full bg-white/5 px-2.5 py-1">${value.toFixed(2)}</span>}
              {unique !== copies && <span className="rounded-full bg-white/5 px-2.5 py-1 font-semibold text-[var(--muted)]">{unique} unique</span>}
              {maybe > 0 && <span className="rounded-full bg-white/5 px-2.5 py-1 font-semibold text-[var(--muted)]">{maybe} maybe</span>}
              {side > 0 && <span className="rounded-full bg-white/5 px-2.5 py-1 font-semibold text-[var(--muted)]">{side} sideboard</span>}
            </p>
          </div>

          <div className="flex w-full gap-2 sm:w-auto">
            <button onClick={() => setAddOpen(true)} className="btn-go flex-1 rounded-full px-5 py-2 text-sm font-semibold sm:flex-none">
              ＋ Add cards
            </button>
            <MoreMenu
              items={[
                { label: importing ? 'Close the text' : 'Edit as text', onClick: () => (importing ? setImporting(false) : openText()) },
                { label: 'Rename', onClick: () => { setDraftName(list.name); setRenaming(true); } },
                ...(deck && list.commander ? [{ label: 'Change commander', onClick: () => setChangingCommander(true) }] : []),
                {
                  label: `Delete ${deck ? 'deck' : 'list'}…`,
                  danger: true,
                  confirm: `Delete “${list.name}”? The cards stay in any other lists.`,
                  onClick: async () => { await api.deleteList(id); router.push(deck ? '/decks' : '/lists'); },
                },
              ]}
            />
          </div>
        </div>
      </div>

      {deck && (!list.commander || changingCommander) && (
        <div className="mt-4">
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
        <div className="mt-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 text-sm" role="tablist" aria-label="Deck view">
          {([['cards', 'Cards'], ['tags', 'Tags'], ['health', 'Health'], ['suggestions', 'Suggestions'], ['collection', 'Collection']] as const).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={section === value}
              onClick={() => setSection(value)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 ${section === value ? 'id-grad font-semibold text-[#15110a]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {deck && section === 'tags' ? (
        <DeckTags listId={id} entries={entries} tags={tags} onTags={setTags} onSelect={setSelected} />
      ) : deck && section === 'collection' ? (
        <DeckCollection listId={id} version={`${list.updatedAt}:${list.commander?.id ?? ''}`} />
      ) : deck && section === 'suggestions' ? (
        <DeckSuggestions
          listId={id}
          cards={cards}
          commander={list.commander?.name ?? null}
          version={`${list.updatedAt}:${list.commander?.id ?? ''}`}
          onAdd={async (cardId, board) => { await api.addCard(id, cardId, 1, board); await load(); }}
          onMove={moveCard}
          onRemove={(cardId) => changeQuantity(cardId, 0)}
        />
      ) : deck && section === 'health' ? (
        <DeckHealth
          listId={id}
          commander={list.commander ? { card: list.commander, finish: list.commanderFinish } : null}
          cards={cards.filter((c) => c.board === 'main')}
          version={`${list.updatedAt}:${list.commander?.id ?? ''}`}
        />
      ) : (
        <DeckCards
          listId={id}
          entries={entries}
          tags={deck ? tags : null}
          version={`${list.updatedAt}:${list.commander?.id ?? ''}`}
          isDeck={deck}
          onSelect={setSelected}
          onQuantity={changeQuantity}
          onMove={moveCard}
        />
      )}

      <CardModal
        card={selected}
        onClose={() => setSelected(null)}
        actions={(selectedEntry || (deck && selectedInDeck && tags)) && (
          <>
            {deck && selectedInDeck && tags && selected && (
              <CardTags listId={id} card={selected} tags={tags} onChange={setTags} />
            )}
            {selectedEntry && (
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
          </>
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
