import type { Metadata, Viewport } from 'next';
import Link from 'next/link';

import ProfileGate from '@/components/ProfileGate';
import ProfileSwitcher from '@/components/ProfileSwitcher';
import ServiceWorker from '@/components/ServiceWorker';

import './globals.css';

const base = process.env.MTG_BASE_PATH || '';

export const metadata: Metadata = {
  title: 'MTG Tracker',
  description: 'Search Magic cards and keep them in lists.',
  // Saved to an iPhone's home screen from Safari, it opens full screen with
  // this name and icon; the page runs under the status bar (see globals.css).
  appleWebApp: { capable: true, title: 'MTG', statusBarStyle: 'black-translucent' },
  icons: { apple: `${base}/icons/apple-touch-icon.png`, icon: `${base}/icons/icon-192.png` },
  formatDetection: { telephone: false },
  // Next writes only the standard mobile-web-app-capable; older iOS wants its own.
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  themeColor: '#14120f',
  width: 'device-width',
  initialScale: 1,
  // Draw to the screen's edges; the notch and home bar are padded in CSS.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--background)]/95 pt-[env(safe-area-inset-top)] backdrop-blur">
          <nav className="safe-x mx-auto flex max-w-6xl items-center gap-2 py-3 sm:gap-4">
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
        <main className="safe-x mx-auto max-w-6xl py-6"><ProfileGate>{children}</ProfileGate></main>
        <footer className="safe-x mx-auto max-w-6xl pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 text-xs text-[var(--muted)]">
          Card data and images from{' '}
          <a href="https://scryfall.com" className="underline hover:text-[var(--foreground)]" target="_blank" rel="noreferrer">
            Scryfall
          </a>
          . Not affiliated with Wizards of the Coast.
        </footer>
        <ServiceWorker />
      </body>
    </html>
  );
}
