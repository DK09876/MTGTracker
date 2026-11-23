'use client';

/**
 * Releases: every version of the app, newest first, each a section that
 * opens to what changed (lib/release-notes.ts). The newest and any this
 * profile hadn't seen start open; opening the page counts as seeing them.
 * Under them, the deploy history: when each build went live.
 */

import { useEffect, useMemo, useState } from 'react';

import CardText from '@/components/CardText';
import * as api from '@/lib/api';
import { useProfile } from '@/lib/profile';
import { CURRENT, isFix, RELEASES, releaseAnchor, releaseDate, UNRELEASED, unseen, type Release } from '@/lib/releases';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (date: string) => { const [y, m] = date.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor" className="shrink-0 text-[var(--muted)] transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none">
      <path d="M9.3 5.3 15.9 12l-6.6 6.7-1.4-1.4 5.2-5.3-5.2-5.3 1.4-1.4Z" />
    </svg>
  );
}

function ReleaseSection({ release, open, isNew, isCurrent, liveAt, onToggle }: {
  release: Release; open: boolean; isNew: boolean; isCurrent: boolean; liveAt?: string; onToggle: (open: boolean) => void;
}) {
  const n = release.items.length;
  return (
    <details
      id={releaseAnchor(release.version)}
      open={open}
      onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== open) onToggle(o); }}
      className={`group scroll-mt-28 rounded-2xl border bg-[var(--surface)] ${isNew ? 'border-[color-mix(in_srgb,var(--accent)_45%,var(--border))]' : 'border-[var(--border)]'}`}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-2xl px-4 py-3 hover:bg-[var(--surface-hover)] [&::-webkit-details-marker]:hidden">
        <span className="mt-[3px]"><Chevron /></span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded-full border border-[var(--border)] px-2 py-px font-mono text-[11px] text-[var(--muted)]">v{release.version}</span>
            {isCurrent && <span className="rounded-full bg-[var(--accent)]/15 px-2 py-px text-[11px] font-medium text-[var(--accent)]">Current</span>}
            {isFix(release) && <span className="rounded-full border border-[var(--border)] px-2 py-px text-[11px] text-[var(--muted)]">Fixes</span>}
            {isNew && <span className="rounded-full bg-[var(--accent)] px-2 py-px text-[11px] font-semibold text-[#15110a]">New</span>}
          </span>
          <span className="font-medium leading-snug">{release.title}</span>
          <span className="text-[12px] text-[var(--muted)]">
            {releaseDate(release.date)} · {n} {n === 1 ? 'change' : 'changes'}
          </span>
        </span>
      </summary>
      <div className="border-t border-[var(--border)] px-4 pb-4 pt-3">
        <ul className="flex flex-col gap-3">
          {release.items.map((item, i) => (
            <li key={i} className="flex gap-2.5">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
              <div className="min-w-0">
                <p className="text-[14px] font-medium leading-snug"><CardText text={item.title} /></p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--muted)]"><CardText text={item.details} /></p>
              </div>
            </li>
          ))}
        </ul>
        {liveAt && <p className="mt-3 text-[11px] text-[var(--faint)]">Live since {when(liveAt)}</p>}
      </div>
    </details>
  );
}

