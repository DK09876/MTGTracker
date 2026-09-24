/**
 * Syntax or not.
 *
 * Syntax skips the model, so a false positive sends English to Scryfall as
 * if it were a query. The cases that matter are the English ones that
 * happen to contain a colon or a comparison.
 */

import { describe, expect, it } from 'vitest';

import { exactName, looksLikeSyntax } from './syntax';

describe('looksLikeSyntax', () => {
  it.each([
    't:goblin c:r',
    'set:mh3 r:mythic',
    'o:"draw a card" cmc<=2',
    'otag:ramp c:g -t:land usd<2',
    '(t:elf or t:druid) id<=g',
    'pow>=5',
    '!"Lightning Bolt"',
    '!Fireball',
    'dragon t:legendary',
  ])('treats %s as syntax', (input) => {
    expect(looksLikeSyntax(input)).toBe(true);
  });

  it.each([
    'Lightning Bolt',
    'lightnig bolt',
    'cheap green ramp that isn\'t a land',
    'best board wipes for Atraxa',
    'note: I want dragons',
    'creatures with power over 5',
    'what does 3:1 mean',
    'wow! dragons',
  ])('sends %s to the translator', (input) => {
    expect(looksLikeSyntax(input)).toBe(false);
  });
});

describe('exactName', () => {
  it('quotes a name for an exact match', () => {
    expect(exactName('Lightning Bolt')).toBe('!"Lightning Bolt"');
  });

  it('drops quotes that would end the phrase early', () => {
    expect(exactName('Kongming, "Sleeping Dragon"')).toBe('!"Kongming, Sleeping Dragon"');
  });
});
