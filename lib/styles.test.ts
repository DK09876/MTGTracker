import { describe, expect, it } from 'vitest';

import type { ScryfallCard } from './scryfall';
import { detectStyles, styleById, styleTargets } from './styles';

const card = (text: string): { card: ScryfallCard; quantity: number } => ({ card: { name: text.slice(0, 20), oracle_text: text } as ScryfallCard, quantity: 1 });
const many = (n: number, text: string) => Array.from({ length: n }, () => card(text));

describe('styles', () => {
  const jiang = { name: 'Jiang Yanggu, Alone', oracle_text: 'Menace\nWhenever a creature you control attacks a player alone, discard a card, then draw a card. Then put a +1/+1 counter on that creature for each card you\'ve discarded this turn.' } as ScryfallCard;

  it('ranks the commander\'s styles by how much of the deck shares them', () => {
    const found = detectStyles(jiang, [...many(20, 'Discard a card: draw a card.'), ...many(4, 'Whenever this creature attacks, it gets +1/+0.')]);
    expect(found.primary.id).toBe('discard');
    // Combat is the commander's too, but only 4 cards play it; counters, 0.
    expect(found.secondary).toBeNull();
    const combat = detectStyles(jiang, [...many(20, 'Discard a card: draw a card.'), ...many(10, 'Whenever this creature attacks, it gets +1/+0.')]);
    expect([combat.primary.id, combat.secondary?.id]).toEqual(['discard', 'combat']);
  });

  it('takes a second style from the deck even when the commander does not say it', () => {
    const found = detectStyles({ name: 'Plain', oracle_text: 'Whenever you cast an instant or sorcery spell, scry 1.' } as ScryfallCard, many(16, 'Landfall - Whenever a land you control enters, gain 1 life.'));
    expect([found.primary.id, found.secondary?.id]).toEqual(['spells', 'landfall']);
  });

  it('ignores reminder text, and falls back to Value', () => {
    expect(detectStyles({ name: 'X', oracle_text: 'Flying (This creature can\'t be blocked except by creatures that discard a card.)' } as ScryfallCard, []).primary.id).toBe('value');
  });

  it('moves the usual counts by style, the main style winning', () => {
    const base = { ramp: [10, 12] as [number, number], draw: [10, 12] as [number, number] };
    expect(styleTargets(base, styleById('discard'), styleById('combat'))).toEqual({ ramp: [10, 12], draw: [12, 16] });
    expect(styleTargets(base, styleById('combat'), styleById('landfall'))).toEqual({ ramp: [12, 15], draw: [8, 11] });
  });
});
