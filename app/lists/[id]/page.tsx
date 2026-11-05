'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useRef, useState } from 'react';

import AddCardsPanel from '@/components/AddCardsPanel';
import CardEditor from '@/components/CardEditor';
import CardModal from '@/components/CardModal';
import CardRoles from '@/components/CardRoles';
import CardTags from '@/components/CardTags';
import CommanderPicker from '@/components/CommanderPicker';
import DeckBuild, { type DeckTab } from '@/components/DeckBuild';
import DeckCards, { type Entry } from '@/components/DeckCards';
import DeckGlance from '@/components/DeckGlance';
import DeckPlan from '@/components/DeckPlan';
import DeckRail from '@/components/DeckRail';
import DeckPlaytest from '@/components/DeckPlaytest';
import DeckChat from '@/components/DeckChat';
import DeckCollection from '@/components/DeckCollection';
import DeckHealth from '@/components/DeckHealth';
import DeckSuggestions from '@/components/DeckSuggestions';
import DeckTags from '@/components/DeckTags';
import FlaggedZone from '@/components/FlaggedZone';
import GameChangerLine from '@/components/GameChangerLine';
import SlotQuestions from '@/components/SlotQuestions';
import PasteFormats from '@/components/PasteFormats';
import ImportResult from '@/components/ImportResult';
import { IdentitySymbols } from '@/components/ManaCost';
import MoreMenu from '@/components/MoreMenu';
import * as api from '@/lib/api';
import type { List, ListedCard } from '@/lib/db';
import { formatDecklist, type Board } from '@/lib/decklist';
import { identityStyle } from '@/lib/identity';
import type { Slot, SlotQuestion } from '@/lib/commanders';
import { deckFlags, type Flag } from '@/lib/health';
import { boardName, cutBoard, DEFAULT_SECTIONS, type DeckSection } from '@/lib/sections-shared';
import { DECKLIST_EXAMPLE, MOXFIELD_REFUSES, readDeckBox } from '@/lib/deck-links';
import { canLead } from '@/lib/import';
import type { ImportSummary } from '@/lib/import-into';
import type { ScryfallCard } from '@/lib/scryfall';
import type { DeckTags as Tags } from '@/lib/tags';
import { imageOf, priceOf } from '@/lib/scryfall';

