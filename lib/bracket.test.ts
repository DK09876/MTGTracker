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

describe('the owner outranks the flag (Part D 17)', () => {
  const liliana = {
    text: '+1: Create a 2/2 black Zombie creature token.\n−4: Each player sacrifices two creatures.\n−9: Each opponent chooses a permanent they control of each permanent type and sacrifices the rest.',
    planeswalker: true,
  };
  const armageddon = { text: 'Destroy all lands.', planeswalker: false };
  const textOf = (n: string) => (n === 'Liliana, Dreadhorde General' ? liliana : n === 'Armageddon' ? armageddon : null);

  it('a planeswalker whose land denial is only its last ability is a caution, not a floor, and says why', () => {
    const b = bracketFloor({ cards: [card('Liliana, Dreadhorde General', { massLandDenial: true })], combos: [] }, { textOf });
    expect(b.floor).toBe(1);
    expect(b.cautions[0]).toMatchObject({ text: 'Can wipe lands with its last ability: count it if your table would', cards: ['Liliana, Dreadhorde General'], kind: 'land' });
    expect(b.why!['Liliana, Dreadhorde General']).toMatch(/^−9: Each opponent chooses/);
  });

  it('a card set aside doesn\'t count, and is listed so it can go back', () => {
    const cards = [card('Armageddon', { massLandDenial: true }), card('Time Warp', { extraTurn: true })];
    expect(bracketFloor({ cards, combos: [] }, { textOf }).floor).toBe(4);
    const b = bracketFloor({ cards, combos: [] }, { textOf, aside: new Set(['armageddon', 'time warp']) });
    expect(b.floor).toBe(1);
    expect(b.cautions).toEqual([]);
    expect(b.aside).toEqual(['Armageddon', 'Time Warp']);
    expect(b.why!.Armageddon).toBe('Destroy all lands.');
  });
});
