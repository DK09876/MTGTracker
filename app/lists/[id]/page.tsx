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
import DeckCards, { type Entry } from '@/components/DeckCards';
import DeckGlance from '@/components/DeckGlance';
import DeckPlan from '@/components/DeckPlan';
import DeckHistory, { countLine, DiffList } from '@/components/DeckHistory';
import DeckRail from '@/components/DeckRail';
import DeckPlaytest from '@/components/DeckPlaytest';
import DeckChat from '@/components/DeckChat';
import DeckCollection from '@/components/DeckCollection';
import Tip from '@/components/Tip';
import { useDeckCopies } from '@/components/useDeckCopies';
import DeckHealth from '@/components/DeckHealth';
import DeckTune from '@/components/DeckTune';
import DeckTags from '@/components/DeckTags';
import FlaggedZone from '@/components/FlaggedZone';
import GameChangerLine from '@/components/GameChangerLine';
import SlotQuestions from '@/components/SlotQuestions';
import PasteFormats from '@/components/PasteFormats';
import ImportResult from '@/components/ImportResult';
import { IdentitySymbols } from '@/components/ManaCost';
import MoreMenu from '@/components/MoreMenu';
import MythicLinked, { LinkResult } from '@/components/MythicLinked';
import * as api from '@/lib/api';
import type { List, ListedCard } from '@/lib/db';
import { formatDecklist, type Board } from '@/lib/decklist';
import { identityStyle } from '@/lib/identity';
import { placeOf, type DeckTab } from '@/lib/deck-tabs';
import type { Slot, SlotQuestion } from '@/lib/commanders';
import { deckFlags, type Flag } from '@/lib/health';
import { boardName, cutBoard, DEFAULT_SECTIONS, type DeckSection } from '@/lib/sections-shared';
import { DECKLIST_EXAMPLE, MOXFIELD_REFUSES, readDeckBox } from '@/lib/deck-links';
import { canLead } from '@/lib/import';
import type { ImportSummary } from '@/lib/import-into';
import type { LinkReport } from '@/lib/mythic';
import { summaryLine } from '@/lib/copy-status';
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
  // The card modal's printings: all of them, or only the copies you own.
  const [mineOnly, setMineOnly] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(seen?.list.name ?? '');
  const [addOpen, setAddOpen] = useState(false);
  const [section, setTab] = useState<DeckTab>('cards');
  // Check is Health and Playtest; Cards can show which cards you own and where (it was the Collection tab).
  const [checkPart, setCheckPart] = useState<'health' | 'playtest'>('health');
  const [owner, setOwner] = useState<'all' | 'mine' | 'missing'>('all');
  // Read once per deck and again when its cards change: the marks, the chip and "Where your copies are" share it.
  const deckCopies = useDeckCopies(id, list?.kind === 'deck', cards);
  const ownership = deckCopies.data;
  // "Where your copies are" shows with Mine or Missing, or once the chip or one of its filters asks for it.
  const [copiesShown, setCopiesShown] = useState(false);
  const [filterTo, setFilterTo] = useState<{ text: string; n: number } | undefined>(undefined);
  const showCopies = () => {
    setCopiesShown(true);
    setTimeout(() => document.getElementById('your-copies')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 80);
  };
  // Any tab name, old or new: Tags lands on Plan's tags, Health and Playtest on Check, Collection on Cards with your copies.
  const setSection = useCallback((tab: DeckTab | string) => {
    const place = placeOf(tab);
    setTab(place.tab);
    if (place.check) setCheckPart(place.check);
    if (place.copies) setOwner((o) => (o === 'all' ? 'mine' : o));
    // The section may not be drawn yet (the tab loads its data first): look for it for a few seconds.
    if (place.anchor) {
      let tries = 0;
      const find = () => {
        const el = document.getElementById(place.anchor!);
        if (el) el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        else if (tries++ < 30) setTimeout(find, 150);
      };
      setTimeout(find, 120);
    }
  }, []);
  // A link can open a tab: ?tab=plan, and the old names too (?tab=tags, ?tab=health, ?tab=collection…).
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the address on arrival
    if (tab) setSection(tab);
  }, [setSection]);
  // Whether the deck's plan is confirmed: Chat and the AI steps wait for it.
  const [planConfirmed, setPlanConfirmed] = useState(seen?.planConfirmed !== false);
  // How many parts of the plan are left to confirm, for the locked screens.
  const [planLeft, setPlanLeft] = useState<number | null>(seen?.planProgress ? seen.planProgress.total - seen.planProgress.done : null);
  // A deck's sections beyond Main, and what an import left to ask about its second commander or companion.
  const [sections, setSections] = useState<DeckSection[]>(seen?.sections?.length ? seen.sections : DEFAULT_SECTIONS);
  const [questions, setQuestions] = useState<SlotQuestion[]>(seen?.slotQuestions ?? []);
  // The bracket the plan aims for, which the Cards tab checks the Game Changers against.
  const [bracket, setBracket] = useState<number | null>(() => api.peek<api.DeckPlanState>(api.paths.plan(id))?.bracket ?? null);
  const onPlan = useCallback((p: api.DeckPlanState) => { setPlanConfirmed(p.confirmed); setBracket(p.bracket ?? null); setPlanLeft(p.progress.total - p.progress.done); }, []);
  // A question from Tune, waiting in a new chat.
  const [chatQuestion, setChatQuestion] = useState('');

  // Keyboard: 1-5 switch the deck's tabs, N adds cards (the Cards tab has its own keys).
  useEffect(() => {
    const TABS: DeckTab[] = ['cards', 'plan', 'tune', 'check', 'chat'];
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (/^[1-5]$/.test(e.key)) { setSection(TABS[Number(e.key) - 1]); window.scrollTo({ top: 0 }); }
      else if (e.key.toLowerCase() === 'n') { e.preventDefault(); setAddOpen(true); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [setSection]);
  const [tags, setTags] = useState<Tags | null>(() => api.peek<Tags>(api.paths.tags(id)) ?? null);
  const [changingCommander, setChangingCommander] = useState(false);
  const [importing, setImporting] = useState(false);
  const [decklist, setDecklist] = useState('');
  const [linkedList, setLinkedList] = useState('');
  const [linkReport, setLinkReport] = useState<LinkReport | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [imported, setImported] = useState<ImportSummary | null>(null);
  const [rejected, setRejected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState<'copied' | 'downloaded' | 'failed' | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportTags, setExportTags] = useState(true);
  // The last change made here, offered for undo for a few seconds.
  const [lastChange, setLastChange] = useState<api.DeckChange | null>(null);
  const [undoing, setUndoing] = useState(false);
  // Saving text over a deck that has cards shows what would change first.
  const [preview, setPreview] = useState<{ diff: api.HistoryDiff; summary: string } | null>(null);


  // Whether others can see this deck on the owner's profile; private until made public.
  const [shown, setShown] = useState(!!seen?.public);
  const load = useCallback(async () => {
    const data = await api.fetchList(id);
    setList(data.list);
    setCards(data.cards);
    setDraftName(data.list.name);
    setShown(!!data.public);
    setPlanConfirmed(data.planConfirmed !== false);
    if (data.planProgress) setPlanLeft(data.planProgress.total - data.planProgress.done);
    if (data.sections?.length) setSections(data.sections);
    setQuestions(data.slotQuestions ?? []);
  }, [id]);

  // Every change recorded for this deck comes back as an event: offer Undo for a few seconds.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const { listId, change } = (e as CustomEvent<{ listId: string; change: api.DeckChange }>).detail;
      if (listId !== id) return;
      setLastChange(change);
      clearTimeout(timer);
      timer = setTimeout(() => setLastChange(null), 7000);
    };
    window.addEventListener(api.DECK_CHANGED, on);
    return () => { window.removeEventListener(api.DECK_CHANGED, on); clearTimeout(timer); };
  }, [id]);
  const undo = useCallback(async () => {
    setUndoing(true);
    try { await api.undoLast(id); } catch { /* nothing left to undo */ } finally { setUndoing(false); }
    await load().catch(() => {});
    void api.deckTags(id).then(setTags).catch(() => {});
  }, [id, load]);
  // Cmd/Ctrl+Z undoes the last change to the deck, outside text boxes.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      void undo();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [undo]);

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
        if (data.planProgress) setPlanLeft(data.planProgress.total - data.planProgress.done);
    if (data.planProgress) setPlanLeft(data.planProgress.total - data.planProgress.done);
        if (data.sections?.length) setSections(data.sections);
        setQuestions(data.slotQuestions ?? []);
        // Read the other tabs now, side by side, so opening one is instant.
        if (data.list.kind === 'deck') {
          const later: Array<Promise<unknown>> = [api.deckPlan(id).then((p) => { if (!cancelled) setBracket(p.bracket ?? null); }), api.deckHealth(id), api.deckPlaytest(id), api.cutReview(id)];
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
    setLinkedList('');
    setLinkReport(null);
    setImporting(true);
  };

  /** Save the text back: the list becomes exactly what it says. Over a deck with cards, see what changes first. */
  const saveText = async (e?: React.FormEvent, text = decklist, confirmed = false) => {
    e?.preventDefault();
    setImportBusy(true);
    try {
      const linked = deck && readDeckBox(text).kind === 'list' ? linkedList : '';
      if (!confirmed && cards.length > 0) {
        const p = await api.previewDecklist(id, text, linked);
        // Lines that can't be found go through the save, which refuses them and lists them to fix.
        if (!p.missing.length && !p.unreadable.length) {
          setPreview({ diff: p.diff, summary: p.summary });
          return;
        }
      }
      setPreview(null);
      const { imported: result, ok, link } = await api.replaceDecklist(id, text, linked);
      setImported(result);
      setRejected(!ok);
      setLinkReport(link ?? null);
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
                { label: importing ? 'Close the import' : 'Import', onClick: () => { setExportOpen(false); if (importing) setImporting(false); else openText(); } },
                { label: exportOpen ? 'Close the export' : 'Export', onClick: () => { setExportOpen((v) => !v); setImporting(false); } },
                ...(deck ? [{ label: 'History and snapshots', onClick: () => setHistoryOpen(true) }] : []),
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
          {deck && readDeckBox(decklist).kind === 'list' && <MythicLinked value={linkedList} onChange={setLinkedList} />}
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
            <button type="button" onClick={() => { setImporting(false); setPreview(null); }} className="rounded-lg border border-[var(--border)] px-3 py-1.5">
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
      {linkReport && !importing && <LinkResult link={linkReport} />}
      {exportOpen && (() => {
        const text = formatDecklist(deck ? list.commander : null, cards, list.commanderFinish, { tags: exportTags ? tags ?? undefined : undefined, sections });
        const download = () => {
          const blob = new Blob([text + '\n'], { type: 'text/plain' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${list.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'deck'}.txt`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          setExported('downloaded');
          setTimeout(() => setExported(null), 2500);
        };
        const copy = async () => {
          try { await navigator.clipboard.writeText(text); setExported('copied'); } catch { setExported('failed'); }
          setTimeout(() => setExported(null), 2500);
        };
        return (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">Export the {deck ? 'deck' : 'list'}</span>
              {deck && (
                <label className="flex items-center gap-2 text-[var(--muted)]">
                  <input type="checkbox" checked={exportTags} onChange={(e) => setExportTags(e.target.checked)} />
                  Include tags (#Ramp)
                  <Tip label="About tags in the export">Moxfield reads tags written after a card, like “1 Sol Ring #Ramp”. Other sites may not: leave this off for them.</Tip>
                </label>
              )}
              <span className="flex-1" />
              <button type="button" onClick={copy} className="rounded-lg border border-[var(--border)] px-3 py-1.5">Copy</button>
              <button type="button" onClick={download} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-[#221c08]">Download .txt</button>
            </div>
            <textarea readOnly value={text} rows={6} aria-label="The exported list" onFocus={(e) => e.currentTarget.select()}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs" />
            {sections.some((x) => !x.builtIn) && <p className="text-xs text-[var(--muted)]">Your own sections are written under “// Section: Name”: importing here puts them back; other sites read them as comments.</p>}
          </div>
        );
      })()}
      {importing && preview && (
        <div role="region" aria-label="What saving changes" className="mt-3 flex flex-col gap-2 rounded-xl border border-[var(--accent)]/50 bg-[var(--surface)] p-3 text-sm">
          <p><b>Saving changes the {deck ? 'deck' : 'list'}: {preview.summary}.</b> <span className="text-[var(--muted)]">Tags, sections, the plan and notes stay on every card that stays. A snapshot is taken first, so you can go back.</span></p>
          <DiffList diff={preview.diff} names={new Map(sections.map((x) => [x.id, x.name]))} />
          <div className="flex gap-2">
            <button type="button" disabled={importBusy || countLine(preview.diff) === 'no changes'} onClick={() => saveText(undefined, decklist, true)} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-[#221c08] disabled:opacity-60">{importBusy ? 'Saving…' : 'Save these changes'}</button>
            <button type="button" onClick={() => setPreview(null)} className="rounded-lg border border-[var(--border)] px-3 py-1.5">Back to the list</button>
          </div>
        </div>
      )}
      {imported && rejected && (
        <p className="mt-3 text-sm text-amber-400">Nothing was changed — fix the lines below and save again.</p>
      )}
      {imported && !rejected && !!imported.tagged && (
        <p role="status" className="mt-3 text-sm text-[var(--muted)]">Kept the tags on {imported.tagged} card{imported.tagged === 1 ? '' : 's'}{imported.newTags?.length ? ` (new tags: ${imported.newTags.join(', ')})` : ''}.</p>
      )}
      {exported && (
        <p role="status" className="mt-3 text-sm text-[var(--muted)]">
          {exported === 'downloaded' ? 'Downloaded the list as a text file, with your tags and sections.' : exported === 'failed'
            ? 'Your browser blocked the clipboard: use Download list instead, or Import to see the list and copy it from there.'
            : 'Decklist copied - paste it into Moxfield, Archidekt or anywhere that takes a list.'}
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
            cardNames={[...new Set(cards.map((c) => c.card.name))].sort()}
          />
        ) : <p className="mt-8 text-center text-[var(--muted)]">Reading the deck…</p>
      ) : null}
      {deck && section === 'plan' && tags ? (
        <section id="plan-tags" data-section="Tags" className="mt-10 scroll-mt-24 border-t border-[var(--border)] pt-6">
          <DeckTags listId={id} entries={entries} tags={tags} onTags={setTags} onSelect={setSelected} onPlan={() => window.scrollTo({ top: 0, behavior: 'smooth' })} sections={sections} />
        </section>
      ) : deck && (section === 'tune' || section === 'chat') && !planConfirmed ? (
        <PlanLock what={section === 'tune' ? 'Tune' : 'Chat'} left={planLeft} onPlan={() => setSection('plan')} />
      ) : deck && section === 'tune' ? (
        <>
          <FlaggedZone flags={flags} cutName={cutName} onFix={fixFlag} />
          <DeckTune
            listId={id}
            version={`${list.updatedAt}:${list.commander?.id ?? ''}`}
            sections={sections}
            brief={tags?.brief ?? ''}
            tagNames={(tags?.tags ?? []).filter((t) => t.status === 'accepted').map((t) => t.name)}
            onChanged={load}
            onTab={(tab) => { setSection(tab); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            onAsk={(q) => { setChatQuestion(q); setSection('chat'); window.scrollTo({ top: 0 }); }}
          />
        </>
      ) : deck && section === 'chat' ? (
        <DeckChat
          key={chatQuestion}
          question={chatQuestion}
          listId={id}
          cards={cards}
        />
      ) : deck && section === 'check' ? (
        <>
          <div role="tablist" aria-label="Check" data-tour="check-parts" className="mt-5 flex w-fit gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 text-sm">
            {([['health', 'Health'], ['playtest', 'Playtest']] as const).map(([v, label]) => (
              <button key={v} role="tab" aria-selected={checkPart === v} data-check={v} onClick={() => setCheckPart(v)}
                className={`rounded-full px-4 py-1.5 ${checkPart === v ? 'id-grad font-semibold text-[#15110a]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}>{label}</button>
            ))}
          </div>
          {checkPart === 'playtest'
            ? <DeckPlaytest listId={id} commander={list.commander} cards={cards.filter((c) => c.board === 'main')} />
            : <DeckHealth
              listId={id}
              commander={list.commander ? { card: list.commander, finish: list.commanderFinish } : null}
              cards={cards.filter((c) => c.board === 'main')}
              version={`${list.updatedAt}:${list.commander?.id ?? ''}`}
            />}
        </>
      ) : deck && section === 'plan' ? null : (
        <>
        {deck && <FlaggedZone flags={flags} cutName={cutName} onFix={fixFlag} />}
        {deck && <GameChangerLine names={entries.filter((e) => e.board === 'main' && e.card.game_changer).map((e) => e.card.name)} bracket={bracket} onPlan={() => { setSection('plan'); window.scrollTo({ top: 0 }); }} />}
        {deck && <DeckGlance listId={id} version={`${list.updatedAt}:${list.commander?.id ?? ''}`} price={value} onTab={(t) => { setSection(t); window.scrollTo({ top: 0 }); }} />}
        {deck && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm" data-tour="owner-filter">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--faint)]">Show</span>
            <div role="radiogroup" aria-label="Which cards" className="flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5">
              {([['all', 'All'], ['mine', 'Mine'], ['missing', 'Missing']] as const).map(([v, label]) => (
                <button key={v} role="radio" aria-checked={owner === v} data-owner={v} onClick={() => setOwner(v)}
                  className={`rounded-full px-3 py-1 ${owner === v ? 'bg-[var(--surface-hover)] font-semibold' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}>{label}</button>
              ))}
            </div>
            {ownership ? (
              <span className="flex min-w-0 items-center gap-1">
                <button data-testid="owned-chip" onClick={showCopies} title="Where your copies are"
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-left text-xs tabular-nums hover:bg-[var(--surface-hover)]">
                  {summaryLine(ownership.summary)}
                </button>
                <Tip label="What these numbers mean">
                  <p><b>Yours</b>: real copies in this deck. <b>Proxies</b>: stand-ins. <b>In your boxes</b>: owned and free to pull. <b>In other decks</b>: every copy you own is in another deck. <b>To buy</b>: not in your collection.</p>
                  <p className="mt-1.5">Each card has a mark saying which; tap it to pull, take, return or proxy it. Mine shows the cards you have a copy of, Missing the ones still to get.</p>
                </Tip>
              </span>
            ) : <span className="text-xs text-[var(--muted)]">Reading your collection…</span>}
          </div>
        )}
        <DeckCards
          listId={id}
          onChanged={() => { void load(); }}
          entries={deck && owner !== 'all' && ownership ? entries.filter((e) => {
            if (e.board !== 'main') return owner === 'mine';
            const h = ownership.cards.find((x) => x.cardIds.includes(e.card.id) || x.name === e.card.name);
            const mine = !!h && h.status !== 'missing';
            return owner === 'mine' ? mine : !mine;
          }) : entries}
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
          mark={deck ? deckCopies.mark : undefined}
          isWord={deck ? deckCopies.isWord : undefined}
          filterTo={filterTo}
        />
        {deck && (owner !== 'all' || copiesShown) && (
          <section id="your-copies" data-section="Your copies" className="mt-10 scroll-mt-24 border-t border-[var(--border)] pt-6">
            <h2 className="font-display text-2xl font-semibold">Where your copies are</h2>
            <DeckCollection listId={id} version={`${list.updatedAt}:${list.commander?.id ?? ''}`} data={ownership} onData={deckCopies.setData}
              onFilter={(text) => { setOwner('all'); setCopiesShown(true); setFilterTo({ text, n: Date.now() }); }} />
          </section>
        )}
        </>
      )}
      </div>
      </div>

      <CardModal
        card={selected}
        onClose={() => setSelected(null)}
        actions={(selectedEntry || (deck && selectedInDeck && tags) || (deck && !!list.commander && selected?.id === list.commander.id)) && (
          <>
            {deck && selectedInDeck && tags && selected && (
              <CardTags listId={id} card={selected} tags={tags} onChange={setTags} />
            )}
            {deck && selectedInDeck && selected && (
              <CardRoles key={`roles-${selected.id}`} listId={id} card={selected} />
            )}
            {selectedEntry && (
              <CardEditor
                key={`editor-${selectedEntry.card.id}`}
                listId={id}
                card={selectedEntry.card}
                finish={selectedEntry.finish}
                board={selectedEntry.board}
                sections={sections}
                isDeck={deck}
                holding={deck ? deckCopies.holdingOf(selectedEntry) : undefined}
                mine={mineOnly}
                onMine={setMineOnly}
                onChanged={async (printingId) => {
                  const data = await api.fetchList(id);
                  setList(data.list);
                  setCards(data.cards);
                  setSelected(data.cards.find((c) => c.card.id === printingId)?.card ?? null);
                }}
              />
            )}
            {deck && list.commander && selected?.id === list.commander.id && (
              <CardEditor
                key={`commander-${list.commander.id}`}
                listId={id}
                card={list.commander}
                finish={list.commanderFinish}
                board="main"
                isDeck
                commander
                holding={deckCopies.holdingOf({ card: list.commander, board: 'main' })}
                mine={mineOnly}
                onMine={setMineOnly}
                onChanged={async () => {
                  const data = await api.fetchList(id);
                  setList(data.list);
                  setCards(data.cards);
                  setSelected(data.list.commander ?? null);
                }}
              />
            )}
          </>
        )}
      />

      {historyOpen && (
        <DeckHistory listId={id} sectionNames={new Map(sections.map((x) => [x.id, x.name]))}
          onChanged={() => { void load(); void api.deckTags(id).then(setTags).catch(() => {}); }}
          onClose={() => setHistoryOpen(false)} />
      )}
      {lastChange && (
        <div role="status" data-undo-toast className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-h,0px)+5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 lg:bottom-6">
          <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-4 pr-1.5 text-sm shadow-xl">
            <span className="min-w-0 truncate">{lastChange.label}</span>
            <button onClick={() => { setLastChange(null); void undo(); }} disabled={undoing} className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[#221c08] disabled:opacity-60">Undo</button>
            <button onClick={() => setLastChange(null)} aria-label="Dismiss" className="px-1 text-[var(--muted)]">✕</button>
          </div>
        </div>
      )}
      {addOpen && (
        <AddCardsPanel
          listId={id}
          commander={deck ? list.commander?.name ?? null : null}
          inDeck={inDeck}
          onAdded={() => { load().catch(() => {}); }}
          onClose={() => setAddOpen(false)}
          sections={deck ? sections : []}
          tags={deck ? tags : null}
          onTags={setTags}
        />
      )}
      {deckCopies.toastView}
    </div>
  );
}

/** Tune and Chat wait for the plan: everything they do is built on what the deck is for. */
function PlanLock({ what, left, onPlan }: { what: 'Tune' | 'Chat'; left: number | null; onPlan: () => void }) {
  return (
    <div data-tour={what === 'Chat' ? 'chat-locked' : 'tune-locked'} className="mt-5 flex max-w-2xl flex-col items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="font-display text-lg font-semibold">{what} starts with the plan</h3>
      <p className="text-sm text-[var(--muted)]">
        {what === 'Tune' ? 'Cuts, swaps, finding cards and fixes are all built on what the deck is for.' : 'Claude answers better when it knows what the deck is for.'}
        {' '}{left ? `${left} part${left === 1 ? '' : 's'} of the plan still to confirm. Most are filled in already.` : 'The plan is drafted from the cards: read it, change anything, and confirm it.'}
      </p>
      <button onClick={onPlan} className="btn-go rounded-full px-4 py-1.5 text-sm font-semibold">Go to Plan</button>
    </div>
  );
}
