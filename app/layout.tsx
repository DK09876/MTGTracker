import type { Metadata, Viewport } from 'next';
import Link from 'next/link';

import ProfileGate from '@/components/ProfileGate';
import ProfileSwitcher from '@/components/ProfileSwitcher';

import './globals.css';

export const metadata: Metadata = {
  title: 'MTG Tracker',
  description: 'Search Magic cards and keep them in lists.',
};

export const viewport: Viewport = {
  themeColor: '#14120f',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-4">
            <Link href="/" className="whitespace-nowrap text-lg font-semibold tracking-tight">
              <span className="text-[var(--accent)]">MTG</span> Tracker
            </Link>
            <div className="ml-auto flex items-center gap-0.5 text-sm sm:gap-1">
              <Link href="/" className="rounded-lg px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] sm:px-3">
                Search
              </Link>
              <Link href="/decks" className="rounded-lg px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] sm:px-3">
                Decks
              </Link>
              <Link href="/lists" className="rounded-lg px-2 py-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] sm:px-3">
                Lists
              </Link>
              <ProfileSwitcher />
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6"><ProfileGate>{children}</ProfileGate></main>
        <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4 text-xs text-[var(--muted)]">
          Card data and images from{' '}
          <a href="https://scryfall.com" className="underline hover:text-[var(--foreground)]" target="_blank" rel="noreferrer">
            Scryfall
          </a>
          . Not affiliated with Wizards of the Coast.
        </footer>
      </body>
    </html>
  );
}
