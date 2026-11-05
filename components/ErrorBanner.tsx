'use client';

/**
 * A banner under the header while an error still needs a look - a failed
 * nightly job, a check that failed, a job that crashed. It stays until
 * someone acknowledges it, here or in Settings. Warnings (a busy model)
 * go in the log without a banner.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { AppError } from '@/lib/errors';
import { useProfile } from '@/lib/profile';
import { useMe } from '@/lib/use-me';

const LOOK_MS = 60_000;

export default function ErrorBanner() {
  const profile = useProfile();
  // Not until the profile may be used: a signed-out admin's would be refused.
  const me = useMe();
  const ready = !!me && !me.needsSignIn;
  const [open, setOpen] = useState<AppError[]>([]);
  const [busy, setBusy] = useState(false);

  const look = useCallback(() => { api.errors().then((r) => setOpen(r.errors)).catch(() => {}); }, []);

  useEffect(() => {
    if (!profile || !ready) return;
    look();
    const timer = setInterval(look, LOOK_MS);
    window.addEventListener(api.ERRORS_CHANGED, look);
    window.addEventListener(api.JOBS_CHANGED, look);
    return () => {
      clearInterval(timer);
      window.removeEventListener(api.ERRORS_CHANGED, look);
      window.removeEventListener(api.JOBS_CHANGED, look);
    };
  }, [profile, look, ready]);

  if (!profile || !ready || !open.length) return null;
  const [newest] = open;

  const ack = async () => {
    setBusy(true);
    try {
      await api.acknowledgeError(newest.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" className="border-b border-red-900/60 bg-red-950/60">
      <div className="safe-x mx-auto flex max-w-[1680px] items-center justify-between gap-3 py-1.5 text-[13px]">
        <p className="min-w-0 truncate" title={`${newest.source}: ${newest.message}`}>
          <span className="font-semibold text-red-300">{newest.source}: </span>
          {newest.message}
          {open.length > 1 && <span className="text-[var(--muted)]"> · and {open.length - 1} more</span>}
        </p>
        <div className="flex shrink-0 gap-1">
          <Link href="/settings#errors" className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-red-200 hover:bg-red-900/30">Log</Link>
          <button onClick={ack} disabled={busy} className="whitespace-nowrap rounded-full border border-red-200/30 px-2.5 py-0.5 font-medium text-red-100 hover:bg-red-900/30 disabled:opacity-60">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
