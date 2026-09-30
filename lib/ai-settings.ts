/**
 * AI switches kept on this device, like the rules' second check. Requests
 * carry them. The model itself is one setting for the whole app, kept on
 * the server (Settings, lib/ai.ts chosenModel).
 */

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'on';
  } catch {
    return false;
  }
}

function write(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* for this visit only */ }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  const other = (e: StorageEvent) => { if (e.key?.startsWith('mtg-ai-')) l(); };
  window.addEventListener('storage', other);
  return () => { listeners.delete(l); window.removeEventListener('storage', other); };
}

/** A switch kept on this device; off until turned on. */
export function useSetting(name: string): [boolean, (on: boolean) => void] {
  const key = `mtg-ai-${name}`;
  const on = useSyncExternalStore(subscribe, () => read(key), () => false);
  return [on, (next: boolean) => write(key, next)];
}