/** What's in the app since the newest version: already here, waiting for the owner to make it a version. */
function SinceSection() {
  if (!UNRELEASED.length) return null;
  // Newest first, the new things before the fixes.
  const items = [...UNRELEASED].reverse().sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'new' ? -1 : 1));
  const n = items.length;
  return (
    <details open className="group rounded-2xl border border-dashed border-[var(--border)]" data-releases-since>
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-2xl px-4 py-3 hover:bg-[var(--surface)] [&::-webkit-details-marker]:hidden">
        <span className="mt-[3px]"><Chevron /></span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium leading-snug">Since v{CURRENT.version}</span>
          <span className="text-[12px] text-[var(--muted)]">{n} {n === 1 ? 'change' : 'changes'} already in the app, part of the next version</span>
        </span>
      </summary>
      <div className="border-t border-dashed border-[var(--border)] px-4 pb-4 pt-3">
        <ul className="flex flex-col gap-3">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2.5">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted)]" />
              <div className="min-w-0">
                <p className="text-[14px] font-medium leading-snug">
                  <CardText text={item.title} />
                  {item.kind === 'fix' && <span className="ml-2 rounded-full border border-[var(--border)] px-1.5 py-px align-middle text-[10px] font-normal text-[var(--muted)]">Fix</span>}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--muted)]"><CardText text={item.details} /></p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export default function ReleasesPage() {
  const profile = useProfile();
  const [state, setState] = useState<api.ReleaseState | null>(null);
  // What was new when the page opened: it stays marked while the page is open, though it now counts as seen.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(() => new Set([CURRENT.version]));

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    api.releaseState().then((s) => {
      if (cancelled) return;
      setState(s);
      const news = profile === 'tour' ? [] : unseen(s.seen).map((r) => r.version);
      setFresh(new Set(news));
      setOpen((o) => new Set([...o, ...news]));
      if (news.length) api.markReleasesSeen(CURRENT.version).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [profile]);

  // A link to one release (the banner's, #v1.2.0) opens it and brings it into view.
  useEffect(() => {
    const go = () => {
      const v = window.location.hash.replace(/^#v/, '');
      if (!v || !RELEASES.some((r) => r.version === v)) return;
      setOpen((o) => new Set([...o, v]));
      requestAnimationFrame(() => document.getElementById(releaseAnchor(v))?.scrollIntoView({ block: 'start' }));
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);

  // When each version first went live: the oldest deploy of it.
  const liveAt = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of state?.deploys ?? []) m.set(d.version, d.at);
    return m;
  }, [state]);

  const months = useMemo(() => {
    const groups: Array<{ month: string; releases: Release[] }> = [];
    for (const r of RELEASES) {
      const month = monthOf(r.date);
      if (groups.at(-1)?.month !== month) groups.push({ month, releases: [] });
      groups.at(-1)!.releases.push(r);
    }
    return groups;
  }, []);

  const allOpen = open.size >= RELEASES.length;
  const toggle = (version: string, o: boolean) => setOpen((s) => {
    const next = new Set(s);
    if (o) next.add(version); else next.delete(version);
    return next;
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-extrabold">What’s new</h1>
        <p className="text-sm text-[var(--muted)]">
          MTG Tracker <span className="font-mono text-[var(--foreground)]">v{CURRENT.version}</span>, from {releaseDate(CURRENT.date)}.
          {' '}Every update the app has had, newest first: open one to see what changed.
        </p>
        <div className="mt-1 flex gap-2">
          <button
            onClick={() => setOpen(allOpen ? new Set() : new Set(RELEASES.map((r) => r.version)))}
            className="rounded-full border border-[var(--border)] px-3 py-1 text-[13px] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          >
            {allOpen ? 'Close all' : 'Open all'}
          </button>
        </div>
      </div>

      <SinceSection />

      {months.map(({ month, releases }) => (
        <section key={month} className="flex flex-col gap-2" aria-label={month}>
          <h2 className="px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--faint)]">{month}</h2>
          {releases.map((r) => (
            <ReleaseSection
              key={r.version}
              release={r}
              open={open.has(r.version)}
              isNew={fresh.has(r.version)}
              isCurrent={r.version === CURRENT.version}
              liveAt={liveAt.get(r.version)}
              onToggle={(o) => toggle(r.version, o)}
            />
          ))}
        </section>
      ))}

      <details className="group rounded-2xl border border-[var(--border)]" data-deploy-history>
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 text-sm hover:bg-[var(--surface)] [&::-webkit-details-marker]:hidden">
          <Chevron />
          <span className="font-medium">Deploy history</span>
          <span className="text-[var(--muted)]">{state ? `${state.deploys.length} ${state.deploys.length === 1 ? 'deploy' : 'deploys'}` : ''}</span>
        </summary>
        <div className="border-t border-[var(--border)] px-4 pb-4 pt-3 text-[13px]">
          {!state ? (
            <p className="text-[var(--muted)]">Loading…</p>
          ) : !state.deploys.length ? (
            <p className="text-[var(--muted)]">No deploys written down yet. Each one is, from this version on.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-[var(--border)]">
              {state.deploys.map((d, i) => (
                <li key={`${d.build}-${d.at}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                  <span className="min-w-[11rem] tabular-nums">{when(d.at)}</span>
                  <a href={`#${releaseAnchor(d.version)}`} className="font-mono text-[var(--foreground)] hover:underline">v{d.version}</a>
                  <span className="font-mono text-[11px] text-[var(--faint)]">{d.build.slice(0, 7)}</span>
                  {i === 0 && d.build === state.build && <span className="text-[11px] text-[var(--accent)]">running now</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </details>
    </div>
  );
}
