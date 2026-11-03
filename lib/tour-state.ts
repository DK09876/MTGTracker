'use client';

/**
 * The guided tour's place: which page's guide, which step, and where to go
 * back to. Kept in this tab's sessionStorage, so a reload keeps the tour and
 * other tabs are untouched; while it is set the tab uses the sample profile
 * (lib/profile.ts).
 */

import { useSyncExternalStore } from 'react';

import { profileChanged, TOUR_KEY } from './profile';

export interface TourState {
  guide: string;
  step: number;
  deckId: string;
  /** The page to come back to when the tour ends. */
  returnTo: string;
}

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cached: TourState | null = null;

export function getTour(): TourState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(TOUR_KEY);
    if (raw !== cachedRaw) { cachedRaw = raw; cached = raw ? JSON.parse(raw) as TourState : null; }
    return cached;
  } catch {
    return null;
  }
}

function write(state: TourState | null) {
  try {
    if (state) sessionStorage.setItem(TOUR_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(TOUR_KEY);
  } catch { /* no tour without storage */ }
  for (const l of listeners) l();
}

export function startTour(guide: string, deckId: string, returnTo: string, firstPath: string): void {
  write({ guide, step: 0, deckId, returnTo });
  profileChanged();
  // A fresh load, so every page reads the sample rather than what it had.
  window.location.assign(firstPath);
}

export function goToStep(step: number): void {
  const t = getTour();
  if (t) write({ ...t, step });
}

export function endTour(): void {
  const t = getTour();
  write(null);
  profileChanged();
  window.location.assign(t?.returnTo ?? '/');
}

export function useTour(): TourState | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getTour, () => null);
}
