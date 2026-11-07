'use client';

/**
 * A deck's copies, for its Cards tab: the ownership read once per deck (and
 * again when the deck changes), shared by the card marks, the filter words,
 * the summary chip and "Where your copies are". A move made from a mark
 * shows a toast with Undo.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import CopyMark, { type CollectionAct } from './CopyMark';
import type { Entry } from './DeckCards';
import * as api from '@/lib/api';
import { holdingIndex, statusWord, undoFor } from '@/lib/copy-status';
import { steady } from '@/lib/steady-tap';

export function useDeckCopies(listId: string, isDeck: boolean, version: unknown) {
  const [data, setData] = useState<api.DeckOwnership | null>(() => api.peekOwnership(listId) ?? null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!isDeck) return;
    let stop = false;
    api.deckOwnership(listId).then((o) => { if (!stop) setData(o); }).catch(() => {});
    return () => { stop = true; };
  }, [listId, isDeck, version]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const act: CollectionAct = useCallback(async (a, before, done) => {
    setBusy(true);
    try {
      const next = await api.deckCollection(listId, a);
      setData(next);
      const back = undoFor(listId, a, before, next.moved ?? 0);
      if (a.action !== 'proxies' && !next.moved) { setToast({ text: 'Nothing moved - the copy may have gone already.' }); return; }
      setToast({
        text: done,
        undo: back ? async () => {
          await api.deckCollection(back.listId, back.act);
          setData(await api.deckOwnership(listId));
        } : undefined,
      });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : 'Could not do that' });
    } finally {
      setBusy(false);
    }
  }, [listId]);

  const holdingOf = useMemo(() => holdingIndex(data), [data]);
  const mark = useCallback((e: Entry) => <CopyMark holding={holdingOf(e)} busy={busy} onAct={act} />, [holdingOf, busy, act]);
  const isWord = useCallback((e: Entry, word: string) => statusWord(holdingOf(e), word), [holdingOf]);

  const toastView = toast && (
    <div role="status" className="fixed bottom-[calc(var(--nav-h)+0.75rem)] sm:bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[#221c08] shadow-lg">
      <span className="min-w-0 flex-1">{toast.text}</span>
      {toast.undo && (
        <button {...steady(() => { const u = toast.undo!; setToast(null); u().catch(() => setToast({ text: 'Could not undo that' })); })} className="min-h-9 shrink-0 rounded-lg bg-[#221c08]/15 px-3 font-semibold">Undo</button>
      )}
    </div>
  );

  return { data, setData, mark: data ? mark : undefined, isWord: data ? isWord : undefined, toastView };
}
