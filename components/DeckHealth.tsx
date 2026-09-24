'use client';

/**
 * A deck at a glance: what is wrong with it, its curve, whether the lands
 * make the colours the spells ask for, how many of each role it runs
 * against common guidelines, and how its opening hands come out.
 *
 * Charts follow one set of rules: a single series in one colour, thin
 * columns with rounded tops on a shared baseline, the value on each column,
 * a tooltip on hover and focus, and a table view. Status is always an icon
 * and a word, never colour alone.
 */

import { useEffect, useState } from 'react';

import ManaCost from './ManaCost';
import * as api from '@/lib/api';
import type { Warning } from '@/lib/health';
import type { RoleCount } from '@/lib/roles';

// Series colour: the app's gold, stepped down into the band that reads on
// the dark surface (validated: lightness band and 3:1 contrast on #1d1a16).
const SERIES = '#b38f1f';
const TRACK = '#3a3016';
// Status colours are fixed and only ever appear beside an icon and a label.
const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' };

interface Props {
  listId: string;
  commander: string | null;
  /** Changes whenever the deck does, so the numbers follow it. */
  version: string;
  onSelectCard?: (name: string) => void;
}

export default function DeckHealth({ listId, commander, version }: Props) {
  const [data, setData] = useState<api.DeckHealth | null>(null);
  const [roles, setRoles] = useState<RoleCount[] | 'loading' | 'failed'>('loading');
  const [error, setError] = useState<string | null>(null);

  // The stored-card checks answer at once; role counts follow on their own.
  useEffect(() => {
    let cancelled = false;
    api.deckHealth(listId)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not check the deck'); });
    api.deckRoles(listId)
      .then((r) => { if (!cancelled) setRoles(r); })
      .catch(() => { if (!cancelled) setRoles('failed'); });
    return () => { cancelled = true; };
  }, [listId, version]);

  if (error) return <p className="mt-8 text-center text-red-400">{error}</p>;
  if (!data) return <p className="mt-8 text-center text-[var(--muted)]">Checking the deck…</p>;
  const { health, landTarget } = data;
  const short = commander?.split(',')[0] ?? 'the commander';

  return (
    // Refetches keep the last numbers on screen rather than flashing empty.
    <div className="mt-5 flex flex-col gap-8">
      <Warnings warnings={health.warnings} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Cards" value={`${health.size} / 100`} />
        <Stat label="Lands" value={String(health.lands)} />
        <Stat label="Average mana value" value={health.averageMv.toFixed(2)} note="spells, commander excluded" />
        <Stat label="Game Changers" value={String(health.gameChangers.length)} />
      </div>

      <Section title="Mana curve" subtitle="Spells by mana value, lands and commander excluded">
        <Columns
          data={health.curve.map((b) => ({ label: b.label, value: b.count, detail: b.cards }))}
          format={(v) => String(v)}
          unit="card"
          name="Mana value"
        />
      </Section>

      <Section title="Colours" subtitle={`Share of the coloured symbols in spell costs, against what makes that colour`}>
        {health.colors.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No coloured costs yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {health.colors.map((c) => (
              <div key={c.color} className="grid grid-cols-[1.5rem_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[1.5rem_minmax(8rem,1fr)_auto]">
                <ManaCost cost={`{${c.color}}`} size={18} />
                <Meter share={c.share} label={`${Math.round(c.share * 100)}% of coloured symbols`} />
                <p className="col-start-2 text-sm text-[var(--muted)] sm:col-start-3">
                  <span className="text-[var(--foreground)]">{Math.round(c.share * 100)}%</span> of symbols ·{' '}
                  <span className="text-[var(--foreground)]">{c.landSources}</span> land{c.landSources === 1 ? '' : 's'}
                  {c.otherSources > 0 && <> · {c.otherSources} other source{c.otherSources === 1 ? '' : 's'}</>}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Roles" subtitle="How many of each kind of card, against common Commander guidelines. Tags from Scryfall.">
        <div className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          <RoleRow label="Lands" count={health.lands} target={landTarget} />
          {roles === 'loading' && (
            <p className="px-4 py-3 text-sm text-[var(--muted)]">
              Tagging this deck&apos;s cards with Scryfall… The first time takes a few seconds; after that it is instant.
            </p>
          )}
          {roles === 'failed' && (
            <p className="px-4 py-3 text-sm text-[var(--muted)]">Couldn&apos;t reach Scryfall for the role tags — try again in a moment.</p>
          )}
          {Array.isArray(roles) && roles.map((r) => <RoleRow key={r.id} label={r.label} count={r.count} target={r.target} cards={r.cards} />)}
        </div>
      </Section>

      <Section
        title="Opening hands"
        subtitle={`Seven cards from the ${health.hand.library}-card library (the deck without ${short})`}
      >
        {health.hand.library < 7 ? (
          <p className="text-sm text-[var(--muted)]">Not enough cards to draw a hand yet.</p>
        ) : (
          <>
            <p className="text-3xl font-semibold">{Math.round(health.hand.twoToFour * 100)}%</p>
            <p className="text-sm text-[var(--muted)]">
              of opening hands have 2–4 lands · {health.hand.averageLands.toFixed(1)} lands on average
            </p>
            <div className="mt-4">
              <Columns
                data={health.hand.distribution.map((p, k) => ({ label: String(k), value: p }))}
                format={(v) => (v < 0.005 && v > 0 ? '<1%' : `${Math.round(v * 100)}%`)}
                name="Lands in hand"
              />
            </div>
          </>
        )}
      </Section>

      <Section title="Card types" subtitle="The 99, by main type">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {health.types.map((t) => <Stat key={t.label} label={t.label} value={String(t.count)} />)}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-medium">{title}</h3>
      {subtitle && <p className="mb-3 text-sm text-[var(--muted)]">{subtitle}</p>}
      {children}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {note && <p className="text-xs text-[var(--muted)]">{note}</p>}
    </div>
  );
}

const LEVEL = {
  critical: { icon: '✕', label: 'Problem', color: STATUS.critical },
  warning: { icon: '▲', label: 'Check', color: STATUS.warning },
  info: { icon: 'i', label: 'Note', color: 'var(--muted)' },
} as const;

function Warnings({ warnings }: { warnings: Warning[] }) {
  if (!warnings.length) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
        <span aria-hidden className="font-bold" style={{ color: STATUS.good }}>✓</span>
        <span className="font-medium">Legal and complete</span>
        <span className="text-[var(--muted)]">— 100 cards, all in the commander&apos;s colours, no duplicates or bans.</span>
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {warnings.map((w) => {
        const level = LEVEL[w.level];
        return (
          <li key={w.title} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold" style={{ color: level.color, border: `1.5px solid ${level.color}` }}>
                {level.icon}
              </span>
              <span className="sr-only">{level.label}:</span>
              <span className="font-medium">{w.title}</span>
              {w.detail && <span className="text-[var(--muted)]">{w.detail}</span>}
            </p>
            {w.cards && w.cards.length > 0 && <p className="mt-1 pl-7 text-[var(--muted)]">{w.cards.join(', ')}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function Meter({ share, label }: { share: number; label: string }) {
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full" style={{ background: TRACK }}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, background: SERIES }} />
    </div>
  );
}

function RoleRow({ label, count, target, cards }: { label: string; count: number; target: [number, number] | null; cards?: string[] }) {
  const [open, setOpen] = useState(false);
  const status = !target ? null : count < target[0] ? 'low' : count > target[1] ? 'high' : 'ok';
  const chip = status === 'ok'
    ? { icon: '✓', text: 'In range', color: STATUS.good }
    : status === 'low' ? { icon: '▲', text: `${target![0] - count} short`, color: STATUS.warning }
    : status === 'high' ? { icon: '●', text: `${count - target![1]} over`, color: 'var(--muted)' }
    : null;
  // The scale runs a little past the top of the range, so both under and
  // over read. A role with no target gets a fixed scale, so one card does
  // not fill the bar.
  const max = Math.max(count, target ? Math.ceil(target[1] * 1.4) : 10, 1);
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          onClick={() => cards?.length && setOpen((o) => !o)}
          className={`w-40 text-left text-sm ${cards?.length ? 'hover:text-[var(--accent)]' : ''}`}
          aria-expanded={cards?.length ? open : undefined}
        >
          {label}
        </button>
        <span className="w-8 text-right text-lg font-semibold tabular-nums">{count}</span>
        <div className="relative h-2 min-w-[8rem] flex-1 rounded-full" style={{ background: TRACK }} aria-hidden>
          {target && (
            <div className="absolute inset-y-[-3px] rounded border border-[var(--muted)]/60"
              style={{ left: `${(target[0] / max) * 100}%`, width: `${((target[1] - target[0]) / max) * 100}%` }} />
          )}
          <div className="h-full rounded-full" style={{ width: `${(count / max) * 100}%`, background: SERIES }} />
        </div>
        <span className="w-16 text-sm text-[var(--muted)]">{target ? `${target[0]}–${target[1]}` : 'no target'}</span>
        {chip && (
          <span className="flex w-24 items-center gap-1.5 text-xs">
            <span aria-hidden className="font-bold" style={{ color: chip.color }}>{chip.icon}</span>
            {chip.text}
          </span>
        )}
      </div>
      {open && cards && <p className="mt-2 text-sm text-[var(--muted)]">{cards.join(', ')}</p>}
    </div>
  );
}

/**
 * A single-series column chart: columns at most 24px wide with a 4px
 * rounded top and a square foot on a hairline baseline, the value on each
 * cap, and a tooltip on hover or keyboard focus. A table view sits below.
 */
function Columns({ data, format, unit, name }: {
  data: Array<{ label: string; value: number; detail?: string[] }>;
  format: (v: number) => string;
  unit?: string;
  name: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const HEIGHT = 140;

  return (
    <div>
      <div className="relative" onMouseLeave={() => setActive(null)}>
        <div className="flex items-end gap-2 border-b border-[var(--border)] px-1" style={{ height: HEIGHT + 22 }}>
          {data.map((d, i) => {
            const h = d.value ? Math.max(3, (d.value / max) * HEIGHT) : 0;
            return (
              <button
                key={d.label}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${name} ${d.label}: ${format(d.value)}${unit ? ` ${unit}${d.value === 1 ? '' : 's'}` : ''}`}
                // The hit area is the whole slot, not just the painted column.
                className="flex h-full flex-1 flex-col items-center justify-end outline-none"
              >
                {d.value > 0 && <span className="mb-1 text-xs tabular-nums text-[var(--muted)]">{format(d.value)}</span>}
                <span
                  className="block w-full max-w-[24px] transition-opacity"
                  style={{ height: h, background: SERIES, borderRadius: '4px 4px 0 0', opacity: active === null || active === i ? 1 : 0.55 }}
                />
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 px-1 pt-1">
          {data.map((d) => <span key={d.label} className="flex-1 text-center text-xs tabular-nums text-[var(--muted)]">{d.label}</span>)}
        </div>
        {active !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 max-w-xs rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs shadow-lg"
            style={{ left: `min(calc(${((active + 0.5) / data.length) * 100}% + 12px), calc(100% - 14rem))` }}
          >
            <p className="text-sm font-semibold">
              {format(data[active].value)}{unit ? ` ${unit}${data[active].value === 1 ? '' : 's'}` : ''}
            </p>
            <p className="text-[var(--muted)]">{name} {data[active].label}</p>
            {data[active].detail && data[active].detail!.length > 0 && (
              <p className="mt-1 text-[var(--muted)]">
                {data[active].detail!.slice(0, 8).join(', ')}{data[active].detail!.length > 8 ? `, +${data[active].detail!.length - 8} more` : ''}
              </p>
            )}
          </div>
        )}
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-[var(--muted)] hover:text-[var(--foreground)]">Show as table</summary>
        <table className="mt-2 w-full max-w-sm text-left tabular-nums">
          <thead><tr className="text-[var(--muted)]"><th className="font-normal">{name}</th><th className="font-normal">Value</th></tr></thead>
          <tbody>
            {data.map((d) => <tr key={d.label}><td>{d.label}</td><td>{format(d.value)}</td></tr>)}
          </tbody>
        </table>
      </details>
    </div>
  );
}
