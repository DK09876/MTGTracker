/**
 * The Build checklist from made-up decks.
 */

import { describe, expect, it } from 'vitest';

import { buildPlan, commanderStyle } from './build';
import { karstenLands } from './deck-numbers';
import type { RoleCount } from './roles';
import type { ScryfallCard } from './scryfall';

const role = (id: string, count: number, target: [number, number] | null = null): RoleCount =>
  ({ id, label: id, group: 'mana', target, count, cards: Array.from({ length: count }, (_, i) => `${id} ${i}`) });

describe('build', () => {
  it('reads a commander\'s style from its text', () => {
    expect(commanderStyle({ oracle_text: 'Whenever you cast an instant or sorcery spell, copy it.' } as ScryfallCard)?.label).toBe('Spells engine');
    expect(commanderStyle({ oracle_text: 'Whenever another creature you control dies, each opponent loses 1 life.' } as ScryfallCard)?.label).toBe('Aristocrats');
    expect(commanderStyle({ oracle_text: 'Flying' } as ScryfallCard)?.label).toBe('Value');
  });

  it('uses Karsten\'s land formula, never below 37', () => {
    expect(karstenLands(3, 10)).toBe(38);
    expect(karstenLands(1.5, 20)).toBe(37);
  });

  it('says what is worth fixing, most pressing first, with the cards behind it', () => {
    const plan = buildPlan({
      commander: null, cards: [], lands: 41, averageMv: 3, size: 101, brief: '',
      roles: [role('ramp', 9, [10, 12]), role('draw', 11, [10, 12]), role('removal', 3, [8, 12]), role('finisher', 0)],
    });
    expect(plan.gaps.map((g) => g.role)).toEqual(['ramp', 'removal']);
    expect(plan.targets.map((g) => g.role)).toEqual(['ramp', 'removal', 'draw']);
    expect(plan.issues.map((i) => [i.id, i.level])).toEqual([
      ['size', 'fix'], ['role:removal', 'fix'], ['role:ramp', 'consider'], ['finisher', 'consider'],
    ]);
    expect(plan.issues[0]).toMatchObject({ title: '1 card over 100', action: { kind: 'cuts' } });
    expect(plan.issues.find((i) => i.id === 'role:ramp')?.cards).toHaveLength(9);
    // Only roles the deck has cards in, or a guideline for.
    expect(plan.roles.map((r) => r.role)).toEqual(['ramp', 'draw', 'removal']);
  });

  it('counts cards tagged as a win condition as finishers', () => {
    const plan = buildPlan({
      commander: null, cards: [], lands: 41, averageMv: 3, size: 100, brief: 'Go wide with slivers.',
      roles: [role('ramp', 10, [10, 12])], wincons: ['Sliver Overlord'],
    });
    expect(plan.finishers).toEqual(['Sliver Overlord']);
    expect(plan.issues).toEqual([]);
  });

  it('flags a colour that is short of its sources', () => {
    const plan = buildPlan({
      commander: null, cards: [], lands: 41, averageMv: 3, size: 100, brief: 'x', roles: [role('finisher', 2)],
      colors: [{ color: 'W', sources: 14, needed: 19, neededFor: 'Swords to Plowshares' }, { color: 'U', sources: 20, needed: 20, neededFor: 'Counterspell' }],
    });
    expect(plan.issues.map((i) => [i.id, i.level])).toEqual([['colors', 'fix']]);
    expect(plan.issues[0].title).toBe('Short of {W} sources for the hungriest spells');
    expect(plan.issues[0].why).toMatch(/^\{W\} 14 of 19, set by Swords to Plowshares/);
  });
});
