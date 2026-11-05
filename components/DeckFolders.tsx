'use client';

/**
 * The decks page's folders. On wide screens a rail beside the decks that
 * stays put as the page scrolls, so every folder is always there to pick or
 * to drop a deck on; on phones a pill in the toolbar that opens a sheet.
 *
 * Each folder's swatch blends the colours of the decks in it. The open
 * folder's ⋯ renames or deletes it; deleting keeps its decks.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import MoreMenu from './MoreMenu';
import { MANA } from '@/lib/identity';

export type FolderPick = 'all' | 'none' | string;
export const DECK_DRAG = 'application/x-mtg-deck';
// Where the rail takes over from the pill (Tailwind's lg).
const WIDE = '(min-width: 64rem)';

export interface FolderProps {
  folders: Array<{ id: string; name: string }>;
  counts: { all: number; none: number; byFolder: Record<string, number> };
  /** The colours of the decks in each folder (and 'all' / 'none'), for its swatch. */
  colours: Record<string, string[]>;
  active: FolderPick;
  onPick: (pick: FolderPick) => void;
  /** Resolves to an error message, or null when done. */
  onCreate: (name: string) => Promise<string | null>;
  onRename: (id: string, name: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<void>;
  onDrop: (deckId: string, folderId: string | null) => void;
  /** The new-folder box, opened from elsewhere too (a deck's "New folder with this deck"). */
  naming: boolean;
  setNaming: (on: boolean) => void;
}

/** A square swatch: one colour, or a pie of each colour the folder's decks use. */
export function FolderSwatch({ colours, size = 12 }: { colours: string[] | undefined; size?: number }) {
  const list = 'WUBRG'.split('').filter((c) => colours?.includes(c)).map((c) => MANA[c]);
  const background = !list.length ? 'var(--border)'
    : list.length === 1 ? list[0]
      : `conic-gradient(${list.map((c, i) => `${c} ${(i / list.length) * 100}% ${((i + 1) / list.length) * 100}%`).join(',')})`;
  return <span aria-hidden className="shrink-0 rounded-[4px]" style={{ width: size, height: size, background }} />;
}

/** Shared by the rail and the sheet: naming, renaming and the rows. */
function useFolderEditing({ onCreate, onRename, setNaming }: Pick<FolderProps, 'onCreate' | 'onRename' | 'setNaming'>) {
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent, id?: string) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name) { setNaming(false); setRenaming(null); return; }
    const problem = id ? await onRename(id, name) : await onCreate(name);
    setError(problem);
    if (!problem) { setDraft(''); setNaming(false); setRenaming(null); }
  };
  const nameBox = (id?: string) => (
    <form onSubmit={(e) => submit(e, id)} className="flex items-center gap-1 px-1 py-1">
      <input
        autoFocus
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { setNaming(false); setRenaming(null); setError(null); } }}
        maxLength={60}
        placeholder="Folder name"
        aria-label="Folder name"
        className="min-w-0 flex-1 rounded-lg border border-[var(--accent)] bg-[var(--background)] px-2.5 py-1.5 text-sm outline-none"
      />
      <button className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-sm font-medium text-[#221c08]">{id ? 'Save' : 'Add'}</button>
    </form>
  );
  return { draft, setDraft, renaming, setRenaming, error, setError, nameBox };
}

type Row = { pick: FolderPick; label: string; count: number; folder?: { id: string; name: string } };
const rowsOf = ({ folders, counts }: Pick<FolderProps, 'folders' | 'counts'>): Row[] => [
  { pick: 'all', label: 'All decks', count: counts.all },
  ...(folders.length ? [{ pick: 'none', label: 'Unfiled', count: counts.none }] : []),
  ...folders.map((f) => ({ pick: f.id, label: f.name, count: counts.byFolder[f.id] ?? 0, folder: f })),
];

