'use client';

/**
 * "Add cards", a window over the deck.
 *
 * Typing a name shows matching cards at once, from the Pi's card copy:
 * Enter adds the top one (arrow keys pick another, Shift+Enter puts it on
 * the Maybeboard), and the box stays ready for the next. Where cards go -
 * Main, the Maybeboard or any section - and a tag to put on them are set
 * above the box. "Search" (or Cmd/Ctrl+Enter) runs a full search instead:
 * plain English ("ramp that fetches lands"), Scryfall syntax or a name,
 * for the deck's commander without having to say so. It opens on the
 * newest cards in the commander's colours.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import CardModal from './CardModal';
import Interpreted from './Interpreted';
import Results, { type Views } from './Results';
import { useSearch } from './useSearch';
import * as api from '@/lib/api';
import type { DeckSection } from '@/lib/sections-shared';
import { nextColor, type DeckTags } from '@/lib/tags';
import type { Board } from '@/lib/decklist';
import type { ScryfallCard } from '@/lib/scryfall';
import { dismissKeyboard, steady } from '@/lib/steady-tap';
import { looksLikeSyntax } from '@/lib/syntax';

interface Props {
  listId: string;
  /** The deck's commander; without one, searches are not scoped. */
  commander: string | null;
  /** What the deck holds, by card name, and on which board. */
  inDeck: Map<string, Board>;
  onAdded: () => void;
  onClose: () => void;
  /** The deck's sections, to choose where cards go; a plain list has none. */
  sections?: DeckSection[];
  /** The deck's tags, to put one on each card added. */
  tags?: DeckTags | null;
  onTags?: (tags: DeckTags) => void;
}

const front = (name: string) => name.split(' // ')[0];
const BOARD_LABEL: Record<string, string> = { main: 'In deck', maybe: 'On maybeboard', side: 'In sideboard', commander: 'Commander' };

