'use client';

/**
 * The header's jobs menu: background work running for this profile, and
 * what finished in the last few minutes, each linking to its deck. Hidden
 * when there is nothing to show.
 *
 * It looks every few seconds while something runs, rarely otherwise, and at
 * once when a page starts a job (api.JOBS_CHANGED).
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import * as api from '@/lib/api';
import { useProfile } from '@/lib/profile';

const BUSY_MS = 3_000;
const IDLE_MS = 30_000;

const elapsed = (from: string, to: string | null) => {
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function JobTray() {
  const profile = useProfile();
  const [jobs, setJobs] = useState<api.JobSummary[]>([]);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profile) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const look = () => {
      clearTimeout(timer);
      api.jobs()
        .then(({ jobs: found }) => {
          if (stopped) return;
          setJobs(found);
          timer = setTimeout(look, found.some((j) => j.status === 'running') ? BUSY_MS : IDLE_MS);
        })
        .catch(() => { if (!stopped) timer = setTimeout(look, IDLE_MS); });
    };
    look();
    window.addEventListener(api.JOBS_CHANGED, look);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener(api.JOBS_CHANGED, look); };
  }, [profile]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!container.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  if (!profile || !jobs.length) return null;
  const busy = jobs.filter((j) => j.status === 'running').length;
  const failed = jobs.some((j) => j.status === 'failed' || j.status === 'interrupted');

  return (
    <div className="relative" ref={container}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-xs ${busy ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'}`}
      >
        {busy ? (
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden className="animate-spin motion-reduce:animate-none">
            <path d="M21 12a9 9 0 1 1-6.2-8.6" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : (
          <span aria-hidden className={failed ? 'text-red-400' : 'text-emerald-400'}>{failed ? '!' : '✓'}</span>
        )}
        {busy ? `${busy} running` : failed ? 'Job failed' : 'Done'}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Background jobs"
          className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+3.75rem)] z-40 flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-1 sm:w-[22rem]"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Background jobs</p>
          {jobs.map((j) => (
            <div key={j.id} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">
                  {j.status === 'done' && <span className="text-emerald-400">Done · </span>}
                  {(j.status === 'failed' || j.status === 'interrupted') && <span className="text-red-400">Failed · </span>}
                  {j.label}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {j.total ? `${j.done ?? 0} / ${j.total}` : elapsed(j.startedAt, j.finishedAt)}
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">
                {j.listId ? <Link href={`/lists/${j.listId}`} onClick={() => setOpen(false)} className="underline hover:text-[var(--foreground)]">{j.subject}</Link> : j.subject}
                {j.status === 'running' && j.detail && <> · {j.detail}</>}
                {j.error && j.status !== 'running' && <> · {j.error}</>}
              </p>
              {j.status === 'running' && (
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                  {j.total
                    ? <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(((j.done ?? 0) / j.total) * 100)}%` }} />
                    : <div className="id-grad h-full w-1/3 animate-[slide_1.6s_ease-in-out_infinite] rounded-full motion-reduce:animate-none" />}
                </div>
              )}
            </div>
          ))}
          <p className="text-xs text-[var(--muted)]">Jobs keep running if you leave the page or close the tab.</p>
        </div>
      )}
    </div>
  );
}
