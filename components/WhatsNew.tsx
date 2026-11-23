'use client';

/**
 * "What's new": a short line under the header once the app has something new
 * this profile hasn't seen (lib/releases.ts); fixes alone don't raise it. The newest
 * release's headline and its first few points, one line each, and a link to
 * the Releases page for the details. Closing it, or opening the Releases
 * page, counts as seen, on every device the profile uses.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import CardText from '@/components/CardText';
import * as api from '@/lib/api';
import { useProfile } from '@/lib/profile';
import { CURRENT, releaseAnchor, toAnnounce } from '@/lib/releases';
import { useMe } from '@/lib/use-me';
import { useReach } from '@/lib/use-reach';

/** Points shown in the line: the rest are a tap away. */
const SHOWN = 3;

function MoreLine({ more, earlier, fixes, className }: { more: number; earlier: number; fixes: number; className: string }) {
  const bits = [
    more > 0 ? `${more} more ${more === 1 ? 'change' : 'changes'}` : '',
    earlier > 0 ? `${earlier} earlier ${earlier === 1 ? 'update' : 'updates'}` : '',
    fixes > 0 ? `${fixes === 1 ? 'a fix' : `${fixes} fixes`}` : '',
  ].filter(Boolean);
  return bits.length ? <span className={`text-[12px] text-[var(--faint)] ${className}`}>{bits.join(' · ')}</span> : null;
}

/**
 * What this profile has seen of the notes: undefined until read (or with no profile that can read it), null for
 * none yet. Shared by the banner and the header's button, and kept in step when either marks them seen.
 */
function useSeen(): { ready: boolean; profile: string | null; seen: string | null | undefined; setSeen: (v: string) => void } {
  const profile = useProfile();
  const me = useMe();
  const ready = !!profile && profile !== 'tour' && !!me && !me.needsSignIn;
  // As read for a profile: another profile's answer counts as not read.
  const [read, setRead] = useState<{ profile: string; seen: string | null } | null>(null);
  const seen = ready && read && read.profile === profile ? read.seen : undefined;

  useEffect(() => {
    if (!ready || !profile) return;
    let cancelled = false;
    api.releaseState().then((s) => { if (!cancelled) setRead({ profile, seen: s.seen }); }).catch(() => {});
    const onSeen = (e: Event) => setRead({ profile, seen: (e as CustomEvent<string>).detail });
    window.addEventListener(api.RELEASES_SEEN, onSeen);
    return () => { cancelled = true; window.removeEventListener(api.RELEASES_SEEN, onSeen); };
  }, [ready, profile]);

  return { ready, profile, seen, setSeen: (v) => { if (profile) setRead({ profile, seen: v }); } };
}

const SPARKLE = 'M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2Zm7 12 .9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14Z';

/** The header's way to the Releases page, on every screen: a sparkle, with a dot while there is something unseen. */
export function WhatsNewButton() {
  const path = usePathname();
  const { seen } = useSeen();
  const on = path === '/releases';
  const fresh = seen !== undefined && !on && toAnnounce(seen).news.length > 0;
  return (
    <Link
      href="/releases"
      aria-label={fresh ? 'What’s new: there are updates you haven’t seen' : 'What’s new'}
      title="What’s new"
      aria-current={on ? 'page' : undefined}
      className={`relative grid h-8 w-8 place-items-center rounded-full border hover:bg-[var(--surface)] hover:text-[var(--foreground)] ${on || fresh
        ? 'border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] text-[var(--accent)]'
        : 'border-[var(--border)] text-[var(--muted)]'}`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor"><path d={SPARKLE} /></svg>
      {fresh && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--background)] bg-[var(--accent)]" />}
    </Link>
  );
}

export default function WhatsNew() {
  const path = usePathname();
  const reach = useReach();
  const { ready, seen, setSeen } = useSeen();

  // The Releases page shows it all, and marks it seen itself; the "updating" line says more for now.
  if (!ready || seen === undefined || path === '/releases' || reach.down || reach.updating) return null;
  // Fixes alone are quiet: they wait on the Releases page, and ride along with the next thing that's new.
  const { news, fixes } = toAnnounce(seen);
  if (!news.length) return null;

  const newest = news[0];
  const more = newest.items.length - SHOWN;
  const earlier = news.length - 1;
  const close = () => {
    setSeen(CURRENT.version);
    api.markReleasesSeen(CURRENT.version).catch(() => {});
  };

  return (
    <div role="status" data-whats-new className="border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--accent)_9%,var(--background))]">
      <div className="safe-x mx-auto flex max-w-[1680px] items-start gap-3 py-2 text-[13px]">
        <span aria-hidden className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center text-[var(--accent)]">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d={SPARKLE} /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate">
            <span className="font-semibold text-[var(--accent)]">New in v{newest.version}</span>
            <span className="text-[var(--muted)]"> · </span>
            <span className="font-medium">{newest.title}</span>
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5 text-[var(--muted)]">
            {newest.items.slice(0, SHOWN).map((item, i) => (
              // One line each; on a phone, two points at most.
              <li key={i} className={`flex min-w-0 gap-1.5 ${i >= 2 ? 'max-sm:hidden' : ''}`}>
                <span aria-hidden className="shrink-0">•</span>
                <span className="min-w-0 truncate"><CardText text={item.title} /></span>
              </li>
            ))}
          </ul>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              href={`/releases#${releaseAnchor(newest.version)}`}
              className="font-medium text-[var(--foreground)] underline decoration-[var(--accent)]/60 underline-offset-2 hover:decoration-[var(--accent)]"
            >
              More on the Releases page
            </Link>
            {/* What isn't shown: on a phone, from the third point on. */}
            <MoreLine className="sm:hidden" more={newest.items.length - 2} earlier={earlier} fixes={fixes.length} />
            <MoreLine className="max-sm:hidden" more={more} earlier={earlier} fixes={fixes.length} />
          </p>
        </div>
        <button
          onClick={close}
          aria-label="Close: I’ve seen what’s new"
          title="Got it"
          className="-mr-1 shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" /></svg>
        </button>
      </div>
    </div>
  );
}
