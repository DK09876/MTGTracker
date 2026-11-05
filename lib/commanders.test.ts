import { describe, expect, it } from 'vitest';

import { canPair, deckIdentity, detectSlots, isCompanion, takesPartner } from './commanders';
import type { ScryfallCard } from './scryfall';

const card = (name: string, identity: string[], text: string, over: Partial<ScryfallCard> = {}) =>
  ({ id: name, name, color_identity: identity, oracle_text: text, type_line: 'Legendary Creature — Human', ...over }) as ScryfallCard;
const tymna = card('Tymna the Weaver', ['W', 'B'], 'Lifelink\nPartner (You can have two commanders if both have partner.)');
const thrasios = card('Thrasios, Triton Hero', ['G', 'U'], '{4}: Scry 1.\nPartner (You can have two commanders if both have partner.)');
const kraum = card('Kraum, Ludevic\'s Opus', ['U', 'R'], 'Flying, haste\nPartner (You can have two commanders if both have partner.)');
const wilson = card('Wilson, Refined Grizzly', ['G'], 'Choose a Background (You can have a Background as a second commander.)');
const giants = card('Raised by Giants', ['G'], 'Commander creatures you own have base power and toughness 10/10.', { type_line: 'Legendary Enchantment — Background' });
const prosper = card('Prosper, Tome-Bound', ['B', 'R'], 'Deathtouch\nMystic Arcanum — At the beginning of your end step, exile the top card of your library.');
const obosh = card('Obosh, the Preypiercer', ['B', 'R'], 'Companion — Each nonland card in your starting deck has an odd mana value.', { keywords: ['Companion'] });
const lurrus = card('Lurrus of the Dream-Den', ['W', 'B'], 'Companion — Each permanent card in your starting deck has mana value 2 or less.', { keywords: ['Companion'] });
const jegantha = card('Jegantha, the Wellspring', ['R', 'G'], 'Companion — No card in your starting deck has more than one of the same mana symbol in its mana cost.', { keywords: ['Companion'] });
const bolt = card('Lightning Bolt', ['R'], 'Lightning Bolt deals 3 damage to any target.', { type_line: 'Instant' });

describe('pairs', () => {
  it('knows which commanders take a second one, and which two go together', () => {
    expect(takesPartner(tymna)).toBe(true);
    expect(takesPartner(wilson)).toBe(true);
    expect(takesPartner(prosper)).toBe(false);
    expect(canPair(tymna, thrasios)).toBe(true);
    expect(canPair(wilson, giants)).toBe(true);
    expect(canPair(wilson, tymna)).toBe(false);
    expect(canPair(tymna, tymna)).toBe(false);
  });

  it('reads companions from the keyword, and a deck\'s colours from both commanders', () => {
    expect(isCompanion(obosh)).toBe(true);
    expect(isCompanion(prosper)).toBe(false);
    expect([...deckIdentity([tymna, thrasios])].sort()).toEqual(['B', 'G', 'U', 'W']);
    expect([...deckIdentity([prosper, null])].sort()).toEqual(['B', 'R']);
  });
});

const main = (c: ScryfallCard, more: object = {}) => ({ card: c, board: 'main', ...more });
const side = (c: ScryfallCard, more: object = {}) => ({ card: c, board: 'side', ...more });

describe('detectSlots', () => {
  it('takes the only card that can partner, and asks when several could', () => {
    expect(detectSlots({ commander: tymna, cards: [main(thrasios), main(bolt)] }))
      .toEqual({ partner: 'Thrasios, Triton Hero', companion: null, ask: [] });
    const both = detectSlots({ commander: tymna, cards: [main(thrasios), main(kraum)] });
    expect(both.partner).toBeNull();
    expect(both.ask).toEqual([{ kind: 'partner', options: ['Thrasios, Triton Hero', 'Kraum, Ludevic\'s Opus'] }]);
  });

  it('takes a second commander the list named, even when another could partner too', () => {
    const out = detectSlots({ commander: tymna, cards: [main(thrasios, { explicit: 'commander' }), main(kraum)] });
    expect(out).toEqual({ partner: 'Thrasios, Triton Hero', companion: null, ask: [] });
  });

  it('looks for a partner only when the commander takes one', () => {
    expect(detectSlots({ commander: prosper, cards: [main(tymna)] }).partner).toBeNull();
  });

  it('takes a companion from outside the deck in its colours, never one in the 99', () => {
    expect(detectSlots({ commander: prosper, cards: [side(obosh)] }).companion).toBe('Obosh, the Preypiercer');
    expect(detectSlots({ commander: prosper, cards: [main(obosh)] }).companion).toBeNull();
    // Jegantha is green: not Prosper's colours.
    expect(detectSlots({ commander: prosper, cards: [side(jegantha)] }).companion).toBeNull();
  });

  it('asks which companion when two could be, unless the list named one', () => {
    const deck = { commander: tymna, cards: [side(lurrus), { card: obosh, board: 'maybe' }] };
    // Obosh is black-red: Tymna alone can't have it, Tymna with Kraum can.
    expect(detectSlots(deck).companion).toBe('Lurrus of the Dream-Den');
    const pair = detectSlots({ commander: tymna, cards: [main(kraum), side(lurrus), side(obosh)] });
    expect(pair.partner).toBe('Kraum, Ludevic\'s Opus');
    expect(pair.ask).toEqual([{ kind: 'companion', options: ['Lurrus of the Dream-Den', 'Obosh, the Preypiercer'] }]);
    const named = detectSlots({ commander: tymna, cards: [main(kraum), side(lurrus), side(obosh, { explicit: 'companion' })] });
    expect(named.companion).toBe('Obosh, the Preypiercer');
  });

  it('leaves alone what the deck already has', () => {
    const out = detectSlots({ commander: tymna, cards: [main(thrasios, { slot: 'partner' }), main(kraum), side(lurrus, { slot: 'companion' }), side(obosh)] });
    expect(out).toEqual({ partner: null, companion: null, ask: [] });
  });
});
