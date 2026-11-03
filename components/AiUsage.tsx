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
  { key: 'tagging', label: 'Reading decks' },
  { key: 'tagcards', label: 'Tagging cards' },
  { key: 'chat', label: 'Chat' },
] as const;

const FEATURE_TONE: Record<string, string> = { search: 'text-sky-300', rules: 'text-amber-300', tagging: 'text-violet-300', tagcards: 'text-fuchsia-300', chat: 'text-emerald-300' };

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

const PAGE = 25;

/** Requests of one kind: what they were for, on which model. */
interface Kind { key: string; feature: string; step: string; model: string; count: number; total: number; low: number; high: number; failed: number }

const kindKey = (c: AiCall) => `${c.feature}|${c.step}|${c.model}`;

function kinds(calls: AiCall[]): Kind[] {
  const by = new Map<string, Kind>();
  for (const c of calls) {
    const k = by.get(kindKey(c)) ?? { key: kindKey(c), feature: c.feature, step: c.step, model: c.model, count: 0, total: 0, low: Infinity, high: 0, failed: 0 };
    k.count += 1;
    k.total += c.cost;
    if (c.outcome === 'ok') { k.low = Math.min(k.low, c.cost); k.high = Math.max(k.high, c.cost); } else k.failed += 1;
    by.set(k.key, k);
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

export default function AiUsage() {
  const [calls, setCalls] = useState<AiCall[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [days, setDays] = useState(7);
  const [who, setWho] = useState<string>('all');
  const [feature, setFeature] = useState<string>('all');
  // By kind (the default) or every request, a page at a time; a kind picked narrows the list.
  const [view, setView] = useState<'kinds' | 'list'>('kinds');
  const [kind, setKind] = useState<string | null>(null);
  const [page, setPage] = useState(0);
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
  const filtered = calls.filter((c) => (who === 'all' || c.profileId === who) && (feature === 'all' || c.feature === feature));
  const shown = filtered.filter((c) => !kind || kindKey(c) === kind);
  const total = filtered.reduce((n, c) => n + c.cost, 0);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const pageCalls = shown.slice(at * PAGE, at * PAGE + PAGE);
  const days_ = [...new Set(pageCalls.map((c) => dayOf(c.at)))];
  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-[var(--accent)] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'}`;
  const reset = () => { setPage(0); setKind(null); };
  const picked = kind ? kinds(filtered).find((k) => k.key === kind) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter the AI usage">
        <button className={chip(who === 'all')} aria-pressed={who === 'all'} onClick={() => { setWho('all'); reset(); }}>Everyone</button>
        {people.map((p) => (
          <button key={p} className={chip(who === p)} aria-pressed={who === p} onClick={() => { setWho(p); reset(); }}>{names[p] ?? p}</button>
        ))}
        <span className="w-2" />
        {FEATURES.map((f) => (
          <button key={f.key} className={chip(feature === f.key)} aria-pressed={feature === f.key} onClick={() => { setFeature(f.key); reset(); }}>{f.label}</button>
        ))}
        <span className="w-2" />
        <select
          value={days}
          onChange={(e) => { setDays(Number(e.target.value)); reset(); }}
          aria-label="How far back"
          className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-base text-[var(--muted)] sm:text-xs"
        >
          <option value={1}>Today</option>
          <option value={7}>7 days</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">
          {filtered.length} request{filtered.length === 1 ? '' : 's'} · {dollars(total)} · requests older than a week are cleared every Sunday
        </p>
        <div className="flex overflow-hidden rounded-full border border-[var(--border)] text-xs" role="group" aria-label="Show">
          {([['kinds', 'By kind'], ['list', 'Every request']] as const).map(([v, label]) => (
            <button key={v} aria-pressed={view === v} onClick={() => { setView(v); setPage(0); if (v === 'kinds') setKind(null); }}
              className={`px-3 py-1 ${view === v ? 'bg-[var(--surface-hover)] text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          No Claude requests {who !== 'all' || feature !== 'all' ? 'match these filters' : 'in this time'}. Free models are not listed.
        </p>
      ) : view === 'kinds' ? (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--surface)] text-left text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-3 py-2 text-right font-medium">Requests</th>
                <th className="px-3 py-2 text-right font-medium">Each</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {kinds(filtered).map((k) => (
                <tr key={k.key} className="border-t border-[var(--border)] align-top hover:bg-[var(--surface)]">
                  <td className="px-3 py-2">
                    <button onClick={() => { setKind(k.key); setView('list'); setPage(0); }} className="text-left hover:underline">
                      <span className={`capitalize ${FEATURE_TONE[k.feature] ?? ''}`}>{k.feature}</span>
                      {k.step && <span className="text-[var(--muted)]"> · {k.step}</span>}
                    </button>
                    <span className="block text-xs text-[var(--muted)]">{modelName(k.model)}{k.failed ? ` · ${k.failed} did not finish` : ''}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{k.count}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--muted)]">
                    {k.low === Infinity ? '—' : k.low === k.high || dollars(k.low) === dollars(k.high) ? dollars(k.low) : `${dollars(k.low)}–${dollars(k.high)}`}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{dollars(k.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {picked && (
            <p className="text-xs">
              Only <span className="capitalize">{picked.feature}</span>{picked.step && ` · ${picked.step}`} on {modelName(picked.model)}
              {' '}<button onClick={() => { setKind(null); setPage(0); }} className="text-[var(--accent)] hover:underline">Show every kind</button>
            </p>
          )}
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
                  <tr><td colSpan={5} className="bg-[var(--surface)] px-3 py-1 text-[11px] uppercase tracking-wider text-[var(--muted)]">{day}</td></tr>
                  {pageCalls.filter((c) => dayOf(c.at) === day).map((c) => (
                    <tr key={c.id} className="border-t border-[var(--border)] align-top">
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
          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-sm">
              <button onClick={() => setPage(at - 1)} disabled={at === 0} className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-hover)] disabled:opacity-40">← Newer</button>
              <span className="text-xs text-[var(--muted)]">Page {at + 1} of {pages} · {shown.length} requests</span>
              <button onClick={() => setPage(at + 1)} disabled={at >= pages - 1} className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-hover)] disabled:opacity-40">Older →</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
