'use client';

/**
 * The model behind rules answers and deck tagging, in the header, with what
 * is left of today's AI budget beside it. Each profile has its own; search
 * has its own model in Settings, as do the caps.
 *
 * The budget is read again when a request that may have spent finishes
 * (api.AI_SPENT), on coming back to the page, and every so often - a
 * friend's spending moves the app's share too.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import * as api from '@/lib/api';
import type { AiState, ModelStatus } from '@/lib/ai';
import { useProfile } from '@/lib/profile';
import { dollars } from '@/lib/spend';

const THINKING = ['rules', 'tagging'] as const;
const REFRESH_MS = 20_000;

/** "Claude Opus 5.5" as "Opus 5.5", "GPT-OSS 120B (Groq)" as "GPT-OSS 120B". */
export const shortLabel = (label: string) => label.replace(/^Claude /, '').replace(/ \((Groq|Mistral)\)$/, '');

/** "$4 / $20 per M tokens", or "free". */
export const priceText = (m: ModelStatus) =>
  m.price ? `$${m.price.input} in / $${m.price.output} out per M tokens` : 'free plan';

export default function ModelMenu() {
  const profile = useProfile();
  const path = usePathname();
  const [state, setState] = useState<AiState | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => { api.aiState().then(setState).catch(() => {}); }, []);

  useEffect(() => {
    if (!profile) return;
    refresh();
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = setInterval(visible, REFRESH_MS);
    window.addEventListener(api.AI_SPENT, refresh);
    window.addEventListener(api.AI_CHANGED, refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(api.AI_SPENT, refresh);
      window.removeEventListener(api.AI_CHANGED, refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [profile, path, refresh]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!container.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (!profile || !state) return null;
  const thinking = state.models.find((m) => m.chosenFor.includes('rules'));
  const paid = !!thinking?.price;
  const { spend } = state;
  const low = paid && spend.left < 0.25;

  const choose = async (id: string) => {
    setError(null);
    try {
      setState(await api.chooseModel(id, [...THINKING]));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change it');
    }
  };

  return (
    <div className="relative" ref={container}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`AI model: ${thinking?.label ?? 'none'}${paid ? `, ${dollars(spend.left)} left today` : ''}`}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
      >
        <span className="text-[var(--foreground)]">{thinking ? shortLabel(thinking.label) : 'No model'}</span>
        {paid && <span className={low ? 'text-amber-400' : ''}>· {dollars(spend.left)}</span>}
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden className={open ? 'rotate-180' : ''}>
          <path d="M1 1L5 5L9 1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="AI model and budget"
          className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+3.75rem)] z-40 max-h-[75vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-1 sm:w-[24rem]"
        >
          <Budget state={state} />
          <p className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Model for rules and deck tagging</p>
          {error && <p className="mb-1 text-xs text-red-400">{error}</p>}
          <div role="radiogroup" aria-label="Model for rules and deck tagging" className="flex flex-col">
            {state.models.filter((m) => m.hasKey).map((m) => {
              const on = m.chosenFor.includes('rules');
              return (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={on}
                  onClick={() => choose(m.id)}
                  className={`flex items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--surface-hover)] ${on ? '' : 'text-[var(--muted)]'}`}
                >
                  <span className="w-3 shrink-0 text-[var(--accent)]">{on ? '✓' : ''}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className={on ? 'font-medium text-[var(--foreground)]' : 'text-[var(--foreground)]'}>{m.label}</span>
                      <span className="text-[11px] text-[var(--muted)]">{priceText(m)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">{m.note}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]">
            Search uses {shortLabel(state.models.find((m) => m.chosenFor.includes('search'))?.label ?? 'none')}.{' '}
            <Link href="/settings" onClick={() => setOpen(false)} className="underline hover:text-[var(--foreground)]">Search model, caps and more in Settings</Link>
          </p>
        </div>
      )}
    </div>
  );
}

/** Today's AI spending against the caps, and the month against the credit. */
export function Budget({ state }: { state: AiState }) {
  const { spend } = state;
  const mine = Math.min(1, spend.profileToday / Math.max(spend.caps.perProfile, 0.01));
  const app = Math.min(1, spend.today / Math.max(spend.caps.daily, 0.01));
  return (
    <div className="text-sm">
      <p className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{dollars(spend.left)} left today</span>
        <span className="text-xs text-[var(--muted)]">resets {resetText(spend.resetsInMs)}</span>
      </p>
      <Bar label={`You: ${dollars(spend.profileToday)} of ${dollars(spend.caps.perProfile)}`} share={mine} />
      <Bar label={`Everyone: ${dollars(spend.today)} of ${dollars(spend.caps.daily)}`} share={app} />
      <p className="mt-1.5 text-xs text-[var(--muted)]">
        This month {dollars(spend.month)} of the {dollars(spend.monthlyCredit)} API credit. Free models don&apos;t count.
      </p>
    </div>
  );
}

function Bar({ label, share }: { label: string; share: number }) {
  return (
    <div className="mt-1.5">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[var(--border)]" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <div className={`h-full rounded-full ${share >= 0.9 ? 'bg-amber-400' : 'bg-[var(--accent)]'}`} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

export function resetText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  return `in ${Math.round(minutes / 60)} h`;
}
