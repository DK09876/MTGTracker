'use client';

/**
 * The app's sections. Links in the header on wider screens; on a phone, a
 * tab bar along the bottom, where a thumb reaches and as a home-screen app
 * expects - five sections do not fit across the top of a small iPhone.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const SECTIONS = [
  { href: '/', label: 'Search', icon: 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z' },
  { href: '/rules', label: 'Rules', icon: 'M6 3h9l4 4v14H6V3Zm2 2v14h9V8h-3V5H8Zm2 5h5v1.6h-5V10Zm0 3.2h5v1.6h-5v-1.6Z' },
  { href: '/decks', label: 'Decks', icon: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v14h10V5H7Zm-4 2h1v12h-1V7Zm17 0h1v12h-1V7Z' },
  { href: '/lists', label: 'Lists', icon: 'M4 6h2v2H4V6Zm4 0h12v2H8V6Zm-4 5h2v2H4v-2Zm4 0h12v2H8v-2Zm-4 5h2v2H4v-2Zm4 0h12v2H8v-2Z' },
  { href: '/games', label: 'Games', icon: 'M12 20.5s-7.6-4.6-9.3-9.4C1.5 7.6 3.8 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.8 1.3-1.7 2.9-2.8 4.9-2.8 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.3 9.4-9.3 9.4Zm0-2.4c2.3-1.5 6.3-4.6 7.4-7.6.7-2.2-.6-4-2.5-4-1.5 0-2.7 1-3.9 2.9L12 10.8l-1-1.4C9.8 7.5 8.6 6.5 7.1 6.5c-1.9 0-3.2 1.8-2.5 4 1.1 3 5.1 6.1 7.4 7.6Z' },
  { href: '/collection', label: 'Collection', icon: 'M4 5h16v4H4V5Zm1 5h14v9H5v-9Zm2 2v5h10v-5H7Zm3 1h4v1.6h-4V13Z' },
];

const active = (path: string, href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

export function TopLinks() {
  const path = usePathname();
  return (
    <div className="hidden h-full items-stretch gap-1 text-sm sm:flex">
      {SECTIONS.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          aria-current={active(path, s.href) ? 'page' : undefined}
          // The page you are on: brighter, with the accent underneath - no filled pill.
          className={`relative flex items-center px-2 transition-colors lg:px-3 hover:text-[var(--foreground)] ${active(path, s.href)
            ? 'font-medium text-[var(--foreground)] after:absolute after:inset-x-2 after:bottom-0 lg:after:inset-x-3 after:h-[2px] after:rounded-full after:bg-[var(--accent)]'
            : 'text-[var(--muted)]'}`}
        >
          {s.label}
        </Link>
      ))}
    </div>
  );
}

const GEAR = 'M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.7a7 7 0 0 1 0 2l2 1.7-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6a7 7 0 0 1-1.7-.9l-2.5.9-1.7-2.9 2-1.7a7 7 0 0 1 0-2l-2-1.7 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9l.5-2.6ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z';

/** Settings (the AI model), as a gear in the header on every screen. */
export function SettingsLink() {
  const path = usePathname();
  const on = path === '/settings';
  return (
    <Link
      href="/settings"
      aria-label="Settings"
      aria-current={on ? 'page' : undefined}
      className={`rounded-lg p-1.5 hover:bg-[var(--surface)] hover:text-[var(--foreground)] ${on ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'}`}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="currentColor"><path d={GEAR} fillRule="evenodd" /></svg>
    </Link>
  );
}

// A deck has its own bar along the bottom (DeckRail); two stacked bars took
// a quarter of a phone's screen, so the app's steps aside there.
// The life counter takes the whole screen.
const OWN_BAR = /^\/decks\/[^/]+|^\/games\/play\//;

export function TabBar() {
  const path = usePathname();
  const hidden = OWN_BAR.test(path);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-no-tabbar', hidden);
  }, [hidden]);
  if (hidden) return null;
  return (
    <nav
      aria-label="Sections"
      data-bottom-nav
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
