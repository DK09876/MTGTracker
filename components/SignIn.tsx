'use client';

/**
 * Signing in as a profile with a password - or, for an admin who has none
 * yet, choosing one.
 */

import { useState } from 'react';

import * as api from '@/lib/api';

export default function SignIn({ me, onSwitch }: { me: api.Me; onSwitch: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setting = me.setsPassword;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (setting && password !== again) { setError('The two passwords are not the same'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.signIn(me.id, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto mt-16 flex max-w-sm flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h1 className="font-display text-xl font-semibold">{setting ? `Choose a password for ${me.name}` : `Sign in as ${me.name}`}</h1>
      {setting && <p className="text-sm text-[var(--muted)]">Admins need a password. This one becomes yours - at least 8 characters.</p>}
      <label htmlFor="pw" className="text-sm text-[var(--muted)]">Password</label>
      <input id="pw" type="password" autoComplete={setting ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus
        className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 outline-none focus:border-[var(--accent)]" />
      {setting && (
        <>
          <label htmlFor="pw2" className="text-sm text-[var(--muted)]">Same again</label>
          <input id="pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)}
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 outline-none focus:border-[var(--accent)]" />
        </>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={busy || !password} className="rounded-full bg-[var(--accent)] px-4 py-2 font-semibold text-[#221c08] disabled:opacity-50">
        {busy ? 'Signing in…' : setting ? 'Set password and sign in' : 'Sign in'}
      </button>
      <p className="text-xs text-[var(--muted)]">This browser stays signed in for 90 days.</p>
      <button type="button" onClick={onSwitch} className="text-sm text-[var(--muted)] underline hover:text-[var(--foreground)]">Use another profile</button>
    </form>
  );
}
