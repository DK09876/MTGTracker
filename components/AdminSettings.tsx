'use client';

/**
 * Settings only admins see: the model each AI step uses, and the people
 * on the app - who is an admin, who has a password.
 */

import { useEffect, useState } from 'react';

import { shortLabel } from './AiBits';
import * as api from '@/lib/api';
import type { AiState } from '@/lib/ai';
import { FEATURE_INFO, FEATURES, MODES, type AiMode, type Feature } from '@/lib/models';
import { dollars } from '@/lib/spend';

export function StepModels({ state, onState }: { state: AiState; onState: (s: AiState) => void }) {
  const [error, setError] = useState<string | null>(null);
  const usable = state.models.filter((m) => m.hasKey);
  const choose = async (feature: Feature, mode: AiMode, id: string) => {
    setError(null);
    try {
      onState(await api.setAppModels({ [feature]: { [mode]: id } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change it');
    }
  };
  const each = (f: Feature, model: string) => {
    const c = state.costByModel[f]?.[model];
    return c === undefined ? 'not used yet' : `about ${dollars(c)} each`;
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold">Regular and Smart models <span className="text-sm font-normal text-[var(--accent)]">· admin</span></h2>
      <p className="text-sm text-[var(--muted)]">
        The model behind each page&apos;s Regular and Smart switch, for every AI step. Smart also thinks harder.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-2 font-medium">Step</th>
              {MODES.map((m) => <th key={m} className="px-3 py-2 font-medium capitalize">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f} className="border-b border-[var(--border)] align-top last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium">{FEATURE_INFO[f].label}</span>
                  <span className="block text-xs text-[var(--muted)]">{FEATURE_INFO[f].why}</span>
                </td>
                {MODES.map((mode) => (
                  <td key={mode} className="px-3 py-2">
                    <select
                      aria-label={`${FEATURE_INFO[f].label}, ${mode}`}
                      value={state.app[f][mode]}
                      onChange={(e) => choose(f, mode, e.target.value)}
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                    >
                      {usable.map((m) => <option key={m.id} value={m.id}>{shortLabel(m.label)}{m.price ? ` · $${m.price.input}/$${m.price.output}` : ' · free'}</option>)}
                    </select>
                    <span className="mt-1 block text-xs tabular-nums text-[var(--muted)]">{each(f, state.app[f][mode])}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--muted)]">Prices are per million tokens in / out. &ldquo;Each&rdquo; is the average request on that step and model over the last 30 days.</p>
    </section>
  );
}

export function People({ self }: { self: string }) {
  const [list, setList] = useState<api.Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.people().then((r) => setList(r.people)).catch((e) => setError(e instanceof Error ? e.message : 'Could not load')); }, []);
  const act = async (id: string, action: 'admin' | 'unadmin' | 'reset' | 'remove', ask: string) => {
    if (!confirm(ask)) return;
    setError(null);
    try {
      setList((await api.changePerson(id, action)).people);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that');
    }
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold">People <span className="text-sm font-normal text-[var(--accent)]">· admin</span></h2>
      <p className="text-sm text-[var(--muted)]">Admins must have a password; an admin without one sets it on their next sign-in. Anyone else can add one from Settings.</p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <ul className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
        {list?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span>
              <span className="font-medium">{p.name}</span>
              <span className="text-[var(--muted)]"> · {p.isAdmin ? 'admin' : 'member'} · {p.hasPassword ? 'password' : 'no password'} · {p.lists} list{p.lists === 1 ? '' : 's'}</span>
            </span>
            {p.id === self ? <span className="text-xs text-[var(--muted)]">You</span> : (
            <span className="flex gap-3 text-xs">
              {p.isAdmin
                ? <button onClick={() => act(p.id, 'unadmin', `Take admin away from ${p.name}?`)} className="text-[var(--accent)] hover:underline">Remove admin</button>
                : <button onClick={() => act(p.id, 'admin', `Make ${p.name} an admin? They will need a password.`)} className="text-[var(--accent)] hover:underline">Make admin</button>}
              {p.hasPassword && (
                <button onClick={() => act(p.id, 'reset', `Clear ${p.name}'s password? They are signed out everywhere${p.isAdmin ? ' and choose a new one on their next sign-in' : ''}.`)} className="text-[var(--accent)] hover:underline">
                  Reset password
                </button>
              )}
              {p.lists === 0 && <button onClick={() => act(p.id, 'remove', `Remove ${p.name}?`)} className="text-red-300 hover:underline">Remove</button>}
            </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
