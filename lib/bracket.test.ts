/** The bracket floor from what the rules name. */

import { describe, expect, it } from 'vitest';

import { bracketFloor } from './bracket';

const card = (name: string, flags: Partial<{ gameChanger: boolean; massLandDenial: boolean; extraTurn: boolean }> = {}) =>
  ({ name, gameChanger: false, massLandDenial: false, extraTurn: false, banned: false, ...flags });
const combo = (cards: string[], twoCard: boolean) => ({ cards, twoCard, speed: 3, produces: ['Infinite mana'] });

describe('bracketFloor', () => {
  it('is 1-2 with nothing the rules name', () => {
    expect(bracketFloor({ cards: [card('Sol Ring')], combos: [] })).toMatchObject({ floor: 1, label: 'Bracket 1–2', reasons: [] });
  });

  it('is at least 3 with one to three Game Changers', () => {
    const b = bracketFloor({ cards: [card('Rhystic Study', { gameChanger: true }), card('Sol Ring')], combos: [] });
    expect(b).toMatchObject({ floor: 3, label: 'At least bracket 3' });
    expect(b.reasons[0]).toMatchObject({ text: '1 Game Changer: brackets 1 and 2 allow none', cards: ['Rhystic Study'] });
  });

  it('is 4 with a fourth Game Changer, or any mass land denial', () => {
    const four = ['A', 'B', 'C', 'D'].map((n) => card(n, { gameChanger: true }));
    expect(bracketFloor({ cards: four, combos: [] }).floor).toBe(4);
    expect(bracketFloor({ cards: [card('Armageddon', { massLandDenial: true })], combos: [] })).toMatchObject({ floor: 4, label: 'Bracket 4 or 5' });
  });

  it('puts two-card combos at 3, with a caution about early wins', () => {
    const b = bracketFloor({ cards: [], combos: [combo(['Vivi Ornitier', 'Quicksilver Elemental'], true), combo(['A', 'B', 'C'], false)] });
    expect(b.floor).toBe(3);
    expect(b.reasons[0].cards).toEqual(['Vivi Ornitier + Quicksilver Elemental']);
    expect(b.cautions[0].text).toMatch(/only late in the game/);
  });

  it('notes extra turns without raising the floor', () => {
    const b = bracketFloor({ cards: [card('Time Warp', { extraTurn: true })], combos: [] });
    expect(b.floor).toBe(1);
    expect(b.cautions[0]).toMatchObject({ cards: ['Time Warp'] });
  });
});
