'use client';

/**
 * The header's budget chip: what has been spent on paid AI today against the
 * cap that will stop this profile first (its own share, or the app's). It
 * opens the same bars Settings shows. Read again whenever a request may have
 * spent, when a job starts or ends, and every half minute, since background
 * jobs spend after their request has answered. Hidden when no paid model has
 * a key: there is nothing to spend.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Budget } from './AiBits';
import type { AiState } from '@/lib/ai';
import * as api from '@/lib/api';
import { useMe } from '@/lib/use-me';
import { useProfile } from '@/lib/profile';
import { dollars } from '@/lib/spend';

const EVERY_MS = 30_000;

/** The cap that runs out first for this profile, and what has been spent against it. */
export function tightest(spend: AiState['spend']): { spent: number; cap: number; whose: 'yours' | 'everyone' } {
  const mine = spend.caps.perProfile - spend.profileToday;
  const app = spend.caps.daily - spend.today;
  return app < mine ? { spent: spend.today, cap: spend.caps.daily, whose: 'everyone' } : { spent: spend.profileToday, cap: spend.caps.perProfile, whose: 'yours' };
}

export default function AiSpend() {
  const profile = useProfile();
  // Not until the profile may be used: a signed-out admin's would be refused.
  const me = useMe();
  const ready = !!me && !me.needsSignIn;
  const [state, setState] = useState<AiState | null>(null);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profile || !ready) return;
    let stopped = false;
    const read = () => { if (!document.hidden) api.aiState().then((s) => { if (!stopped) setState(s); }).catch(() => {}); };
    read();
    const timer = setInterval(read, EVERY_MS);
    const events = [api.AI_SPENT, api.AI_CHANGED, api.JOBS_CHANGED];
    for (const e of events) window.addEventListener(e, read);
    document.addEventListener('visibilitychange', read);
    return () => { stopped = true; clearInterval(timer); for (const e of events) window.removeEventListener(e, read); document.removeEventListener('visibilitychange', read); };
  }, [profile, ready]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!container.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  if (!profile || !ready || !state || !state.models.some((m) => m.hasKey && m.price)) return null;
  const t = tightest(state.spend);
  const share = t.spent / Math.max(t.cap, 0.01);
  const tone = share >= 1 ? 'border-red-400/60 text-red-300' : share >= 0.8 ? 'border-amber-300/60 text-amber-300' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]';
  const says = `AI budget today: ${dollars(t.spent)} spent of ${dollars(t.cap)} (${t.whose === 'yours' ? 'your share' : 'everyone'})`;

  return (
    <div className="relative" ref={container} data-ai-spend>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label={says} title={says}
        className={`flex items-center whitespace-nowrap rounded-lg border px-2 py-1 text-xs tabular-nums ${tone}`}>
        {dollars(t.spent)}{/* The cap shows where there is room; a phone's header has none beside a job chip. */}<span className="max-sm:hidden"><span className="px-1 opacity-60">/</span>{dollars(t.cap)}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Today's AI budget"
          className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl max-sm:fixed max-sm:inset-x-4 max-sm:top-[calc(env(safe-area-inset-top)+3.75rem)] max-sm:mt-0 max-sm:w-auto">
          <Budget state={state} />
          {share >= 1 && <p className="mt-2 text-xs text-red-300">{t.whose === 'yours' ? 'Your share for today is used up.' : 'The app’s budget for today is used up.'} Claude can’t be asked until it resets.</p>}
          <Link href="/settings" onClick={() => setOpen(false)} className="mt-2 inline-block text-xs text-[var(--muted)] underline underline-offset-[3px] hover:text-[var(--foreground)]">Change the caps in Settings</Link>
        </div>
      )}
    </div>
  );
}
