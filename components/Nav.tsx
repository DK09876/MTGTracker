'use client';

/**
 * The app's sections. Links in the header on wider screens; on a phone, a
 * tab bar along the bottom, where a thumb reaches and as a home-screen app
 * expects - five sections do not fit across the top of a small iPhone.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS = [
  { href: '/', label: 'Search', icon: 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z' },
  { href: '/rules', label: 'Rules', icon: 'M6 3h9l4 4v14H6V3Zm2 2v14h9V8h-3V5H8Zm2 5h5v1.6h-5V10Zm0 3.2h5v1.6h-5v-1.6Z' },
  { href: '/decks', label: 'Decks', icon: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v14h10V5H7Zm-4 2h1v12h-1V7Zm17 0h1v12h-1V7Z' },
  { href: '/lists', label: 'Lists', icon: 'M4 6h2v2H4V6Zm4 0h12v2H8V6Zm-4 5h2v2H4v-2Zm4 0h12v2H8v-2Zm-4 5h2v2H4v-2Zm4 0h12v2H8v-2Z' },
  { href: '/collection', label: 'Collection', icon: 'M4 5h16v4H4V5Zm1 5h14v9H5v-9Zm2 2v5h10v-5H7Zm3 1h4v1.6h-4V13Z' },
];

const active = (path: string, href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

export function TopLinks() {
  const path = usePathname();
  return (
    <div className="hidden items-center gap-1 text-sm sm:flex">
      {SECTIONS.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          aria-current={active(path, s.href) ? 'page' : undefined}
          className={`rounded-lg px-3 py-1.5 hover:bg-[var(--surface)] hover:text-[var(--foreground)] ${active(path, s.href) ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'}`}
        >
          {s.label}
        </Link>
      ))}
    </div>
  );
}

export function TabBar() {
  const path = usePathname();
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--border)] bg-[var(--background)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      {SECTIONS.map((s) => {
        const on = active(path, s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={on ? 'page' : undefined}
            className={`flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${on ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="currentColor"><path d={s.icon} fillRule="evenodd" /></svg>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
