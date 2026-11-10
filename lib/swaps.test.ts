/**
 * The same-job lookup on the Swaps tab, from made-up cards: what it lists,
 * that it never ranks, and the reversible land it once took for a spell.
 */

import { describe, expect, it } from 'vitest';

import { sameJob, type DeckCard, type JobState } from './swaps';
import { normalizeCard, type ScryfallCard } from './scryfall';

const card = (name: string, cmc: number, over: Partial<ScryfallCard> = {}) =>
  ({ id: name, oracle_id: `o-${name}`, name, cmc, type_line: 'Artifact', oracle_text: '', ...over }) as ScryfallCard;
const inDeck = (c: ScryfallCard, jobs: string[], over: Partial<DeckCard> = {}): DeckCard => ({ card: c, quantity: 1, roles: jobs.map((j) => (j === 'interaction' ? 'removal' : j)), jobs, plan: [], ...over });
const ranges = (over: Record<string, [number, number, number]>): JobState[] =>
  Object.entries(over).map(([id, [count, lo, hi]]) => ({ id, label: id, count, range: [lo, hi] }));

describe('same job in the deck', () => {
  const signet = card('Arcane Signet', 2);
  const deck = [
    inDeck(card('Burnished Hart', 3), ['ramp']),
    inDeck(card('Mind Stone', 2), ['ramp']),
    inDeck(card('Gilded Lotus', 5), ['ramp']),
    inDeck(card('Sol Ring', 1), ['ramp'], { protected: '★ you kept it' }),
    inDeck(card('Night\'s Whisper', 2, { type_line: 'Sorcery' }), ['draw']),
  ];

  it('lists cards doing the same job at about the same cost, never protected ones', () => {
    const out = sameJob({ card: signet, roles: ['ramp'], jobs: ['ramp'], plan: [] }, deck, ranges({ ramp: [13, 11, 13] }));
    const names = out.map((o) => o.out.card.name);
    expect(names).toContain('Burnished Hart');
    expect(names).toContain('Mind Stone');
    expect(names).not.toContain('Sol Ring');
    // Five mana is more than one away from two: the curve would creep.
    expect(names).not.toContain('Gilded Lotus');
    expect(names).not.toContain('Night\'s Whisper');
  });

  it('is a lookup, not a ranking: closest cost first, then by name, with no score', () => {
    const out = sameJob({ card: signet, roles: ['ramp'], jobs: ['ramp'], plan: [] }, deck, ranges({ ramp: [13, 11, 13] }));
    expect(out.map((o) => o.out.card.name)).toEqual(['Mind Stone', 'Burnished Hart']);
    expect(out.every((o) => !('score' in o))).toBe(true);
    expect(out[0].how.steps.join(' ')).toMatch(/Not ranked/);
    expect(out.map((o) => o.why).join(' ')).not.toMatch(/better|upgrade/i);
  });

  it('warns when the card going out does two jobs, or its job would drop under range', () => {
    const growth = inDeck(card('Growth Spiral', 2, { type_line: 'Instant' }), ['ramp', 'draw']);
    const out = sameJob({ card: signet, roles: ['ramp'], jobs: ['ramp'], plan: [] }, [growth], ranges({ ramp: [12, 11, 13], draw: [10, 10, 12] }));
    expect(out[0].warn).toMatch(/Does two jobs/);
    expect(out[0].warn).toMatch(/draw would drop to 9/);
  });

  it('lists a way to win only for another way to win', () => {
    const revel = inDeck(card('Revel in Riches', 5, { type_line: 'Enchantment' }), ['finishers'], { protected: 'way to win', route: true });
    const finisher = sameJob({ card: card('Torment of Hailfire', 4), roles: ['finisher'], jobs: ['finishers'], plan: [] }, [revel], []);
    expect(finisher.map((o) => o.out.card.name)).toEqual(['Revel in Riches']);
    const ramp = sameJob({ card: card('Big Rock', 5), roles: ['ramp'], jobs: ['ramp'], plan: [] }, [revel], []);
    expect(ramp).toEqual([]);
  });

  it('never lists a counterspell for a board wipe', () => {
    const wipe = inDeck(card('Blasphemous Act', 9, { type_line: 'Sorcery' }), ['interaction'], { roles: ['wipe'] });
    const out = sameJob({ card: card('Pyroblast', 9, { type_line: 'Instant' }), roles: ['counter'], jobs: ['interaction'], plan: [] }, [wipe], []);
    expect(out).toEqual([]);
  });

  it('never lists a reversible land as a spell', () => {
    // As Scryfall sends it: the type line only on the faces.
    const vents = normalizeCard({
      id: 'sv', name: 'Steam Vents // Steam Vents', layout: 'reversible_card',
      card_faces: [
        { name: 'Steam Vents', oracle_id: 'o-sv', cmc: 0, type_line: 'Land — Island Mountain', oracle_text: '({T}: Add {U} or {R}.)' },
        { name: 'Steam Vents', oracle_id: 'o-sv', cmc: 0, type_line: 'Land — Island Mountain', oracle_text: '({T}: Add {U} or {R}.)' },
      ],
    } as ScryfallCard);
    const out = sameJob({ card: card('Mana Vault', 1), roles: ['ramp'], jobs: ['ramp'], plan: [] }, [inDeck(vents, ['ramp'])], []);
    expect(out).toEqual([]);
  });
});
