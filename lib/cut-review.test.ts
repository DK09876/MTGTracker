import { describe, expect, it, vi } from 'vitest';

import { parseReview, rerateCard, rerateMessage, reviewCuts, reviewMessage, reviewSize, settled, verdictOfTier, type ReviewInput } from './cut-review';
import type { JsonModel } from './ai';
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
  it('reads about twice what the deck is over, 20 to 60', () => {
    expect([reviewSize(-3), reviewSize(0), reviewSize(9), reviewSize(16), reviewSize(45)]).toEqual([20, 20, 20, 32, 60]);
  });

  it('rates the whole deck in tiers, each tier standing for a verdict', async () => {
    const opt = { name: 'Opt', mana_cost: '{U}', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.' } as ScryfallCard;
    const message = reviewMessage({ ...input, mode: 'whole', cards: [input.candidates[0].card, opt] });
    expect(message).toContain('Rate all 2 cards in the main deck');
    expect(message).toContain('The cut list says: Draw over');
    expect(message).toContain('Opt {U} - Instant');
    const model = vi.fn(async (request) => {
      expect(request.step).toBe('rate the whole deck');
      return { data: { items: [{ name: 'Wheel of Misfortune', tier: 'C', why: 'x' }, { name: 'Opt', tier: 'A', why: 'y' }, { name: 'Sol Ring', tier: 'S', why: 'not asked' }] }, model: 'claude-opus-5-5' };
    }) as unknown as JsonModel;
    const out = await reviewCuts(model, { ...input, mode: 'whole', cards: [input.candidates[0].card, opt] });
    expect(out.items.map((i) => [i.name, i.tier, i.verdict])).toEqual([['Wheel of Misfortune', 'C', 'cut'], ['Opt', 'A', 'keep']]);
    expect(verdictOfTier('B')).toBe('unsure');
  });

  it('tells the next review what it said and what the owner did since', () => {
    const before = { at: '2026-11-05T06:09:22.917Z', model: 'm', instructions: '', over: 16, items: [
      { name: 'Mind Stone', verdict: 'cut' as const, why: 'a' }, { name: 'Snort', verdict: 'keep' as const, why: 'b' }, { name: 'Anger', verdict: 'unsure' as const, why: 'c' },
    ] };
    const done = settled(before, new Set(['Snort', 'Anger']), new Set(['Snort']));
    expect(done).toEqual({ cut: ['Mind Stone'], kept: ['Snort'] });
    const message = reviewMessage({ ...input, previous: { at: before.at, items: before.items, ...done } });
    expect(message).toContain('Last time (2026-11-05) you said:');
    expect(message).toContain('- Snort: keep');
    expect(message).toContain('Since then the owner cut: Mind Stone.');
    expect(message).toContain('And starred to keep for good: Snort.');
  });

  it('re-rates one card with the owner\'s reason', async () => {
    const was = { name: 'Mana Geyser', verdict: 'cut' as const, why: 'no discard synergy', tier: 'C' as const };
    const geyser = { name: 'Mana Geyser', mana_cost: '{3}{R}{R}', type_line: 'Sorcery', oracle_text: 'Add {R} for each tapped land your opponents control.' } as ScryfallCard;
    const rerate = { commander: null, brief: 'Wheels.', styles: [], card: geyser, was, wantTier: 'B' as const, reason: 'It powers a turn-five wheel.' };
    const message = rerateMessage(rerate);
    expect(message).toContain('You said: tier C - no discard synergy');
    expect(message).toContain('The owner thinks it is tier B.');
    expect(message).toContain('It powers a turn-five wheel.');
    const model = vi.fn(async () => ({ data: { tier: 'B', why: 'Fair: it fuels the wheel turn.' }, model: 'm' })) as unknown as JsonModel;
    expect(await rerateCard(model, rerate)).toEqual({ tier: 'B', why: 'Fair: it fuels the wheel turn.', model: 'm' });
  });
});
