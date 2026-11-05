/**
 * Swaps and upgrades, worked out from the cards - no model.
 *
 * What a card could replace: a card in the deck doing the same job at
 * about the same cost (within one mana, so the curve doesn't creep), the
 * most replaceable first - in a job that is over its range, slower or
 * narrower, doing one job where the new card does two, off the plan, high
 * on the cut list. Protected cards (key cards, cards of the ways to win,
 * pets, ★ keeps, the commanders) are never offered, except a way-to-win
 * card against another way to win. A warning says when the card going out
 * does two jobs, or when its job would drop under its range.
 *
 * Upgrades: for jobs the deck already does, a card doing the same job
 * that is better in a way anyone can check - cheaper, instant speed, more
 * jobs, removal that hits anything.
 *
 * Pure: the caller works out roles, jobs, themes and what is protected.
 */

import { quality } from './fit';
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
  /** Its cut-list score, when the rules would offer it as a cut. */
  cutScore?: number;
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

export interface Replacement {
  out: DeckCard;
  /** Higher: more replaceable. */
  score: number;
  why: string;
  warn?: string;
  how: How;
}

const LABEL: Record<string, string> = { ramp: 'ramp', draw: 'card draw', interaction: 'interaction', protection: 'protection', recursion: 'recursion', tutor: 'tutors', finishers: 'ways to finish' };
const textOf = (c: ScryfallCard) => [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n').replace(/\([^)]*\)/g, '');
const isLand = (c: ScryfallCard) => /\bLand\b/.test((c.type_line ?? '').split('//')[0]);
const instant = (c: ScryfallCard) => /^Instant\b/.test(c.type_line ?? '') || (c.keywords ?? []).some((k) => /^flash$/i.test(k));
// Hits anything: any permanent, any target, or several modes - unless it only hits one colour (Pyroblast, Red Elemental Blast).
const flexible = (c: ScryfallCard) => /\b(target|each) (nonland )?permanent\b|\bany target\b|\bchoose (one|two)\b/i.test(textOf(c))
  && !/\btarget (white|blue|black|red|green) (spell|permanent)|\bif (it|that (spell|permanent)) is (white|blue|black|red|green)\b/i.test(textOf(c));
/** Interaction comes in kinds that don't stand in for each other: a counterspell is no board wipe. */
const KINDS = ['wipe', 'counter', 'removal'];
const kindOf = (roles: string[]) => KINDS.find((k) => roles.includes(k)) ?? null;
const cost = (c: ScryfallCard) => c.cmc ?? 0;
const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** The cards in the deck an incoming card could replace, most replaceable first. */
export function replacements(incoming: Incoming, cards: DeckCard[], jobs: JobState[], max = 3): Replacement[] {
  const jobOf = new Map(jobs.map((j) => [j.id, j]));
  const finisher = incoming.jobs.includes('finishers');
  const sameKind = (c: DeckCard) => !(incoming.jobs.includes('interaction') && c.jobs.includes('interaction')) || kindOf(c.roles) === kindOf(incoming.roles);
  const shares = (c: DeckCard) => incoming.jobs.length
    ? c.jobs.some((j) => incoming.jobs.includes(j) && (j !== 'interaction' || sameKind(c)))
    // A card with no job everyone needs is a plan card: it replaces another plan card of the same kind, or one off the plan.
    : (c.plan.some((p) => incoming.plan.includes(p)) || (!c.plan.length && !c.jobs.length));
  const eligible = (c: DeckCard, spread: number) => !isLand(c.card) && c.card.name !== incoming.card.name
    && (!c.protected || (finisher && c.route))
    && Math.abs(cost(c.card) - cost(incoming.card)) <= spread && shares(c);
  let pool = cards.filter((c) => eligible(c, 1));
  if (!pool.length) pool = cards.filter((c) => eligible(c, 2));

  const out = pool.map((c): Replacement => {
    const inputs: string[] = [];
    const steps: string[] = [];
    let score = 0;
    const same = c.jobs.filter((j) => incoming.jobs.includes(j));
    if (same.length) inputs.push(`Both do: ${list(same.map((j) => LABEL[j] ?? j))}`);
    else if (c.plan.some((p) => incoming.plan.includes(p))) inputs.push(`Both play to: ${c.plan.filter((p) => incoming.plan.includes(p)).join(', ')}`);
    else inputs.push('Neither is a job every deck needs; this one does nothing the plan asks for');
    inputs.push(`Costs: ${cost(c.card)} out, ${cost(incoming.card)} in`);
    // A job over its range: the extra is the easiest to give up.
    for (const j of c.jobs) {
      const s = jobOf.get(j);
      if (s?.range && s.count > s.range[1] && !incoming.jobs.includes(j)) { score += 1; steps.push(`${s.label} is at ${s.count}, over ${s.range[0]}–${s.range[1]}: +1`); }
      if (s?.range && s.count > s.range[1] && incoming.jobs.includes(j)) { score += 0.5; steps.push(`${s.label} is over its range, and the new card keeps the count: +0.5`); }
    }
    if (cost(c.card) > cost(incoming.card)) { score += 0.5; steps.push('Costs more than the card coming in: +0.5'); }
    if (c.roles.includes('removal') && incoming.roles.includes('removal') && flexible(incoming.card) && !flexible(c.card)) { score += 0.5; steps.push('Narrower removal than the card coming in: +0.5'); }
    if (instant(incoming.card) && !instant(c.card) && same.length) { score += 0.3; steps.push('Sorcery speed, where the new card is instant: +0.3'); }
    if (c.jobs.length < incoming.jobs.length) { score += 0.4; steps.push(`Does ${c.jobs.length || 'no'} job${c.jobs.length === 1 ? '' : 's'} where the new card does ${incoming.jobs.length}: +0.4`); }
    if (!c.plan.length) { score += 0.6; steps.push('Plays to none of the plan’s styles or themes: +0.6'); }
    if (c.cutScore) { score += Math.min(1.5, c.cutScore / 2); steps.push(`On the cut list, score ${c.cutScore}: +${Math.min(1.5, c.cutScore / 2).toFixed(1)}`); }
    // Warnings: it does two jobs, or a job drops under its range.
    const warns: string[] = [];
    if (c.jobs.length >= 2) { score -= 0.6; warns.push(`Does two jobs: ${list(c.jobs.map((j) => LABEL[j] ?? j))}`); steps.push('Does two jobs: −0.6'); }
    for (const j of c.jobs) {
      const s = jobOf.get(j);
      if (s?.range && !incoming.jobs.includes(j) && s.count - 1 < s.range[0]) { score -= 1; warns.push(`${s.label} would drop to ${s.count - 1}, under ${s.range[0]}–${s.range[1]}`); steps.push(`${s.label} would go under its range: −1`); }
    }
    if (cost(c.card) < cost(incoming.card)) warns.push(`Costs ${cost(incoming.card) - cost(c.card)} less: the curve goes up a little`);
    if (c.route) warns.push('One of the deck’s ways to win, offered because the new card is another');
    const why = [
      same.length ? `Same job (${list(same.map((j) => LABEL[j] ?? j))})` : c.plan.length ? 'Same part of the plan' : 'Off the plan',
      cost(c.card) === cost(incoming.card) ? 'same cost' : cost(c.card) > cost(incoming.card) ? `costs ${cost(c.card) - cost(incoming.card)} more` : `costs ${cost(incoming.card) - cost(c.card)} less`,
    ].join(', ') + '.';
    return { out: c, score: Math.round(score * 100) / 100, why, warn: warns.join('. ') || undefined, how: { inputs, steps: steps.length ? steps : ['Nothing makes it more or less replaceable than the rest.'] } };
  });
  return out.sort((a, b) => b.score - a.score || cost(b.out.card) - cost(a.out.card) || a.out.card.name.localeCompare(b.out.card.name)).slice(0, max);
}

export interface Upgrade {
  add: { card: ScryfallCard; roles: string[]; jobs: string[]; where: string | null };
  out: DeckCard;
  job: string;
  gain: number;
  why: string;
  how: How;
}

/**
 * Better cards for jobs the deck already does: for each card in a job, the
 * best card from the pool doing that job that costs no more and is better
 * in a way you can check. Your own copies first, then by how much better.
 */
export function upgrades(cards: DeckCard[], pool: Array<{ card: ScryfallCard; roles: string[]; jobs: string[]; where: string | null; plan?: string[] }>, jobIds: string[], perJob = 3): Upgrade[] {
  const inDeck = new Set(cards.map((c) => c.card.name));
  const used = new Set<string>();
  const out: Upgrade[] = [];
  for (const job of jobIds) {
    // Cards that play to the plan are the deck's own: not swapped for generic ones, however good.
    const mine = cards.filter((c) => c.jobs.includes(job) && !c.protected && !isLand(c.card) && !c.plan.length)
      .sort((a, b) => quality(a.card, a.roles).score - quality(b.card, b.roles).score);
    const options = pool.filter((p) => p.jobs.includes(job) && !inDeck.has(p.card.name));
    let found = 0;
    for (const c of mine) {
      if (found >= perJob) break;
      const qOut = quality(c.card, c.roles).score;
      let best: Upgrade | null = null;
      for (const p of options) {
        if (used.has(p.card.name) || cost(p.card) > cost(c.card)) continue;
        if (job === 'interaction' && kindOf(p.roles) !== kindOf(c.roles)) continue;
        const reasons: string[] = [];
        if (cost(p.card) < cost(c.card)) reasons.push(`${cost(c.card) - cost(p.card)} cheaper`);
        if (instant(p.card) && !instant(c.card)) reasons.push('instant speed');
        if (p.jobs.length > c.jobs.length) reasons.push(`does ${p.jobs.length} jobs`);
        if (job === 'interaction' && flexible(p.card) && !flexible(c.card)) reasons.push('hits anything');
        if (!reasons.length) continue;
        const gain = quality(p.card, p.roles).score - qOut + (p.where ? 0.15 : 0);
        if (gain < 0.1) continue;
        if (!best || gain > best.gain) {
          best = {
            add: p, out: c, job, gain: Math.round(gain * 100) / 100,
            why: `Same job (${LABEL[job] ?? job}): ${list(reasons)}.`,
            how: {
              inputs: [`Out: ${c.card.name}, ${cost(c.card)} mana, does ${list(c.jobs.map((j) => LABEL[j] ?? j)) || 'no listed job'}`, `In: ${p.card.name}, ${cost(p.card)} mana, does ${list(p.jobs.map((j) => LABEL[j] ?? j))}`, ...(p.where ? [`You have a copy: ${p.where}`] : [])],
              steps: [`Better at the job in ways you can check: ${list(reasons)}.`, `Card quality ${qOut.toFixed(2)} → ${quality(p.card, p.roles).score.toFixed(2)}${p.where ? ', +0.15 for a copy you own' : ''}.`],
            },
          };
        }
      }
      if (best) { out.push(best); used.add(best.add.card.name); found += 1; }
    }
  }
  return out.sort((a, b) => Number(!!b.add.where) - Number(!!a.add.where) || b.gain - a.gain);
}
