'use client';

/**
 * The AI usage trail: every Claude request, newest first - who, what for,
 * which model, its tokens and what it cost - with filters by person and by
 * feature. Read when opened, and again when a request may have spent.
 * Reopening a saved search or conversation never shows here: it makes none.
 */

import { useCallback, useEffect, useState } from 'react';

import * as api from '@/lib/api';
import type { AiCall } from '@/lib/db';
import { dollars } from '@/lib/spend';
import { shortLabel } from './ModelMenu';

const FEATURES = [
  { key: 'all', label: 'All' },
  { key: 'search', label: 'Search' },
  { key: 'rules', label: 'Rules' },
  { key: 'tagging', label: 'Tagging' },
] as const;

const FEATURE_TONE: Record<string, string> = { search: 'text-sky-300', rules: 'text-amber-300', tagging: 'text-violet-300' };

const OUTCOME: Record<string, string> = {
  failed: 'failed',
  declined: 'declined by Claude',
  blocked: 'blocked by the daily cap',
  stopped: 'stopped',
};

const modelName = (id: string) => shortLabel(id.replace(/^claude-/, 'Claude ').replace(/-(\d)-(\d)$/, ' $1.$2').replace(/-(\d)$/, ' $1')
  .replace(/Claude (\w)/, (_, c: string) => `Claude ${c.toUpperCase()}`));

const dayOf = (iso: string) => {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export default function AiUsage() {
  const [calls, setCalls] = useState<AiCall[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [days, setDays] = useState(7);
  const [who, setWho] = useState<string>('all');
  const [feature, setFeature] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(() => {
    api.aiUsage(days).then((r) => { setCalls(r.calls); setNames(r.names); setError(null); }).catch(() => setError('Could not load the AI usage'));
  }, [days]);
  useEffect(() => {
    read();
    window.addEventListener(api.AI_SPENT, read);
    return () => window.removeEventListener(api.AI_SPENT, read);
  }, [read]);

  if (!calls) return <p className="text-sm text-[var(--muted)]">{error ?? 'Loading…'}</p>;
  const people = [...new Set(calls.map((c) => c.profileId))];
  const shown = calls.filter((c) => (who === 'all' || c.profileId === who) && (feature === 'all' || c.feature === feature));
  const total = shown.reduce((n, c) => n + c.cost, 0);
  const days_ = [...new Set(shown.map((c) => dayOf(c.at)))];
  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-[var(--accent)] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter the AI usage">
        <button className={chip(who === 'all')} aria-pressed={who === 'all'} onClick={() => setWho('all')}>Everyone</button>
        {people.map((p) => (
          <button key={p} className={chip(who === p)} aria-pressed={who === p} onClick={() => setWho(p)}>{names[p] ?? p}</button>
        ))}
        <span className="w-2" />
        {FEATURES.map((f) => (
          <button key={f.key} className={chip(feature === f.key)} aria-pressed={feature === f.key} onClick={() => setFeature(f.key)}>{f.label}</button>
        ))}
        <span className="w-2" />
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="How far back"
          className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-base text-[var(--muted)] sm:text-xs"
        >
          <option value={1}>Today</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>
      <p className="text-xs text-[var(--muted)]">
        {shown.length} request{shown.length === 1 ? '' : 's'} · {dollars(total)}
        {shown.length === 500 ? ' · the newest 500' : ''}
      </p>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          No Claude requests {who !== 'all' || feature !== 'all' ? 'match these filters' : 'in this time'}. Free models are not listed.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--surface)] text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-3 py-2 text-right font-medium">Tokens<span className="block font-normal normal-case tracking-normal">in / out</span></th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            {days_.map((day) => (
              <tbody key={day}>
                <tr><td colSpan={5} className="bg-[#171511] px-3 py-1 text-[11px] uppercase tracking-wider text-[var(--muted)]">{day}</td></tr>
                {shown.filter((c) => dayOf(c.at) === day).map((c) => (
                  <tr key={c.id} className="border-t border-[#26221b] align-top">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--muted)]">{timeOf(c.at)}</td>
                    <td className="px-3 py-2">{names[c.profileId] ?? c.profileId}</td>
                    <td className="px-3 py-2">
                      <span className={`capitalize ${FEATURE_TONE[c.feature] ?? ''}`}>{c.feature}</span>
                      {c.step && <span className="text-[var(--muted)]"> · {c.step}</span>}
                      {c.label && <span className="block max-w-[16rem] truncate text-xs text-[var(--muted)]" title={c.label}>{c.label}</span>}
                      <span className="block text-xs text-[var(--muted)]">
                        {modelName(c.model)}{c.answeredBy && ` · answered by ${modelName(c.answeredBy)}`}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-[var(--muted)]">
                      {c.inputTokens.toLocaleString()} / {c.outputTokens.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {dollars(c.cost)}
                      {c.outcome !== 'ok' && <span className="block text-xs text-amber-400" title={c.detail}>{OUTCOME[c.outcome] ?? c.outcome}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
