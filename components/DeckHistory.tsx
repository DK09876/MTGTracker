'use client';

/**
 * A deck's history, in a window over the page: every change, newest first,
 * grouped by sitting, each with a way back to before it; and snapshots -
 * take one, compare it with the deck now, restore it.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import * as api from '@/lib/api';

const SESSION_GAP_MS = 30 * 60_000;

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** "+4 −3, 2 moved" */
export function countLine(d: api.HistoryDiff): string {
  const parts = [
    d.added.length ? `+${d.added.length}` : '',
    d.removed.length ? `−${d.removed.length}` : '',
    d.moved.length ? `${d.moved.length} moved` : '',
    d.changed.length ? `${d.changed.length} changed` : '',
    d.tagged.length ? `${d.tagged.length} tag${d.tagged.length === 1 ? '' : 's'}` : '',
    d.commander ? 'new commander' : '',
  ].filter(Boolean);
  return parts.join(', ') || 'no changes';
}

const BOARD: Record<string, string> = { main: 'Main', maybe: 'Maybeboard', side: 'Sideboard' };
const board = (b: string | null, names: Map<string, string>) => (b ? names.get(b) ?? BOARD[b] ?? b : '');
const place = (w: string | null, names: Map<string, string>) => (w ? w.replace(/\b(main|maybe|side|s-[\w-]+)\b/, (m) => board(m, names)) : '');

/** A change card by card: added, removed, moved, changed, tags. */
export function DiffList({ diff, names }: { diff: api.HistoryDiff; names: Map<string, string> }) {
  const rows: Array<[string, string, string]> = [
    ...diff.added.map((c): [string, string, string] => ['+', c.name, place(c.to, names)]),
    ...diff.removed.map((c): [string, string, string] => ['−', c.name, place(c.from, names)]),
    ...diff.moved.map((c): [string, string, string] => ['→', c.name, `${board(c.from, names)} → ${board(c.to, names)}`]),
    ...diff.changed.map((c): [string, string, string] => ['~', c.name, `${place(c.from, names)} → ${place(c.to, names)}`]),
    ...diff.tagged.map((c): [string, string, string] => ['#', c.name, c.to ? `tagged ${c.to}` : `untagged ${c.from}`]),
    ...(diff.commander ? [['★', 'Commander', `${diff.commander.from ?? 'none'} → ${diff.commander.to ?? 'none'}`] as [string, string, string]] : []),
  ];
  if (!rows.length) return <p className="text-xs text-[var(--muted)]">Nothing changed.</p>;
  return (
    <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto text-xs">
      {rows.map(([mark, name, detail], i) => (
        <li key={i} className="flex gap-2">
          <span className={`w-3 shrink-0 text-center font-bold ${mark === '+' ? 'text-emerald-400' : mark === '−' ? 'text-red-300' : 'text-[var(--muted)]'}`}>{mark}</span>
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="shrink-0 text-[var(--muted)]">{detail}</span>
        </li>
      ))}
    </ul>
  );
}

interface Props {
  listId: string;
  /** Section names by id, for "moved to Wishlist". */
  sectionNames: Map<string, string>;
  onChanged: () => void;
  onClose: () => void;
}

