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

import { useEffect, useMemo, useState } from 'react';

import KeepRule from './KeepRule';
import Tip from './Tip';
import ManaCost from './ManaCost';
import * as api from '@/lib/api';
import type { ListedCard } from '@/lib/db';
import { geek, seenBy } from '@/lib/geek';
import { LANDS_FAR_UNDER } from '@/lib/hard-checks';
import type { Warning } from '@/lib/health';
import type { KeepRule as KeepRuleType } from '@/lib/keep';
import { atLeast } from '@/lib/odds';
import type { Finish, ScryfallCard } from '@/lib/scryfall';
import { ROLE_GROUPS, type RoleCount, type RoleGroup } from '@/lib/roles';

// Series colour: the app's gold, stepped down into the band that reads on
// the dark surface (validated: lightness band and 3:1 contrast on #1d1a16).
// In the commander's colours (the deck page sets --c1..--c3; gold without a commander).
const SERIES = 'linear-gradient(135deg, var(--c1), var(--c3))';
const TRACK = '#3a3016';
// Status colours are fixed and only ever appear beside an icon and a label.
const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' };

interface Props {
  listId: string;
  commander: { card: ScryfallCard; finish: Finish } | null;
  /** The main board, for the Geek stats worked out here. */
  cards: ListedCard[];
  /** Changes whenever the deck does, so the numbers follow it. */
  version: string;
}

