/**
 * The cut review's shapes and small rules, safe for the browser: the review
 * itself (lib/cut-review.ts) reads the database.
 */

export type Tier = 'S' | 'A' | 'B' | 'C';
export const TIERS: Tier[] = ['S', 'A', 'B', 'C'];
export type ReviewMode = 'top' | 'whole';

export interface ReviewItem {
  name: string;
  verdict: 'cut' | 'keep' | 'unsure';
  why: string;
  /** Whole-deck reviews: the card's tier. */
  tier?: Tier;
  /** The owner disagreed: the tier before, and their reason. */
  disputed?: { from: Tier | null; reason: string };
}

export interface CutReview {
  at: string;
  model: string;
  instructions: string;
  /** How many cards the deck needed to lose when it was asked. */
  over: number;
  items: ReviewItem[];
  /** Old reviews have neither: they were 'top' over 30 cards. */
  mode?: ReviewMode;
}

/** What a tier means for cutting: S and A stay, C is the first to go. */
export const verdictOfTier = (t: Tier): ReviewItem['verdict'] => (t === 'C' ? 'cut' : t === 'B' ? 'unsure' : 'keep');

/** How many of the list's top cards a quick review reads: about twice what the deck is over, 20 to 60. */
export const reviewSize = (over: number) => Math.max(20, Math.min(60, over * 2));
