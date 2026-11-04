import { describe, expect, it, vi } from 'vitest';

import { parseReview, reviewCuts, reviewMessage, type ReviewInput } from './cut-review';
import type { ScryfallCard } from './scryfall';

const card = (name: string, text: string) => ({ id: name, name, type_line: 'Sorcery', mana_cost: '{2}{R}', oracle_text: text } as ScryfallCard);
const input: ReviewInput = {
  commander: card('Jiang Yanggu, Alone', 'Whenever a creature attacks alone, discard a card, then draw a card.'),
  brief: 'Attack alone; discard and wheel to grow Jiang.',
  styles: ['Discard', 'Combat'],
  tags: [{ name: 'Wheels', description: 'Each player discards their hand and draws', cards: ['a', 'b'] }],
  candidates: [
    { cardId: 'w', name: 'Wheel of Misfortune', score: 2.1, reasons: ['Draw over'], why: [], roles: ['draw'], cmc: 3, card: card('Wheel of Misfortune', 'Each player discards their hand, then draws seven cards.') },
    { cardId: 'g', name: 'Mana Geyser', score: 1, reasons: ['Ramp over'], why: [], roles: ['ramp'], cmc: 5, card: card('Mana Geyser', 'Add {R} for each tapped land your opponents control.') },
  ],
  over: 19,
  instructions: 'Keep anything that attacks alone.',
};

describe('the cut review', () => {
  it('sends the plan, the styles, the tags, each card with the list\'s reasons, and the owner\'s instructions last', () => {
    const m = reviewMessage(input);
    expect(m).toMatch(/Attack alone; discard and wheel/);
    expect(m).toMatch(/Styles: Discard \+ Combat/);
    expect(m).toMatch(/- Wheels: Each player discards their hand and draws \(2 cards\)/);
    expect(m).toMatch(/19 over 100/);
    expect(m).toMatch(/1\. Wheel of Misfortune[\s\S]*List says \(score 2\.1\): Draw over/);
    expect(m.trim().endsWith('Keep anything that attacks alone.\n"""')).toBe(true);
    expect(reviewMessage({ ...input, instructions: ' ' })).not.toMatch(/instructions/);
  });

  it('keeps only the cards it was asked about, once each, with a known verdict', () => {
    const items = parseReview({ items: [
      { name: 'wheel of misfortune', verdict: 'keep', why: 'It is the engine.' },
      { name: 'Wheel of Misfortune', verdict: 'cut', why: 'twice' },
      { name: 'Sol Ring', verdict: 'cut', why: 'not asked' },
      { name: 'Mana Geyser', verdict: 'maybe', why: 'odd verdict' },
    ] }, ['Wheel of Misfortune', 'Mana Geyser']);
    expect(items).toEqual([
      { name: 'Wheel of Misfortune', verdict: 'keep', why: 'It is the engine.' },
      { name: 'Mana Geyser', verdict: 'unsure', why: 'odd verdict' },
    ]);
  });

  it('asks the model once, never cutting anything itself', async () => {
    const model = vi.fn(async () => ({ model: 'claude-sonnet-5', data: { items: [{ name: 'Mana Geyser', verdict: 'cut', why: 'Nothing to spend it on.' }] } }));
    const out = await reviewCuts(model, input);
    expect(model).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ model: 'claude-sonnet-5', items: [{ name: 'Mana Geyser', verdict: 'cut', why: 'Nothing to spend it on.' }] });
  });
});
