import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Figtree } from 'next/font/google';
import 'mana-font/css/mana.css';
import Link from 'next/link';

import ModelMenu from '@/components/ModelMenu';
import ProfileGate from '@/components/ProfileGate';
import ProfileSwitcher from '@/components/ProfileSwitcher';
import { SettingsLink, TabBar, TopLinks } from '@/components/Nav';
import ServiceWorker from '@/components/ServiceWorker';

import './globals.css';

const base = process.env.MTG_BASE_PATH || '';

// Self-hosted at build time by next/font: no request to Google from the page.
const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const ui = Figtree({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });

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
  themeColor: '#100f0e',
  width: 'device-width',
  initialScale: 1,
  // Draw to the screen's edges; the notch and home bar are padded in CSS.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body>
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--background)]/95 pt-[env(safe-area-inset-top)] backdrop-blur">
          <nav className="safe-x mx-auto flex max-w-6xl items-center gap-2 py-3 sm:gap-4">
            <Link href="/" className="font-display flex items-center gap-2 whitespace-nowrap text-lg font-extrabold">
              {/* The five colours around a dark centre. */}
              <span aria-hidden className="grid h-6 w-6 place-items-center rounded-[7px] bg-[conic-gradient(from_210deg,#f2dfa0,#5aa8e6,#a98bd0,#ef6d4f,#4fbf7a,#f2dfa0)]">
                <span className="h-3 w-3 rounded-[3px] bg-[var(--background)]" />
              </span>
              <span className="max-sm:sr-only">MTG Tracker</span>
            </Link>
            <div className="ml-auto flex items-center gap-1 text-sm">
              <TopLinks />
              <ModelMenu />
              <SettingsLink />
              <ProfileSwitcher />
            </div>
          </nav>
        </header>
        <main className="safe-x mx-auto max-w-6xl py-6"><ProfileGate>{children}</ProfileGate></main>
        <footer className="safe-x mx-auto max-w-6xl pb-[calc(var(--nav-h)+max(2rem,env(safe-area-inset-bottom)))] pt-4 text-xs text-[var(--muted)]">
          Card data and images from{' '}
          <a href="https://scryfall.com" className="underline hover:text-[var(--foreground)]" target="_blank" rel="noreferrer">
            Scryfall
          </a>
          . Not affiliated with Wizards of the Coast.
        </footer>
        <TabBar />
        <ServiceWorker />
      </body>
    </html>
  );
}
