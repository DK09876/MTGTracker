'use client';

/**
 * One line under the header while the app is updating, and after it, when a
 * new version is out (handoff 9, Part B). It shows when a request couldn't
 * reach the server (lib/reach.ts) or the server says a deploy is under way,
 * asks the server every few seconds while it is up, and clears itself on the
 * first answer. Nothing is re-sent and nothing reloads by itself: someone may
 * be typing. A deploy the tab slept through shows as a new version too.
 */

import { useEffect } from 'react';

import * as api from '@/lib/api';
import { useReach } from '@/lib/use-reach';

const EVERY_MS = 20_000;
const WHILE_DOWN_MS = 2_500;

export default function UpdateBanner() {
  const r = useReach();
  const waiting = r.down || r.updating;

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      if (stop) return;
      clearTimeout(timer);
      const next = () => { if (!stop) timer = setTimeout(look, waiting ? WHILE_DOWN_MS : EVERY_MS); };
      if (document.hidden && !waiting) { next(); return; }
      api.appStatus().catch(() => {}).finally(next);
    };
    look();
    document.addEventListener('visibilitychange', look);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', look); };
  }, [waiting]);

  if (waiting) {
    return (
      <div role="status" data-update-banner="updating" className="border-t border-sky-900/60 bg-sky-950/80">
        <p className="safe-x mx-auto flex max-w-[1680px] items-center gap-2 py-1.5 text-[13px] text-sky-100">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-sky-300 motion-reduce:animate-none" />
          The app is updating. This page will reconnect by itself.
        </p>
      </div>
    );
  }
  if (r.newer) {
    return (
      <div role="status" data-update-banner="newer" className="border-t border-emerald-900/60 bg-emerald-950/80">
        <div className="safe-x mx-auto flex max-w-[1680px] items-center justify-between gap-3 py-1.5 text-[13px] text-emerald-100">
          <p className="min-w-0">A new version is out.</p>
          <button onClick={() => window.location.reload()} className="shrink-0 whitespace-nowrap rounded-full border border-emerald-200/40 px-3 py-0.5 font-medium hover:bg-emerald-900/40">Refresh</button>
        </div>
      </div>
    );
  }
  return null;
}