export default function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  // Opened before this visit: shown at once from last time while it is read again.
  const seen = api.peek<api.ListPage>(api.paths.list(id));
  const [list, setList] = useState<List | null>(seen?.list ?? null);
  const [cards, setCards] = useState<ListedCard[]>(seen?.cards ?? []);
  const [loading, setLoading] = useState(!seen);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(seen?.list.name ?? '');
  const [addOpen, setAddOpen] = useState(false);
  const [section, setSection] = useState<DeckTab>('cards');
  // Whether the deck's plan is confirmed: Chat and the AI steps wait for it.
  const [planConfirmed, setPlanConfirmed] = useState(seen?.planConfirmed !== false);
  // A deck's sections beyond Main, and what an import left to ask about its second commander or companion.
  const [sections, setSections] = useState<DeckSection[]>(seen?.sections?.length ? seen.sections : DEFAULT_SECTIONS);
  const [questions, setQuestions] = useState<SlotQuestion[]>(seen?.slotQuestions ?? []);
  // The bracket the plan aims for, which the Cards tab checks the Game Changers against.
  const [bracket, setBracket] = useState<number | null>(() => api.peek<api.DeckPlanState>(api.paths.plan(id))?.bracket ?? null);
  const onPlan = useCallback((p: api.DeckPlanState) => { setPlanConfirmed(p.confirmed); setBracket(p.bracket ?? null); }, []);
  // A question from Tune, waiting in a new chat.
  const [chatQuestion, setChatQuestion] = useState('');

  // Keyboard: 1-8 switch the deck's tabs, N adds cards (the Cards tab has its own keys).
  useEffect(() => {
    const TABS: DeckTab[] = ['cards', 'plan', 'tune', 'tags', 'health', 'playtest', 'chat', 'collection'];
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (/^[1-8]$/.test(e.key)) { setSection(TABS[Number(e.key) - 1]); window.scrollTo({ top: 0 }); }
      else if (e.key.toLowerCase() === 'n') { e.preventDefault(); setAddOpen(true); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const [tags, setTags] = useState<Tags | null>(() => api.peek<Tags>(api.paths.tags(id)) ?? null);
  const [changingCommander, setChangingCommander] = useState(false);
  const [importing, setImporting] = useState(false);
  const [decklist, setDecklist] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [imported, setImported] = useState<ImportSummary | null>(null);
  const [rejected, setRejected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState<'copied' | 'copied-own' | 'failed' | null>(null);


  // Whether others can see this deck on the owner's profile; private until made public.
  const [shown, setShown] = useState(!!seen?.public);
  const load = useCallback(async () => {
    const data = await api.fetchList(id);
    setList(data.list);
    setCards(data.cards);
    setDraftName(data.list.name);
    setShown(!!data.public);
    setPlanConfirmed(data.planConfirmed !== false);
    if (data.sections?.length) setSections(data.sections);
    setQuestions(data.slotQuestions ?? []);
  }, [id]);

  // A starter list being built for this deck in the background: the page
  // looks every few seconds and fills in when it is done.
  const [building, setBuilding] = useState(false);
  const wasBuilding = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => api.jobs().then(({ jobs }) => {
      if (cancelled) return;
      const job = jobs.find((j) => j.kind === 'starter' && j.listId === id);
      const running = job?.status === 'running';
      if (wasBuilding.current && !running) void load();
      wasBuilding.current = running;
      setBuilding(running);
      if (running) timer = setTimeout(look, 3000);
    }).catch(() => {});
    void look();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, load]);
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
        setShown(!!data.public);
        setPlanConfirmed(data.planConfirmed !== false);
        if (data.sections?.length) setSections(data.sections);
        setQuestions(data.slotQuestions ?? []);
        // Read the other tabs now, side by side, so opening one is instant.
        if (data.list.kind === 'deck') {
          const later: Array<Promise<unknown>> = [api.deckPlan(id).then((p) => { if (!cancelled) setBracket(p.bracket ?? null); }), api.buildPlan(id), api.deckHealth(id), api.deckPlaytest(id), api.cutReview(id)];
          if (data.cards.filter((c) => c.board === 'main').reduce((n, c) => n + c.quantity, 0) + 1 > 100) later.push(api.cutPlan(id));
          void Promise.allSettled(later);
        }
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
  // A second commander leads with the first: shown with it, never offered as a cut.
  const listed: Entry[] = cards.map((c) => (deck && c.slot === 'partner' ? { ...c, commander: true } : c));
  const entries: Entry[] = deck && list.commander
    ? [{ card: list.commander, quantity: 1, finish: list.commanderFinish, board: 'main', commander: true }, ...listed]
    : listed;
  const partner = deck ? cards.find((c) => c.slot === 'partner')?.card ?? null : null;
  const companion = deck ? cards.find((c) => c.slot === 'companion')?.card ?? null : null;
  // Cuts and moved-out cards go to the section for cards that came out (the Sideboard unless changed).
  const cutTo = cutBoard(sections);
  const cutName = boardName(sections, cutTo);
  // Until the owner says which card is the second commander, the deck's colours aren't known: colour flags wait for the answer.
  const partnerAsked = questions.some((q) => q.kind === 'partner');
  const flags: Flag[] = deck ? deckFlags({ commander: list.commander, cards: cards.filter((c) => c.board === 'main') }).filter((f) => !(partnerAsked && f.kind === 'colours')) : [];
  const main = entries.filter((e) => !deck || e.board === 'main');
  const value = main.reduce((sum, c) => sum + (priceOf(c.card, c.finish) ?? 0) * c.quantity, 0);
  const copies = main.reduce((sum, c) => sum + c.quantity, 0);
  const unique = main.length;
  const deckSize = copies;
  // Each section beyond Main with cards in it, for the header.
  const sectionCounts = sections.map((x) => ({ ...x, n: entries.filter((e) => e.board === x.id).reduce((n, e) => n + e.quantity, 0) })).filter((x) => x.n > 0);
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
  const fixFlag = (f: Flag) => (f.kind === 'copies' ? changeQuantity(f.cardId, Number.isFinite(f.limit) ? f.limit! : f.quantity) : moveCard(f.cardId, cutTo));
  const changeSlot = async (cardId: string, slot: Slot | null) => {
    try { await api.setSlot(id, { cardId, slot }); } finally { await load().catch(() => {}); }
  };

  // "Edit as text": the deck as it stands, in the same format it imports.
  const openText = () => {
    setDecklist(formatDecklist(deck ? list.commander : null, cards, list.commanderFinish));
    setImported(null);
    setRejected(false);
    setImporting(true);
  };

  /** Save the text back: the list becomes exactly what it says. */
  const saveText = async (e?: React.FormEvent, text = decklist) => {
    e?.preventDefault();
    setImportBusy(true);
    try {
      const { imported: result, ok } = await api.replaceDecklist(id, text);
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
    <div style={deck && list.commander ? identityStyle([...new Set([...(list.commander.color_identity ?? []), ...(partner?.color_identity ?? [])])]) : undefined}>
      <Link href={deck ? '/decks' : '/lists'} className="relative z-10 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
        ← All {deck ? 'decks' : 'lists'}
      </Link>

      {/* A deck's header: its commander's art, sharp, fading in from the right behind a name in its colours. */}
      {/* Full height on Cards; a band on the other tabs, so their work starts near the top. */}
      <div className={`relative isolate mt-2 ${hero ? `-mx-4 overflow-hidden px-4 pb-4 sm:mx-0 sm:rounded-2xl sm:border sm:border-white/[0.06] sm:px-6 ${section === 'cards' ? 'pt-16 sm:pb-5 sm:pt-14' : 'pt-6 sm:pt-5'}` : ''}`}>
        {hero && (
          <>
            <div aria-hidden className="id-glow absolute -inset-10 -z-20 opacity-40 blur-3xl" />
            {heroArt && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroArt}
                alt=""
                aria-hidden
                className="absolute inset-y-0 right-0 -z-20 h-full w-full object-cover object-[50%_30%] opacity-80 [mask-image:linear-gradient(to_bottom,black_30%,transparent)] sm:w-[62%] sm:[mask-image:linear-gradient(to_right,transparent,black_45%)]"
              />
            )}
            <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/40 to-transparent sm:bg-gradient-to-r sm:from-[var(--background)]/90 sm:via-[var(--background)]/30" />
          </>
        )}
        <div className="flex items-end justify-between gap-3 max-sm:flex-wrap">
          <div className="min-w-0 flex-1">
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
              <h1
                title={list.name}
                // A long name steps down a size and stops at three lines, so it never pushes the deck off the screen.
                className={`font-display font-extrabold leading-[1.05] [text-wrap:balance] line-clamp-3 ${deck
                  ? `id-text ${section !== 'cards' || list.name.length > 40 ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl'}`
                  : 'text-3xl'}`}
              >{list.name}</h1>
            )}
            {deck && list.commander && !changingCommander && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--foreground)]/85">
                <IdentitySymbols identity={[...new Set([...(list.commander.color_identity ?? []), ...(partner?.color_identity ?? [])])].join('')} size={17} />
                <button onClick={() => setSelected(list.commander)} className="hover:underline">{list.commander.name}</button>
                {partner && <><span aria-hidden className="text-[var(--muted)]">&amp;</span><button onClick={() => setSelected(partner)} className="hover:underline">{partner.name}</button></>}
                {companion && <span className="text-[var(--muted)]">· companion <button onClick={() => setSelected(companion)} className="text-[var(--foreground)]/85 hover:underline">{companion.name}</button></span>}
              </p>
            )}
            <p className="mt-3 flex flex-wrap gap-1.5 text-xs font-bold tabular-nums">
              {deck
                ? <span className={`rounded-full px-2.5 py-1 ${deckSize === 100 ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{deckSize} / 100</span>
                : <span className="rounded-full bg-white/5 px-2.5 py-1">{copies} card{copies === 1 ? '' : 's'}</span>}
              {value > 0 && <span className="rounded-full bg-white/5 px-2.5 py-1">${value.toFixed(2)}</span>}
              {unique !== copies && <span className="rounded-full bg-white/5 px-2.5 py-1 font-semibold text-[var(--muted)]">{unique} unique</span>}
              {sectionCounts.map((x) => <span key={x.id} className="rounded-full bg-white/5 px-2.5 py-1 font-semibold text-[var(--muted)]">{x.n} in {x.name}</span>)}
              {deck && shown && <span className="rounded-full bg-white/5 px-2.5 py-1 font-semibold text-[var(--muted)]">Public</span>}
            </p>
          </div>

          <div className={`flex shrink-0 gap-2 ${deck ? 'absolute right-4 top-4 sm:static' : 'w-full sm:w-auto'}`}>
            <button data-tour="add-cards" onClick={() => setAddOpen(true)} className={`btn-go flex-1 rounded-full px-5 py-2 text-sm font-semibold sm:flex-none lg:hidden ${deck ? 'max-lg:hidden' : ''}`}>
              ＋ Add cards
            </button>
            <div data-tour="deck-more"><MoreMenu
              items={[
                { label: importing ? 'Close the import' : 'Import', onClick: () => (importing ? setImporting(false) : openText()) },
                {
                  label: 'Export',
                  onClick: async () => {
                    try {
                      await navigator.clipboard.writeText(formatDecklist(deck ? list.commander : null, cards, list.commanderFinish));
                      setExported(cards.some((c) => c.board.startsWith('s-')) ? 'copied-own' : 'copied');
                    } catch { setExported('failed'); }
                    setTimeout(() => setExported(null), 2500);
                  },
                },

                { label: 'Rename', onClick: () => { setDraftName(list.name); setRenaming(true); } },
                { label: `Duplicate ${deck ? 'deck' : 'list'}`, onClick: async () => { const copy = await api.duplicateList(id); router.push(`${deck ? '/decks' : '/lists'}/${copy.id}`); } },
                ...(deck && list.commander ? [{ label: 'Change commander', onClick: () => setChangingCommander(true) }] : []),
                ...(deck ? [{
                  label: shown ? 'Make private' : 'Show on my profile',
                  onClick: async () => { setShown((await api.setDeckPublic(id, !shown)).public); },
                }] : []),
                {
                  label: `Delete ${deck ? 'deck' : 'list'}…`,
                  danger: true,
                  confirm: `Delete “${list.name}”? The cards stay in any other lists.`,
                  onClick: async () => { await api.deleteList(id); router.push(deck ? '/decks' : '/lists'); },
                },
              ]}
            /></div>
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
              <p className="mb-1.5 text-sm text-[var(--muted)]">{list.commander ? 'New commander' : cards.some((c) => canLead(c.card)) ? 'Or search for one' : 'Pick a commander'}</p>
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
            Edit the list, paste a new one over it (a text export from Arena, MTGO, Archidekt, Moxfield and most sites), or replace it all with a link to an Archidekt deck.
            Saving makes the {deck ? 'deck' : 'list'} exactly this. Moxfield links aren&apos;t supported - use its Export and paste the list. <PasteFormats />
          </p>
          <textarea
            value={decklist}
            onChange={(e) => { setDecklist(e.target.value); setRejected(false); }}
            rows={Math.min(24, Math.max(8, decklist.split('\n').length + 1))}
            autoFocus
            placeholder={DECKLIST_EXAMPLE}
            spellCheck={false}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 font-mono text-xs outline-none focus:border-[var(--accent)]"
          />
          {(() => {
            const box = readDeckBox(decklist);
            if (box.kind === 'both') return <p role="alert" className="text-xs text-amber-300">There is a link and a list here. Remove one of them - the deck comes from the link or from the list, not both.</p>;
            if (box.kind === 'links') return <p role="alert" className="text-xs text-amber-300">There are two links here. Keep the one for this deck.</p>;
            if (box.kind === 'link' && box.link!.site === 'moxfield') return <p role="alert" className="text-xs text-amber-300">{MOXFIELD_REFUSES}</p>;
            if (box.kind === 'link') return <p className="text-xs text-emerald-400">Saving fetches that Archidekt deck and makes this deck exactly that.</p>;
            return null;
          })()}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button disabled={importBusy || ['both', 'links'].includes(readDeckBox(decklist).kind) || readDeckBox(decklist).link?.site === 'moxfield'} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-[#221c08] disabled:opacity-60">
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
      {exported && (
        <p role="status" className="mt-3 text-sm text-[var(--muted)]">
          {exported === 'failed'
            ? 'Your browser blocked the clipboard: use Import to see the list and copy it from there.'
            : `Decklist copied - paste it into Moxfield, Archidekt or anywhere that takes a list.${exported === 'copied-own'
              ? ` Your own sections (${sections.filter((x) => !x.builtIn).map((x) => x.name).join(', ')}) aren't in it: other sites only know a sideboard and a maybeboard. Importing a list keeps them.`
              : ''}`}
        </p>
      )}
      {imported && (rejected || imported.commander) && (
        <ImportResult
          result={imported}
          applied={!rejected}
          // Replacing waits for every line, so a typo never silently drops a card; this is the way past that, on purpose.
          onDropProblems={rejected ? () => {
            const bad = new Set([...imported.missing, ...imported.unreadable]);
            const kept = decklist.split(/\r?\n/).filter((l) => !bad.has(l.trim())).join('\n');
            setDecklist(kept);
            void saveText(undefined, kept);
          } : undefined}
        />
      )}

      {building && (
        <p className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-4 py-2.5 text-sm">
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--border)]"><span className="id-grad block h-full w-1/3 animate-[slide_1.6s_ease-in-out_infinite] rounded-full motion-reduce:animate-none" /></span>
          Building a starter list - roles first, then what fits the commander, then lands. The cards appear here when it is done.
        </p>
      )}
      {deck && <SlotQuestions listId={id} questions={questions} cards={cards} onAnswered={load} />}
      <div className={deck ? 'mt-5 pb-20 lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:items-start lg:gap-6 lg:pb-0' : ''}>
      {deck && <DeckRail section={section} onSection={setSection} planConfirmed={planConfirmed} deck={{ name: list.name, art: heroArt, size: deckSize, onAdd: () => setAddOpen(true) }} />}
      <div className="min-w-0">
      {deck && section === 'plan' ? (
        tags ? (
          <DeckPlan
            listId={id}
            tags={tags}
            onTags={setTags}
            version={`${list.updatedAt}:${list.commander?.id ?? ''}`}
            onPlan={onPlan}
            onTab={(tab) => setSection(tab)}
          />
        ) : <p className="mt-8 text-center text-[var(--muted)]">Reading the deck…</p>
      ) : deck && section === 'tune' ? (
        <DeckBuild
          listId={id}
          cards={cards}
          commander={list.commander?.name ?? null}
          version={`${list.updatedAt}:${list.commander?.id ?? ''}`}
          onAdd={async (cardId, board) => { await api.addCard(id, cardId, 1, board); await load(); }}
          onMove={moveCard}
          cutTo={cutTo}
          cutName={cutName}
          flags={flags}
          onFix={fixFlag}
          deckSize={deckSize}
          onTab={(tab) => { setSection(tab); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          tagNames={(tags?.tags ?? []).filter((t) => t.status === 'accepted').map((t) => t.name)}
          planConfirmed={planConfirmed}
          brief={tags?.brief ?? ''}
          onAsk={(q) => { setChatQuestion(q); setSection('chat'); window.scrollTo({ top: 0 }); }}
        />
      ) : deck && section === 'chat' && !planConfirmed ? (
        <div data-tour="chat-locked" className="mt-5 flex max-w-2xl flex-col items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h3 className="font-display text-lg font-semibold">Chat starts with the plan</h3>
          <p className="text-sm text-[var(--muted)]">Claude answers better when it knows what the deck is for. The plan is already drafted from the cards - read it, change anything, and confirm it.</p>
          <button onClick={() => setSection('plan')} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold">Go to Plan</button>
        </div>
      ) : deck && section === 'chat' ? (
        <DeckChat
          key={chatQuestion}
          question={chatQuestion}
          listId={id}
          cards={cards}
          onAdd={async (cardId, board) => { await api.addCard(id, cardId, 1, board); await load(); }}
          onMove={moveCard}
          cutTo={cutTo}
          cutName={cutName}
        />
      ) : deck && section === 'tags' ? (
        <DeckTags listId={id} entries={entries} tags={tags} onTags={setTags} onSelect={setSelected} onPlan={() => setSection('plan')} sections={sections} />
      ) : deck && section === 'collection' ? (
        <DeckCollection listId={id} version={`${list.updatedAt}:${list.commander?.id ?? ''}`} />
      ) : deck && section === 'suggestions' ? (
        <DeckSuggestions
          listId={id}
          commander={list.commander?.name ?? null}
          version={`${list.updatedAt}:${list.commander?.id ?? ''}`}
          onAdd={async (cardId, board) => { await api.addCard(id, cardId, 1, board); await load(); }}
        />
      ) : deck && section === 'playtest' ? (
        <DeckPlaytest listId={id} commander={list.commander} cards={cards.filter((c) => c.board === 'main')} />
      ) : deck && section === 'health' ? (
        <DeckHealth
          listId={id}
          commander={list.commander ? { card: list.commander, finish: list.commanderFinish } : null}
          cards={cards.filter((c) => c.board === 'main')}
          version={`${list.updatedAt}:${list.commander?.id ?? ''}`}
        />
      ) : (
        <>
        {deck && <FlaggedZone flags={flags} cutName={cutName} onFix={fixFlag} />}
        {deck && <GameChangerLine names={entries.filter((e) => e.board === 'main' && e.card.game_changer).map((e) => e.card.name)} bracket={bracket} onPlan={() => { setSection('plan'); window.scrollTo({ top: 0 }); }} />}
        {deck && <DeckGlance listId={id} version={`${list.updatedAt}:${list.commander?.id ?? ''}`} price={value} onTab={(t) => { setSection(t); window.scrollTo({ top: 0 }); }} />}
        <DeckCards
          listId={id}
          entries={entries}
          tags={deck ? tags : null}
          version={`${list.updatedAt}:${list.commander?.id ?? ''}`}
          isDeck={deck}
          onTags={setTags}
          onAsk={deck ? (q) => { setChatQuestion(q); setSection('chat'); window.scrollTo({ top: 0 }); } : undefined}
          onChangeCommander={deck ? () => { setChangingCommander(true); window.scrollTo({ top: 0, behavior: 'smooth' }); } : undefined}
          onSelect={setSelected}
          onQuantity={changeQuantity}
          onMove={moveCard}
          sections={sections}
          onSections={deck ? setSections : undefined}
          commander={deck ? list.commander : null}
          onSlot={deck ? changeSlot : undefined}
        />
        </>
      )}
      </div>
      </div>

      <CardModal
        card={selected}
        onClose={() => setSelected(null)}
        actions={(selectedEntry || (deck && selectedInDeck && tags)) && (
          <>
            {deck && selectedInDeck && tags && selected && (
              <CardTags listId={id} card={selected} tags={tags} onChange={setTags} />
            )}
            {deck && selectedInDeck && selected && (
              <CardRoles key={selected.id} listId={id} card={selected} />
            )}
            {selectedEntry && (
              <CardEditor
                key={selectedEntry.card.id}
                listId={id}
                card={selectedEntry.card}
                finish={selectedEntry.finish}
                board={selectedEntry.board}
                sections={sections}
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
