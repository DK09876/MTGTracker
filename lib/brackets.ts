/**
 * Game Changers against the bracket a deck aims for: brackets 1 and 2 allow
 * none, bracket 3 up to three, and 4 and 5 any number. Pure.
 */

/** How many Game Changers a bracket allows; null when no bracket is set. */
export function gameChangerLimit(bracket: number | null): number | null {
  if (bracket === null) return null;
  return bracket <= 2 ? 0 : bracket === 3 ? 3 : Infinity;
}

export const BRACKETS: Record<number, string> = {
  1: 'Exhibition: themes first, no Game Changers',
  2: 'Core: like a precon, no Game Changers',
  3: 'Upgraded: up to three Game Changers',
  4: 'Optimized: anything goes but cEDH',
  5: 'cEDH: built to win fast',
};

/** "2 Game Changers, bracket 3 allows 3", and whether that is too many. */
export function gameChangerLine(count: number, bracket: number | null): { text: string; over: boolean } {
  const limit = gameChangerLimit(bracket);
  const many = `${count} Game Changer${count === 1 ? '' : 's'}`;
  if (limit === null) return { text: `${many}. Set the bracket you're aiming for on Plan to check it.`, over: false };
  if (limit === Infinity) return { text: `${many}, bracket ${bracket} allows any number`, over: false };
  return { text: `${many}, bracket ${bracket} allows ${limit === 0 ? 'none' : limit}`, over: count > limit };
}
