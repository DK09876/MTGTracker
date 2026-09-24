'use client';

/**
 * "Add cards", a window over the deck.
 *
 * It opens on suggestions - what this commander's decks play on EDHREC that
 * this deck does not have yet - and takes anything typed: plain English
 * ("ramp that fetches lands"), Scryfall syntax, or a card name. Every search
 * is for the deck's commander without having to say so. Cards already in
 * the deck are hidden by default, so what is left is what could be added.
 */

import { useEffect, useRef, useState } from 'react';

import CardModal from './CardModal';
import Interpreted from './Interpreted';
import Results, { type Views } from './Results';
import { useSearch } from './useSearch';
import * as api from '@/lib/api';
import type { Board } from '@/lib/decklist';
import type { ScryfallCard } from '@/lib/scryfall';
import { looksLikeSyntax } from '@/lib/syntax';

interface Props {
  listId: string;
  /** The deck's commander; without one, searches are not scoped. */
  commander: string | null;
  /** What the deck holds, by card name, and on which board. */
  inDeck: Map<string, Board>;
  onAdded: () => void;
  onClose: () => void;
}

const front = (name: string) => name.split(' // ')[0];
const BOARD_LABEL: Record<Board, string> = { main: 'In deck', maybe: 'On maybeboard', side: 'In sideboard' };

export default function AddCardsPanel({ listId, commander, inDeck, onAdded, onClose }: Props) {
  const s = useSearch();
  const [text, setText] = useState('');
  const [hideInDeck, setHideInDeck] = useState(true);
  const [added, setAdded] = useState<Map<string, Board>>(new Map());
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const opened = useRef(false);

  const boardOf = (card: ScryfallCard) => added.get(front(card.name)) ?? inDeck.get(front(card.name));

  // Opens on suggestions for the commander.
  useEffect(() => {
    if (opened.current || !commander) return;
    opened.current = true;
    s.run('searching', () => api.runQuery('', { commander }), (r) => {
      s.showAnswer({ ...r, interpretation: { ...r.interpretation, explanation: `Suggestions for ${commander}` } });
    });
  }, [commander, s]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !selected) onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose, selected]);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    s.run(looksLikeSyntax(q) ? 'searching' : 'thinking',
      () => (commander ? api.askForDeck(q, commander) : api.ask(q)), s.showAnswer);
  };

  const add = async (card: ScryfallCard, board: Board) => {
    setAdded((prev) => new Map(prev).set(front(card.name), board));
    try {
      await api.addCard(listId, card.id, 1, board);
      onAdded();
    } catch {
      setAdded((prev) => { const next = new Map(prev); next.delete(front(card.name)); return next; });
    }
  };

  // Leave out what the deck already has - unless asked to show it.
  const keep = (card: ScryfallCard) => !hideInDeck || !inDeck.has(front(card.name));
  const views: Views = hideInDeck ? {
    cards: s.views.cards && { ...s.views.cards, cards: s.views.cards.cards.filter(keep) },
    edhrec: s.views.edhrec && (() => {
      const cards = s.views.edhrec.cards.filter(keep);
      const ids = new Set(cards.map((c) => c.id));
      return { ...s.views.edhrec, cards, sections: s.views.edhrec.sections.map((sec) => ({ ...sec, ids: sec.ids.filter((id) => ids.has(id)) })).filter((sec) => sec.ids.length) };
    })(),
    combos: s.views.combos,
  } : s.views;
  const hidden = (s.views.edhrec?.cards.length ?? 0) - (views.edhrec?.cards.length ?? 0)
    + (s.views.cards?.cards.length ?? 0) - (views.cards?.cards.length ?? 0);

  const actions = (card: ScryfallCard) => {
    const on = boardOf(card);
    if (on) {
      return <p className="mt-auto rounded-lg bg-[var(--surface-hover)] py-1.5 text-center text-xs text-[var(--muted)]">{BOARD_LABEL[on]}</p>;
    }
    return (
      <div className="mt-auto flex gap-1.5">
        <button onClick={() => add(card, 'main')} className="flex-1 rounded-lg bg-[var(--accent)] py-1.5 text-sm font-medium text-[#221c08] hover:brightness-110">
          + Add
        </button>
        <button onClick={() => add(card, 'maybe')} className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs hover:bg-[var(--surface-hover)]">
          Maybe
        </button>
      </div>
    );
  };

  const busy = s.status === 'searching' || s.status === 'thinking';

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Add cards"
        className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-2xl"
      >
        <div className="border-b border-[var(--border)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Add cards{commander ? ` for ${commander.split(',')[0]}` : ''}</h2>
            <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-[var(--muted)] hover:bg-[var(--surface)]">✕</button>
          </div>
          <form onSubmit={search} className="mt-3 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              placeholder={commander ? 'Ramp that fetches lands, cheap removal, t:artifact mv<3, Sol Ring…' : 'Describe what you want, a card name, or Scryfall syntax'}
              aria-label="Find cards to add"
              className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 outline-none focus:border-[var(--accent)]"
            />
            <button disabled={busy} className="rounded-xl bg-[var(--accent)] px-4 py-2.5 font-medium text-[#221c08] disabled:opacity-60">
              Find
            </button>
          </form>
          <label className="mt-2 flex items-center gap-2 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={hideInDeck} onChange={(e) => setHideInDeck(e.target.checked)} />
            Hide cards already in the deck{hideInDeck && hidden > 0 ? ` (${hidden} hidden)` : ''}
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!commander && !s.answer && !busy && (
            <p className="text-sm text-[var(--muted)]">Pick a commander for the deck to get suggestions — or search for anything above.</p>
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
    </div>
  );
}