export default function AddCardsPanel({ listId, commander, inDeck, onAdded, onClose, sections = [], tags = null, onTags }: Props) {
  // Where added cards go, and a tag to put on them; remembered while the panel is open.
  const [target, setTarget] = useState<Board>('main');
  const [tagId, setTagId] = useState('');
  const [newTag, setNewTag] = useState<string | null>(null);
  // Names as you type: the answer is kept with the text it answers, so a slow one can't add the wrong card.
  const [quick, setQuick] = useState<{ q: string; cards: api.QuickCard[] } | null>(null);
  const [pick, setPick] = useState(0);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const seq = useRef(0);
  const accepted = (tags?.tags ?? []).filter((t) => t.status === 'accepted');
  const s = useSearch();
  const [text, setText] = useState('');
  const [hideInDeck, setHideInDeck] = useState(true);
  const [added, setAdded] = useState<Map<string, Board>>(new Map());
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const opened = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // Ready to type with a keyboard and mouse; on a phone the on-screen
  // keyboard would cover the suggestions the panel opens on.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) input.current?.focus();
  }, []);

  const boardOf = (card: ScryfallCard) => added.get(front(card.name)) ?? inDeck.get(front(card.name));

  // Opens on the newest cards the commander can play.
  useEffect(() => {
    if (opened.current || !commander) return;
    opened.current = true;
    s.run('searching', () => api.runQuery('', { commander }), (r) => {
      s.showAnswer({ ...r, interpretation: { ...r.interpretation, explanation: `The newest cards in ${commander.split(',')[0]}'s colours` } });
    });
  }, [commander, s]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !selected) onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose, selected]);

  // Ask for names as the text changes, a beat after typing stops.
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2 || looksLikeSyntax(q)) return;
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      api.quickCards(listId, q).then((r) => { if (seq.current === mine) { setQuick({ q, cards: r.cards }); setPick(0); } }).catch(() => {});
    }, 90);
    return () => clearTimeout(timer);
  }, [text, listId]);

  const runSearch = () => {
    dismissKeyboard();
    const q = text.trim();
    if (!q) return;
    setQuick(null);
    s.run(looksLikeSyntax(q) ? 'searching' : 'thinking',
      () => (commander ? api.askForDeck(q, commander) : api.ask(q)), s.showAnswer);
  };

  const tagCard = async (oracleId: string) => {
    if (!tagId) return;
    try { const t = await api.setCardTag(listId, oracleId, tagId, true); onTags?.(t); } catch { /* the card is in; the tag can be added later */ }
  };

  /** Add a card by name: the one picked, or the top match for exactly what is typed now. */
  const addTyped = async (toMaybe: boolean, index = pick) => {
    const q = text.trim();
    if (!q) return;
    let list = quick?.q === q ? quick.cards : null;
    if (!list) {
      try { list = (await api.quickCards(listId, q)).cards; } catch { list = []; }
    }
    const card = list[Math.min(index, list.length - 1)];
    if (!card) { runSearch(); return; }
    const board: Board = toMaybe ? 'maybe' : target;
    setText('');
    setQuick(null);
    setPick(0);
    input.current?.focus();
    setAdded((prev) => new Map(prev).set(front(card.name), board));
    try {
      await api.addCard(listId, card.id, 1, board);
      await tagCard(card.oracleId);
      const where = board === 'main' ? 'the deck' : sections.find((x) => x.id === board)?.name ?? board;
      setNote({ text: `Added ${card.name} to ${where}`, ok: true });
      onAdded();
    } catch {
      setNote({ text: `Couldn't add ${card.name}`, ok: false });
      setAdded((prev) => { const next = new Map(prev); next.delete(front(card.name)); return next; });
    }
  };

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    // Enter with names showing adds the top one; otherwise it searches.
    if (quick?.cards.length && quick.q === text.trim()) { void addTyped(false); return; }
    if (text.trim().length >= 2 && !looksLikeSyntax(text.trim())) { void addTyped(false); return; }
    runSearch();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = quick?.cards.length ?? 0;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); setPick((p) => (p + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); setPick((p) => (p - 1 + n) % n); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runSearch(); }
    else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); void addTyped(true); }
    else if (e.key === 'Escape' && quick?.cards.length) { e.preventDefault(); e.stopPropagation(); setQuick(null); }
  };

  const makeTag = async () => {
    const name = (newTag ?? '').trim();
    if (!name) { setNewTag(null); return; }
    try {
      const t = await api.createTag(listId, { name, color: nextColor((tags?.tags ?? []).map((x) => x.color)) });
      onTags?.(t);
      const made = t.tags.find((x) => x.name === name);
      if (made) setTagId(made.id);
    } catch { /* stays without a tag */ }
    setNewTag(null);
  };

  const add = async (card: ScryfallCard, board: Board) => {
    setAdded((prev) => new Map(prev).set(front(card.name), board));
    try {
      await api.addCard(listId, card.id, 1, board);
      await tagCard(card.oracle_id ?? card.id);
      onAdded();
    } catch {
      setAdded((prev) => { const next = new Map(prev); next.delete(front(card.name)); return next; });
    }
  };

  // Leave out what the deck already has - unless asked to show it.
  const keep = (card: ScryfallCard) => !hideInDeck || !inDeck.has(front(card.name));
  const views: Views = hideInDeck ? {
    cards: s.views.cards && { ...s.views.cards, cards: s.views.cards.cards.filter(keep) },
    combos: s.views.combos,
  } : s.views;
  const hidden = (s.views.cards?.cards.length ?? 0) - (views.cards?.cards.length ?? 0);

  const actions = (card: ScryfallCard) => {
    const on = boardOf(card);
    if (on) {
      return <p className="mt-auto rounded-lg bg-[var(--surface-hover)] py-1.5 text-center text-xs text-[var(--muted)]">{BOARD_LABEL[on]}</p>;
    }
    return (
      <div className="mt-auto flex gap-1.5">
        <button {...steady(() => add(card, target))} className="flex-1 rounded-lg bg-[var(--accent)] py-1.5 text-sm font-medium text-[#221c08] hover:brightness-110">
          + Add{target !== 'main' ? ` to ${sections.find((x) => x.id === target)?.name ?? target}` : ''}
        </button>
        <button {...steady(() => add(card, 'maybe'))} className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs hover:bg-[var(--surface-hover)]">
          Maybe
        </button>
      </div>
    );
  };

  const busy = s.status === 'searching' || s.status === 'thinking';

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* A light backdrop, and on a wide screen a narrower panel: the deck stays in view while you add to it. */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside
        data-tour="add-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Add cards"
        className="absolute inset-y-0 right-0 flex w-full max-w-3xl xl:max-w-2xl flex-col border-l border-[var(--border)] bg-[var(--background)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl"
      >
        <div className="border-b border-[var(--border)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Add cards{commander ? ` for ${commander.split(',')[0]}` : ''}</h2>
            <button onClick={onClose} aria-label="Close" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface)]">✕</button>
          </div>
          {sections.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5 text-[var(--muted)]">Add to
                <select value={target} onChange={(e) => setTarget(e.target.value as Board)} aria-label="Where added cards go"
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--foreground)]">
                  <option value="main">Main</option>
                  {sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[var(--muted)]">Tag
                {newTag === null ? (
                  <select value={tagId} onChange={(e) => (e.target.value === '__new' ? setNewTag('') : setTagId(e.target.value))} aria-label="Tag to put on added cards"
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--foreground)]">
                    <option value="">None</option>
                    {accepted.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    <option value="__new">New tag…</option>
                  </select>
                ) : (
                  <span className="flex items-center gap-1">
                    <input value={newTag} onChange={(e) => setNewTag(e.target.value)} autoFocus maxLength={60} placeholder="New tag" aria-label="New tag name"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void makeTag(); } if (e.key === 'Escape') { e.stopPropagation(); setNewTag(null); } }}
                      className="w-32 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--foreground)]" />
                    <button type="button" onClick={makeTag} className="rounded-lg border border-[var(--border)] px-2 py-1">Make</button>
                  </span>
                )}
              </label>
            </div>
          )}
          <form onSubmit={search} className="relative mt-3 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              ref={input}
              enterKeyHint="go"
              autoComplete="off"
              role="combobox"
              aria-expanded={!!quick?.cards.length && quick.q === text.trim()}
              aria-controls="quick-names"
              aria-activedescendant={quick?.cards.length ? `quick-${pick}` : undefined}
              placeholder={commander ? 'Type a name - Enter adds it. Or: cheap removal, t:artifact mv<3…' : 'Type a name - Enter adds it. Or describe what you want'}
              aria-label="Card name, or what you're looking for"
              className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 outline-none focus:border-[var(--accent)]"
            />
            <button type="button" onClick={runSearch} disabled={busy} className="rounded-xl border border-[var(--border)] px-4 py-2.5 font-medium disabled:opacity-60" title="Search (Cmd/Ctrl+Enter)">
              Search
            </button>
            {!!quick?.cards.length && quick.q === text.trim() && (
              <ul id="quick-names" role="listbox" aria-label="Matching cards"
                className="absolute inset-x-0 top-full z-10 mt-1 max-h-80 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl">
                {quick.cards.map((c, i) => (
                  <li key={c.id} id={`quick-${i}`} role="option" aria-selected={i === pick}
                    onMouseEnter={() => setPick(i)}
                    // On mousedown, so the box keeps focus and the answer is the one on screen.
                    onMouseDown={(e) => { e.preventDefault(); void addTyped(e.shiftKey, i); }}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${i === pick ? 'bg-[var(--surface-hover)]' : ''}`}>
                    <span className="min-w-0 flex-1 truncate">{c.name}{c.gameChanger && <span className="ml-1.5 text-[10px] font-bold text-orange-300" title="Game Changer">◆</span>}</span>
                    <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:inline">{c.type.split(' — ')[0]}</span>
                    {c.inDeck && <span className="shrink-0 rounded bg-[var(--surface-hover)] px-1.5 text-[10px] text-[var(--muted)]">{BOARD_LABEL[c.inDeck] ?? sections.find((x) => x.id === c.inDeck)?.name ?? 'In deck'}</span>}
                    {i === pick && <kbd className="shrink-0 text-[10px] text-[var(--muted)]">Enter</kbd>}
                  </li>
                ))}
              </ul>
            )}
          </form>
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-[var(--muted)]">
            {note ? <span role="status" className={note.ok ? 'text-emerald-400' : 'text-red-300'}>{note.text}</span> : <span>Enter adds · Shift+Enter to the Maybeboard · ↑↓ pick · Cmd/Ctrl+Enter searches</span>}
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={hideInDeck} onChange={(e) => setHideInDeck(e.target.checked)} />
            Hide cards already in the deck{hideInDeck && hidden > 0 ? ` (${hidden} hidden)` : ''}
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!commander && !s.answer && !busy && (
            <p className="text-sm text-[var(--muted)]">Pick a commander for the deck to see cards it can play — or search for anything above.</p>
          )}
          {s.answer && s.status !== 'thinking' && (
            <Interpreted interpretation={s.answer.interpretation} trace={s.answer.trace} onRun={s.runEdited} />
          )}
          {s.status === 'searching' && <p className="mt-8 text-center text-[var(--muted)]">Searching…</p>}
          {s.status === 'thinking' && <p className="mt-8 text-center text-[var(--muted)]">Working out what you mean…</p>}
          {s.status === 'error' && <p className="mt-8 text-center text-red-400">{s.error}</p>}
          {s.status === 'idle' && Object.keys(s.views).length > 0 && (
            <Results
              views={views}
              commander={commander ?? undefined}
              tab={s.tab}
              onTab={s.openTab}
              loading={s.tabLoading}
              inLists={{}}
              onSort={s.resort}
              onLoadMore={s.answer ? s.loadMore : undefined}
              loadingMore={s.loadingMore}
              onSelect={setSelected}
              actions={actions}
              dense
            />
          )}
        </div>
      </aside>
      <CardModal
        card={selected}
        onClose={() => setSelected(null)}
        actions={selected && (
          <div className="max-w-xs">{actions(selected)}</div>
        )}
      />
    </div>,
    document.body,
  );
}
