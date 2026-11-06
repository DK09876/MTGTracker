'use client';

/**
 * Picking a seat's deck. The button shows what the seat is playing; it
 * opens a sheet (the bottom of the screen on a phone) with the pilot's
 * decks by folder, and - when the game lets decks be borrowed - everyone
 * else's behind a row each with their picture, closed until opened.
 * Search looks through all of them. A deck not on the app can be typed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { SeatAvatar } from '@/components/GameBits';
import { IdentitySymbols } from '@/components/ManaCost';
import type * as api from '@/lib/api';
import { steady } from '@/lib/steady-tap';

export interface DeckChoice { deckId: string | null; deckName: string }

export default function DeckPicker({ seat, pilot, members, decks, borrowing, value, taken = {}, onChange }: {
  seat: number;
  /** Decks already at another seat, by deck id: the seat's number. One copy of a deck can't sit twice. */
  taken?: Record<string, number>;
  pilot: api.Member;
  members: api.Member[];
  decks: Record<string, api.PickDeck[]>;
  borrowing: boolean;
  value: DeckChoice;
  onChange: (choice: DeckChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const owners = useMemo(() => new Map(Object.entries(decks).flatMap(([owner, list]) => list.map((d) => [d.id, { deck: d, owner }] as const))), [decks]);
  const chosen = value.deckId ? owners.get(value.deckId) : undefined;
  const lender = chosen && chosen.owner !== pilot.id ? members.find((m) => m.id === chosen.owner) : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Seat ${seat + 1} deck: ${chosen?.deck.name ?? (value.deckName || 'none picked')}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-left hover:border-[var(--accent)]"
      >
        <SeatAvatar art={chosen?.deck.commander?.art} name={chosen?.deck.name ?? (value.deckName || '?')} seat={seat} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{chosen?.deck.name ?? (value.deckName || <span className="font-normal text-[var(--muted)]">Pick a deck</span>)}</span>
          <span className="flex items-center gap-1.5 truncate text-xs text-[var(--muted)]">
            {lender ? (
              <><SeatAvatar art={lender.art} name={lender.name} size={14} /> Borrowed from {lender.name}</>
            ) : chosen?.deck.commander ? chosen.deck.commander.name.split(',')[0] : value.deckName ? 'Not on the app' : 'Tap to choose'}
          </span>
        </span>
        <span aria-hidden className="text-[var(--muted)]">▾</span>
      </button>
      {open && (
        <PickerSheet
          seat={seat} pilot={pilot} members={members} decks={decks} borrowing={borrowing} value={value} taken={taken}
          lenderId={lender?.id ?? null}
          onPick={(c) => { onChange(c); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PickerSheet({ seat, pilot, members, decks, borrowing, value, taken, lenderId, onPick, onClose }: {
  seat: number; pilot: api.Member; members: api.Member[]; decks: Record<string, api.PickDeck[]>; borrowing: boolean; taken: Record<string, number>;
  value: DeckChoice; lenderId: string | null; onPick: (c: DeckChoice) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState(value.deckId ? '' : value.deckName);
  // Whose decks are showing under "Borrow from": the one lending the current deck starts open.
  const [opened, setOpened] = useState<Set<string>>(() => new Set(lenderId ? [lenderId] : []));
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (d: api.PickDeck) => !q || d.name.toLowerCase().includes(q) || (d.commander?.name.toLowerCase().includes(q) ?? false) || (d.folder?.toLowerCase().includes(q) ?? false);
  const own = (decks[pilot.id] ?? []).filter(matches);
  const lenders = borrowing
    ? members.filter((m) => m.id !== pilot.id && (decks[m.id] ?? []).length).map((m) => ({ member: m, list: (decks[m.id] ?? []).filter(matches), all: (decks[m.id] ?? []).length }))
    : [];
  const toggle = (id: string) => setOpened((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Deck for seat ${seat + 1}`}>
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-[var(--border)] bg-[var(--background)] pb-[env(safe-area-inset-bottom)] sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-[var(--border)] p-4 pb-3">
          <SeatAvatar art={pilot.art} name={pilot.name} seat={seat} size={30} />
          <p className="min-w-0 flex-1 truncate font-display text-lg font-bold">What is {pilot.name} playing?</p>
          <button type="button" onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-full text-[var(--muted)] hover:bg-[var(--surface)]">✕</button>
        </div>
        <div className="px-4 pt-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={borrowing ? 'Find a deck - anyone’s' : 'Find a deck'}
            aria-label="Find a deck"
            className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-2 pt-2">
          <Section title={`${pilot.name}’s decks`}>
            <ByFolder list={own} value={value} taken={taken} onPick={onPick} empty={q ? 'None match' : (decks[pilot.id] ?? []).length ? '' : pilot.profileId ? 'No decks on the app yet' : 'A guest - type the deck below'} />
          </Section>

          {lenders.length > 0 && (
            <Section title="Borrow from">
              {lenders.map(({ member, list, all }) => {
                // Searching opens everyone with a match; otherwise each opens when tapped.
                const shown = q ? list.length > 0 : opened.has(member.id);
                if (q && !list.length) return null;
                return (
                  <div key={member.id} className="rounded-2xl">
                    <button type="button" onClick={() => toggle(member.id)} aria-expanded={shown}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-[var(--surface)]">
                      <SeatAvatar art={member.art} name={member.name} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{member.name}</span>
                        <span className="block text-xs text-[var(--muted)]">{q ? `${list.length} of ${all}` : all} deck{all === 1 ? '' : 's'}</span>
                      </span>
                      <span aria-hidden className={`text-[var(--muted)] transition-transform ${shown ? 'rotate-90' : ''}`}>›</span>
                    </button>
                    {shown && <div className="ml-6 border-l border-[var(--border)] pl-2"><ByFolder list={list} value={value} taken={taken} onPick={onPick} empty="" /></div>}
                  </div>
                );
              })}
            </Section>
          )}
          {!borrowing && <p className="px-3 pb-1 pt-2 text-xs text-[var(--muted)]">Turn on <b>Borrow decks</b> to pick from other players’ decks.</p>}

          <Section title="Not on the app">
            <form className="flex gap-2 px-2" onSubmit={(e) => { e.preventDefault(); onPick({ deckId: null, deckName: typed.trim().slice(0, 60) }); }}>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Deck or commander name (optional)" maxLength={60}
                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]" />
              <button type="submit" className="rounded-lg border border-[var(--border)] px-3 text-sm">Use</button>
            </form>
          </Section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-2 first:mt-0">
      <h3 className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</h3>
      {children}
    </section>
  );
}

/** A person's decks, the ones in no folder first, then each folder under its name. */
function ByFolder({ list, value, taken, onPick, empty }: { list: api.PickDeck[]; value: DeckChoice; taken: Record<string, number>; onPick: (c: DeckChoice) => void; empty: string }) {
  if (!list.length) return empty ? <p className="px-3 py-2 text-sm text-[var(--muted)]">{empty}</p> : null;
  const groups = new Map<string, api.PickDeck[]>();
  for (const d of list) groups.set(d.folder ?? '', [...(groups.get(d.folder ?? '') ?? []), d]);
  const names = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  return (
    <ul>
      {names.map((folder) => (
        <li key={folder || '-'}>
          {folder && names.length > 0 && <p className="flex items-center gap-1.5 px-3 pb-0.5 pt-2 text-xs font-semibold text-[var(--muted)]"><span aria-hidden>▤</span>{folder}</p>}
          <ul>
            {groups.get(folder)!.map((d) => {
              const on = value.deckId === d.id;
              const elsewhere = !on && taken[d.id] !== undefined ? taken[d.id] : null;
              return (
                <li key={d.id}>
                  <button type="button" {...steady(() => onPick({ deckId: d.id, deckName: d.name }))} aria-pressed={on} disabled={elsewhere !== null}
                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left disabled:opacity-45 ${on ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'enabled:hover:bg-[var(--surface)]'}`}>
                    <SeatAvatar art={d.commander?.art} name={d.name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{d.name}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]">
                        {d.commander && <IdentitySymbols identity={d.commander.identity.join('')} size={12} />}
                        <span className="truncate">{d.commander?.name.split(',')[0] ?? 'No commander'}</span>
                      </span>
                    </span>
                    {elsewhere !== null && <span className="shrink-0 text-[11px] text-[var(--muted)]">at seat {elsewhere + 1}</span>}
                    {elsewhere === null && d.games > 0 && <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold tabular-nums">{d.wins}–{d.games - d.wins}</span>}
                    {on && <span aria-hidden className="shrink-0 text-[var(--accent)]">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
