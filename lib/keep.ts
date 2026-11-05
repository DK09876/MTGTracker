/**
 * A deck's keep rule: which opening sevens it keeps. A land range, plus any
 * number of "at least N cards tagged X" - built-in tags (ramp, card
 * advantage) or the owner's. Health shows how often a seven passes it;
 * Playtest mulligans by it. Pure, so the page works it out itself.
 *
 * With only the land range the odds are exact (the hypergeometric); with
 * more conditions, which can overlap, they are counted over 20,000 dealt
 * hands and said to be.
 */

import { choose } from './odds';

export interface KeepNeed { tag: string; atLeast: number }
export interface KeepRule { lands: [number, number]; needs: KeepNeed[] }

export const DEFAULT_KEEP: KeepRule = { lands: [2, 5], needs: [] };

/** What the rule needs to know about a card. */
export interface KeepCard { land: boolean; tags: string[] }

export function keeps(hand: KeepCard[], rule: KeepRule): boolean {
  const lands = hand.filter((c) => c.land).length;
  if (lands < rule.lands[0] || lands > rule.lands[1]) return false;
  return rule.needs.every((n) => hand.filter((c) => c.tags.includes(n.tag)).length >= n.atLeast);
}

export function describeKeep(rule: KeepRule): string {
  const lands = rule.lands[0] === rule.lands[1] ? `${rule.lands[0]} lands` : `${rule.lands[0]}–${rule.lands[1]} lands`;
  return [lands, ...rule.needs.map((n) => `${n.atLeast} ${n.tag}`)].join(' + ');
}

export function cleanKeep(raw: unknown): KeepRule {
  const r = (raw ?? {}) as Partial<KeepRule>;
  const lo = Number(r.lands?.[0]), hi = Number(r.lands?.[1]);
  const lands: [number, number] = Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && hi <= 7 && lo <= hi ? [lo, hi] : DEFAULT_KEEP.lands;
  const needs = (Array.isArray(r.needs) ? r.needs : [])
    .filter((n): n is KeepNeed => !!n && typeof n.tag === 'string' && n.tag.trim() !== '' && Number.isInteger(n.atLeast) && n.atLeast >= 1 && n.atLeast <= 7)
    .slice(0, 6)
    .map((n) => ({ tag: n.tag.trim().slice(0, 80), atLeast: n.atLeast }));
  return { lands, needs };
}

/** A small seeded generator, so the counted odds do not wobble between looks. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** How often a seven from this deck passes the rule: exact when it can be. */
export function keepOdds(deck: KeepCard[], rule: KeepRule, hands = 20_000): { odds: number; exact: boolean } {
  const N = deck.length;
  if (N < 7) return { odds: 0, exact: true };
  if (!rule.needs.length) {
    const L = deck.filter((c) => c.land).length;
    let p = 0;
    for (let k = rule.lands[0]; k <= rule.lands[1]; k++) p += (choose(L, k) * choose(N - L, 7 - k)) / choose(N, 7);
    return { odds: p, exact: true };
  }
  const rand = rng(7);
  const idx = deck.map((_, i) => i);
  let ok = 0;
  for (let h = 0; h < hands; h++) {
    // A partial shuffle: just the first seven.
    for (let i = 0; i < 7; i++) { const j = i + Math.floor(rand() * (N - i)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    if (keeps(idx.slice(0, 7).map((i) => deck[i]), rule)) ok += 1;
  }
  return { odds: ok / hands, exact: false };
}

/** After up to `mulligans` more looks (London: each a fresh seven). */
export const withMulligans = (odds: number, mulligans: number) => 1 - (1 - odds) ** (mulligans + 1);
