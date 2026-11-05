/**
 * What a card could replace, and upgrades for jobs the deck already does,
 * from made-up cards.
 */

import { describe, expect, it } from 'vitest';

import { replacements, upgrades, type DeckCard, type JobState } from './swaps';
import type { ScryfallCard } from './scryfall';

const card = (name: string, cmc: number, over: Partial<ScryfallCard> = {}) =>
  ({ id: name, oracle_id: `o-${name}`, name, cmc, type_line: 'Artifact', oracle_text: '', ...over }) as ScryfallCard;
const inDeck = (c: ScryfallCard, jobs: string[], over: Partial<DeckCard> = {}): DeckCard => ({ card: c, quantity: 1, roles: jobs.map((j) => (j === 'interaction' ? 'removal' : j)), jobs, plan: [], ...over });
const ranges = (over: Record<string, [number, number, number]>): JobState[] =>
  Object.entries(over).map(([id, [count, lo, hi]]) => ({ id, label: id, count, range: [lo, hi] }));

describe('what a card could replace', () => {
  const signet = card('Arcane Signet', 2);
  const deck = [
    inDeck(card('Burnished Hart', 3), ['ramp']),
    inDeck(card('Mind Stone', 2), ['ramp']),
    inDeck(card('Gilded Lotus', 5), ['ramp']),
    inDeck(card('Sol Ring', 1), ['ramp'], { protected: '★ you kept it' }),
    inDeck(card('Night\'s Whisper', 2, { type_line: 'Sorcery' }), ['draw']),
  ];

  it('offers cards doing the same job at about the same cost, never protected ones', () => {
    const out = replacements({ card: signet, roles: ['ramp'], jobs: ['ramp'], plan: [] }, deck, ranges({ ramp: [13, 11, 13] }));
    const names = out.map((o) => o.out.card.name);
    expect(names).toContain('Burnished Hart');
    expect(names).toContain('Mind Stone');
    expect(names).not.toContain('Sol Ring');
    // Five mana is more than one away from two: the curve would creep.
    expect(names).not.toContain('Gilded Lotus');
    expect(names).not.toContain('Night\'s Whisper');
    // Burnished Hart costs more than the card coming in: more replaceable.
    expect(names[0]).toBe('Burnished Hart');
    expect(out[0].how.steps.join(' ')).toMatch(/Costs more/);
  });

  it('warns when the card going out does two jobs, or its job would drop under range', () => {
    const growth = inDeck(card('Growth Spiral', 2, { type_line: 'Instant' }), ['ramp', 'draw']);
    const out = replacements({ card: signet, roles: ['ramp'], jobs: ['ramp'], plan: [] }, [growth], ranges({ ramp: [12, 11, 13], draw: [10, 10, 12] }));
    expect(out[0].warn).toMatch(/Does two jobs/);
    expect(out[0].warn).toMatch(/draw would drop to 9/);
  });

  it('offers a way to win only for another way to win', () => {
    const revel = inDeck(card('Revel in Riches', 5, { type_line: 'Enchantment' }), ['finishers'], { protected: 'way to win', route: true });
    const finisher = replacements({ card: card('Torment of Hailfire', 4), roles: ['finisher'], jobs: ['finishers'], plan: [] }, [revel], []);
    expect(finisher.map((o) => o.out.card.name)).toEqual(['Revel in Riches']);
    const ramp = replacements({ card: card('Big Rock', 5), roles: ['ramp'], jobs: ['ramp'], plan: [] }, [revel], []);
    expect(ramp).toEqual([]);
  });
});

describe('upgrades', () => {
  it('finds cheaper or instant cards for the same job, your own copies first', () => {
    const deck = [inDeck(card('Commander\'s Sphere', 3), ['ramp']), inDeck(card('Feed the Swarm', 2, { type_line: 'Sorcery', oracle_text: 'Destroy target creature or enchantment an opponent controls.' }), ['interaction'])];
    const pool = [
      { card: card('Arcane Signet', 2), roles: ['ramp'], jobs: ['ramp'], where: null },
      { card: card('Fellwar Stone', 2), roles: ['ramp'], jobs: ['ramp'], where: 'yours, Box 2' },
      { card: card('Rakdos Charm', 2, { type_line: 'Instant', oracle_text: 'Choose one — Exile target player\'s graveyard; or destroy target artifact; or each creature deals 1 damage to its controller.' }), roles: ['removal'], jobs: ['interaction'], where: null },
      { card: card('Hellkite', 6), roles: ['ramp'], jobs: ['ramp'], where: null },
    ];
    const found = upgrades(deck, pool, ['ramp', 'interaction']);
    expect(found[0]).toMatchObject({ add: { card: { name: 'Fellwar Stone' } }, out: { card: { name: 'Commander\'s Sphere' } } });
    expect(found[0].why).toMatch(/1 cheaper/);
    const charm = found.find((u) => u.add.card.name === 'Rakdos Charm');
    expect(charm?.why).toMatch(/instant speed/);
    // A dearer card is never an upgrade.
    expect(found.some((u) => u.add.card.name === 'Hellkite')).toBe(false);
  });
});

describe('interaction comes in kinds', () => {
  it('never offers a counterspell for a board wipe, nor a generic card for one the plan uses', () => {
    const wipe = inDeck(card('Blasphemous Act', 9, { type_line: 'Sorcery', oracle_text: 'Blasphemous Act deals 13 damage to each creature.' }), ['interaction'], { roles: ['wipe'] });
    const engine = inDeck(card('Archmage of Runes', 5, { type_line: 'Creature' }), ['draw'], { plan: ['Spells engine'] });
    const pool = [
      { card: card('Pyroblast', 1, { type_line: 'Instant', oracle_text: 'Choose one — Counter target spell if it is blue; or destroy target permanent if it is blue.' }), roles: ['counter', 'removal'], jobs: ['interaction'], where: null },
      { card: card('Misery Charm', 2, { type_line: 'Instant' }), roles: ['draw', 'removal', 'recursion'], jobs: ['draw', 'interaction', 'recursion'], where: null },
    ];
    const found = upgrades([wipe, engine], pool, ['interaction', 'draw']);
    expect(found).toEqual([]);
  });
});
