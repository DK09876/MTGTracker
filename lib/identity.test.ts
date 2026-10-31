import { describe, expect, it } from 'vitest';

import { symbolClass } from '@/components/ManaCost';
import { identityColours, identityStops, identityStyle, MANA } from './identity';

describe('identity', () => {
  it('orders colours WUBRG and calls none colourless', () => {
    expect(identityColours('GR')).toEqual(['R', 'G']);
    expect(identityColours(['G', 'B', 'R'])).toEqual(['B', 'R', 'G']);
    expect(identityColours('')).toEqual(['C']);
    expect(identityColours(null)).toEqual(['C']);
  });

  it('gives three stops for any number of colours', () => {
    expect(identityStops('RG')).toEqual([MANA.R, MANA.G, MANA.G]);
    expect(identityStops('URW')).toEqual([MANA.W, MANA.U, MANA.R]);
    expect(identityStops('WUBRG')).toEqual([MANA.W, MANA.U, MANA.B]);
    const mono = identityStops('G');
    expect(mono[0]).toBe(MANA.G);
    expect(mono[1]).not.toBe(MANA.G);
    expect(identityStyle('B')).toMatchObject({ '--c1': MANA.B });
  });
});

describe('symbolClass', () => {
  it('maps Scryfall symbols to the Mana font', () => {
    expect(symbolClass('W')).toBe('ms-w');
    expect(symbolClass('2')).toBe('ms-2');
    expect(symbolClass('W/U')).toBe('ms-wu ms-split');
    expect(symbolClass('2/W')).toBe('ms-2w ms-split');
    expect(symbolClass('G/P')).toBe('ms-gp');
    expect(symbolClass('T')).toBe('ms-tap');
    expect(symbolClass('X')).toBe('ms-x');
  });
});
