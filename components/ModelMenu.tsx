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
          <details className="group">
            <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2 text-sm [&::-webkit-details-marker]:hidden">
              <span>
                <span className={`font-medium ${low ? 'text-amber-400' : ''}`}>{dollars(spend.left)} left today</span>
                <span className="text-xs text-[var(--muted)]"> · resets {resetText(spend.resetsInMs)}</span>
              </span>
              <span className="text-xs text-[var(--muted)] group-open:hidden">Details ▸</span>
              <span className="hidden text-xs text-[var(--muted)] group-open:inline">Hide ▾</span>
            </summary>
            <div className="mt-1"><Budget state={state} compact /></div>
          </details>
          <p className="mb-1.5 mt-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Model for rules and deck tagging</p>
          {error && <p className="mb-1 text-xs text-red-400">{error}</p>}
          <ModelTabs models={state.models} chosen={thinking?.id ?? null} onChoose={choose} />
          <p className="mt-2 border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]">
            Search uses {shortLabel(state.models.find((m) => m.chosenFor.includes('search'))?.label ?? 'none')}.{' '}
            <Link href="/settings" onClick={() => setOpen(false)} className="underline hover:text-[var(--foreground)]">Search model, caps and more in Settings</Link>
          </p>
        </div>
      )}
    </div>
  );
}

const TABS = [
  { key: 'claude', label: 'Claude', test: (m: ModelStatus) => m.provider === 'anthropic' },
  { key: 'free', label: 'Free models', test: (m: ModelStatus) => m.provider !== 'anthropic' },
] as const;

/**
 * The models as two tabs: Claude by level, most capable first, and the free
 * ones as a plain list. Opens on the tab of the model in use; only the chosen
 * model shows its longer note.
 */
function ModelTabs({ models, chosen, onChoose }: { models: ModelStatus[]; chosen: string | null; onChoose: (id: string) => void }) {
  const inUse = models.find((m) => m.id === chosen);
  const [tab, setTab] = useState<'claude' | 'free'>(inUse && inUse.provider !== 'anthropic' ? 'free' : 'claude');
  const shown = models.filter((m) => m.hasKey && TABS.find((t) => t.key === tab)!.test(m));
  return (
    <div>
      <div role="tablist" aria-label="Kinds of model" className="mb-1 flex gap-1 rounded-lg bg-[var(--background)] p-0.5 text-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-2 py-1 ${tab === t.key ? 'bg-[var(--surface-hover)] text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
          >
            {t.label}
            {inUse && t.test(inUse) && <span className="ml-1 text-[var(--accent)]">•</span>}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Model for rules and deck tagging" className="flex flex-col">
        {shown.length === 0 && <p className="px-2 py-2 text-xs text-[var(--muted)]">None of these has a key on the server.</p>}
        {shown.map((m) => {
          const on = m.id === chosen;
          return (
            <button
              key={m.id}
              role="radio"
              aria-checked={on}
              onClick={() => onChoose(m.id)}
              className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-hover)] ${on ? 'bg-[var(--surface-hover)]' : ''}`}
            >
              <span className="w-3 shrink-0 pt-0.5 text-[var(--accent)]">{on ? '✓' : ''}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm">
                    {m.level && <span className="mr-1.5 text-[11px] uppercase tracking-wide text-[var(--muted)]">{m.level}</span>}
                    <span className={on ? 'font-medium' : ''}>{shortLabel(m.label)}</span>
                  </span>
                  {m.price && <span className="shrink-0 text-[11px] text-[var(--muted)]">${m.price.input} / ${m.price.output}</span>}
                </span>
                <span className="block text-xs text-[var(--muted)]">{on ? m.note : m.short}</span>
              </span>
            </button>
          );
        })}
      </div>
      {tab === 'claude' && <p className="mt-1 px-2 text-[11px] text-[var(--muted)]">Prices are dollars per million tokens, in / out.</p>}
    </div>
  );
}

/** Today's AI spending against the caps, and the month against the credit. */
export function Budget({ state, compact = false }: { state: AiState; compact?: boolean }) {
  const { spend } = state;
  const mine = Math.min(1, spend.profileToday / Math.max(spend.caps.perProfile, 0.01));
  const app = Math.min(1, spend.today / Math.max(spend.caps.daily, 0.01));
  return (
    <div className="text-sm">
      {!compact && (
        <p className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{dollars(spend.left)} left today</span>
          <span className="text-xs text-[var(--muted)]">resets {resetText(spend.resetsInMs)}</span>
        </p>
      )}
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
