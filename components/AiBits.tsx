'use client';

/**
 * Pieces for showing AI models and today's budget: short model names, a
 * model's price, and the budget bars Settings shows. Which model a page
 * uses is picked on the page itself (AiModelPicker).
 */


import type { AiState, ModelStatus } from '@/lib/ai';
import { dollars } from '@/lib/spend';

export const shortLabel = (label: string) => label.replace(/^Claude /, '').replace(/ \((Groq|Mistral)\)$/, '');

/** "$4 / $20 per M tokens", or "free". */
export const priceText = (m: ModelStatus) =>
  m.price ? `$${m.price.input} in / $${m.price.output} out per M tokens` : 'free plan';

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
