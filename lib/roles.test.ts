/**
 * Role counts, with Scryfall's tag search and the saved answers stood in for.
 */

import { describe, expect, it, vi } from 'vitest';

import { countRoles, type Deps } from './roles';
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
    expect(first.search).toHaveBeenCalledTimes(5);
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
});
