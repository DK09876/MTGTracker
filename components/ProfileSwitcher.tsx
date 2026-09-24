'use client';

/**
 * The current profile, in the header, and a way to change it. Switching
 * reloads the page: every view is someone's, and a reload is the simplest
 * way to be sure nothing of the last profile's is left on screen.
 */

import { useEffect, useRef, useState } from 'react';

import AddProfile from './AddProfile';
import * as api from '@/lib/api';
import { getProfile, setProfile, type Profile } from '@/lib/profile';

export default function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState('');
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.fetchProfiles()
      .then((found) => { setProfiles(found); setActive(getProfile()); })
      .catch(() => {});
  }, []);

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

  const current = profiles.find((p) => p.id === active);
  if (!current) return null;

  return (
    <div className="relative" ref={container}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
      >
        <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-[#221c08]">
          {current.name.charAt(0).toUpperCase()}
        </span>
        {current.name}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 min-w-[14rem] rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
          {profiles.map((p) => (
            <button
              key={p.id}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (p.id === active) return;
                setProfile(p.id);
                window.location.reload();
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)] ${p.id === active ? '' : 'text-[var(--muted)]'}`}
            >
              <span className="w-3 text-[var(--accent)]">{p.id === active ? '✓' : ''}</span>
              {p.name}
            </button>
          ))}
          <div className="mt-1 border-t border-[var(--border)] pt-1">
            <AddProfile compact onAdded={(p) => { setProfile(p.id); window.location.reload(); }} />
          </div>
        </div>
      )}
    </div>
  );
}
