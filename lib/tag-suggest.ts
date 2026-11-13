/**
 * Tags from the card data that stand out in one deck, with no AI: the Tags
 * tab's "From your cards" suggestions. The rules, in order (the 2026-11-11
 * prototype, tag-filter-prototype.py):
 *
 *   1. every tag on the deck's non-land, non-commander cards. The tags the app
 *      already reads as whole families (FAMILIES: ramp, counterspell...) count
 *      with every tag under them, and the tags inside a family are not offered
 *      on their own; every other tag counts its own cards
 *   1b. a tag that is nearly the same cards as one of the six jobs is not
 *      offered: the jobs row covers it
 *   2. on at least 2 of those cards
 *   3. not trivia (TRIVIA, TRIVIA_PREFIX: name jokes, "cycle" groupings, tags
 *      about how a card is laid out) - this list wants the owner's eye
 *   4. at least 3 times more common in the deck than across all tagged cards
 *   5. ranked by cards in the deck with it x ln(how much more common)
 *   6. walking down, a tag sharing 70% or more of its cards with a stronger
 *      kept tag is dropped (shared cards / cards in either)
 *
 * The tags behind the built-in jobs are not left out: with nothing applied
 * up front they are ordinary tags. Pure, given the counts.
 */

import { ROLES, tagSets } from './roles';

/** The tags the app's built-in roles read, each as a whole family (roles.ts). */
export const FAMILIES = new Set(ROLES.flatMap((r) => tagSets(r.tag ?? '').any));

/** Tags that say nothing about what a card does in a deck. */
export const TRIVIA = new Set(`alliteration single-english-word-name namesake-spell portmanteau fun-ruling activated-ability triggered-ability
virtual-vanilla french-vanilla virtual-french-vanilla intervening-if-clause unique-type-line cheaper-than-mv more-expensive-than-mv
additional-cost alternative-cost drawback modal single-target-instant-sorcery multiple-targets delayed-trigger symmetrical
repeatable-crime mana-value-matters name-matters utility-land out-of-color-token unique-mana-cost refund alternate-cost-life
pillage-effect charm cda-color mana-ability-with-extra-effect`.split(/\s+/).filter(Boolean));
export const TRIVIA_PREFIX = ['cycle-', 'typal-coupling', 'keyword-errata', 'tutor-creature-'];

export const MIN_CARDS = 2;
export const MIN_LIFT = 3;
export const OVERLAP = 0.7;
export const SHOWN = 5;

export interface TagSuggestion { slug: string; cards: string[]; lift: number; score: number }

const trivia = (slug: string) => TRIVIA.has(slug) || TRIVIA_PREFIX.some((p) => slug.startsWith(p));

const near = (a: string[], b: string[]) => { const B = new Set(b); return a.filter((c) => B.has(c)).length / new Set([...a, ...b]).size >= OVERLAP; };

/** Rules 2-5: the tags on enough cards, not trivia, and unusual enough here, strongest first. */
export function scoreTags(deckTags: Map<string, string[]>, totals: { cards: number; bySlug: Map<string, number> }): TagSuggestion[] {
  const by = new Map<string, string[]>();
  for (const [key, tags] of deckTags) for (const t of new Set(tags)) by.set(t, [...(by.get(t) ?? []), key]);
  const size = Math.max(1, deckTags.size);
  const scored: TagSuggestion[] = [];
  for (const [slug, cards] of by) {
    if (cards.length < MIN_CARDS || trivia(slug)) continue;
    const all = totals.bySlug.get(slug) ?? 0;
    if (!all || !totals.cards) continue;
    const lift = (cards.length / size) / (all / totals.cards);
    if (lift < MIN_LIFT) continue;
    scored.push({ slug, cards, lift, score: cards.length * Math.log(lift) });
  }
  return scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
}

/** Rules 1b and 6: drop near-copies of a job, then near-copies of a stronger tag. */
export function pickTags(scored: TagSuggestion[], jobs: string[][] = []): TagSuggestion[] {
  const kept: TagSuggestion[] = [];
  for (const s of scored) {
    if (jobs.some((j) => j.length && near(s.cards, j))) continue;
    if (!kept.some((k) => near(k.cards, s.cards))) kept.push(s);
  }
  return kept;
}

/**
 * The deck's standout tags, strongest first. A family (FAMILIES) takes in the
 * tags under it only when the family itself stands out in this deck: where
 * Counterspell does, its kinds fold into it; where Recursion does not,
 * Gives flashback stands on its own.
 *   fold(families): each non-land, non-commander card's tags, folded by those families
 *   totals(families): the same across all tagged cards
 *   jobs: the six jobs' cards, by the same keys
 */
export function standoutTags(
  fold: (families: Set<string>) => Map<string, string[]>,
  totals: (families: Set<string>) => { cards: number; bySlug: Map<string, number> },
  jobs: string[][] = [],
): TagSuggestion[] {
  const first = scoreTags(fold(FAMILIES), totals(FAMILIES));
  const standing = new Set(first.filter((s) => FAMILIES.has(s.slug) && !jobs.some((j) => j.length && near(s.cards, j))).map((s) => s.slug));
  return pickTags(scoreTags(fold(standing), totals(standing)), jobs);
}
