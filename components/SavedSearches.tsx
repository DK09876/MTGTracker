'use client';

/**
 * Saved searches: a search kept under a name to carry on later, as it was
 * left - what was asked and refined, the tab, the pages loaded.
 *
 * SaveBar sits over the results: "Save search" for a new one; for one opened
 * from the history panel, whether it has changed since, and "Save changes".
 * The list of them is the history panel (HistoryPanel).
 */

import { useState } from 'react';

import { sameSession, type SavedSearch, type Session } from '@/lib/recent';
import { steady } from '@/lib/steady-tap';

const input = 'min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]';
const button = 'min-h-9 shrink-0 rounded-lg border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-hover)] disabled:opacity-50';
const primary = 'min-h-9 shrink-0 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[#221c08] hover:brightness-110 disabled:opacity-50';

export function SaveBar({ session, saved, onSave, onSaveChanges, onNew }: {
  session: Session;
  /** The saved search this is, if any. */
  saved: SavedSearch | null;
  onSave: (name: string) => Promise<void>;
  onSaveChanges: () => Promise<void>;
  /** Leave this search for an empty page, with the saved and recent lists. */
  onNew: () => void;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } finally { setBusy(false); }
  };

  if (saved) {
    const unchanged = sameSession(saved.session, session);
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 truncate text-[var(--muted)]">
          <span aria-hidden className="text-[var(--accent)]">★</span> Saved as <span className="text-[var(--foreground)]">{saved.name}</span>
          {!unchanged && ' - changed since'}
        </span>
        {!unchanged && (
          <button disabled={busy} {...steady(() => act(onSaveChanges))} className={primary}>Save changes</button>
        )}
        {!unchanged && (
          <button disabled={busy} onClick={() => setNaming(session.thread.join(' › ').slice(0, 80))} className={button}>Save as new</button>
        )}
        <button onClick={onNew} className={`${button} ml-auto`}>New search</button>
        {naming !== null && <NameForm value={naming} onChange={setNaming} busy={busy} onCancel={() => setNaming(null)} onSave={(n) => act(async () => { await onSave(n); setNaming(null); })} />}
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      {naming === null ? (
        <>
          <button onClick={() => setNaming(session.thread.join(' › ').slice(0, 80))} className={button}>
            <span aria-hidden>☆</span> Save search
          </button>
          <button onClick={onNew} className={`${button} ml-auto`}>New search</button>
        </>
      ) : (
        <NameForm value={naming} onChange={setNaming} busy={busy} onCancel={() => setNaming(null)} onSave={(n) => act(async () => { await onSave(n); setNaming(null); })} />
      )}
    </div>
  );
}

function NameForm({ value, onChange, busy, onSave, onCancel }: {
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSave(value.trim()); }}>
      <input value={value} onChange={(e) => onChange(e.target.value)} autoFocus maxLength={80} aria-label="Name for this search" enterKeyHint="done" className={input} />
      <button disabled={busy || !value.trim()} className={primary}>Save</button>
      <button type="button" onClick={onCancel} className={button}>Cancel</button>
    </form>
  );
}
