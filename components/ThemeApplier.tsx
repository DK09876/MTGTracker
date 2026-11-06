'use client';

/**
 * Puts the active profile's look on the whole app: its theme's colour
 * tokens, and - unless the profile or the device asks for less motion - a
 * slowly drifting glow behind everything in the theme's colours.
 */

import { useEffect, useState } from 'react';

import * as api from '@/lib/api';
import { useProfile } from '@/lib/profile';
import { useMe } from '@/lib/use-me';

export default function ThemeApplier() {
  const profile = useProfile();
  const me = useMe();
  const [motion, setMotion] = useState(false);

  useEffect(() => {
    // Not until the profile may be used: a signed-out admin's look stays put.
    if (!profile || !me || me.needsSignIn) return;
    let cancelled = false;
    const root = document.documentElement;
    const put = () => api.profileStyle().then(({ style, vars }) => {
      if (cancelled) return;
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
      root.dataset.theme = style.theme;
      root.style.colorScheme = style.theme === 'plains' ? 'light' : 'dark';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--background'] ?? '#100f0e');
      setMotion(style.motion);
    }).catch(() => {});
    void put();
    window.addEventListener(api.STYLE_CHANGED, put);
    return () => { cancelled = true; window.removeEventListener(api.STYLE_CHANGED, put); };
  }, [profile, me]);

  if (!motion) return null;
  // Held in a box the size of the screen: the glow reaches past the edges, and a phone on its
  // side otherwise widened the page to fit it (zooming everything out a little).
  return <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"><div className="living-bg" /></div>;
}