export default function DeckHealth({ listId, commander, cards, version }: Props) {
  const [data, setData] = useState<api.DeckHealth | null>(() => api.peek<api.DeckHealth>(api.paths.health(listId)) ?? null);
  const [roles, setRoles] = useState<RoleCount[] | 'loading' | 'failed'>(() => api.peek<{ roles: RoleCount[] }>(api.paths.roles(listId))?.roles ?? 'loading');
  const [insights, setInsights] = useState<api.DeckInsights | 'loading' | 'failed'>(() => api.peek<api.DeckInsights>(api.paths.insights(listId)) ?? 'loading');
  const [error, setError] = useState<string | null>(null);

  // The stored-card checks answer at once; roles and the bracket follow on their own.
  useEffect(() => {
    let cancelled = false;
    api.deckHealth(listId)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not check the deck'); });
    api.deckRoles(listId)
      .then((r) => { if (!cancelled) setRoles(r); })
      .catch(() => { if (!cancelled) setRoles('failed'); });
    api.deckInsights(listId)
      .then((i) => { if (!cancelled) setInsights(i); })
      .catch(() => { if (!cancelled) setInsights('failed'); });
    return () => { cancelled = true; };
  }, [listId, version]);

  const stats = useMemo(() => (data ? geek({
    health: data.health, cards, commander,
    roles: Array.isArray(roles) ? roles : undefined,
  }) : null), [data, cards, commander, roles]);

  if (error) return <p className="mt-8 text-center text-red-400">{error}</p>;
  if (!data) return <p className="mt-8 text-center text-[var(--muted)]">Checking the deck…</p>;
  const { health, landTarget, landCount } = data;
  const short = commander?.card.name.split(',')[0] ?? 'the commander';

  return (
    // Refetches keep the last numbers on screen rather than flashing empty.
    <div className="mt-5 flex flex-col gap-8">
      <Warnings warnings={health.warnings} />

      <div data-tour="bracket"><Bracket insights={insights} /></div>

      <WinRead insights={insights} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Cards" value={`${health.size} / 100`} />
        <Stat label="Lands" value={String(health.lands)} />
        <Stat label="Average mana value" value={health.averageMv.toFixed(2)} note="spells, commander excluded" />
        <Stat label="Game Changers" value={String(health.gameChangers.length)} />
      </div>

      <Section tour="curve" title="Mana curve" subtitle="Spells by mana value, lands and commander excluded">
        <Columns
          data={health.curve.map((b) => ({ label: b.label, value: b.count, detail: b.cards }))}
          format={(v) => String(v)}
          unit="card"
          name="Mana value"
        />
      </Section>

      <Section tour="colours" title="Colours" subtitle={`Share of the coloured symbols in spell costs, against what makes that colour`}>
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
                  {c.fetchLandSources > 0 && <> ({c.fetchLandSources} by fetching)</>}
                  {c.otherSources > 0 && <> · {c.otherSources} other source{c.otherSources === 1 ? '' : 's'}</>}
                  {c.needed !== null && (
                    <span className="block" title={`${c.neededFor} sets it: the sources to cast it on curve about 90% of the time. Lands count in full, rocks and dorks at three quarters.`}>
                      <span className="text-[var(--foreground)]">{c.sources} of {c.needed} sources</span>{' '}
                      <span>for {c.neededFor}</span>
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section tour="roles" title="Built-in tags" subtitle="How many of each kind of card, against the plan's guidelines. Tagged automatically from Scryfall.">
        <div className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
          <RoleRow label="Lands" count={landCount ?? health.lands} target={landTarget} />
          {roles === 'loading' && (
            <p className="px-4 py-3 text-sm text-[var(--muted)]">
              Tagging this deck&apos;s cards with Scryfall… The first time takes up to a minute; after that it is instant.
            </p>
          )}
          {roles === 'failed' && (
            <p className="px-4 py-3 text-sm text-[var(--muted)]">Couldn&apos;t reach Scryfall for the built-in tags — try again in a moment.</p>
          )}
          {Array.isArray(roles) && (Object.keys(ROLE_GROUPS) as RoleGroup[]).map((g) => {
            // A role the deck has none of is only worth a row if there is a guideline for it.
            const rows = roles.filter((r) => r.group === g && (r.count > 0 || r.target));
            if (!rows.length) return null;
            return (
              <div key={g}>
                <p className="bg-[var(--surface)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{ROLE_GROUPS[g]}</p>
                {rows.map((r) => <RoleRow key={r.id} label={r.label} count={r.count} target={r.target} cards={r.cards} />)}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        tour="hands"
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

      {stats && <GeekStats stats={stats} library={health.hand.library} roles={Array.isArray(roles) ? roles : []} keep={<HealthKeep listId={listId} cards={cards} version={version} />} />}
    </div>
  );
}

const pct = (p: number) => (p > 0 && p < 0.005 ? '<1%' : p > 0.995 && p < 1 ? '>99%' : `${Math.round(p * 100)}%`);
const money = (n: number) => `$${n.toFixed(2)}`;

const STRENGTH = { strong: ['Strong', '#7ccf8a'], some: ['Helps close', '#e0b64a'] } as const;

/** How the deck wins, read from its cards without a model: free, and there as soon as the roles are. */
function WinRead({ insights }: { insights: api.DeckInsights | 'loading' | 'failed' }) {
  if (insights === 'loading' || insights === 'failed' || !insights.wincons) return null;
  const { routes, missing } = insights.wincons;
  return (
    <section data-tour="win-read" className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 data-section="How it wins" className="font-display text-lg font-semibold">How it wins <span className="text-sm font-normal text-[var(--muted)]">· quick read, no AI</span></h3>
        <p className="text-xs text-[var(--muted)]">From combos, finishers and the deck&apos;s shape. Have Claude read the deck on the Plan tab for the full read.</p>
      </div>
      {routes.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {routes.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{r.label}</span>
                <span className="text-xs font-semibold" style={{ color: STRENGTH[r.strength][1] }}>{STRENGTH[r.strength][0]}</span>
              </div>
              <p className="text-sm text-[var(--muted)]">{r.how}</p>
              <p className="text-xs text-[var(--muted)]">{r.cards.slice(0, 6).join(' · ')}{r.cards.length > 6 ? ` · +${r.cards.length - 6} more` : ''}</p>
            </li>
          ))}
        </ul>
      )}
      {missing && (
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm">
          {routes.length > 0 && <span className="font-semibold text-amber-300">Thin spot: </span>}{missing}
        </p>
      )}
    </section>
  );
}

function Bracket({ insights }: { insights: api.DeckInsights | 'loading' | 'failed' }) {
  if (insights === 'loading') {
    return <p className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">Estimating the bracket with Commander Spellbook…</p>;
  }
  const bracket = insights === 'failed' ? null : insights.bracket;
  if (!bracket) {
    return <p className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">Couldn&apos;t reach Commander Spellbook for the bracket — try again in a moment.</p>;
  }
  // A caution naming the same cards as a reason above says the same thing twice.
  const shown = new Set(bracket.reasons.map((r) => [...r.cards].sort().join('|')));
  const cautions = bracket.cautions.filter((c) => !shown.has([...c.cards].sort().join('|')));
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-lg font-semibold" title={`Commander Spellbook's own scale calls it ${bracket.spellbook.label}`}>{bracket.label}</p>
      </div>
      <p className="text-sm text-[var(--muted)]">
        {bracket.floor === 1
          ? 'Nothing the bracket rules name: no Game Changers, mass land denial or two-card combos. Between 1 and 2 is down to how the deck plays.'
          : 'The lowest official bracket this list can be. The rest depends on how the deck plays.'}
      </p>
      {bracket.reasons.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {bracket.reasons.map((r) => (
            <li key={r.text}>
              <span className="font-medium">{r.text}</span>
              <span className="text-[var(--muted)]"> — {r.cards.join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
      {cautions.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {cautions.map((c) => (
            <li key={c.text} className="flex gap-2">
              <span aria-hidden className="font-bold" style={{ color: STATUS.warning }}>▲</span>
              <span><span className="sr-only">Check: </span>{c.text}<span className="text-[var(--muted)]"> — {c.cards.join(', ')}</span></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The deck in numbers, folded away by default. Everything is exact
 * hypergeometric odds from the library; the one assumption - nobody skips
 * the first draw in multiplayer - is said where it applies.
 */
function GeekStats({ stats, library, roles, keep }: { stats: ReturnType<typeof geek>; library: number; roles: RoleCount[]; keep: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <summary className="cursor-pointer font-medium">Geek stats <span className="text-sm font-normal text-[var(--muted)]">— the deck in numbers</span></summary>
      <div className="mt-4 flex flex-col gap-7">
        <GeekBlock title="Mulligans" note="Your keep rule: the lands a seven needs, and any cards it must have. Playtest mulligans by the same rule. In multiplayer the first mulligan is free.">
          {keep}
        </GeekBlock>

        <GeekBlock title="Hitting land drops" note="Chance of having played a land every turn so far. By turn N you have seen 7 + N cards: in multiplayer Commander nobody skips the first draw.">
          <Columns data={stats.landDrops.map((d) => ({ label: `T${d.turn}`, value: d.p }))} format={pct} name="Land drop on turn" />
        </GeekBlock>

        {stats.castOnCurve.length > 0 && (
          <GeekBlock title="Casting on curve" note="Each colour's hungriest spell, and the chance of having enough lands of that colour by its turn (fetch lands counted).">
            <ul className="flex flex-col gap-2 text-sm">
              {stats.castOnCurve.map((c) => (
                <li key={c.color} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ManaCost cost={`{${c.color}}`} size={16} />
                  <span className="min-w-[10rem] flex-1">{c.card}</span>
                  <span className="text-[var(--muted)]">{c.pips} {c.color} source{c.pips === 1 ? '' : 's'} by turn {c.mv}, from {c.sources}</span>
                  <span className="w-12 text-right font-semibold tabular-nums">{pct(c.p)}</span>
                </li>
              ))}
            </ul>
          </GeekBlock>
        )}

        {stats.roleOdds.length > 0 && (
          <GeekBlock title="Drawing what you need in time" note="At least one, by the turn it tends to matter.">
            <ul className="flex flex-col gap-1.5 text-sm">
              {stats.roleOdds.map((r) => (
                <li key={r.label} className="flex items-center gap-3">
                  <span className="flex-1">{r.label} <span className="text-[var(--muted)]">({r.count}) by turn {r.turn}</span></span>
                  <span className="w-12 text-right font-semibold tabular-nums">{pct(r.p)}</span>
                </li>
              ))}
            </ul>
          </GeekBlock>
        )}

        <GeekBlock title="Mana">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Coloured symbols" value={String(stats.mana.totalPips)} />
            <Stat label="Symbols per spell" value={stats.mana.pipsPerSpell.toFixed(2)} />
            <Stat label="Median mana value" value={String(stats.mana.medianMv)} />
            <Stat label="Lands in the library" value={pct(stats.mana.landRatio)} />
          </div>
        </GeekBlock>

        <GeekBlock title="Money" note="Per copy, commander included, at each card's finish.">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Total" value={money(stats.price.total)} />
            <Stat label="Median card" value={money(stats.price.median)} />
            <Stat label="Top 10 cards" value={pct(stats.price.topTenShare)} note="of the deck's value" />
          </div>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Priciest: {stats.price.top.map((t) => `${t.name} ${money(t.price)}`).join(' · ')}
          </p>
        </GeekBlock>

        <Calculator library={library} roles={roles} />
      </div>
    </details>
  );
}

function GeekBlock({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      {note && <p className="mb-2 text-xs text-[var(--muted)]">{note}</p>}
      {children}
    </div>
  );
}

/** "What are the odds of drawing at least k of these n cards by turn t?" */
function Calculator({ library, roles }: { library: number; roles: RoleCount[] }) {
  const [copies, setCopies] = useState(10);
  const [atLeastK, setAtLeastK] = useState(1);
  const [turn, setTurn] = useState(3);
  const seen = turn === 0 ? 7 : seenBy(turn);
  const valid = library >= seen && copies >= 0 && copies <= library && atLeastK >= 0;
  const p = valid ? atLeast(library, Math.min(copies, library), seen, atLeastK) : null;
  const input = 'w-16 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-right tabular-nums';
  return (
    <GeekBlock title="Odds calculator" note="Drawing without replacement from the library.">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>At least</span>
        <input type="number" min={0} max={7} value={atLeastK} onChange={(e) => setAtLeastK(Number(e.target.value))} className={input} aria-label="At least" />
        <span>of</span>
        <input type="number" min={0} max={library} value={copies} onChange={(e) => setCopies(Number(e.target.value))} className={input} aria-label="Cards in the deck" />
        <span>cards</span>
        {roles.length > 0 && (
          <select
            aria-label="Use a role's count"
            onChange={(e) => { if (e.target.value) setCopies(Number(e.target.value)); }}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1"
            defaultValue=""
          >
            <option value="">(or a built-in tag…)</option>
            {roles.map((r) => <option key={r.id} value={r.count}>{r.label} ({r.count})</option>)}
          </select>
        )}
        <span>by</span>
        <select value={turn} onChange={(e) => setTurn(Number(e.target.value))} aria-label="By turn" className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1">
          <option value={0}>the opening hand</option>
          {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>turn {i + 1}</option>)}
        </select>
      </div>
      <p className="mt-3 text-3xl font-semibold">{p === null ? '—' : pct(p)}</p>
      <p className="text-xs text-[var(--muted)]">
        {seen} cards seen from a {library}-card library with {copies} of them.
      </p>
    </GeekBlock>
  );
}

function Section({ title, subtitle, children, tour }: { title: string; subtitle?: string; children: React.ReactNode; tour?: string }) {
  return (
    <section data-tour={tour}>
      <h3 data-section={title} className="font-medium">{title}</h3>
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
        <span className="font-medium">No problems</span>
        <span className="text-[var(--muted)]">— every card legal and in the commander&apos;s colours, no extra copies, card draw in the deck, lands not far under range.</span>
        <Tip label="What counts as a problem">Only hard failures are warnings here: cards that make the deck not legal, no card draw at all, or lands {LANDS_FAR_UNDER} or more under the low end of the range. Everything else is a number with its range below: being a little outside a range is often on purpose.</Tip>
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
  // A number with its range, not a warning: under or over is often on purpose (lib/hard-checks.ts).
  // Lands can be fractional (a land on the back of a double-faced card counts as part of one).
  const by = (x: number) => Math.round(x * 10) / 10;
  const chip = status === 'ok' ? { text: 'in range' }
    : status === 'low' ? { text: `${by(target![0] - count)} under` }
    : status === 'high' ? { text: `${by(count - target![1])} over` }
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
        <span className="min-w-8 text-right text-lg font-semibold tabular-nums">{count}</span>
        <div className="relative h-2 min-w-[8rem] flex-1 rounded-full" style={{ background: TRACK }} aria-hidden>
          {target && (
            <div className="absolute inset-y-[-3px] rounded border border-[var(--muted)]/60"
              style={{ left: `${(target[0] / max) * 100}%`, width: `${((target[1] - target[0]) / max) * 100}%` }} />
          )}
          <div className="h-full rounded-full" style={{ width: `${(count / max) * 100}%`, background: SERIES }} />
        </div>
        <span className="min-w-16 text-sm text-[var(--muted)]">{target ? `${target[0]}–${target[1]}` : 'no target'}</span>
        {chip && (
          <span className="min-w-24 whitespace-nowrap text-xs text-[var(--muted)]">{chip.text}</span>
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

/** The keep rule, read and saved with the deck's playtest settings. */
function HealthKeep({ listId, cards, version }: { listId: string; cards: ListedCard[]; version: string }) {
  const [state, setState] = useState<api.PlaytestState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.deckPlaytest(listId).then((p) => { if (!cancelled) setState(p); }).catch(() => { if (!cancelled) setError('Couldn\'t read the keep rule just now.'); });
    return () => { cancelled = true; };
  }, [listId, version]);
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!state) return <p className="text-sm text-[var(--muted)]">Reading the keep rule…</p>;
  const save = async (keep: KeepRuleType) => {
    const settings = { ...state.settings, keep };
    setState({ ...state, settings });
    try { await api.savePlaytest(listId, { settings }); } catch { setError('Couldn\'t save the keep rule.'); }
  };
  return <KeepRule rule={state.settings.keep} cards={cards} cardTags={state.cardTags} tagNames={state.tagNames} mulligans={state.settings.maxMulligans} onChange={save} />;
}
