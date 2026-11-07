/**
 * Arrow keys in a pick-one list: which row is highlighted after a key, and
 * whether Enter may pick. Shared by the commander picker and the add box so
 * both move the same way.
 */

/** The highlighted row after an arrow key; wraps at either end. -1 means none. */
export function moveHighlight(key: string, index: number, count: number): number {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
  if (key === 'ArrowUp') return index <= 0 ? count - 1 : index - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return index;
}

/**
 * The row Enter picks, or null while the results on screen belong to an older
 * search (picking then would choose something the person didn't type).
 */
export function enterPick(typed: string, resultsFor: string, index: number, count: number): number | null {
  if (!count || typed.trim().toLowerCase() !== resultsFor.trim().toLowerCase()) return null;
  return index >= 0 && index < count ? index : 0;
}
