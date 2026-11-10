/**
 * Same-job lookup, worked out from the cards - no model, no ranking.
 *
 * Pure: the caller works out roles, jobs, themes and what is protected.
 */

import type { ScryfallCard } from './scryfall';
import type { How } from './tune-shared';

export interface DeckCard {
  card: ScryfallCard;
  quantity: number;
  /** Built-in roles (roles.ts). */
  roles: string[];
  /** The jobs every deck needs that it fills (deck-numbers.ts jobsOf). */
  jobs: string[];
  /** The plan's styles and themes it plays to, by label. */
  plan: string[];
  /** Why it is never cut, when it is protected. */
  protected?: string | null;
  /** On a way to win. */
  route?: boolean;
}

export interface JobState {
  id: string;
  label: string;
  count: number;
  range: [number, number] | null;
}

export interface Incoming {
  card: ScryfallCard;
  roles: string[];
  jobs: string[];
  plan: string[];
}

export interface SameJob {
  out: DeckCard;
  why: string;
  warn?: string;
  how: How;
}

const LABEL: Record<string, string> = { ramp: 'ramp', draw: 'card draw', interaction: 'interaction', protection: 'protection', recursion: 'recursion', tutor: 'tutors', finishers: 'ways to finish' };
const isLand = (c: ScryfallCard) => /\bLand\b/.test((c.type_line ?? '').split('//')[0]);
/** Interaction comes in kinds that don't stand in for each other: a counterspell is no board wipe. */
const KINDS = ['wipe', 'counter', 'removal'];
const kindOf = (roles: string[]) => KINDS.find((k) => roles.includes(k)) ?? null;
const cost = (c: ScryfallCard) => c.cmc ?? 0;
const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * Cards in the deck doing the same job as a card you might add, at about the
 * same cost (within one mana; two if nothing is that close). A lookup, not a
 * recommendation: there is no score and no claim that the swap is better.
 * When ranked by rules, three in four such swaps made decks worse (deck flow
 * evaluation, 2026-11-10), so the order is only the closest cost first, then
 * the name. Protected cards are never listed, except a way to win against
 * another way to win. Warnings are facts: the card going out does two jobs,
 * or its job would drop under its range.
 */
export function sameJob(incoming: Incoming, cards: DeckCard[], jobs: JobState[], max = 3): SameJob[] {
  const jobOf = new Map(jobs.map((j) => [j.id, j]));
  const finisher = incoming.jobs.includes('finishers');
  const sameKind = (c: DeckCard) => !(incoming.jobs.includes('interaction') && c.jobs.includes('interaction')) || kindOf(c.roles) === kindOf(incoming.roles);
  const shares = (c: DeckCard) => incoming.jobs.length
    ? c.jobs.some((j) => incoming.jobs.includes(j) && (j !== 'interaction' || sameKind(c)))
    // A card with no job everyone needs is a plan card: it matches another plan card of the same kind.
    : c.plan.some((p) => incoming.plan.includes(p));
  const eligible = (c: DeckCard, spread: number) => !isLand(c.card) && c.card.name !== incoming.card.name
    && (!c.protected || (finisher && c.route))
    && Math.abs(cost(c.card) - cost(incoming.card)) <= spread && shares(c);
  let pool = cards.filter((c) => eligible(c, 1));
  if (!pool.length) pool = cards.filter((c) => eligible(c, 2));

  const out = pool.map((c): SameJob => {
    const same = c.jobs.filter((j) => incoming.jobs.includes(j));
    const inputs = [
      same.length ? `Both do: ${list(same.map((j) => LABEL[j] ?? j))}` : `Both play to: ${c.plan.filter((p) => incoming.plan.includes(p)).join(', ')}`,
      `Costs: ${cost(c.card)} out, ${cost(incoming.card)} in`,
    ];
    const warns: string[] = [];
    if (c.jobs.length >= 2) warns.push(`Does two jobs: ${list(c.jobs.map((j) => LABEL[j] ?? j))}`);
    for (const j of c.jobs) {
      const s = jobOf.get(j);
      if (s?.range && !incoming.jobs.includes(j) && s.count - 1 < s.range[0]) warns.push(`${s.label} would drop to ${s.count - 1}, under ${s.range[0]}–${s.range[1]}`);
    }
    if (c.route) warns.push('One of the deck’s ways to win, listed because the new card is another');
    const why = [
      same.length ? `Same job (${list(same.map((j) => LABEL[j] ?? j))})` : `Both play to ${list(c.plan.filter((p) => incoming.plan.includes(p)))}`,
      cost(c.card) === cost(incoming.card) ? 'same cost' : cost(c.card) > cost(incoming.card) ? `costs ${cost(c.card) - cost(incoming.card)} more` : `costs ${cost(incoming.card) - cost(c.card)} less`,
    ].join(', ') + '.';
    return { out: c, why, warn: warns.join('. ') || undefined, how: { inputs, steps: ['Listed because it does the same job at about the same cost. Not ranked: whether the swap helps is your call.'] } };
  });
  const gap = (r: SameJob) => Math.abs(cost(r.out.card) - cost(incoming.card));
  return out.sort((a, b) => gap(a) - gap(b) || a.out.card.name.localeCompare(b.out.card.name)).slice(0, max);
}
