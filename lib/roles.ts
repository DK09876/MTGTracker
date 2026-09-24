/**
 * What each card in a deck does - ramp, card advantage, removal, board
 * wipes, tutors - and how many of each the deck runs.
 *
 * Roles come from Scryfall's community tags (otag:ramp and so on), which
 * are better than anything guessed from rules text. They are not part of a
 * card's own record, so they are looked up in batches - "which of these
 * thirty cards are tagged ramp?" - and saved, so a deck is only looked up
 * once and a card seen in one deck is known in every other.
 */

import { exactName } from './syntax';
import type { ScryfallCard, SearchResult } from './scryfall';
import { primaryType } from './deckview';

export interface Role {
  id: string;
  label: string;
  /** The Scryfall search that finds cards in this role. */
  tag: string;
  /** A common guideline for a Commander deck, as a range - or none. */
  target: [number, number] | null;
}

// Guideline ranges most Commander deckbuilding advice lands near; they are
// a starting point, and a deck's plan may want more or fewer of any.
//
// Scryfall's tags are broader than deckbuilders mean: otag:tutor includes
// every land-fetcher (Cultivate, Evolving Wilds) and otag:card-advantage
// the cycling lands. Lands are counted as lands, and land-fetching as ramp.
export const ROLES: Role[] = [
  { id: 'ramp', label: 'Ramp', tag: 'otag:ramp -t:land', target: [10, 12] },
  { id: 'draw', label: 'Card advantage', tag: 'otag:card-advantage -t:land', target: [10, 12] },
  { id: 'removal', label: 'Targeted removal', tag: 'otag:spot-removal -t:land', target: [8, 12] },
  { id: 'wipe', label: 'Board wipes', tag: 'otag:board-wipe -t:land', target: [2, 4] },
  { id: 'tutor', label: 'Tutors', tag: 'otag:tutor -otag:ramp -t:land', target: null },
];

/**
 * Bumped whenever a role's search changes, so saved answers from the old
 * definition are looked up again rather than trusted.
 */
export const ROLES_VERSION = 2;

export const LAND_TARGET: [number, number] = [35, 38];

const QUERY_BUDGET = 950;
// Looked-up roles are trusted for a month; Scryfall's tags change slowly.
const FRESH_DAYS = 30;

export interface RoleCount extends Omit<Role, 'tag'> {
  count: number;
  cards: string[];
}

export interface Deps {
  search: (query: string) => Promise<SearchResult>;
  cached: (oracleIds: string[], since: string, version: number) => { roles: Map<string, string[]>; checked: Set<string> };
  save: (found: Map<string, string[]>, version: number) => void;
  now?: () => Date;
}

/** `tag (!"A" or !"B" ...)`, as many names per query as fit. */
function batches(tag: string, names: string[]): string[] {
  const out: string[] = [];
  let group: string[] = [];
  const build = (g: string[]) => `${tag} (${g.map(exactName).join(' or ')})`;
  for (const name of names) {
    if (group.length && build([...group, name]).length > QUERY_BUDGET) { out.push(build(group)); group = []; }
    group.push(name);
  }
  if (group.length) out.push(build(group));
  return out;
}

const front = (name: string) => name.split(' // ')[0];

export async function countRoles(cards: Array<{ card: ScryfallCard; quantity: number }>, deps: Deps): Promise<RoleCount[]> {
  const withIds = cards.filter((c) => c.card.oracle_id);
  const oracleIds = [...new Set(withIds.map((c) => c.card.oracle_id!))];
  const since = new Date((deps.now?.() ?? new Date()).getTime() - FRESH_DAYS * 86400_000).toISOString();
  const { roles: known, checked } = deps.cached(oracleIds, since, ROLES_VERSION);

  // Look up only what has not been looked up lately.
  const unchecked = withIds.filter((c) => !checked.has(c.card.oracle_id!));
  if (unchecked.length) {
    const idByName = new Map(unchecked.map((c) => [front(c.card.name), c.card.oracle_id!]));
    const names = [...idByName.keys()];
    const found = new Map<string, string[]>([...idByName.values()].map((id) => [id, []]));
    // All at once: the Scryfall client spaces them out.
    const lookups = ROLES.flatMap((role) => batches(role.tag, names).map((query) => ({ role, query })));
    const results = await Promise.all(lookups.map(({ query }) => deps.search(query)));
    results.forEach(({ cards: hits }, i) => {
      for (const hit of hits) {
        const id = idByName.get(front(hit.name));
        if (id && !found.get(id)!.includes(lookups[i].role.id)) found.get(id)!.push(lookups[i].role.id);
      }
    });
    deps.save(found, ROLES_VERSION);
    for (const [id, roles] of found) known.set(id, roles);
  }

  return ROLES.map((role) => {
    // Lands are counted as lands, whatever else they do.
    const members = withIds.filter((c) => (known.get(c.card.oracle_id!) ?? []).includes(role.id)
      && primaryType(c.card) !== 'Lands');
    return {
      id: role.id,
      label: role.label,
      target: role.target,
      count: members.reduce((n, c) => n + c.quantity, 0),
      cards: members.map((c) => c.card.name).sort(),
    };
  });
}
