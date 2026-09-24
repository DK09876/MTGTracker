'use client';

/**
 * The one search field, with card names suggested as you type.
 *
 * Names are the fast path: pick one and it searches for exactly that card,
 * with no model involved. Pressing Enter on anything else hands it to the
 * search route to work out what it meant.
 *
 * Suggestions stop once the input stops looking like a name - Scryfall
 * syntax, or more words than a card name has - so a sentence is not shadowed
 * by a dropdown of near-misses.
 */

import { useEffect, useId, useState } from 'react';

import * as api from '@/lib/api';
import { looksLikeSyntax } from '@/lib/syntax';

const DEBOUNCE_MS = 200;
// Long card names run to five or six words; sentences run longer.
const MAX_NAME_WORDS = 6;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onPickName: (name: string) => void;
}

const wantsSuggestions = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length >= 2
    && trimmed.split(/\s+/).length <= MAX_NAME_WORDS
    && !looksLikeSyntax(trimmed);
};

export default function SearchBox({ value, onChange, onSubmit, onPickName }: Props) {
  const [names, setNames] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  useEffect(() => {
    if (!wantsSuggestions(value)) return;
    // Aborting the previous request keeps a slow reply for "lig" from
    // replacing the suggestions for "lightning".
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.autocomplete(value, controller.signal)
        .then((found) => { setNames(found.slice(0, 8)); setActive(-1); })
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [value]);

  const visible = open && wantsSuggestions(value) ? names : [];

  const pick = (name: string) => {
    setOpen(false);
    onPickName(name);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && visible.length) {
      e.preventDefault();
      setActive((i) => (i + 1) % visible.length);
    } else if (e.key === 'ArrowUp' && visible.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? visible.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter' && active >= 0 && visible[active]) {
      e.preventDefault();
      pick(visible[active]);
    }
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setOpen(false); onSubmit(value); }}
      className="flex gap-2"
    >
      <div className="relative min-w-0 flex-1">
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder="A card name, or describe what you want"
          aria-label="Search cards"
          role="combobox"
          aria-expanded={visible.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base outline-none focus:border-[var(--accent)]"
        />
        {visible.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg"
          >
            {visible.map((name, i) => (
              <li
                key={name}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: click fires after the input's blur
                // has already closed the list.
                onMouseDown={(e) => { e.preventDefault(); pick(name); }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-4 py-2 text-sm ${i === active ? 'bg-[var(--surface-hover)]' : ''}`}
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="submit"
        className="rounded-xl bg-[var(--accent)] px-5 py-3 font-medium text-[#221c08] hover:brightness-110"
      >
        Search
      </button>
    </form>
  );
}
