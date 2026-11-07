'use client';

/**
 * Pick a commander by typing its name: matching cards that can lead a deck
 * appear with their art and type line, most played first.
 */

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import * as api from '@/lib/api';
import { enterPick, moveHighlight } from '@/lib/picker-keys';

interface Props {
  value: api.CommanderOption | null;
  onChange: (commander: api.CommanderOption | null) => void;
  autoFocus?: boolean;
}

const DEBOUNCE_MS = 250;

export default function CommanderPicker({ value, onChange, autoFocus }: Props) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<api.CommanderOption[]>([]);
  const [searching, setSearching] = useState(false);
  // The search the options answer, the highlighted row, and an Enter pressed before the answer came.
  const [optionsFor, setOptionsFor] = useState('');
  const [active, setActive] = useState(-1);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const wait = (on: boolean) => { pendingRef.current = on; setPending(on); };
  const pick = useRef(onChange);
  useEffect(() => { pick.current = onChange; }, [onChange]);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      api.searchCommanders(q, controller.signal)
        .then((found) => {
          setOptions(found); setOptionsFor(q); setActive(found.length ? 0 : -1);
          // Enter pressed while searching picks the top result of the search for what's typed now.
          if (pendingRef.current) { wait(false); if (found.length) pick.current(found[0]); }
        })
        .catch(() => {})
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [text]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
        {value.image && <Image src={value.image} alt="" width={48} height={67} className="rounded" unoptimized />}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{value.name}</p>
          <p className="truncate text-sm text-[var(--muted)]">{value.typeLine}</p>
        </div>
        <button
          type="button"
          onClick={() => { onChange(null); setText(''); setOptions([]); }}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)]"
        >
          Change
        </button>
      </div>
    );
  }

  const shown = text.trim().length >= 2 ? options : [];
  return (
    <div>
      <input
        value={text}
        onChange={(e) => { setText(e.target.value); wait(false); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => moveHighlight(e.key, i, shown.length));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const i = enterPick(text, optionsFor, active, shown.length);
            if (i !== null) onChange(shown[i]);
            else if (text.trim().length >= 2) wait(true);
          } else if (e.key === 'Escape' && text) {
            e.preventDefault(); setText(''); setOptions([]);
          }
        }}
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls="commander-options"
        aria-activedescendant={active >= 0 && shown[active] ? `commander-${shown[active].id}` : undefined}
        placeholder="Search for a commander — fire lord azula, vivi…"
        aria-label="Commander"
        autoFocus={autoFocus}
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 outline-none focus:border-[var(--accent)]"
      />
      {(shown.length > 0 || searching) && (
        <div id="commander-options" role="listbox" className="mt-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {searching && pending && shown.length > 0 && <p className="px-4 py-1.5 text-xs text-[var(--muted)]">Picking the top match…</p>}
          {searching && !shown.length && <p className="px-4 py-3 text-sm text-[var(--muted)]">Searching…</p>}
          {shown.map((option, i) => (
            <button
              type="button"
              key={option.id}
              id={`commander-${option.id}`}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              onMouseEnter={() => setActive(i)}
              onClick={() => onChange(option)}
              className={`flex w-full items-center gap-4 px-3 py-2 text-left hover:bg-[var(--surface-hover)] ${i === active ? 'bg-[var(--surface-hover)]' : ''}`}
            >
              {option.image
                ? <Image src={option.image} alt="" width={56} height={78} className="rounded" unoptimized />
                : <span className="h-[78px] w-14 rounded bg-[var(--background)]" />}
              <span className="min-w-0">
                <span className="block truncate font-medium">{option.name}</span>
                <span className="block truncate text-sm text-[var(--muted)]">{option.typeLine}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
