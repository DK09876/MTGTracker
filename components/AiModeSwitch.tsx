'use client';

/**
 * A page's Regular / Smart switch: which AI this page uses for you, with
 * the model behind it, about what a request costs on it, and what is left
 * of today's budget. Remembered per profile and page.
 */

import { useEffect, useState } from 'react';

import { shortLabel } from './AiBits';
import * as api from '@/lib/api';
import type { AiState } from '@/lib/ai';
import { AREA_OF, FEATURES, MODES, type AiArea, type AiMode, type Feature } from '@/lib/models';
import { dollars } from '@/lib/spend';

const NOTE: Record<AiMode, string> = { regular: 'cheaper, quick', smart: 'stronger, thinks harder' };

export default function AiModeSwitch({ area, className = '' }: { area: AiArea; className?: string }) {
  const [state, setState] = useState<AiState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const read = () => { api.aiState().then(setState).catch(() => {}); };
    read();
    window.addEventListener(api.AI_CHANGED, read);
    window.addEventListener(api.AI_SPENT, read);
    return () => { window.removeEventListener(api.AI_CHANGED, read); window.removeEventListener(api.AI_SPENT, read); };
  }, []);

  if (!state) return null;
  const mode = state.modes[area];
  // The page's main step stands for it: reading a deck, for a deck's Tags.
  const feature: Feature = FEATURES.find((f) => AREA_OF[f] === area)!;
  const model = (m: AiMode) => state.app[feature][m];
  const label = (m: AiMode) => shortLabel(state.models.find((x) => x.id === model(m))?.label ?? model(m));
  const each = state.costByModel[feature]?.[model(mode)];
  const paid = !!state.models.find((x) => x.id === model(mode))?.price;

  const pick = async (m: AiMode) => {
    if (m === mode || busy) return;
    setBusy(true);
    try {
      setState(await api.chooseMode(area, m));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm ${className}`} data-tour="ai-mode">
      <div role="radiogroup" aria-label="AI mode" className="flex overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5">
        {MODES.map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={mode === m}
            onClick={() => pick(m)}
            title={`${label(m)} - ${NOTE[m]}`}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${mode === m ? (m === 'smart' ? 'btn-go' : 'bg-[var(--surface-hover)] text-[var(--foreground)]') : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
          >
            {m === 'smart' ? '✦ Smart' : 'Regular'}
          </button>
        ))}
      </div>
      <span className="text-xs text-[var(--muted)]">
        <span className="text-[var(--foreground)]">{label(mode)}</span>
        {each !== undefined && <> · about {dollars(each)} a request</>}
        {paid && <> · {dollars(state.spend.left)} left today</>}
      </span>
    </div>
  );
}
