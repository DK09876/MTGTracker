'use client';

/**
 * "What should this deck do?" - the owner's brief, and reads of how the
 * deck wins.
 *
 * A read is either quick (from the cards' roles and combos, no model, free)
 * or the model's: from scratch, building on the brief, or checking it. Reads
 * run as background jobs, so the page can be left while one works; the
 * newest waits here until the owner saves it, uses it as the brief, or
 * discards it. Saved reads list what has changed in the deck since, and how
 * their routes compare with the newest read.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import * as api from '@/lib/api';
import { modelLabel } from '@/lib/quota';
import type { DeckRead, ReadMode, WinLine } from '@/lib/reads';
import type { DeckTags } from '@/lib/tags';

interface Props {
  listId: string;
  tags: DeckTags;
  onTags: (tags: DeckTags) => void;
  /** A first brief drafted from the cards, shown until the owner writes one. */
  drafted?: string;
}

const POLL_MS = 2_500;

const MODES: Array<{ mode: ReadMode; label: string; note: string; free?: boolean }> = [
  { mode: 'quick', label: 'Quick read', note: 'How it wins from combos and roles, without AI.', free: true },
  { mode: 'scratch', label: 'Draft from scratch', note: 'Reads the cards and ignores what you wrote.' },
  { mode: 'build', label: 'Build on my brief', note: 'Keeps your words and fills in what is missing.' },
  { mode: 'check', label: 'Check my brief', note: 'Where the cards and your plan disagree.' },
];

const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const by = (r: DeckRead) => (r.model ? modelLabel(r.model).replace(/^Claude /, '') : 'Quick read');

