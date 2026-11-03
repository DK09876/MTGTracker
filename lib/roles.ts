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
import { oracleTextOf, type ScryfallCard, type SearchResult } from './scryfall';
import { primaryType } from './deckview';

export type RoleGroup = 'mana' | 'cards' | 'interaction' | 'resilience' | 'plan';

export const ROLE_GROUPS: Record<RoleGroup, string> = {
  mana: 'Mana',
  cards: 'Cards',
  interaction: 'Interaction',
  resilience: 'Resilience',
  plan: 'Game plan',
};

export interface Role {
  id: string;
  label: string;
  group: RoleGroup;
  /** The Scryfall search that finds cards in this role. */
  tag?: string;
  /**
   * Rules text that also puts a card in this role, for what Scryfall has no
   * tag for (redirecting a spell, a damage-on-death payoff). Read from the
   * card itself, so it costs no lookup.
   */
  text?: RegExp;
  /** A common guideline for a Commander deck, as a range - or none. */
  target: [number, number] | null;
}

// Every role is a Scryfall community tag (scryfall.com/docs/tagger-tags),
// checked to exist on 2026-10-31 - no model involved. Guideline ranges are
// where most Commander deckbuilding advice lands; a deck's plan may want
// more or fewer of any.
//
// Scryfall's tags are broader than deckbuilders mean, so some are narrowed:
// otag:tutor includes every land-fetcher (Cultivate, Evolving Wilds) and
// otag:card-advantage the cycling lands, so lands are counted as lands and
// land-fetching as ramp. A cantrip replaces itself rather than gaining a
// card, so it is not counted as card advantage (the deckbuilding videos'
// rule: only cards that leave you with more in hand are draw).
const FINISHER = new RegExp([
  // Mass steal: all creatures, or one from each opponent.
  String.raw`gain control of (all|each) (creatures|creature|permanents)`,
  String.raw`gain control of all creatures target (opponent|player) controls`,
  String.raw`for each opponent, gain control of`,
  String.raw`untap all creatures and gain control of them`,
  // Death and sacrifice payoffs aimed at the opponents.
  String.raw`whenever [^.]*\b(dies|die|is put into a graveyard|are put into a graveyard|you sacrifice)\b[^.]*\b(each opponent|target opponent|target player|any target)\b`,
  String.raw`whenever [^.]*\b(each opponent|target opponent)\b[^.]*\bloses? \w+ life\b[^.]*\b(dies|sacrifice)`,
].join('|'), 'i');

export const ROLES: Role[] = [
  { id: 'ramp', label: 'Ramp', group: 'mana', tag: 'otag:ramp -t:land', target: [10, 12] },
  { id: 'rock', label: 'Mana rocks', group: 'mana', tag: 'otag:mana-rock -t:land', target: null },
  { id: 'dork', label: 'Mana creatures', group: 'mana', tag: 'otag:mana-dork', target: null },
  { id: 'land-ramp', label: 'Land ramp', group: 'mana', tag: 'otag:land-ramp -t:land', target: null },
  { id: 'ritual', label: 'Rituals', group: 'mana', tag: 'otag:ritual', target: null },
  { id: 'reducer', label: 'Cost reducers', group: 'mana', tag: 'otag:cost-reducer -t:land', target: null },

  { id: 'draw', label: 'Card advantage', group: 'cards', tag: 'otag:card-advantage -otag:cantrip -t:land', target: [10, 12] },
  { id: 'engine', label: 'Draw engines', group: 'cards', tag: 'otag:draw-engine -t:land', target: null },
  { id: 'cantrip', label: 'Cantrips', group: 'cards', tag: 'otag:cantrip', target: null },
  { id: 'tutor', label: 'Tutors', group: 'cards', tag: 'otag:tutor -otag:ramp -t:land', target: null },
  { id: 'wheel', label: 'Wheels', group: 'cards', tag: 'otag:wheel', target: null },

  { id: 'removal', label: 'Targeted removal', group: 'interaction', tag: 'otag:spot-removal -t:land', target: [8, 12] },
  { id: 'wipe', label: 'Board wipes', group: 'interaction', tag: 'otag:board-wipe -t:land', target: [2, 4] },
  { id: 'counter', label: 'Counterspells', group: 'interaction', tag: 'otag:counterspell', target: null },
  { id: 'gy-hate', label: 'Graveyard hate', group: 'interaction', tag: 'otag:graveyard-hate -t:land', target: null },
  // Slows the whole table down. Scryfall has no single stax tag; these are
  // the tags for rule-setting pieces, without punisher draw (otag:tax).
  { id: 'stax', label: 'Stax', group: 'interaction', tag: '(otag:cost-increaser or otag:rule-of-law or otag:tax-attack or otag:prevent-cast or otag:prevent-activation or otag:skip-untap-step or otag:cast-tax or otag:mass-land-denial)', target: null },

  // Protection is wider than Scryfall's tag: fogs, "your opponents can't
  // cast spells this turn" (silence) and spells that send a removal spell
  // somewhere else all keep your board or your turn alive.
  { id: 'protection', label: 'Protection', group: 'resilience', tag: '(otag:protection or otag:fog or otag:silence) -t:land',
    text: /\b(change the target|choose new targets for target (spell|instant|sorcery))/i, target: null },
  { id: 'recursion', label: 'Recursion', group: 'resilience', tag: 'otag:recursion -t:land', target: null },

  { id: 'wincon', label: 'Wins the game', group: 'plan', tag: 'otag:win-condition', target: null },
  // Ends a game that is already close, from the card's own text: taking
  // every creature for a turn (Insurrection, Mob Rule), or making each
  // death or sacrifice hurt the table (Syr Konrad, Marionette Master).
  { id: 'finisher', label: 'Finishers', group: 'plan', text: FINISHER, target: null },
  { id: 'extra-turn', label: 'Extra turns', group: 'plan', tag: 'otag:extra-turn', target: null },
  { id: 'extra-combat', label: 'Extra combats', group: 'plan', tag: 'otag:extra-combat', target: null },
  { id: 'overrun', label: 'Overruns', group: 'plan', tag: 'otag:overrun', target: null },
  { id: 'anthem', label: 'Anthems', group: 'plan', tag: 'otag:anthem', target: null },
  { id: 'drain', label: 'Drain', group: 'plan', tag: 'otag:drain-life', target: null },
  { id: 'mill', label: 'Mills opponents', group: 'plan', tag: 'otag:mill', target: null },
  { id: 'tokens', label: 'Token makers', group: 'plan', tag: 'otag:repeatable-token-generator', target: null },
  { id: 'sac-outlet', label: 'Sac outlets', group: 'plan', tag: 'otag:sac-outlet', target: null },
];

/**
 * Bumped whenever a role's search changes, so saved answers from the old
 * definition are looked up again rather than trusted.
 */
export const ROLES_VERSION = 4;

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
    const lookups = ROLES.flatMap((role) => (role.tag ? batches(role.tag, names) : []).map((query) => ({ role, query })));
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
    const members = withIds.filter((c) => ((known.get(c.card.oracle_id!) ?? []).includes(role.id)
      || (role.text?.test(oracleTextOf(c.card)) ?? false))
      && primaryType(c.card) !== 'Lands');
    return {
      id: role.id,
      label: role.label,
      group: role.group,
      target: role.target,
      count: members.reduce((n, c) => n + c.quantity, 0),
      cards: members.map((c) => c.card.name).sort(),
    };
  });
}
