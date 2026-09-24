'use client';

/**
 * The current profile, in the header: switch to another, or add a new one.
 *
 * It reads the same store as the "Who's using this?" screen, so it appears
 * the moment a profile is picked there. Switching reloads the page: every
 * view belongs to someone, and a reload is the simplest way to be sure
 * nothing of the last profile's is left on screen.
 */

import { useEffect, useRef, useState } from 'react';

import AddProfile from './AddProfile';
import * as api from '@/lib/api';
import { setProfile, useProfile, type Profile } from '@/lib/profile';

export default function ProfileSwitcher() {
  const active = useProfile();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  // Re-read when the profile changes, so one just added on the
  // "Who's using this?" screen is in the menu.
  useEffect(() => {
    if (!active) return;
    api.fetchProfiles().then(setProfiles).catch(() => {});
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!container.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (!active) return null;
  const name = profiles.find((p) => p.id === active)?.name ?? active;

  const switchTo = (id: string) => {
    setOpen(false);
    if (id === active) return;
    setProfile(id);
    window.location.reload();
  };

  return (
    <div className="relative" ref={container}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
      >
        <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-[#221c08]">
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="max-w-[8rem] truncate">{name}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden className={open ? 'rotate-180' : ''}>
          <path d="M1 1L5 5L9 1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 min-w-[14rem] rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
          {profiles.map((p) => (
            <button
              key={p.id}
              role="menuitem"
              onClick={() => switchTo(p.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)] ${p.id === active ? '' : 'text-[var(--muted)]'}`}
            >
              <span className="w-3 text-[var(--accent)]">{p.id === active ? '✓' : ''}</span>
              {p.name}
            </button>
          ))}
          <div className="mt-1 border-t border-[var(--border)] pt-1">
            <AddProfile compact onAdded={(p) => switchTo(p.id)} />
          </div>
        </div>
      )}
    </div>
  );
}
