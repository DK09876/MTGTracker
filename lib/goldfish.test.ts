import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from './scryfall';
import { bestHand, canPay, goldfish, playGame, rng, simCard, simDeck } from './goldfish';

const card = (name: string, extra: Partial<ScryfallCard>): ScryfallCard => ({ id: name, name, ...extra }) as ScryfallCard;

const forest = card('Forest', { type_line: 'Basic Land — Forest', produced_mana: ['G'], cmc: 0 });
const island = card('Island', { type_line: 'Basic Land — Island', produced_mana: ['U'], cmc: 0 });
const tapland = card('Thornwood Falls', { type_line: 'Land', produced_mana: ['G', 'U'], oracle_text: 'Thornwood Falls enters tapped.\nWhen it enters, you gain 1 life.\n{T}: Add {G} or {U}.' });
const checkland = card('Hinterland Harbor', { type_line: 'Land', produced_mana: ['G', 'U'], oracle_text: 'Hinterland Harbor enters tapped unless you control a Forest or an Island.' });
const solRing = card('Sol Ring', { type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '{T}: Add {C}{C}.' });
const signet = card('Simic Signet', { type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '{1}, {T}: Add {G}{U}.', produced_mana: ['G', 'U'] });
const elves = card('Llanowar Elves', { type_line: 'Creature — Elf Druid', mana_cost: '{G}', cmc: 1, oracle_text: '{T}: Add {G}.', produced_mana: ['G'] });
const cultivate = card('Cultivate', { type_line: 'Sorcery', mana_cost: '{2}{G}', cmc: 3, oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.' });
const bear = card('Grizzly Bears', { type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2 });
const counter = card('Counterspell', { type_line: 'Instant', mana_cost: '{U}{U}', cmc: 2 });
const big = card('Craterhoof Behemoth', { type_line: 'Creature — Beast', mana_cost: '{5}{G}{G}{G}', cmc: 8 });
const mdfc = card('Turntimber Symbiosis', { type_line: 'Sorcery // Land', mana_cost: '{4}{G}{G}{G}', cmc: 7, card_faces: [
  { name: 'Turntimber Symbiosis', type_line: 'Sorcery', mana_cost: '{4}{G}{G}{G}' },
  { name: 'Turntimber, Serpentine Wood', type_line: 'Land', oracle_text: 'As Turntimber, Serpentine Wood enters, you may pay 3 life. If you don\'t, it enters tapped.' },
] as ScryfallCard['card_faces'] });
const commander = simCard(card('Tatyova, Benthic Druid', { type_line: 'Legendary Creature', mana_cost: '{3}{G}{U}', cmc: 5 }));

describe('reading cards', () => {
  it('sorts lands, rocks, dorks and land ramp', () => {
    expect(simCard(forest)).toMatchObject({ kind: 'land', colors: ['G'], tapped: false });
    expect(simCard(tapland).tapped).toBe(true);
    expect(simCard(checkland).tapped).toBe(false);
    expect(simCard(mdfc).kind).toBe('land');
    expect(simCard(solRing)).toMatchObject({ kind: 'rock', makes: 2 });
    expect(simCard(elves)).toMatchObject({ kind: 'dork', colors: ['G'] });
    expect(simCard(cultivate)).toMatchObject({ kind: 'landRamp', fetches: 1 });
    expect(simCard(counter)).toMatchObject({ kind: 'spell', pips: { U: 2 }, generic: 0 });
  });
});

describe('paying for spells', () => {
  const src = (colors: string[], makes = 1) => ({ colors, makes, ready: true });
  it('needs the right colours, not just enough mana', () => {
    expect(canPay(simCard(counter), [src(['G']), src(['G'])])).toBeNull();
    expect(canPay(simCard(counter), [src(['U']), src(['G', 'U'])])).not.toBeNull();
  });
  it('spends a basic before a dual for a single colour', () => {
    const paid = canPay(simCard(bear), [src(['G', 'U']), src(['G']), src(['G', 'U'])]);
    expect(paid).toContain(1);
    expect(paid).toHaveLength(2);
  });
  it('counts a rock that makes two', () => {
    expect(canPay(simCard(bear), [src(['C'], 2), src(['G'])])).toHaveLength(2);
    expect(canPay(simCard(bear), [src(['C'], 2)])).toBeNull();
  });
});

describe('a game', () => {
  const deck = simDeck([
    { card: forest, quantity: 20 }, { card: island, quantity: 14 }, { card: tapland, quantity: 3 },
    { card: solRing, quantity: 1 }, { card: signet, quantity: 1 }, { card: elves, quantity: 4 }, { card: cultivate, quantity: 4 },
    { card: bear, quantity: 30 }, { card: counter, quantity: 15 }, { card: big, quantity: 7 },
  ]);

  it('plays a land a turn and casts the commander when it can', () => {
    const log = playGame(deck, commander, rng(3), { turns: 8, mulligan: true, drawFirst: true });
    expect(log.lands).toHaveLength(8);
    for (let t = 1; t < 8; t++) expect(log.lands[t]).toBeGreaterThanOrEqual(log.lands[t - 1]);
    expect(log.commanderTurn).not.toBeNull();
  });

  it('is repeatable from a seed', () => {
    expect(goldfish(deck, commander, 200, 9)).toEqual(goldfish(deck, commander, 200, 9));
  });

  it('reports sensible numbers for a normal deck', () => {
    const r = goldfish(deck, commander, 1000, 1);
    expect(r.commanderAverage!).toBeGreaterThan(3);
    expect(r.commanderAverage!).toBeLessThan(6.5);
    expect(r.commanderBy[7]).toBeGreaterThan(0.85);
    expect(r.manaByTurn[2]).toBeGreaterThan(2.5);
    expect(r.missedLandBy[3]).toBeLessThan(0.3);
    expect(r.stuck[0]?.name).toBe('Craterhoof Behemoth');
  });

  it('a land-light deck misses more land drops', () => {
    const light = simDeck([{ card: forest, quantity: 25 }, { card: bear, quantity: 74 }]);
    const heavy = simDeck([{ card: forest, quantity: 40 }, { card: bear, quantity: 59 }]);
    expect(goldfish(light, null, 600, 2).missedLandBy[4]).toBeGreaterThan(goldfish(heavy, null, 600, 2).missedLandBy[4]);
  });
});

describe('the best hand', () => {
  it('picks lands and early mana over expensive cards', () => {
    const deck = simDeck([
      { card: forest, quantity: 20 }, { card: island, quantity: 16 }, { card: solRing, quantity: 1 }, { card: elves, quantity: 2 },
      { card: bear, quantity: 20 }, { card: big, quantity: 20 }, { card: counter, quantity: 20 },
    ]);
    const best = bestHand(deck, commander, { beam: 3, trials: 15 });
    expect(best.cards).toHaveLength(7);
    expect(best.cards).toContain('Sol Ring');
    expect(best.cards).not.toContain('Craterhoof Behemoth');
    const lands = best.cards.filter((n) => n === 'Forest' || n === 'Island').length;
    expect(lands).toBeGreaterThanOrEqual(2);
    expect(lands).toBeLessThanOrEqual(5);
    expect(best.commanderAverage!).toBeLessThan(4);
  });
});
