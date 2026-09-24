/**
 * Which profile this browser is using - DK, Kevin - as LifeOS does it: the
 * choice is remembered on the device, and every request says whose lists it
 * is for. Nothing else is stored in the browser.
 *
 * Storage can be unavailable (private windows, blocked site data), so every
 * access is guarded and a missing choice just means "ask again".
 */

const KEY = 'mtg-profile';

export interface Profile {
  id: string;
  name: string;
}

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
    localStorage.setItem(KEY, id);
  } catch { /* the choice lasts until the page closes */ }
}
