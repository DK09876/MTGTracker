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
 *   - lands far under the plan's range: LANDS_FAR_UNDER or more below its
 *     low end (33 or fewer against 37-38).
 * Everything else - job counts, colour sources, size, Game Changers - is a
 * number shown with its range, not a warning. Pure.
 */

import type { Warning } from './health';

/** How far under the low end of the land range a deck has to be before it is a warning. */
export const LANDS_FAR_UNDER = 4;

export function landsFarUnder(have: number, range: [number, number]): boolean {
  return have <= range[0] - LANDS_FAR_UNDER;
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
    out.push({ level: 'critical', title: `${n(lands.have)} lands, far under ${lands.range[0]}–${lands.range[1]}`, detail: `${n(lands.range[0] - lands.have)} under the low end of the range (warned at ${LANDS_FAR_UNDER} or more). Expect to miss land drops.` });
  }
  return out;
}