/** Wide screens: the folders in a rail that stays beside the decks. */
export function FolderRail(props: FolderProps) {
  const { active, onPick, onDrop, onDelete, naming, setNaming, colours } = props;
  const edit = useFolderEditing(props);
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

  return (
    <nav data-tour="deck-folders" aria-label="Folders" className="flex flex-col gap-0.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-sm">
      <span className="px-2.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-[var(--faint)]">Folders</span>
      {rowsOf(props).map((r) => (
        edit.renaming === r.pick ? <div key={r.pick}>{edit.nameBox(r.pick)}</div> : (
          <div key={r.pick} className="group/row relative flex items-center">
            <button
              onClick={() => onPick(r.pick)}
              aria-pressed={active === r.pick}
              {...drop(r.pick)}
              className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                over === r.pick ? 'bg-[var(--accent)]/20 ring-1 ring-[var(--accent)]'
                  : active === r.pick ? 'bg-[var(--surface-hover)] text-[var(--foreground)] shadow-[inset_2px_0_0_var(--accent)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]'}`}
            >
              <FolderSwatch colours={colours[r.pick]} />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className={`text-xs tabular-nums text-[var(--faint)] ${r.folder && active === r.pick ? 'mr-7' : ''}`}>{r.count}</span>
            </button>
            {r.folder && active === r.pick && (
              <span className="absolute right-1">
                <MoreMenu
                  label={`More for the ${r.folder.name} folder`}
                  triggerClassName="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                  items={[
                    { label: 'Rename', onClick: () => { edit.setDraft(r.folder!.name); edit.setRenaming(r.folder!.id); edit.setError(null); } },
                    { label: 'Delete folder…', danger: true, confirm: `Delete “${r.folder.name}”? Its decks stay, out of any folder.`, onClick: () => onDelete(r.folder!.id) },
                  ]}
                />
              </span>
            )}
          </div>
        )
      ))}
      {naming ? edit.nameBox() : (
        <button onClick={() => { edit.setDraft(''); setNaming(true); edit.setError(null); }} className="mt-1 rounded-lg px-2.5 py-2 text-left text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">
          ＋ New folder
        </button>
      )}
      {edit.error && <p role="alert" className="px-2.5 text-xs text-amber-300">{edit.error}</p>}
      {props.folders.length > 0 && <p className="px-2.5 pb-1 pt-2 text-[11px] leading-snug text-[var(--faint)]">Drag a deck onto a folder to file it.</p>}
    </nav>
  );
}

/** Phones: the open folder as a pill; tapping it opens the folders in a sheet. */
export function FolderPill(props: FolderProps) {
  const { active, onPick, onDelete, naming, setNaming, colours } = props;
  const [open, setOpen] = useState(false);
  const edit = useFolderEditing(props);
  const rows = rowsOf(props);
  const current = rows.find((r) => r.pick === active) ?? rows[0];
  // "New folder with this deck" opens the sheet with its box ready - on phones; wide screens name it in the rail.
  const wide = useSyncExternalStore(
    (on) => { const q = window.matchMedia(WIDE); q.addEventListener('change', on); return () => q.removeEventListener('change', on); },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
  const shown = !wide && (open || naming);
  const close = () => { setOpen(false); setNaming(false); edit.setRenaming(null); edit.setError(null); };
  useEffect(() => {
    if (!shown) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  });

  return (
    <>
      <button
        data-tour="deck-folders"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex min-h-10 min-w-0 shrink items-center gap-2 rounded-full border border-[var(--accent)] bg-[var(--surface)] px-3 py-1.5 text-sm"
      >
        <FolderSwatch colours={colours[current.pick]} />
        <span className="min-w-0 truncate">{current.label}</span>
        <span aria-hidden className="text-[var(--muted)]">▾</span>
      </button>
      {shown && createPortal(
        <div role="dialog" aria-label="Folders" className="fixed inset-0 z-[70] flex flex-col justify-end">
          <button aria-label="Close" onClick={close} className="flex-1 bg-black/55" />
          <div className="max-h-[75vh] overflow-y-auto rounded-t-3xl border-t border-[var(--border)] bg-[var(--surface)] px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2.5">
            <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-[var(--border)]" />
            <p className="px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--faint)]">Folders</p>
            {rows.map((r) => (
              edit.renaming === r.pick ? <div key={r.pick}>{edit.nameBox(r.pick)}</div> : (
                <div key={r.pick} className="flex items-center">
                  <button
                    onClick={() => { onPick(r.pick); close(); }}
                    aria-pressed={active === r.pick}
                    className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 text-left text-[15px] ${active === r.pick ? 'bg-[var(--surface-hover)]' : ''}`}
                  >
                    <FolderSwatch colours={colours[r.pick]} size={14} />
                    <span className="min-w-0 flex-1 truncate">{r.label}</span>
                    <span className="text-sm tabular-nums text-[var(--faint)]">{r.count}</span>
                  </button>
                  {r.folder && active === r.pick && (
                    <MoreMenu
                      label={`More for the ${r.folder.name} folder`}
                      triggerClassName="ml-1 flex h-11 w-11 items-center justify-center rounded-xl text-[var(--muted)]"
                      items={[
                        { label: 'Rename', onClick: () => { edit.setDraft(r.folder!.name); edit.setRenaming(r.folder!.id); edit.setError(null); } },
                        { label: 'Delete folder…', danger: true, confirm: `Delete “${r.folder.name}”? Its decks stay, out of any folder.`, onClick: () => onDelete(r.folder!.id) },
                      ]}
                    />
                  )}
                </div>
              )
            ))}
            {naming ? edit.nameBox() : (
              <button onClick={() => { edit.setDraft(''); setNaming(true); edit.setError(null); }} className="flex min-h-11 w-full items-center rounded-xl px-2.5 text-left text-[15px] text-[var(--muted)]">
                ＋ New folder
              </button>
            )}
            {edit.error && <p role="alert" className="px-2.5 text-xs text-amber-300">{edit.error}</p>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
