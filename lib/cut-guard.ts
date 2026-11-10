/**
 * The guards every cut list goes through, from the rules or from Claude:
 *   - never a card that is never cut (the commanders, ★ keeps, pets, key
 *     cards, the plan's protected cards);
 *   - never a land that would take the deck under the low end of its land
 *     range;
 *   - never more than the exact count asked for.
 * In the deck flow evaluation (2026-11-10) Sonnet put lands in its cuts on
 * 9 of 18 decks and once returned the wrong count; Opus did neither, but
 * code enforces it whichever model answers. The list's order is kept: the
 * first cards are the ones kept when it is clamped. Pure.
 */

export interface CutCandidate {
  name: string;
  /** A land (its front face): counted against the land floor. */
  land: boolean;
  quantity?: number;
}

export interface GuardRules {
  /** How many cards to cut at most; null for no limit (a browse list, not a cut). */
  count: number | null;
  /** Lands in the deck now, and the fewest it may have (the low end of its range). */
  lands: { have: number; floor: number };
  /** Names that are never cut, with why. */
  never: Map<string, string>;
}

export interface Guarded<T extends CutCandidate> {
  kept: T[];
  dropped: Array<{ item: T; why: string }>;
}

export function guardCuts<T extends CutCandidate>(items: T[], rules: GuardRules): Guarded<T> {
  const kept: T[] = [];
  const dropped: Guarded<T>['dropped'] = [];
  let lands = rules.lands.have;
  let cut = 0;
  const seen = new Set<string>();
  for (const item of items) {
    const n = item.quantity ?? 1;
    if (seen.has(item.name)) { dropped.push({ item, why: 'listed twice' }); continue; }
    seen.add(item.name);
    const never = rules.never.get(item.name);
    if (never) { dropped.push({ item, why: `never cut: ${never}` }); continue; }
    if (item.land && lands - n < rules.lands.floor) {
      dropped.push({ item, why: `a land: the deck would have ${lands - n}, under its ${rules.lands.floor}` });
      continue;
    }
    if (rules.count !== null && cut + n > rules.count) {
      dropped.push({ item, why: `past the ${rules.count} to cut` });
      continue;
    }
    kept.push(item);
    cut += n;
    if (item.land) lands -= n;
  }
  return { kept, dropped };
}
