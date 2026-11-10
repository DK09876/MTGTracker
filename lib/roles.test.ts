/**
 * Role counts, with Scryfall's tag search and the saved answers stood in for.
 */

import { describe, expect, it, vi } from 'vitest';

import { countRoles, fixRoles, oneShotTreasure, ROLES, type Deps } from './roles';
import type { ScryfallCard } from './scryfall';

const card = (name: string, type_line = 'Sorcery') => ({ id: name, oracle_id: `o-${name}`, name, type_line }) as ScryfallCard;
const cultivate = card('Cultivate');
const bolt = card('Lightning Bolt', 'Instant');
const rhystic = card('Rhystic Study', 'Enchantment');
const myriad = card('Myriad Landscape', 'Land');
// Keyed by the first term of each role's search.
const tags: Record<string, string[]> = {
  'otag:ramp': ['Cultivate', 'Myriad Landscape'],
  'otag:card-advantage': ['Rhystic Study'],
  'otag:spot-removal': ['Lightning Bolt'],
};

function deps(saved = new Map<string, string[]>(), checked = new Set<string>()): Deps & { search: ReturnType<typeof vi.fn> } {
  return {
    // Scryfall answers with the tagged cards among the names asked about.
    search: vi.fn(async (query: string) => {
      const tag = query.split(' ')[0];
      const cards = (tags[tag] ?? []).filter((n) => query.includes(`"${n}"`)).map((n) => card(n));
      return { cards, totalCards: cards.length, hasMore: false };
    }),
    cached: () => ({ roles: new Map(saved), checked: new Set(checked) }),
    save: vi.fn((found: Map<string, string[]>) => { for (const [k, v] of found) { saved.set(k, v); checked.add(k); } }),
  };
}

