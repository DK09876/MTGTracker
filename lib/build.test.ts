/**
 * The Build checklist from made-up decks.
 */

import { describe, expect, it } from 'vitest';

import { buildPlan, commanderStyle, karstenLands } from './build';
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

  it('lists roles below their guideline, and a missing finisher, as gaps', () => {
    const plan = buildPlan({
      commander: null, cards: [], lands: 36, averageMv: 3, size: 101, brief: '', savedReads: 0,
      roles: [role('ramp', 8, [10, 12]), role('draw', 11, [10, 12]), role('finisher', 0)],
    });
    expect(plan.gaps.map((g) => g.role)).toEqual(['ramp', 'finisher']);
    expect(plan.targets.map((g) => g.role)).toEqual(['ramp', 'finisher', 'draw']);
    expect(plan.steps.find((s) => s.id === 'cuts')?.summary).toBe('1 over 100');
    expect(plan.steps.find((s) => s.id === 'plan')?.status).toBe('todo');
  });
});
