'use client';

/**
 * Settings only admins see: the people on the app - who is an admin, who
 * has a password.
 */

import { useEffect, useState } from 'react';

import * as api from '@/lib/api';

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
