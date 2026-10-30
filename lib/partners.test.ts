import { describe, expect, it } from 'vitest';

import { edhrecSlug } from './edhrec';
import { scoped } from './interpret';
import { canPartner, mergePair, splitPair } from './partners';
import type { ScryfallCard } from './scryfall';

const card = (name: string, identity: string[], text: string, type = 'Legendary Creature — God') =>
  ({ id: name, name, color_identity: identity, oracle_text: text, type_line: type, mana_cost: '{1}' }) as ScryfallCard;
const kratos = card('Kratos, Stoic Father', ['R', 'W'], 'Whenever you attack...\nPartner—Father & son (You can have two commanders if both have this ability.)');
const atreus = card('Atreus, Impulsive Son', ['U', 'R'], 'Reach\nPartner—Father & son (You can have two commanders if both have this ability.)');
const godOfWar = card('Kratos, God of War', ['R'], 'Double strike');
const tymna = card('Tymna the Weaver', ['W', 'B'], 'Lifelink\nPartner (You can have two commanders if both have partner.)');
const thrasios = card('Thrasios, Triton Hero', ['G', 'U'], '{4}: Scry 1...\nPartner (You can have two commanders if both have partner.)');
const will = card('Will Kenrith', ['U'], 'Partner with Rowan Kenrith (When this creature enters...)');
const rowan = card('Rowan Kenrith', ['R'], 'Partner with Will Kenrith (When this creature enters...)');
const wilson = card('Wilson, Refined Grizzly', ['G'], 'Choose a Background (You can have a Background as a second commander.)');
const background = card('Raised by Giants', ['G'], 'Commander creatures you own have base power and toughness 10/10.', 'Legendary Enchantment — Background');

describe('splitPair', () => {
  it('splits two names, and leaves one alone', () => {
    expect(splitPair('Kratos and Atreus')).toEqual(['Kratos', 'Atreus']);
    expect(splitPair('Tymna + Thrasios')).toEqual(['Tymna', 'Thrasios']);
    expect(splitPair('Kratos, Stoic Father')).toBeNull();
  });
});

describe('canPartner', () => {
  it('pairs the same partner kind, a named partner both ways, and a Background with its chooser', () => {
    expect(canPartner(kratos, atreus)).toBe(true);
    expect(canPartner(tymna, thrasios)).toBe(true);
    expect(canPartner(will, rowan)).toBe(true);
    expect(canPartner(wilson, background)).toBe(true);
  });
  it('refuses cards that cannot lead together', () => {
    expect(canPartner(godOfWar, atreus)).toBe(false);
    expect(canPartner(kratos, tymna)).toBe(false); // a Partner variant only pairs with its own kind
    expect(canPartner(will, tymna)).toBe(false);
    expect(canPartner(background, background)).toBe(false);
  });
});

describe('mergePair', () => {
  it('is one commander for search: both colours, EDHREC\'s name for the pair, neither card in the results', () => {
    const pair = mergePair(kratos, atreus);
    expect(pair.name).toBe('Atreus, Impulsive Son + Kratos, Stoic Father');
    expect(edhrecSlug(pair.name)).toBe('atreus-impulsive-son-kratos-stoic-father');
    expect(pair.color_identity).toEqual(['W', 'U', 'R']);
    expect(pair.oracle_text).toContain('Kratos, Stoic Father: Whenever you attack');
    const q = scoped('t:creature', pair);
    expect(q).toContain('id<=wur');
    expect(q).toContain('-!"Atreus, Impulsive Son"');
    expect(q).toContain('-!"Kratos, Stoic Father"');
  });
});
