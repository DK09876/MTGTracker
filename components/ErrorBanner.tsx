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

const LOOK_MS = 60_000;

export default function ErrorBanner() {
  const profile = useProfile();
  const [open, setOpen] = useState<AppError[]>([]);
  const [busy, setBusy] = useState(false);

  const look = useCallback(() => { api.errors().then((r) => setOpen(r.errors)).catch(() => {}); }, []);

  useEffect(() => {
    if (!profile) return;
    look();
    const timer = setInterval(look, LOOK_MS);
    window.addEventListener(api.ERRORS_CHANGED, look);
    window.addEventListener(api.JOBS_CHANGED, look);
    return () => {
      clearInterval(timer);
      window.removeEventListener(api.ERRORS_CHANGED, look);
      window.removeEventListener(api.JOBS_CHANGED, look);
    };
  }, [profile, look]);

  if (!profile || !open.length) return null;
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
      <div className="safe-x mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 text-sm">
        <p>
          <span className="font-semibold text-red-300">{newest.source}: </span>
          {newest.message}
          {open.length > 1 && <span className="text-[var(--muted)]"> · and {open.length - 1} more</span>}
        </p>
        <div className="flex gap-2">
          <Link href="/settings#errors" className="rounded-full border border-red-900/70 px-3 py-1 text-red-200 hover:bg-red-900/30">See the log</Link>
          <button onClick={ack} disabled={busy} className="rounded-full bg-[var(--foreground)] px-3 py-1 font-semibold text-[var(--background)] disabled:opacity-60">
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
}
