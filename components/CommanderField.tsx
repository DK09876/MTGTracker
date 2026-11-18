'use client';

/**
 * Search's optional Commander field: the only way a search is for a commander's deck (its colours, Commander-legal,
 * built around its rules text). A card named in the search text is just a card, never taken as the commander.
 * Collapsed to one small button until used; once chosen, a chip with Change and ✕.
 */

import { useState } from 'react';

import CommanderPicker from './CommanderPicker';
import type * as api from '@/lib/api';

export default function CommanderField({ value, onChange }: { value: api.CommanderOption | null; onChange: (c: api.CommanderOption | null) => void }) {
  const [open, setOpen] = useState(false);
  if (value) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm" data-commander-field>
        <span className="text-[var(--muted)]">For commander</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)]/50 bg-[var(--accent)]/10 py-0.5 pl-3 pr-1">
          <b className="font-semibold">{value.name}</b>
          <button type="button" onClick={() => { onChange(null); setOpen(true); }} className="rounded-full px-2 py-0.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Change</button>
          <button type="button" aria-label="Search without a commander" onClick={() => { onChange(null); setOpen(false); }} className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">✕</button>
        </span>
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-commander-field
        className="rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
        ＋ For a commander
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1.5" data-commander-field>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-[var(--muted)]">Search for this commander’s deck: its colours, and what it rewards.</span>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-[var(--muted)] underline underline-offset-[3px] hover:text-[var(--foreground)]">Cancel</button>
      </div>
      <CommanderPicker value={null} onChange={(c) => { onChange(c); setOpen(false); }} autoFocus />
    </div>
  );
}
