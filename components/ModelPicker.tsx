'use client';

/**
 * The models one of the profile's features can use - the thinking model
 * (rules and tagging) or search - kept on the server. Each shows its price,
 * whether the server has its provider's key, today's use, whether it
 * answered the last time it was asked, and "Test" (one tiny request).
 */

import { useState } from 'react';

import * as api from '@/lib/api';
import type { AiState } from '@/lib/ai';
import type { Feature } from '@/lib/models';
import { dollars } from '@/lib/spend';
import { priceText } from './ModelMenu';

const PROVIDER = { anthropic: 'Anthropic', gemini: 'Google Gemini', mistral: 'Mistral', groq: 'Groq' } as const;

const when = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
};

export default function ModelPicker({ state, features, onState, name, label }: {
  state: AiState; features: Feature[]; onState: (s: AiState) => void; name: string; label: string;
}) {
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (id: string) => {
    setError(null);
    try { onState(await api.chooseModel(id, features)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not change it'); }
  };
  const test = async (id: string) => {
    setTesting(id);
    setError(null);
    try { onState(await api.testModel(id)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not test it'); } finally { setTesting(null); }
  };

  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={label}>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {state.models.map((m) => {
        const chosen = m.chosenFor.includes(features[0]);
        return (
          <div
            key={m.id}
            className={`rounded-xl border px-4 py-3 ${chosen ? 'border-[var(--accent)] bg-[var(--surface)]' : 'border-[var(--border)]'} ${m.hasKey ? '' : 'opacity-60'}`}
          >
            <label className={`flex items-start gap-3 ${m.hasKey ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
              <input
                type="radio"
                name={name}
                checked={chosen}
                disabled={!m.hasKey}
                onChange={() => choose(m.id)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{m.label}</span>
                  <span className="text-xs text-[var(--muted)]">{PROVIDER[m.provider]} · {priceText(m)}</span>
                  {chosen && <span className="rounded bg-[var(--accent)] px-1.5 text-[11px] font-medium text-black">In use</span>}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{m.note}</span>
              </span>
            </label>
            <p className="ml-7 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
              {!m.hasKey
                ? <span>No key on the server</span>
                : <>
                  <span>
                    {m.price
                      ? `${dollars(m.spentToday)} today, ${m.used} request${m.used === 1 ? '' : 's'}`
                      : m.dailyTokens
                        ? `${Math.round(m.tokens / 1000)}K of ${Math.round(m.dailyTokens / 1000)}K tokens used today`
                        : `${m.used} of about ${m.limit} used today`}
                  </span>
                  <span className={m.health ? (m.health.ok ? 'text-emerald-400' : 'text-amber-400') : ''}>
                    {!m.health ? 'Not tried yet' : m.health.ok ? `✓ Answered ${when(m.health.at)}` : `✗ ${m.health.detail} (${when(m.health.at)})`}
                  </span>
                  <button onClick={() => test(m.id)} disabled={testing !== null} className="underline hover:text-[var(--foreground)] disabled:opacity-50">
                    {testing === m.id ? 'Testing…' : 'Test'}
                  </button>
                </>}
            </p>
          </div>
        );
      })}
    </div>
  );
}
