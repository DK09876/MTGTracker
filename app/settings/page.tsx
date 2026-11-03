'use client';

/**
 * The profile's AI models - one for rules and tagging, one for search - how
 * hard Claude thinks, and the app's daily spending caps.
 */

import { useEffect, useState } from 'react';

import AiUsage from '@/components/AiUsage';
import { People, StepModels } from '@/components/AdminSettings';
import CardData from '@/components/CardData';
import MyProfile from '@/components/MyProfile';
import ErrorLog from '@/components/ErrorLog';
import { Budget } from '@/components/AiBits';
import * as api from '@/lib/api';
import type { AiState } from '@/lib/ai';
import { useMe } from '@/lib/use-me';


export default function SettingsPage() {
  const me = useMe();
  const [state, setState] = useState<AiState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const read = () => api.aiState().then(setState).catch(() => setError('Could not load the models'));
    read();
    window.addEventListener(api.AI_CHANGED, read);
    return () => window.removeEventListener(api.AI_CHANGED, read);
  }, []);

  if (!state) return <p className="text-sm text-[var(--muted)]">{error ?? 'Loading…'}</p>;
  const admin = !!me?.isAdmin;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <MyProfile />

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">AI budget</h2>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"><Budget state={state} /></div>
        {admin && <Caps state={state} onState={setState} />}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">AI usage</h2>
        <p className="text-sm text-[var(--muted)]">
          Every Claude request: who made it, what for, and what it cost. Kept a week, then cleared on Sunday. Opening a saved search or conversation makes no request, so it never shows here.
        </p>
        <AiUsage />
      </section>

      <section data-tour="ai-model" className="flex flex-col gap-3">
        <h2 className="font-medium">Regular and Smart</h2>
        <p className="text-sm text-[var(--muted)]">
          Search, Rules, a deck&apos;s Tags and its Chat each have a Regular / Smart switch, remembered for you on each page.
          Regular uses a cheaper model; Smart a stronger one that thinks harder, at a few times the price.
          {admin ? ' Which model each uses is set below.' : ''}
        </p>
      </section>

      {admin && (
        <>
          <StepModels state={state} onState={setState} />
          <People self={me!.id} />
          <CardData />
          <ErrorLog />
        </>
      )}
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
