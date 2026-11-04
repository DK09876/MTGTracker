'use client';

/**
 * The decks page's folders: All, Unfiled, then each folder, and "+ Folder".
 * A deck dragged onto a folder goes into it (onto Unfiled, out of any).
 * The open folder's ⋯ renames or deletes it; deleting keeps its decks.
 */

import { useState } from 'react';

import MoreMenu from './MoreMenu';

export type FolderPick = 'all' | 'none' | string;
export const DECK_DRAG = 'application/x-mtg-deck';

interface Props {
  folders: Array<{ id: string; name: string }>;
  counts: { all: number; none: number; byFolder: Record<string, number> };
  active: FolderPick;
  onPick: (pick: FolderPick) => void;
  /** Resolves to an error message, or null when done. */
  onCreate: (name: string) => Promise<string | null>;
  onRename: (id: string, name: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<void>;
  onDrop: (deckId: string, folderId: string | null) => void;
  /** Open the new-folder box from elsewhere (a deck's "New folder with this deck"). */
  naming: boolean;
  setNaming: (on: boolean) => void;
}

export default function DeckFolderBar({ folders, counts, active, onPick, onCreate, onRename, onDelete, onDrop, naming, setNaming }: Props) {
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<FolderPick | null>(null);

  const drop = (target: FolderPick) => ({
    onDragOver: (e: React.DragEvent) => {
      if (target === 'all' || !e.dataTransfer.types.includes(DECK_DRAG)) return;
      e.preventDefault();
      setOver(target);
    },
    onDragLeave: () => setOver((o) => (o === target ? null : o)),
    onDrop: (e: React.DragEvent) => {
      const deck = e.dataTransfer.getData(DECK_DRAG);
      setOver(null);
      if (deck && target !== 'all') { e.preventDefault(); onDrop(deck, target === 'none' ? null : target); }
    },
  });
  const chip = (pick: FolderPick, label: React.ReactNode, count: number) => (
    <button
      key={pick}
      onClick={() => onPick(pick)}
      aria-pressed={active === pick}
      {...drop(pick)}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition ${
        over === pick ? 'border-[var(--accent)] bg-[var(--accent)]/20'
          : active === pick ? 'border-[var(--accent)] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'}`}
    >
      {label}<span className="tabular-nums opacity-70">{count}</span>
    </button>
  );

  const submit = async (e: React.FormEvent, id?: string) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name) { setNaming(false); setRenaming(null); return; }
    const problem = id ? await onRename(id, name) : await onCreate(name);
    setError(problem);
    if (!problem) { setDraft(''); setNaming(false); setRenaming(null); }
  };
  const nameBox = (id?: string) => (
    <form onSubmit={(e) => submit(e, id)} className="flex shrink-0 items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { setNaming(false); setRenaming(null); setError(null); } }}
        maxLength={60}
        placeholder="Folder name"
        aria-label="Folder name"
        className="w-40 rounded-full border border-[var(--accent)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none"
      />
      <button className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[#221c08]">{id ? 'Rename' : 'Add'}</button>
    </form>
  );

  return (
    <div data-tour="deck-folders" className="mt-6">
      {/* One row to swipe on a phone; wrapped on wider screens. */}
      <div role="group" aria-label="Folders" className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        {chip('all', 'All decks', counts.all)}
        {folders.length > 0 && chip('none', 'Unfiled', counts.none)}
        {folders.map((f) => (
          renaming === f.id ? <span key={f.id}>{nameBox(f.id)}</span> : (
            <span key={f.id} className="flex shrink-0 items-center">
              {chip(f.id, <><FolderIcon />{f.name}</>, counts.byFolder[f.id] ?? 0)}
              {active === f.id && (
                <MoreMenu
                  label={`More for the ${f.name} folder`}
                  items={[
                    { label: 'Rename', onClick: () => { setDraft(f.name); setRenaming(f.id); setError(null); } },
                    { label: 'Delete folder…', danger: true, confirm: `Delete “${f.name}”? Its decks stay, out of any folder.`, onClick: () => onDelete(f.id) },
                  ]}
                />
              )}
            </span>
          )
        ))}
        {naming ? nameBox() : (
          <button onClick={() => { setDraft(''); setNaming(true); setError(null); }} className="shrink-0 whitespace-nowrap rounded-full border border-dashed border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
            ＋ Folder
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-amber-300">{error}</p>}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current opacity-80">
      <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4l1.5 2h7.5A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5z" />
    </svg>
  );
}
