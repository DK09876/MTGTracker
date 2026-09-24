/**
 * Which profile this browser is using - DK, Kevin - as LifeOS does it: the
 * choice is remembered on the device, and every request says whose lists it
 * is for. Nothing else is stored in the browser.
 *
 * One small store, so the "Who's using this?" screen and the switcher in the
 * header always agree: picking a profile on one shows it in the other at
 * once, and a change in another tab is picked up too.
 *
 * Storage can be unavailable (private windows, blocked site data), so every
 * access is guarded and a missing choice just means "ask again".
 */

import { useSyncExternalStore } from 'react';

const KEY = 'mtg-profile';

export interface Profile {
  id: string;
  name: string;
}

const listeners = new Set<() => void>();

export function getProfile(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setProfile(id: string): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch { /* the choice lasts until the page closes */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const fromOtherTab = (e: StorageEvent) => { if (e.key === KEY) listener(); };
  window.addEventListener('storage', fromOtherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', fromOtherTab);
  };
}

/**
 * The current profile id: '' when none is chosen, and null while the page is
 * still being rendered on the server - when nobody's choice is known yet, so
 * nothing should be shown rather than the chooser flashing up.
 */
export function useProfile(): string | null {
  return useSyncExternalStore(subscribe, getProfile, () => null);
}
