'use client';

/**
 * The profile's AI models - one for rules and tagging, one for search - how
 * hard Claude thinks, and the app's daily spending caps.
 */

import { useEffect, useState } from 'react';

import AiUsage from '@/components/AiUsage';
import ModelPicker from '@/components/ModelPicker';
import { Budget } from '@/components/ModelMenu';
import * as api from '@/lib/api';
import type { AiState } from '@/lib/ai';
import { EFFORTS, type Effort } from '@/lib/models';

const EFFORT_NOTE: Record<Effort, string> = {
  low: 'Quick and cheapest. Fine for easy questions.',
  medium: 'The default. Thinks things through on most questions.',
  high: 'Thinks longest - about twice the cost of medium on a hard rules question.',
};

export default function SettingsPage() {
  const [state, setState] = useState<AiState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const read = () => api.aiState().then(setState).catch(() => setError('Could not load the models'));
    read();
    window.addEventListener(api.AI_CHANGED, read);
    return () => window.removeEventListener(api.AI_CHANGED, read);
  }, []);

  if (!state) return <p className="text-sm text-[var(--muted)]">{error ?? 'Loading…'}</p>;
  const claude = state.models.find((m) => m.chosenFor.includes('rules'))?.provider === 'anthropic';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">AI budget</h2>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"><Budget state={state} /></div>
        <Caps state={state} onState={setState} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">AI usage</h2>
        <p className="text-sm text-[var(--muted)]">
          Every Claude request: who made it, what for, and what it cost. Kept 90 days. Opening a saved search or conversation makes no request, so it never shows here.
        </p>
        <AiUsage />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Model for rules and deck tagging</h2>
        <p className="text-sm text-[var(--muted)]">
          Yours alone - other profiles pick their own. The same choice as the picker in the header.
        </p>
        <ModelPicker state={state} features={['rules', 'tagging']} onState={setState} name="thinking-model" label="Model for rules and deck tagging" />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">How hard Claude thinks</h2>
        <p className="text-sm text-[var(--muted)]">
          On rules answers and tagging{claude ? '' : ' (only when the model above is Claude)'}. Search always thinks briefly.
        </p>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="How hard Claude thinks">
          {EFFORTS.map((e) => (
            <label key={e} className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] px-4 py-2.5">
              <input
                type="radio"
                name="effort"
                checked={state.effort === e}
                onChange={() => api.chooseEffort(e).then(setState).catch(() => setError('Could not change it'))}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium capitalize">{e}</span>
                <span className="block text-xs text-[var(--muted)]">{EFFORT_NOTE[e]}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Model for search</h2>
        <p className="text-sm text-[var(--muted)]">
          Plans each plain-English search; the cards themselves always come from Scryfall. A fast model keeps searches quick.
        </p>
        <ModelPicker state={state} features={['search']} onState={setState} name="search-model" label="Model for search" />
      </section>
    </div>
  );
}

/** The app's daily caps, in dollars - for everyone, so anyone can change them. */
function Caps({ state, onState }: { state: AiState; onState: (s: AiState) => void }) {
  const [daily, setDaily] = useState(String(state.spend.caps.daily));
  const [perProfile, setPerProfile] = useState(String(state.spend.caps.perProfile));
  const [message, setMessage] = useState<string | null>(null);
  const dirty = daily !== String(state.spend.caps.daily) || perProfile !== String(state.spend.caps.perProfile);

  const save = async () => {
    setMessage(null);
    try {
      const next = await api.setCaps({ daily: Number(daily), perProfile: Number(perProfile) });
      onState(next);
      setDaily(String(next.spend.caps.daily));
      setPerProfile(String(next.spend.caps.perProfile));
      setMessage('Saved');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save');
    }
  };

  const field = 'w-24 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5';
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-[var(--muted)]">
        Claude is paid from the API credit. Once a cap is reached, Claude requests stop until midnight Pacific; free models keep working.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">Each day, everyone ($)</span>
          <input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--muted)]">Each day, per profile ($)</span>
          <input inputMode="decimal" value={perProfile} onChange={(e) => setPerProfile(e.target.value)} className={field} />
        </label>
        <button onClick={save} disabled={!dirty} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-black disabled:opacity-40">
          Save caps
        </button>
        {message && <span className="text-xs text-[var(--muted)]">{message}</span>}
      </div>
    </div>
  );
}
