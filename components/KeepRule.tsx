'use client';

/**
 * The deck's keep rule: which opening sevens it keeps - a land range, plus
 * "at least N cards tagged X". Health shows how often a seven passes it;
 * Playtest mulligans by it; both edit the same rule. The odds are worked
 * out here: exactly for lands alone, counted over 20,000 hands otherwise.
 */

import { useMemo, useState } from 'react';

import Tip from './Tip';
import type { ListedCard } from '@/lib/db';
import { keepOdds, withMulligans, type KeepRule as Rule } from '@/lib/keep';

interface Props {
  rule: Rule;
  /** The main board, the commander left out (it is not dealt). */
  cards: ListedCard[];
  cardTags: Record<string, string[]>;
  tagNames: string[];
  /** Mulligans the deck takes, for the "after mulligans" odds. */
  mulligans: number;
  onChange: (rule: Rule) => void;
  disabled?: boolean;
}

const isLand = (type: string | undefined) => /\bLand\b/.test((type ?? '').split('//')[0]);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const select = 'rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1';

export default function KeepRule({ rule, cards, cardTags, tagNames, mulligans, onChange, disabled }: Props) {
  const [adding, setAdding] = useState(tagNames.find((t) => t === 'Ramp') ?? tagNames[0] ?? '');
  const deck = useMemo(() => cards.flatMap((c) => Array.from({ length: c.quantity }, () => ({ land: isLand(c.card.type_line), tags: cardTags[c.card.name] ?? [] }))), [cards, cardTags]);
  const odds = useMemo(() => keepOdds(deck, rule), [deck, rule]);
  const lands = deck.filter((c) => c.land).length;

  return (
    <div data-tour="keep-rule" className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span>Keep a seven with</span>
        <select aria-label="Fewest lands" value={rule.lands[0]} disabled={disabled} className={select}
          onChange={(e) => { const lo = Number(e.target.value); onChange({ ...rule, lands: [lo, Math.max(lo, rule.lands[1])] }); }}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n}>{n}</option>)}
        </select>
        <span>to</span>
        <select aria-label="Most lands" value={rule.lands[1]} disabled={disabled} className={select}
          onChange={(e) => { const hi = Number(e.target.value); onChange({ ...rule, lands: [Math.min(hi, rule.lands[0]), hi] }); }}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n}>{n}</option>)}
        </select>
        <span>lands</span>
        <Tip label="About the keep rule">
          Most players keep two to five lands. A rule that asks for more - a ramp card, a card from your key theme - keeps fewer sevens but better ones;
          the odds below show what that costs. Playtest mulligans by this same rule.
        </Tip>
      </div>
      {rule.needs.map((n, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span>and at least</span>
          <select aria-label="How many" value={n.atLeast} disabled={disabled} className={select}
            onChange={(e) => onChange({ ...rule, needs: rule.needs.map((x, j) => (j === i ? { ...x, atLeast: Number(e.target.value) } : x)) })}>
            {[1, 2, 3].map((k) => <option key={k}>{k}</option>)}
          </select>
          <span>card tagged</span>
          <select aria-label="Tag" value={n.tag} disabled={disabled} className={select}
            onChange={(e) => onChange({ ...rule, needs: rule.needs.map((x, j) => (j === i ? { ...x, tag: e.target.value } : x)) })}>
            {[...new Set([n.tag, ...tagNames])].map((t) => <option key={t}>{t}</option>)}
          </select>
          <button type="button" disabled={disabled} onClick={() => onChange({ ...rule, needs: rule.needs.filter((_, j) => j !== i) })} aria-label="Remove this condition" className="text-[var(--muted)] hover:text-red-400">×</button>
        </div>
      ))}
      {tagNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Tag to add" value={adding} disabled={disabled} onChange={(e) => setAdding(e.target.value)} className={select}>
            {tagNames.map((t) => <option key={t}>{t}</option>)}
          </select>
          <button type="button" disabled={disabled || !adding} onClick={() => onChange({ ...rule, needs: [...rule.needs, { tag: adding, atLeast: 1 }] })}
            className="rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--surface-hover)]">＋ Also need a card tagged this</button>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[10rem] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <span className="text-xs text-[var(--muted)]">A seven passes</span>
          <span className="text-xl font-semibold tabular-nums">{pct(odds.odds)}</span>
          <span className="text-xs text-[var(--muted)]">{odds.exact ? `exact, ${lands} lands in ${deck.length}` : 'counted over 20,000 hands'}</span>
        </div>
        <div className="flex min-w-[10rem] flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <span className="text-xs text-[var(--muted)]">Within {mulligans} mulligan{mulligans === 1 ? '' : 's'}</span>
          <span className="text-xl font-semibold tabular-nums">{pct(withMulligans(odds.odds, mulligans))}</span>
          <span className="text-xs text-[var(--muted)]">London, a fresh seven each time</span>
        </div>
      </div>
    </div>
  );
}
