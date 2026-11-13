/**
 * The few things shown as warnings about a deck: hard failures only.
 *
 * Every deck used to be flagged - tuned decks averaged seven warnings and
 * "lands low" fired on 30 of 32 decks, because the land range starts at 37
 * (deck flow evaluation, 2026-11-10). Warnings that fire on every deck get
 * ignored, so only these remain:
 *   - not legal: cards outside the colours, extra copies, banned or not
 *     legal cards (health.ts deckFlags);
 *   - no card draw at all;
 *   - lands far under: LANDS_FAR_UNDER or more below the low end of the
 *     plan's range or 37, whichever is lower (33 or fewer for most decks).
 * Everything else - job counts, colour sources, size, Game Changers - is a
 * number shown with its range, not a warning. Pure.
 */

import type { Warning } from './health';

/** How far under the low end of the land range a deck has to be before it is a warning. */
export const LANDS_FAR_UNDER = 4;

/**
 * The land count the far-under line is measured from: the low end of the
 * range, but never above 37. The formula's range reaches 41-42 on high-curve
 * decks, which flagged a precon at 37 lands.
 */
export const LAND_REFERENCE_CAP = 37;
export const landReference = (range: [number, number]) => Math.min(LAND_REFERENCE_CAP, range[0]);

/** The fewest lands before a deck counts as far under: 33 for any range starting at 37 or more. */
export const farUnderLine = (range: [number, number]) => landReference(range) - LANDS_FAR_UNDER;

export function landsFarUnder(have: number, range: [number, number]): boolean {
  return have <= farUnderLine(range);
}

export interface HardInput {
  lands: { have: number; range: [number, number] } | null;
  /** Card draw as the jobs count it; null when not known yet. */
  draw: number | null;
  /** The deck is far enough along for counts to mean something (90+ cards). */
  nearlyBuilt: boolean;
}

/** The warnings beyond legality: no draw, lands far under. A half-built deck gets neither. */
export function hardWarnings({ lands, draw, nearlyBuilt }: HardInput): Warning[] {
  if (!nearlyBuilt) return [];
  const out: Warning[] = [];
  if (draw === 0) out.push({ level: 'critical', title: 'No card draw', detail: 'Nothing in the deck draws more than one card. Without draw the deck runs out of cards by the middle of the game.' });
  if (lands && landsFarUnder(lands.have, lands.range)) {
    // Lands on the back of a double-faced card count as part of one (36.38): shown to one decimal place.
    const n = (x: number) => String(Math.round(x * 10) / 10);
    out.push({ level: 'critical', title: `${n(lands.have)} lands, far under ${lands.range[0]}–${lands.range[1]}`, detail: `${n(landReference(lands.range) - lands.have)} under ${landReference(lands.range)} (warned at ${LANDS_FAR_UNDER} or more under the low end of the range, or 37 if that is lower). Expect to miss land drops.` });
  }
  return out;
}