export default function DeckHistory({ listId, sectionNames, onChanged, onClose }: Props) {
  const [tab, setTab] = useState<'changes' | 'snapshots'>('changes');
  const [data, setData] = useState<{ changes: api.DeckChange[]; snapshots: api.DeckSnapshot[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [compare, setCompare] = useState<{ id: string; diff: api.HistoryDiff; summary: string } | null>(null);

  const read = useCallback(() => api.deckHistory(listId).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the history')), [listId]);
  useEffect(() => { void read(); }, [read]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await work(); await read(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not work'); } finally { setBusy(false); setConfirming(null); }
  };

  // Sittings: changes by the same person with no gap over half an hour.
  const sittings: Array<{ who: string | null; at: string; items: api.DeckChange[] }> = [];
  for (const c of data?.changes ?? []) {
    const last = sittings[sittings.length - 1];
    const prev = last?.items[last.items.length - 1];
    if (last && prev && last.who === (c.who ?? null) && new Date(prev.at).getTime() - new Date(c.at).getTime() < SESSION_GAP_MS) last.items.push(c);
    else sittings.push({ who: c.who ?? null, at: c.at, items: [c] });
  }

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label="Deck history"
        className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-[var(--border)] bg-[var(--background)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4">
          <h2 className="text-lg font-semibold">History</h2>
          <button onClick={onClose} aria-label="Close" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface)]">✕</button>
        </div>
        <div className="flex gap-1 border-b border-[var(--border)] px-4 py-2 text-sm" role="tablist">
          {(['changes', 'snapshots'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 ${tab === t ? 'bg-[var(--surface-hover)] font-semibold' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}>
              {t === 'changes' ? 'Changes' : `Snapshots${data ? ` · ${data.snapshots.length}` : ''}`}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
          {!data && !error && <p className="text-sm text-[var(--muted)]">Reading the history…</p>}

          {data && tab === 'changes' && (
            data.changes.length === 0
              ? <p className="text-sm text-[var(--muted)]">No changes yet. Everything you change in this deck shows up here, with a way back.</p>
              : (
                <div className="flex flex-col gap-5">
                  {sittings.map((s, i) => (
                    <section key={i} className="flex flex-col gap-1.5">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{when(s.at)}{s.who ? ` · ${s.who}` : ''}</h3>
                      <ul className="flex flex-col gap-1">
                        {s.items.map((c) => (
                          <li key={c.id} className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ${c.undone ? 'opacity-50' : ''}`}>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <button onClick={() => setOpen(open === c.id ? null : c.id)} className="min-w-0 flex-1 text-left" aria-expanded={open === c.id}>
                                <span className={c.undone ? 'line-through' : ''}>{c.label}</span>
                                <span className="ml-2 text-xs text-[var(--muted)]">{time(c.at)} · {countLine(c.diff)}{c.undone ? ' · undone' : ''}</span>
                              </button>
                              {c.restorable && !c.undone && (confirming === c.id
                                ? <span className="flex items-center gap-2 text-xs">
                                    <span className="text-amber-300">Also undoes everything after it.</span>
                                    <button disabled={busy} onClick={() => act(() => api.restoreBefore(listId, c.id))} className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 font-semibold text-[#221c08] disabled:opacity-60">Go back</button>
                                    <button onClick={() => setConfirming(null)} className="text-[var(--muted)] underline">Cancel</button>
                                  </span>
                                : <button onClick={() => setConfirming(c.id)} className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Go back to before this</button>)}
                            </div>
                            {open === c.id && <div className="mt-2 border-t border-dashed border-[var(--border)] pt-2"><DiffList diff={c.diff} names={sectionNames} /></div>}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )
          )}

          {data && tab === 'snapshots' && (
            <div className="flex flex-col gap-4">
              <form onSubmit={(e) => { e.preventDefault(); void act(async () => { await api.takeSnapshot(listId, name || `Snapshot ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`); setName(''); }); }}
                className="flex flex-wrap items-center gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name it, e.g. Before the precon upgrade" aria-label="Snapshot name"
                  className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]" />
                <button disabled={busy} className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-sm font-semibold text-[#221c08] disabled:opacity-60">Take a snapshot</button>
              </form>
              <p className="text-xs text-[var(--muted)]">A snapshot is the whole deck as it is now. One is also taken for you before an import over the deck and before Tune applies changes.</p>
              {data.snapshots.length === 0 && <p className="text-sm text-[var(--muted)]">No snapshots yet.</p>}
              <ul className="flex flex-col gap-1.5">
                {data.snapshots.map((s) => (
                  <li key={s.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1">{s.name}{s.auto && <span className="ml-2 text-xs text-[var(--muted)]">automatic</span>}
                        <span className="ml-2 text-xs text-[var(--muted)]">{when(s.at)} · {s.size} cards</span></span>
                      <button onClick={() => (compare?.id === s.id ? setCompare(null) : api.compareSnapshot(listId, s.id).then((r) => setCompare({ id: s.id, ...r })).catch(() => setError('Could not compare that snapshot')))}
                        className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">{compare?.id === s.id ? 'Hide' : 'Compare with now'}</button>
                      {confirming === s.id
                        ? <span className="flex items-center gap-2 text-xs">
                            <button disabled={busy} onClick={() => act(() => api.restoreSnapshot(listId, s.id))} className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 font-semibold text-[#221c08] disabled:opacity-60">Restore it</button>
                            <button onClick={() => setConfirming(null)} className="text-[var(--muted)] underline">Cancel</button>
                          </span>
                        : <button onClick={() => setConfirming(s.id)} className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Restore</button>}
                      <button onClick={() => act(() => api.deleteSnapshot(listId, s.id))} aria-label={`Delete ${s.name}`} className="text-xs text-[var(--muted)] hover:text-red-300">✕</button>
                    </div>
                    {compare?.id === s.id && (
                      <div className="mt-2 border-t border-dashed border-[var(--border)] pt-2">
                        <p className="mb-1 text-xs text-[var(--muted)]">Since this snapshot: {compare.summary}</p>
                        <DiffList diff={compare.diff} names={sectionNames} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
