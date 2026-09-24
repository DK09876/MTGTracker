'use client';

/**
 * Asks who is using the app, once per browser, before showing it.
 *
 * Unlike LifeOS this does not fall back to DK: the app is shared with
 * friends, and a new browser landing in someone else's lists is the one
 * thing profiles are here to prevent.
 */

import { useEffect, useState } from 'react';

import AddProfile from './AddProfile';
import * as api from '@/lib/api';
import { getProfile, setProfile, type Profile } from '@/lib/profile';

export default function ProfileGate({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [active, setActive] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.fetchProfiles()
      .then((found) => {
        setProfiles(found);
        const remembered = getProfile();
        if (found.some((p) => p.id === remembered)) setActive(remembered);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not reach the server'));
  }, []);

  if (active) return <>{children}</>;

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-xl font-medium">Who&apos;s using this?</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Each profile has its own lists.</p>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {!profiles && !error && <p className="mt-4 text-sm text-[var(--muted)]">Loading…</p>}
      <div className="mt-5 flex flex-col gap-2">
        {profiles?.map((profile) => (
          <button
            key={profile.id}
            onClick={() => { setProfile(profile.id); setActive(profile.id); }}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left hover:border-[var(--accent)]"
          >
            {profile.name}
          </button>
        ))}
      </div>
      {profiles && (
        <div className="mt-6">
          <p className="mb-2 text-sm text-[var(--muted)]">{profiles.length ? 'New here? Add yourself:' : 'Add the first profile:'}</p>
          <AddProfile onAdded={(p) => { setProfile(p.id); setActive(p.id); }} />
        </div>
      )}
    </div>
  );
}
