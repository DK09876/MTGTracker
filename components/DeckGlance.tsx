'use client';

/**
 * The deck at a glance, above its cards: the state of the deck without
 * leaving the Cards tab - curve, lands against the plan, the built-in tags
 * against their ranges, colour sources, bracket, the last good-start rate.
 * Customize picks which show (remembered in this browser); each one opens
 * the tab with its detail. Everything here is read from what the other tabs
 * already work out.
 */

import { useEffect, useState } from 'react';

import type { DeckTab } from './DeckBuild';
import ManaCost from './ManaCost';
import * as api from '@/lib/api';
import type { RoleCount } from '@/lib/roles';

type WidgetId = 'curve' | 'lands' | 'ramp' | 'draw' | 'removal' | 'wipe' | 'colours' | 'bracket' | 'good' | 'avgmv' | 'price' | 'combos' | 'gamechangers';

const WIDGETS: Array<{ id: WidgetId; label: string; tab: DeckTab }> = [
  { id: 'curve', label: 'Mana curve', tab: 'health' },
  { id: 'lands', label: 'Lands', tab: 'tune' },
  { id: 'ramp', label: 'Ramp', tab: 'tune' },
  { id: 'draw', label: 'Card draw', tab: 'tune' },
  { id: 'removal', label: 'Removal', tab: 'tune' },
  { id: 'wipe', label: 'Board wipes', tab: 'tune' },
  { id: 'colours', label: 'Colour sources', tab: 'tune' },
  { id: 'bracket', label: 'Bracket', tab: 'health' },
  { id: 'good', label: 'Good start', tab: 'playtest' },
  { id: 'avgmv', label: 'Average mana value', tab: 'health' },
  { id: 'price', label: 'Price', tab: 'collection' },
  { id: 'combos', label: 'Combos', tab: 'tune' },
  { id: 'gamechangers', label: 'Game Changers', tab: 'health' },
];
const DEFAULT: WidgetId[] = ['curve', 'lands', 'ramp', 'draw', 'removal', 'colours', 'bracket', 'good'];
const KEY = 'mtg-glance';
// Playtest writes the last good-start rate here (DeckPlaytest.tsx).
export const lastGoodStartKey = (listId: string) => `mtg-goodstart:${listId}`;

function load(): WidgetId[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as WidgetId[] | null;
    return Array.isArray(v) ? v.filter((x) => WIDGETS.some((w) => w.id === x)) : DEFAULT;
  } catch { return DEFAULT; }
}

interface Props {
  listId: string;
  version: string;
  price: number;
  onTab: (tab: DeckTab) => void;
}