describe('countRoles', () => {
  const deck = [{ card: cultivate, quantity: 1 }, { card: bolt, quantity: 1 }, { card: rhystic, quantity: 1 }, { card: myriad, quantity: 1 }];

  it('counts each role, leaving ramp lands to the land count', async () => {
    const roles = await countRoles(deck, deps());
    const by = Object.fromEntries(roles.map((r) => [r.id, [r.count, r.cards]]));
    expect(by.ramp).toEqual([1, ['Cultivate']]);
    expect(by.draw).toEqual([1, ['Rhystic Study']]);
    expect(by.removal).toEqual([1, ['Lightning Bolt']]);
    expect(by.wipe).toEqual([0, []]);
  });

  it('asks Scryfall once per role for a new deck, then never again', async () => {
    const saved = new Map<string, string[]>();
    const checked = new Set<string>();
    const first = deps(saved, checked);
    await countRoles(deck, first);
    expect(first.search).toHaveBeenCalledTimes(ROLES.filter((r) => r.tag).length);
    // A card with no roles is remembered as looked up, too.
    expect(saved.get('o-Myriad Landscape')).toEqual(['ramp']);

    const second = deps(saved, checked);
    const roles = await countRoles(deck, second);
    expect(second.search).not.toHaveBeenCalled();
    expect(roles.find((r) => r.id === 'draw')!.count).toBe(1);
  });

  it('looks up only the cards it has not seen', async () => {
    const saved = new Map([['o-Cultivate', ['ramp']]]);
    const d = deps(saved, new Set(['o-Cultivate']));
    await countRoles(deck, d);
    for (const [query] of d.search.mock.calls) expect(query).not.toContain('Cultivate');
  });

  it('asks for a role with its exclusions, so land-fetchers are not tutors', async () => {
    const d = deps();
    await countRoles(deck, d);
    const queries = d.search.mock.calls.map(([q]) => q as string);
    expect(queries.find((q) => q.startsWith('otag:tutor'))).toMatch(/^otag:tutor -otag:ramp -t:land \(/);
  });

  it('reads roles Scryfall has no tag for from the card text', async () => {
    const withText = (name: string, oracle_text: string, type_line = 'Instant') => ({ ...card(name, type_line), oracle_text }) as ScryfallCard;
    const roles = await countRoles([
      { card: withText('Redirect Lightning', 'Change the target of target spell or ability with a single target.'), quantity: 1 },
      { card: withText('Syr Konrad, the Grim', 'Whenever another creature dies, Syr Konrad, the Grim deals 1 damage to each opponent.', 'Legendary Creature'), quantity: 1 },
      { card: withText('Insurrection', 'Untap all creatures and gain control of them until end of turn. They gain haste until end of turn.', 'Sorcery'), quantity: 1 },
      { card: withText('Opt', 'Scry 1. Draw a card.'), quantity: 1 },
    ], deps());
    const by = Object.fromEntries(roles.map((r) => [r.id, r.cards]));
    expect(by.protection).toEqual(['Redirect Lightning']);
    expect(by.finisher).toEqual(['Insurrection', 'Syr Konrad, the Grim']);
  });
});

describe('one-shot Treasure makers are not ramp', () => {
  // Real rules text (reminder text included, as Scryfall sends it).
  const c = (name: string, oracle_text: string, type_line = 'Instant') => ({ id: name, oracle_id: `o-${name}`, name, type_line, oracle_text }) as ScryfallCard;
  const REMINDER = ' (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")';
  const oneShot = [
    c('Big Score', 'As an additional cost to cast this spell, discard a card.\nDraw two cards and create two Treasure tokens.' + REMINDER),
    c('Deadly Dispute', 'As an additional cost to cast this spell, sacrifice an artifact or creature.\nDraw two cards and create a Treasure token.' + REMINDER),
    c('Dockside Extortionist', 'When this creature enters, create X Treasure tokens, where X is the number of artifacts and enchantments your opponents control.' + REMINDER, 'Creature — Goblin Pirate'),
    c('Creative Outburst', 'Creative Outburst deals 5 damage to any target. Look at the top five cards of your library. Put one of them into your hand and the rest on the bottom of your library in a random order.\n{U/R}{U/R}, Discard this card: Create a Treasure token.'),
  ];
  const repeatable = [
    c('Smothering Tithe', 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.' + REMINDER, 'Enchantment'),
    c('Pitiless Plunderer', 'Whenever another creature you control dies, create a Treasure token.' + REMINDER, 'Creature — Human Pirate'),
    c('Black Market Connections', 'At the beginning of your first main phase, choose one or more —\n• Sell Contraband — Create a Treasure token. You lose 1 life.\n• Buy Information — Draw a card. You lose 2 life.', 'Enchantment'),
    c('Deadeye Plunderers', 'This creature gets +1/+1 for each artifact you control.\n{2}{U}{B}: Create a Treasure token.' + REMINDER, 'Creature — Human Pirate'),
  ];

  it('tells a one-shot Treasure maker from a repeatable one', () => {
    expect(oneShot.filter((x) => !oneShotTreasure(x)).map((x) => x.name)).toEqual([]);
    expect(repeatable.filter((x) => oneShotTreasure(x)).map((x) => x.name)).toEqual([]);
    expect(oneShotTreasure(c('Arcane Signet', '{T}: Add one mana of any color in your commander\'s color identity.', 'Artifact'))).toBe(false);
  });

  it('takes ramp off a one-shot maker and leaves its other roles', () => {
    expect(fixRoles(oneShot[1], ['ramp', 'draw'])).toEqual(['draw']);
    expect(fixRoles(repeatable[0], ['ramp'])).toEqual(['ramp']);
  });

  it('does not count one-shot Treasure as ramp in a deck', async () => {
    const deck = [...oneShot, ...repeatable].map((card) => ({ card, quantity: 1 }));
    const tagged = new Map(deck.map((d) => [d.card.oracle_id!, ['ramp']]));
    const counted = await countRoles(deck, { search: async () => ({ cards: [], totalCards: 0, hasMore: false }), cached: () => ({ roles: tagged, checked: new Set(tagged.keys()) }), save: () => {} });
    expect(counted.find((r) => r.id === 'ramp')?.cards).toEqual(repeatable.map((x) => x.name).sort());
  });
});
