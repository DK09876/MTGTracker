'use client';

/**
 * Settings: the suggestion log. Everyone gets their own sharing switch;
 * admins see how suggestions fare - accept rate by task, method, model,
 * prompt version and the rank they were shown at - and can export the log
 * for evaluation (no names, no typed reasons).
 */

import { useEffect, useState } from 'react';

import Tip from './Tip';
import * as api from '@/lib/api';
import { REASON_LABELS, type ReasonChip } from '@/lib/suggestion-shared';

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const DIMS: Array<[keyof NonNullable<api.SuggestionLog['admin']>['rates'], string, string]> = [
  ['task', 'By task', 'Trim (cuts), find, tune (swaps, fixes, lands), build (finish the deck), plan (Claude’s plan proposals).'],
  ['method', 'By method', 'Code: worked out by the app’s rules. AI: written by a model.'],
  ['model', 'By model', 'The model that wrote the suggestion; code has none.'],
  ['promptVersion', 'By prompt version', 'Bumped whenever a prompt changes, so a change can be compared with what came before.'],
  ['rank', 'By rank shown', 'Where in its group the suggestion was shown: 1 is first.'],
];

/** Your own switch: whether what you're shown and what you do with it is logged. */
export function ShareSwitch() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.suggestionLog().then((l) => setOn(l.share)).catch(() => setError('Could not load the setting')); }, []);
  if (on === null) return error ? <p className="text-sm text-red-400">{error}</p> : null;
  const flip = async () => {
    try { setOn((await api.setSuggestionShare(!on)).share); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
  };
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-1.5 font-display text-lg font-semibold">Help improve suggestions
        <Tip label="What this keeps">The suggestions the app shows you, and whether you take, turn down or leave each one, with a reason if you give one. It stays in this app. Typed reasons are never shared; an export for testing leaves out names and typed reasons.</Tip>
      </h2>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={() => void flip()} />
        Keep a record of the suggestions I’m shown and what I do with them
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}

/** Admins: how suggestions fare. */
export function SuggestionStats() {
  const [log, setLog] = useState<api.SuggestionLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.suggestionLog().then(setLog).catch(() => setError('Could not load the log')); }, []);
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!log?.admin) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  const { totals, rates, reasons } = log.admin;
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold">Suggestions <span className="text-sm font-normal text-[var(--accent)]">· admin</span></h2>
        <p className="text-sm text-[var(--muted)]">
          {totals.events} suggestions shown in {totals.batches} groups; {totals.conversations} questions and answers.
          Accept rate is accepted over decided (accepted, turned down, or left untouched when the group was replaced or the changes applied).
          Regretted: a cut card back in the deck, or an added card gone, within two weeks.
        </p>
        <p className="text-xs text-[var(--muted)]">Recording: {totals.sharing.map((p) => `${p.name} ${p.on ? 'on' : 'off'}`).join(' · ')}</p>
        <a href={api.suggestionExportUrl()} className="self-start text-sm text-[var(--accent)] underline">Export for evaluation (no names, no typed reasons)</a>
      </div>
      {totals.events === 0 && <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">Nothing logged yet. Suggestions are logged as people open Tune and Plan.</p>}
      {totals.events > 0 && DIMS.map(([dim, title, tip]) => (
        <div key={dim} className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1 text-sm font-medium">{title}<Tip label={`About ${title.toLowerCase()}`}>{tip}</Tip></h3>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full min-w-[30rem] text-sm tabular-nums">
              <thead className="text-xs text-[var(--muted)]"><tr className="text-left">
                <th className="px-3 py-1.5 font-normal"> </th><th className="px-2 font-normal">Shown</th><th className="px-2 font-normal">Taken</th><th className="px-2 font-normal">Turned down</th><th className="px-2 font-normal">Left</th><th className="px-2 font-normal">Open</th><th className="px-2 font-normal">Accept rate</th><th className="px-2 font-normal">Regretted</th>
              </tr></thead>
              <tbody>
                {rates[dim].map((r) => (
                  <tr key={r.value} className="border-t border-[var(--border)]">
                    <td className="max-w-[12rem] truncate px-3 py-1.5" title={r.value}>{r.value}</td><td className="px-2">{r.shown}</td><td className="px-2">{r.accepted}</td><td className="px-2">{r.refused}</td><td className="px-2">{r.ignored}</td><td className="px-2">{r.open}</td><td className="px-2 font-medium">{pct(r.acceptRate)}</td><td className="px-2">{r.regretted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {reasons.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium">Why suggestions were turned down</h3>
          <ul className="text-sm">
            {reasons.map((r) => <li key={r.chip}>{REASON_LABELS[r.chip as ReasonChip] ?? r.chip}: {r.count}{r.typed ? ` (${r.typed} with a typed reason, kept private)` : ''}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
