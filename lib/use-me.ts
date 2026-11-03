'use client';

/**
 * What this browser may do as the active profile - signed in or not, admin
 * or not - read once and shared by everything that asks, and read again
 * when the profile or the sign-in changes.
 */

import { useEffect, useState } from 'react';

import * as api from './api';
import { useProfile } from './profile';

let cached: { profile: string; me: api.Me } | null = null;

/** The active profile's access, and whether reading it failed (so a page is not held back for ever). */
export function useMeState(): { me: api.Me | null; failed: boolean } {
  const profile = useProfile();
  const [state, setState] = useState<{ profile: string; me: api.Me | null; failed: boolean }>(
    { profile: profile ?? '', me: cached?.profile === profile ? cached.me : null, failed: false },
  );
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    const read = () => api.me(profile)
      .then((m) => { cached = { profile, me: m }; if (!cancelled) setState({ profile, me: m, failed: false }); })
      .catch(() => { if (!cancelled) setState((s) => ({ ...s, profile, failed: true })); });
    void read();
    window.addEventListener(api.ME_CHANGED, read);
    return () => { cancelled = true; window.removeEventListener(api.ME_CHANGED, read); };
  }, [profile]);
  const current = state.me?.id === profile ? state.me : cached?.profile === profile ? cached.me : null;
  return { me: current, failed: state.profile === profile && state.failed };
}

export function useMe(): api.Me | null {
  return useMeState().me;
}