export default function DeckGlance({ listId, version, price, onTab }: Props) {
  const [shown, setShown] = useState<WidgetId[]>(() => (typeof window === 'undefined' ? DEFAULT : load()));
  const [editing, setEditing] = useState(false);
  const [health, setHealth] = useState(() => api.peek<api.DeckHealth>(api.paths.health(listId)) ?? null);
  const [roles, setRoles] = useState<RoleCount[] | null>(() => api.peek<{ roles: RoleCount[] }>(api.paths.roles(listId))?.roles ?? null);
  const [plan, setPlan] = useState(() => api.peek<api.DeckPlanState>(api.paths.plan(listId)) ?? null);
  const [insights, setInsights] = useState(() => api.peek<api.DeckInsights>(api.paths.insights(listId)) ?? null);
  // The last good-start rate Playtest saw, read when the strip opens.
  const [good] = useState<number | null>(() => {
    try { return (JSON.parse(localStorage.getItem(lastGoodStartKey(listId)) ?? 'null') as { share: number } | null)?.share ?? null; } catch { return null; }
  });
  const wantsInsights = shown.includes('bracket') || shown.includes('combos');

  useEffect(() => {
    let cancelled = false;
    api.deckHealth(listId).then((h) => { if (!cancelled) setHealth(h); }).catch(() => {});
    api.deckRoles(listId).then((r) => { if (!cancelled) setRoles(r); }).catch(() => {});
    api.deckPlan(listId).then((p) => { if (!cancelled) setPlan(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [listId, version]);
  // Combos and the bracket ask Commander Spellbook, which is slow: only when shown.
  useEffect(() => {
    if (!wantsInsights) return;
    let cancelled = false;
    api.deckInsights(listId).then((i) => { if (!cancelled) setInsights(i); }).catch(() => {});
    return () => { cancelled = true; };
  }, [listId, version, wantsInsights]);

  const save = (next: WidgetId[]) => { setShown(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* fine */ } };
  const h = health?.health;
  const role = (id: string) => roles?.find((r) => r.id === id);
  // The aim beside the count, the count in amber when it is outside it:
  // "34 short" read as "34 missing".
  const off = (have: number, range: [number, number] | null | undefined) => !!range && (have < range[0] || have > range[1]);
  const status = (have: number, range: [number, number] | null | undefined) =>
    !range ? null : <span className="text-xs font-normal text-[var(--muted)]">{have < range[0] ? 'low · ' : have > range[1] ? 'high · ' : ''}aim {range[0]}–{range[1]}</span>;
  const stat = (label: string, value: React.ReactNode, note?: React.ReactNode, warn = false) => (
    <span className="flex flex-col whitespace-nowrap text-xs text-[var(--muted)]">{label}<b className={`text-base font-semibold tabular-nums ${warn ? 'text-amber-300' : 'text-[var(--foreground)]'}`}>{value} {note}</b></span>
  );
  const body = (id: WidgetId): React.ReactNode => {
    switch (id) {
      case 'curve': {
        if (!h) return null;
        const max = Math.max(1, ...h.curve.map((c) => c.count));
        return (
          <span className="flex h-12 items-end gap-1" aria-label={`Mana curve: ${h.curve.map((c) => `${c.count} at ${c.label}`).join(', ')}`}>
            {h.curve.map((c) => (
              <span key={c.label} className="flex w-4 flex-col items-center gap-0.5">
                <span className="w-full rounded-t-[3px] bg-[linear-gradient(to_top,var(--c1),var(--c3))]" style={{ height: `${(c.count / max) * 34}px`, minHeight: c.count ? 2 : 0 }} title={`${c.count} at ${c.label}`} />
                <span className="text-[10px] leading-none text-[var(--muted)]">{c.label}</span>
              </span>
            ))}
          </span>
        );
      }
      case 'lands': return h ? stat('Lands', h.lands, status(h.lands, plan?.lands), off(h.lands, plan?.lands)) : null;
      case 'ramp': case 'draw': case 'removal': case 'wipe': {
        const r = role(id);
        return r ? stat(r.label, r.count, status(r.count, r.target), off(r.count, r.target)) : null;
      }
      case 'colours': {
        if (!h) return null;
        const short = h.colors.filter((c) => c.needed !== null && c.sources < c.needed - 1);
        return stat('Colours', short.length ? <span className="flex items-center gap-1 text-amber-300">{short.map((c) => <ManaCost key={c.color} cost={`{${c.color}}`} size={14} />)}<span className="text-xs font-normal">needs sources</span></span> : <span className="text-emerald-400">✓ enough</span>);
      }
      case 'bracket': return insights?.bracket ? stat('Bracket', insights.bracket.floor === 1 ? '1–2' : insights.bracket.floor) : null;
      case 'good': return good === null ? stat('Good start', <span className="text-xs font-normal text-[var(--muted)]">not tested yet</span>) : stat('Good start', `${Math.round(good * 100)}%`);
      case 'avgmv': return h ? stat('Avg mana value', h.averageMv.toFixed(2)) : null;
      case 'price': return stat('Price', `$${price.toFixed(2)}`);
      case 'combos': return insights?.combos ? stat('Combos', insights.combos.included.length, <span className="text-xs text-[var(--muted)]">{insights.combos.toAdd.length} one away</span>) : null;
      case 'gamechangers': return h ? stat('Game Changers', h.gameChangers.length) : null;
    }
  };

  return (
    // One row to swipe on a phone; wrapped on wider screens.
    <div data-tour="deck-glance" className="mt-5 flex items-end gap-x-7 gap-y-3 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]/60 px-4 py-3 [scrollbar-width:none] sm:flex-wrap">
      {shown.map((id) => {
        const w = WIDGETS.find((x) => x.id === id)!;
        const content = body(id);
        return (
          <button key={id} onClick={() => onTab(w.tab)} title={`${w.label}: open ${w.tab}`} className="shrink-0 rounded-lg text-left hover:opacity-80">
            {content ?? <span className="flex flex-col text-xs text-[var(--muted)]">{w.label}<b className="text-base font-normal">…</b></span>}
          </button>
        );
      })}
      <button onClick={() => setEditing((v) => !v)} aria-expanded={editing} className="ml-auto shrink-0 self-center rounded-full px-2.5 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]">
        {editing ? 'Done' : 'Customize'}
      </button>
      {editing && (
        <div className="flex basis-full flex-wrap gap-1.5 border-t border-dashed border-[var(--border)] pt-3">
          {WIDGETS.map((w) => (
            <label key={w.id} className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs">
              <input type="checkbox" checked={shown.includes(w.id)} onChange={(e) => save(e.target.checked ? [...shown, w.id] : shown.filter((x) => x !== w.id))} />
              {w.label}
            </label>
          ))}
          <button onClick={() => save(DEFAULT)} className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">Reset</button>
        </div>
      )}
    </div>
  );
}
