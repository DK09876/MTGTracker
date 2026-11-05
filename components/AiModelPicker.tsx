'use client';

/**
 * Which Claude model a page uses for you - Haiku, Sonnet, Opus, or Fable
 * (off for now) - remembered per profile and page, with about what a request
 * costs on it and what is left of today's budget.
 *
 * The buttons keep one width and one place whatever is picked; only the
 * line beside them changes, on the side away from them, so nothing jumps.
 */

import { useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { AiState } from '@/lib/ai';
import { AREA_OF, costOf, FEATURES, TIER_INFO, TIER_MODEL, TIERS, TIERS_OFF, TYPICAL_TOKENS, type AiArea, type Feature, type Tier } from '@/lib/models';
import { dollars } from '@/lib/spend';

export default function AiModelPicker({ area, align = 'left', className = '' }: { area: AiArea; align?: 'left' | 'right'; className?: string }) {
  const [state, setState] = useState<AiState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const read = () => { api.aiState().then(setState).catch(() => {}); };
    read();
    window.addEventListener(api.AI_CHANGED, read);
    window.addEventListener(api.AI_SPENT, read);
    return () => { window.removeEventListener(api.AI_CHANGED, read); window.removeEventListener(api.AI_SPENT, read); };
  }, []);

  const tier = state?.tiers[area] ?? null;
  // The page's main step stands for it: reading a deck, for a deck's Tags.
  const feature: Feature = FEATURES.find((f) => AREA_OF[f] === area)!;
  // What this page has really cost on the model, or else its price on a typical request.
  const each = (t: Tier) => state?.costByModel[feature]?.[TIER_MODEL[t]] ?? costOf(TIER_MODEL[t], TYPICAL_TOKENS[feature]);

  const pick = async (t: Tier) => {
    if (!state || t === tier || busy || TIERS_OFF.includes(t)) return;
    setBusy(true);
    try {
      setState(await api.chooseTier(area, t));
    } finally {
      setBusy(false);
    }
  };

  const buttons = (
    <div role="radiogroup" aria-label="AI model" className="flex shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {TIERS.map((t) => {
        const off = TIERS_OFF.includes(t);
        const on = tier === t;
        return (
          <button
            key={t}
            role="radio"
            aria-checked={on}
            aria-disabled={off}
            disabled={!state || off}
            onClick={() => pick(t)}
            title={`${TIER_INFO[t].label}: ${TIER_INFO[t].note}`}
            className={`w-[4.25rem] rounded-full py-1 text-center text-xs font-semibold transition-colors ${on
              ? 'btn-go'
              : off ? 'cursor-not-allowed text-[var(--faint)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
          >
            <span className="inline-flex items-center justify-center gap-1">
              {off && (
                <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden>
                  <rect x="0.5" y="4.5" width="8" height="5" rx="1.2" fill="none" stroke="currentColor" />
                  <path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" />
                </svg>
              )}
              {TIER_INFO[t].label}
            </span>
          </button>
        );
      })}
    </div>
  );
  const line = (
    <p className={`min-w-0 text-xs tabular-nums text-[var(--muted)] ${align === 'right' ? 'text-right' : ''}`} aria-live="polite">
      {state && tier ? (
        <>≈ {dollars(each(tier))} a request<span className="max-sm:hidden"> · {dollars(state.spend.left)} left today</span></>
      ) : ' '}
    </p>
  );

  return (
    <div className={`flex items-center gap-3 ${align === 'right' ? 'justify-end' : ''} ${className}`} data-tour="ai-mode">
      {/* On a phone the cost sits under the tiers rather than squeezed beside them. */}
      {align === 'right' ? <>{line}{buttons}</> : <>{buttons}{line}</>}
    </div>
  );
}
