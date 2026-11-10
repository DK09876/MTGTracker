/**
 * Commander fit, from made-up cards.
 */

import { describe, expect, it } from 'vitest';

import { fitOf, fitProfile, quality } from './fit';
import type { ScryfallCard } from './scryfall';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) => ({ id: name, name, type_line, oracle_text, ...extra }) as ScryfallCard;
const azula = card('Fire Lord Azula', 'Legendary Creature — Human Noble', 'Whenever you cast a spell while Fire Lord Azula is attacking, copy that spell.');
const ulalek = card('Ulalek, Fused Atrocity', 'Legendary Creature — Eldrazi', 'Whenever you cast an Eldrazi spell, you may pay {C}{C}. If you do, copy all spells you control.');

describe('fit', () => {
  it('reads what a commander cares about and matches cards that do it', () => {
    const p = fitProfile(azula)!;
    expect(p.themes.map((t) => t.name)).toContain('attacking');
    expect(fitOf(card('Opt', 'Instant', 'Scry 1. Draw a card.'), fitProfile(card('X', 'Legendary Creature', 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.'))).matches).toContain('instants and sorceries');
    const eldrazi = fitProfile(ulalek)!;
    expect(eldrazi.types).toContain('Eldrazi');
    expect(fitOf(card('Artisan of Kozilek', 'Creature — Eldrazi', 'Annihilator 2'), eldrazi).score).toBeGreaterThan(0);
    expect(fitOf(card('Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.'), eldrazi).score).toBe(0);
  });

  it('rates how good a card is at its job from things on the card, not popularity', () => {
    const growth = quality(card('Growth Spiral', 'Instant', 'Draw a card.', { cmc: 2 }), ['ramp', 'draw']);
    const kodama = quality(card('Kodama\'s Reach', 'Sorcery', 'Search for two lands.', { cmc: 3 }), ['ramp']);
    expect(growth.score).toBeGreaterThan(kodama.score);
    expect(growth.reasons).toEqual(expect.arrayContaining(['2 mana', 'instant speed', 'does 2 jobs']));
    const chaos = quality(card('Chaos Warp', 'Instant', 'The owner of target permanent shuffles it into their library.', { cmc: 3 }), ['removal']);
    expect(chaos.reasons).toContain('hits anything');
    const tapland = quality(card('Bad Land', 'Land', 'Bad Land enters tapped.', { produced_mana: ['B'] }));
    const dual = quality(card('Blood Crypt', 'Land — Swamp Mountain', '', { produced_mana: ['B', 'R'] }));
    expect(dual.score).toBeGreaterThan(tapland.score);
  });
});

describe('creature types a commander cares about', () => {
  it('reads them from its rules text, not its own type line', () => {
    // Azula is a Human Noble; nothing in her text is about Humans.
    expect(fitProfile(azula)!.types).toEqual([]);
    expect(fitOf(card('Random Human', 'Creature — Human Soldier', 'Vigilance'), fitProfile(azula)).matches).toEqual([]);
    // A commander whose text names a type does care about it.
    const naming = card('Wizard Lord', 'Legendary Creature — Human Wizard', 'Wizards you control get +1/+1.');
    expect(fitProfile(naming)!.types).toEqual(['Wizard']);
  });

  it('does not take a type from the commander’s own name in its text', () => {
    const named = card('Gorm the Dragon', 'Legendary Creature — Human Warrior', 'Whenever Gorm the Dragon attacks, draw a card.');
    expect(fitProfile(named)!.types).toEqual([]);
  });
});
