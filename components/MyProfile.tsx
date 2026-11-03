'use client';

/**
 * Settings: your own profile - add, change or remove your password, and
 * sign this browser out.
 */

import { useState } from 'react';

import * as api from '@/lib/api';
import { setProfile } from '@/lib/profile';
import { useMe } from '@/lib/use-me';

export default function MyProfile() {
  const me = useMe();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  if (!me) return null;

  const save = async (remove = false) => {
    setMessage(null);
    try {
      await api.changePassword(current, remove ? '' : next);
      setCurrent('');
      setNext('');
      setMessage(remove ? 'Password removed' : 'Password saved');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save');
    }
  };
  const field = 'w-full max-w-xs rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5';

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold">Your profile · {me.name}</h2>
      <p className="text-sm text-[var(--muted)]">
        {me.isAdmin ? 'You are an admin: you see the app-wide settings below. Admins keep a password.'
          : me.hasPassword ? 'Your profile has a password, so only browsers signed in as you can open it.'
            : 'Anyone on the app can open your profile. Add a password to keep it yours.'}
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-2 text-sm">
        {me.hasPassword && (
          <label className="flex flex-col gap-1">Current password
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} />
          </label>
        )}
        <label className="flex flex-col gap-1">{me.hasPassword ? 'New password' : 'Password'}
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={field} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={next.length < 8} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-[#221c08] disabled:opacity-50">
            {me.hasPassword ? 'Change password' : 'Add password'}
          </button>
          {me.hasPassword && !me.isAdmin && (
            <button type="button" onClick={() => save(true)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-hover)]">Remove password</button>
          )}
          {me.signedIn && (
            <button type="button" onClick={async () => { await api.signOut(); setProfile(''); }} className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-hover)]">
              Sign out
            </button>
          )}
          {message && <span className="text-[var(--muted)]">{message}</span>}
        </div>
        <p className="text-xs text-[var(--muted)]">At least 8 characters.</p>
      </form>
    </section>
  );
}
