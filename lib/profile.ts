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
  /** Set on the list the server gives: whether using it needs signing in. */
  isAdmin?: boolean;
  hasPassword?: boolean;
  /** The favourite commander's art: the profile picture. */
  art?: string | null;
}

const listeners = new Set<() => void>();

// While the guided tour runs (lib/tour-state.ts), this tab uses the tour's
// sample profile; the profile you chose is left as it was.
export const TOUR_KEY = 'mtg-tour';

export function getProfile(): string {
  if (typeof window === 'undefined') return '';
  try {
    if (sessionStorage.getItem(TOUR_KEY)) return 'tour';
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** Tell everything that reads the profile to read it again (the tour starting or ending). */
export function profileChanged(): void {
  for (const listener of listeners) listener();
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
