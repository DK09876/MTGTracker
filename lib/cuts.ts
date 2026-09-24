/**
 * Cards worth looking at first when a deck needs cuts.
 *
 * Where the deck is over a role's guideline - 25 ramp against 10-12 - the
 * cards in that role the commander's decks play least come first. Then the
 * deck's least-played spells overall. "Least played" is EDHREC's share of
 * the commander's decks running the card; a card not on EDHREC's list for
 * the commander at all is rarer still, so it leads.
 *
 * These are prompts, not verdicts: a card nobody else plays may be the
 * reason the deck is yours.
 */

import type { CardStats } from './edhrec';
import type { RoleCount } from './roles';

export interface CutCard {
  name: string;
  /** Share of the commander's decks that run it; null when EDHREC does not list it. */
  inclusion: number | null;
}

export interface CutGroup {
  title: string;
  detail: string;
  cards: CutCard[];
}

const LIMIT = 8;

export function cutCandidates(
  spells: string[],
  stats: Map<string, CardStats> | null,
  roles: RoleCount[] | null,
): CutGroup[] {
  const inclusionOf = (name: string) => stats?.get(name)?.inclusion ?? stats?.get(name.split(' // ')[0])?.inclusion ?? null;
  // Least played first; unlisted before everything.
  const rank = (names: string[]) => names
    .map((name) => ({ name, inclusion: inclusionOf(name) }))
    .sort((a, b) => (a.inclusion ?? -1) - (b.inclusion ?? -1) || a.name.localeCompare(b.name));

  const groups: CutGroup[] = [];
  for (const role of roles ?? []) {
    if (!role.target || role.count <= role.target[1]) continue;
    const over = role.count - role.target[1];
    groups.push({
      title: `${role.label}: ${over} over`,
      detail: `${role.count} against a guideline of ${role.target[0]}–${role.target[1]}. The ones ${stats ? 'its decks play least' : 'to look at'} first.`,
      cards: rank(role.cards).slice(0, Math.max(over, 3)),
    });
  }
  if (stats) {
    groups.push({
      title: 'Least played with this commander',
      detail: 'Spells the fewest of its decks on EDHREC run.',
      cards: rank(spells).slice(0, LIMIT),
    });
  }
  return groups;
}