export default function DeckBrief({ listId, tags, onTags, drafted = '' }: Props) {
  const [brief, setBrief] = useState<string | null>(null);
  const [reads, setReads] = useState<api.DeckReads | null>(null);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The owner's words for the model, on top of everything it is sent anyway.
  const [instructions, setInstructions] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const running = reads?.job?.status === 'running';
  const load = useCallback(() => api.deckReads(listId).then(setReads).catch(() => {}), [listId]);
  useEffect(() => { void load(); }, [load]);
  // While a read runs, look until it is done; leaving the page does not stop it.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  // The box grows with what is written rather than scrolling inside itself.
  const fromCards = !tags.brief.trim() && brief === null && !!drafted;
  const text = brief ?? (tags.brief || drafted);
  // It is fitted again when its width changes too (the saved reads column
  // arriving, a rotated phone), not only when the text does.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + 2}px`;
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [text]);

  useEffect(() => {
    if (!menu) return;
    const outside = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);

  const start = async (mode: ReadMode) => {
    setMenu(false);
    setError(null);
    try {
      const { job } = await api.startRead(listId, mode, mode === 'quick' ? '' : instructions);
      setReads((r) => (r ? { ...r, job } : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start it');
    }
  };

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    }
  };

  const saveBrief = async (value = brief) => {
    if (value === null || value === tags.brief) return;
    try {
      onTags(await api.setTagBrief(listId, value));
      setBrief(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the brief');
    }
  };

  const draft = reads?.draft ?? null;
  const failed = reads?.job && reads.job.status !== 'running' ? reads.job : null;
  const last = reads?.job;

  return (
    <section data-tour="brief" className="flex flex-col gap-3">
      <div className="flex max-w-3xl flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">What this deck does</h3>
        <div className="relative" ref={menuRef}>
          <div data-tour="draft-menu" className="btn-go inline-flex overflow-hidden rounded-full text-sm font-semibold">
            <button onClick={() => start(tags.brief.trim() ? 'build' : 'scratch')} disabled={running} className="px-3.5 py-1.5 disabled:opacity-60">
              {running ? `${last?.label ?? 'Reading'}…` : '✦ Draft with AI'}
            </button>
            <button
              onClick={() => setMenu((m) => !m)}
              disabled={running}
              aria-label="More ways to read the deck"
              aria-haspopup="menu"
              aria-expanded={menu}
              className="border-l border-black/20 px-2.5 disabled:opacity-60"
            >
              <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden><path d="M1 1L5 5L9 1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
          {menu && (
            <div role="menu" className="absolute right-0 z-30 mt-1 w-80 max-w-[90vw] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-lg">
              <label className="block px-3 pb-2 pt-1 text-xs text-[var(--muted)]">
                Your instructions for the AI <span className="opacity-80">(optional, added to what it is sent)</span>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="e.g. Casual table, no infinite combos. Focus on the commander growing huge."
                  className="mt-1 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                />
              </label>
              {MODES.map((m) => (
                <button key={m.mode} role="menuitem" onClick={() => start(m.mode)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--surface-hover)]">
                  <span className="text-sm font-medium">{m.label}</span>
                  <span className={`ml-2 text-xs ${m.free ? 'text-emerald-400' : 'text-[var(--muted)]'}`}>{m.free ? 'free, no AI' : 'AI'}</span>
                  <span className="block text-xs text-[var(--muted)]">{m.note}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="max-w-3xl text-sm text-[var(--muted)]">
        Everything else reads this: what to add and cut, how cards are tagged, what Chat knows. The plan, how it wins,
        what parts of the deck are for — &ldquo;the tokens are there to feed Korvold&rdquo;, &ldquo;keep interaction cheap&rdquo;. AI reads run in the
        background, so you can leave this page while one works.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {running && (
        <div className="flex max-w-3xl flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <p>{last?.label}… <span className="text-[var(--muted)]">{last?.detail}</span></p>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]"><div className="id-grad h-full w-1/3 animate-[slide_1.6s_ease-in-out_infinite] rounded-full motion-reduce:animate-none" /></div>
        </div>
      )}
      {failed && failed.status !== 'done' && !draft && (
        <p className="max-w-3xl text-sm text-red-400">{failed.label} did not finish: {failed.error}</p>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_32rem] flex-col gap-3">
          {draft && !running && (
            <ReadCard read={draft} title="New read · not saved">
              <div className="flex flex-wrap gap-2">
                <button onClick={() => act(() => api.keepRead(listId, draft.id, true))} className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[#221c08]">Save this read</button>
                {draft.brief && (
                  <button onClick={() => { setBrief(draft.brief); void saveBrief(draft.brief); }} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface-hover)]">
                    Use it as my brief
                  </button>
                )}
                <button onClick={() => act(() => api.dropRead(listId, draft.id))} className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--surface-hover)]">Discard</button>
              </div>
            </ReadCard>
          )}
          <label htmlFor={`brief-${listId}`} className="text-sm font-medium">
            My brief <span className="font-normal text-[var(--muted)]">· {fromCards ? 'drafted from the cards - change anything, then confirm the plan below' : 'saved when you leave the box'}</span>
          </label>
          <textarea
            id={`brief-${listId}`}
            ref={box}
            value={text}
            onChange={(e) => setBrief(e.target.value)}
            onBlur={() => saveBrief()}
            rows={3}
            maxLength={4000}
            placeholder="e.g. Aristocrats: make tokens, sacrifice them for value, drain the table. I want to know which cards are fodder vs. outlets vs. payoffs."
            className="min-h-24 resize-none overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>

        {reads && reads.saved.length > 0 && (
          <aside data-tour="saved-reads" className="flex min-w-0 flex-[1_1_18rem] flex-col gap-3">
            <h4 className="font-display font-semibold">Saved reads</h4>
            {reads.saved.map((r) => <SavedCard key={r.id} read={r} onDrop={() => act(() => api.dropRead(listId, r.id))} />)}
          </aside>
        )}
      </div>
    </section>
  );
}

function Routes({ lines }: { lines: WinLine[] }) {
  if (!lines.length) return <p className="text-amber-300">No clear way to win.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((w, i) => (
        <li key={i}>
          {w.label && <span className="font-semibold">{w.label}{w.strength ? ` · ${w.strength === 'strong' ? 'strong' : 'helps close'}` : ''}: </span>}
          {w.how}
          {w.cards.length > 0 && <span className="block text-xs text-[var(--muted)]">{w.cards.join(' · ')}</span>}
        </li>
      ))}
    </ul>
  );
}

function ReadCard({ read, title, children }: { read: DeckRead; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</p>
        <p className="text-xs text-[var(--muted)]">{by(read)}{read.mode === 'check' ? ' · checked your brief' : ''}</p>
      </div>
      <Routes lines={read.winConditions} />
      {read.missing && (
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2">
          <span className="font-semibold text-amber-300">{read.mode === 'check' ? 'Where it disagrees: ' : 'What it needs: '}</span>{read.missing}
        </p>
      )}
      {read.brief && (
        <details>
          <summary className="cursor-pointer text-xs text-[var(--muted)]">Suggested brief</summary>
          <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">{read.brief}</p>
        </details>
      )}
      {children}
    </div>
  );
}

function SavedCard({ read, onDrop }: { read: api.SavedRead; onDrop: () => void }) {
  const [open, setOpen] = useState(false);
  const { since, against } = read;
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
      <div className="flex justify-between gap-2">
        <strong>{when(read.at)} · {by(read)}</strong>
        <span className="text-xs text-[var(--muted)]">{read.winConditions.length} route{read.winConditions.length === 1 ? '' : 's'}</span>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Deck since then:{' '}
        {since.added.length || since.removed.length
          ? <><span className="text-emerald-400">+{since.added.length}</span> <span className="text-red-300">−{since.removed.length}</span> cards</>
          : 'no changes'}
      </p>
      {against && (against.gained.length > 0 || against.lost.length > 0) && (
        <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-2 text-xs">
          <p className="uppercase tracking-wide text-[var(--muted)]">Compared with the newest read</p>
          {against.gained.map((w, i) => <p key={`g${i}`}><span className="font-bold text-emerald-400">+ </span>{w.label ?? w.how}</p>)}
          {against.lost.map((w, i) => <p key={`l${i}`}><span className="font-bold text-red-300">− </span>{w.label ?? w.how}</p>)}
          {against.stillMissing && <p><span className="font-bold text-amber-300">~ </span>Still says it needs something</p>}
        </div>
      )}
      {open && (
        <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-2">
          <Routes lines={read.winConditions} />
          {read.missing && <p className="text-amber-200">{read.missing}</p>}
          {(since.added.length > 0 || since.removed.length > 0) && (
            <p className="text-xs text-[var(--muted)]">
              {since.added.length > 0 && <>In since: {since.added.join(', ')}. </>}
              {since.removed.length > 0 && <>Out since: {since.removed.join(', ')}.</>}
            </p>
          )}
        </div>
      )}
      <div className="flex gap-3 text-xs">
        <button onClick={() => setOpen((o) => !o)} className="text-[var(--accent)] hover:underline">{open ? 'Close' : 'Open'}</button>
        <button onClick={onDrop} className="text-[var(--muted)] hover:underline">Delete</button>
      </div>
    </article>
  );
}
