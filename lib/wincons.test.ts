/**
 * The no-AI win guess, from made-up role counts and cards.
 */

import { describe, expect, it } from 'vitest';

import type { RoleCount } from './roles';
import type { ScryfallCard } from './scryfall';
import { guessWinRoutes } from './wincons';

const role = (id: string, cards: string[]): RoleCount => ({ id, label: id, group: 'plan', target: null, count: cards.length, cards });
const card = (name: string, type_line: string, oracle_text = '') => ({ card: { id: name, name, type_line, oracle_text } as ScryfallCard, quantity: 1 });

describe('guessWinRoutes', () => {
  it('names finishers as a route', () => {
    const guess = guessWinRoutes({ cards: [], roles: [role('finisher', ['Insurrection', 'Mob Rule', 'Syr Konrad, the Grim', 'Blood Artist'])], combos: [] });
    expect(guess.routes.map((r) => [r.id, r.strength])).toEqual([['finisher', 'strong']]);
    expect(guess.missing).toBe('');
  });

  it('does not read ramp and protection auras as a commander-damage plan', () => {
    const auras = Array.from({ length: 8 }, (_, i) => card(`Growth ${i}`, 'Enchantment — Aura', 'Enchant land. Whenever enchanted land is tapped for mana, add an additional {G}.'));
    const guess = guessWinRoutes({ cards: auras, roles: [], combos: [] });
    expect(guess.routes).toEqual([]);
    expect(guess.missing).toMatch(/No clear way to win/);
  });

  it('reads a pile of equipment that pumps as commander damage', () => {
    const gear = Array.from({ length: 8 }, (_, i) => card(`Blade ${i}`, 'Artifact — Equipment', 'Equipped creature gets +2/+0.'));
    expect(guessWinRoutes({ cards: gear, roles: [], combos: [] }).routes.map((r) => r.id)).toEqual(['voltron']);
  });
});

describe('engine combos', () => {
  const combo = (cards: string[], produces: string[]) => ({ id: cards.join('+'), url: '', cards, produces }) as never;
  it('counts an infinite-storm combo as a win only with a payoff', () => {
    const engine = [combo(['Storm-Kiln Artist', 'Reiterate'], ['Infinite storm count', 'Infinite colored mana'])];
    const without = guessWinRoutes({ cards: [], roles: [], combos: engine });
    expect(without.routes.map((r) => [r.label, r.strength])).toEqual([['Combo with no payoff', 'some']]);
    expect(without.missing).toMatch(/payoff/);
    const withPayoff = guessWinRoutes({ cards: [], roles: [role('finisher', ['Longshot, Rebel Bowman'])], combos: engine });
    expect(withPayoff.routes[0]).toMatchObject({ label: 'Combo into a payoff', strength: 'strong' });
    expect(withPayoff.missing).toBe('');
  });
});
