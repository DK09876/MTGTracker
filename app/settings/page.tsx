'use client';

/**
 * Settings, in tabs: your profile; the AI (budget, caps, who spent what);
 * and for admins the people, and the app's health - card data, errors and
 * checks. One long page had all of it, the admin tools under your own.
 */

import { useEffect, useState } from 'react';

import AiUsage from '@/components/AiUsage';
import { People } from '@/components/AdminSettings';
import CardData from '@/components/CardData';
import MyProfile from '@/components/MyProfile';
import { ShareSwitch, SuggestionStats } from '@/components/SuggestionLog';
import ErrorLog from '@/components/ErrorLog';
import { Budget } from '@/components/AiBits';
import * as api from '@/lib/api';
import type { AiState } from '@/lib/ai';
import { useMe } from '@/lib/use-me';


type Tab = 'profile' | 'ai' | 'people' | 'suggestions' | 'health';
const fromHash = (hash: string): Tab => {
  const h = hash.replace('#', '');
  return h === 'errors' || h === 'health' ? 'health' : h === 'ai' || h === 'people' || h === 'suggestions' ? h : 'profile';
};

export default function SettingsPage() {
  const me = useMe();
  const [state, setState] = useState<AiState | null>(null);
  // The tab is in the address (#ai), so a link can open one: the error banner's goes to #errors.
  const [tab, setTab] = useState<Tab>('profile');
  useEffect(() => {
    const read = () => setTab(fromHash(window.location.hash));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const pick = (t: Tab) => { setTab(t); history.replaceState(null, '', t === 'profile' ? window.location.pathname : `#${t}`); };
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const read = () => api.aiState().then(setState).catch(() => setError('Could not load the models'));
    read();
    window.addEventListener(api.AI_CHANGED, read);
    return () => window.removeEventListener(api.AI_CHANGED, read);
  }, []);

  if (!state) return <p className="text-sm text-[var(--muted)]">{error ?? 'Loading…'}</p>;
  const admin = !!me?.isAdmin;

  const tabs: Array<[Tab, string]> = [['profile', 'Profile'], ['ai', 'AI'], ...(admin ? [['people', 'People'], ['suggestions', 'Suggestions'], ['health', 'App health']] as Array<[Tab, string]> : [])];
  const shown: Tab = tabs.some(([t]) => t === tab) ? tab : 'profile';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-3xl font-extrabold">Settings</h1>
        <div role="tablist" aria-label="Settings" className="flex gap-1 overflow-x-auto border-b border-[var(--border)] [scrollbar-width:none]">
          {tabs.map(([t, label]) => (
            <button
              key={t}
              role="tab"
              aria-selected={shown === t}
              onClick={() => pick(t)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${shown === t ? 'border-[var(--accent)] font-medium text-[var(--foreground)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {shown === 'profile' && <><MyProfile /><ShareSwitch /></>}
      {shown === 'suggestions' && <SuggestionStats />}

      {shown === 'ai' && (
        <>
          <section data-tour="ai-budget" className="flex flex-col gap-3">
            <h2 className="font-medium">Budget</h2>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"><Budget state={state} /></div>
            {admin && <Caps state={state} onState={setState} />}
          </section>
          <section data-tour="ai-model" className="flex flex-col gap-2">
            <h2 className="font-medium">Models</h2>
            <p className="text-sm text-[var(--muted)]">
              Every page that asks Claude - Search, Rules, a deck&apos;s Plan, Tags and Chat - has a <span className="rounded-full border border-[var(--border)] px-1.5 text-xs text-[var(--foreground)]">✦ model</span> chip
              beside its button. Pick Haiku, Sonnet or Opus there; it is remembered for you on that page. Stronger models think harder and cost more.
            </p>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="font-medium">Usage</h2>
            <p className="text-sm text-[var(--muted)]">
              Every Claude request: who made it, what for, and what it cost. Kept a week. Opening a saved search or conversation makes no request.
            </p>
            <AiUsage />
          </section>
        </>
      )}

      {shown === 'people' && <People self={me!.id} />}
      {shown === 'health' && (
        <>
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
