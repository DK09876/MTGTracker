'use client';

/**
 * "Smarter model": use Gemini 3.8 Flash instead of Flash-Lite, for any
 * feature that asks the model (rules answers, deck tagging). One setting for
 * the device, shared by all of them.
 *
 * It can only be turned on while the smarter model has been answering: on
 * the free tier it refused for hours at a time. "Check now" asks it something
 * tiny (one request of its own daily allowance, not Flash-Lite's). With it
 * on, a busy Flash hands over to Flash-Lite within 45 seconds, so an answer
 * still comes - just from the standard model.
 */

import { useEffect, useState } from 'react';

import * as api from '@/lib/api';
import { useSmarter } from '@/lib/ai-settings';
import type { SmarterStatus } from '@/lib/ai';

const when = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
};

export default function SmarterModelSetting() {
  const [wanted, setWanted] = useSmarter();
  const [status, setStatus] = useState<SmarterStatus | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => { api.smarterStatus().then(setStatus).catch(() => {}); }, []);

  const check = async () => {
    setChecking(true);
    try { setStatus(await api.checkSmarter()); } catch { /* status stays */ } finally { setChecking(false); }
  };

  const available = !!status?.available;
  const on = wanted && available;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className={`flex items-center gap-3 ${available ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={!available}
          onChange={(e) => setWanted(e.target.checked)}
          className="h-5 w-5 accent-[var(--accent)]"
        />
        <span>
          <span className="font-medium">Smarter model</span>
          <span className="text-[var(--muted)]"> - {status?.label ?? 'Gemini 3.8 Flash'} instead of Flash-Lite, for every AI feature</span>
        </span>
      </label>
      <p className="ml-8 text-xs text-[var(--muted)]">
        {!status && 'Checking…'}
        {status && (available
          ? <>✓ Answering (checked {when(status.checkedAt!)}). If it is busy, Flash-Lite answers instead.</>
          : <>Off: {status.detail}{status.checkedAt ? ` (${when(status.checkedAt)})` : ''}. On the free tier it is often overloaded.</>)}
        {' '}
        <button onClick={check} disabled={checking} className="underline hover:text-[var(--foreground)] disabled:opacity-50">
          {checking ? 'Checking…' : 'Check now'}
        </button>
        {' '}(uses one of its own requests)
      </p>
    </div>
  );
}
