'use client';

/** "Add a profile": a name, and you are in it. */

import { useState } from 'react';

import * as api from '@/lib/api';
import type { Profile } from '@/lib/profile';

interface Props {
  onAdded: (profile: Profile) => void;
  /** Starts as a link; opens into the form when clicked. */
  compact?: boolean;
}

export default function AddProfile({ onAdded, compact }: Props) {
  const [open, setOpen] = useState(!compact);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full px-3 py-2 text-left text-sm text-[var(--accent)] hover:bg-[var(--surface-hover)]">
        + Add a profile
      </button>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || busy) return;
        setBusy(true);
        setError(null);
        try {
          onAdded(await api.createProfile(name.trim()));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not add that profile');
        } finally {
          setBusy(false);
        }
      }}
      className={compact ? 'flex flex-col gap-2 px-3 py-2' : 'flex flex-col gap-2'}
    >
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="New profile name"
          maxLength={30}
          autoFocus={compact}
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button
          disabled={busy || !name.trim()}
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[#221c08] disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  );
}
