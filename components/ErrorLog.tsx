'use client';

/**
 * Settings: the error log and the self-checks. "Needs a look" shows what
 * the banner is about; "All" shows the last 30 days, warnings included.
 */

import { useCallback, useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { CheckRun } from '@/lib/checks';
import type { AppError } from '@/lib/errors';

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ErrorLog() {
  const [errors, setErrors] = useState<AppError[] | null>(null);
  const [all, setAll] = useState(false);
  const [run, setRun] = useState<CheckRun | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(() => {
    api.errors(true).then((r) => setErrors(r.errors)).catch(() => setErrors([]));
    api.checks().then((r) => setRun(r.run)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(api.ERRORS_CHANGED, load);
    return () => window.removeEventListener(api.ERRORS_CHANGED, load);
  }, [load]);

  const open = (errors ?? []).filter((e) => !e.ackAt);
  const shown = all ? errors ?? [] : open;
  const checkNow = async () => {
    setChecking(true);
    try {
      setRun((await api.runChecks()).run);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <section id="errors" className="flex scroll-mt-20 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Errors</h2>
          <div className="flex gap-1.5 text-xs">
            <button onClick={() => setAll(false)} className={`rounded-full border px-3 py-1 ${!all ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] text-[var(--muted)]'}`}>
              Needs a look · {open.length}
            </button>
            <button onClick={() => setAll(true)} className={`rounded-full border px-3 py-1 ${all ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] text-[var(--muted)]'}`}>
              All · 30 days
            </button>
            {open.length > 1 && (
              <button onClick={() => api.acknowledgeError()} className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-hover)]">Acknowledge all</button>
            )}
          </div>
        </div>
        {errors === null ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{all ? 'Nothing logged in the last 30 days.' : 'Nothing needs a look.'}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {shown.map((e) => (
              <li key={e.id} className={`flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-sm ${e.ackAt ? 'text-[var(--muted)]' : ''}`}>
                <span className="w-32 shrink-0 text-xs text-[var(--muted)]">{when(e.at)}</span>
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium">{e.source}</span>
                    {e.level === 'warn' && <span className="ml-2 rounded-full border border-[var(--border)] px-1.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">warning</span>}
                  </p>
                  <p className="break-words text-[var(--muted)]">{e.message}</p>
                  {e.detail && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-[var(--muted)]">Details</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--background)] p-2">{e.detail}</pre>
                    </details>
                  )}
                </div>
                {e.ackAt ? (
                  <span className="text-xs">Seen by {e.ackBy}</span>
                ) : (
                  <button onClick={() => api.acknowledgeError(e.id)} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--surface-hover)]">Acknowledge</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Checks <span className="text-sm font-normal text-[var(--muted)]">· every 15 minutes</span></h2>
          <button onClick={checkNow} disabled={checking} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--surface-hover)] disabled:opacity-50">
            {checking ? 'Checking…' : 'Check now'}
          </button>
        </div>
        {run ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {run.checks.map((c) => (
                <div key={c.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className={`text-xs ${c.ok ? 'text-emerald-400' : 'text-red-300'}`}>
                    <span aria-hidden>{c.ok ? '✓ ' : '✕ '}</span>{c.detail}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--muted)]">Last checked {when(run.at)}.</p>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">Not checked yet.</p>
        )}
      </section>
    </>
  );
}
