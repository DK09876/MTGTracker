'use client';

/**
 * Cards the deck can't have as it stands - too many copies, outside the
 * commanders' colours, banned, not legal - each with its fix. Shown on top of
 * Cards and Tune only when there is something to fix; the cut list shows the
 * same cards as its first filter.
 */

import { useState } from 'react';

import Tip from './Tip';
import type { Flag } from '@/lib/health';

interface Props {
  flags: Flag[];
  /** Where a moved card goes: the section for cards that came out. */
  cutName: string;
  onFix: (flag: Flag) => Promise<void> | void;
  /** Inside the cut list, as its first filter: no frame of its own. */
  bare?: boolean;
}

export const fixLabel = (f: Flag, cutName: string) => (f.kind === 'copies' ? 'Remove extra copies' : `Move to ${cutName}`);

export default function FlaggedZone({ flags, cutName, onFix, bare = false }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!flags.length) return null;
  const fix = async (f: Flag) => { setBusy(f.cardId + f.kind); try { await onFix(f); } finally { setBusy(null); } };
  const rows = (
    <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      {flags.map((f) => (
        <li key={f.cardId + f.kind} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
          <span className="min-w-0 flex-[1_1_14rem]">
            <span className="font-medium">{f.name}</span>
            <span className="ml-2 text-[var(--muted)]">{f.why}</span>
          </span>
          {f.commander
            ? <span className="text-xs text-[var(--muted)]">Change the commander from its ⋯ on Cards</span>
            : (
              <button onClick={() => fix(f)} disabled={busy !== null}
                className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold hover:bg-[var(--surface-hover)] disabled:opacity-50">
                {busy === f.cardId + f.kind ? 'Fixing…' : fixLabel(f, cutName)}
              </button>
            )}
        </li>
      ))}
    </ul>
  );
  if (bare) return rows;
  return (
    <section data-section="Flagged" data-section-count={String(flags.length)} className="mt-4 flex flex-col gap-2 rounded-2xl border border-[#ffb4a8]/40 bg-[#ffb4a8]/[0.04] p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {flags.length} card{flags.length === 1 ? '' : 's'} to fix first
        <Tip label="About flagged cards">
          Cards a Commander deck can&apos;t have: more copies than allowed, colours outside the commander&apos;s, or cards that are banned or not legal.
          Whatever the plan, these go first. A moved card waits in {cutName}, so you can bring it back.
        </Tip>
      </h3>
      {rows}
    </section>
  );
}
