import { describe, expect, it } from 'vitest';

import { bestNameLine, cleanName, nameMatches, readBottomLine, similarity } from './scan';

describe('readBottomLine', () => {
  it('reads the 2015-2022 frame: number over total, set and language', () => {
    expect(readBottomLine('263/281 U\nC21 • EN > Mike Bierek')).toEqual({ number: '263', set: 'c21' });
  });
  it('reads the newer frame: rarity then a zero-padded number', () => {
    expect(readBottomLine('U 0091\nEOC • EN  Artist Name')).toEqual({ number: '91', set: 'eoc' });
  });
  it('forgives OCR noise: a bullet as *, O for 0', () => {
    expect(readBottomLine('C O158\nTDC * EN ~ Craig J Spearing')).toEqual({ number: '158', set: 'tdc' });
    expect(readBottomLine('046/249 U\nIMA . EN')).toEqual({ number: '46', set: 'ima' });
  });
  it('reads the set when OCR turns the bullet into guillemets', () => {
    expect(readBottomLine('M 0001 &5\nEOC « EN » DANIEL LJUNGGREN')).toEqual({ number: '1', set: 'eoc' });
    expect(readBottomLine('177/274 UV\nM21 » EN » ANTHONY PALUMBO')).toEqual({ number: '177', set: 'm21' });
  });

  it('never takes the digits of a set code for the number', () => {
    expect(readBottomLine('C21 » EN » MIKE BIEREK')).toEqual({ set: 'c21' });
    expect(readBottomLine('2XM + EN Todd LOCKWOOD')).toEqual({ set: '2xm' });
  });

  it('finds nothing on an old card, and does not take the language for a set', () => {
    expect(readBottomLine('Illus. Mark Tedin')).toEqual({});
    expect(readBottomLine('EN')).toEqual({});
  });
});

describe('cleanName', () => {
  it('trims marks OCR puts around the name bar', () => {
    expect(cleanName('| Hearthhull, the Worldseed ~')).toBe('Hearthhull, the Worldseed');
    expect(cleanName('Borrowing 100,000 Arrows 2U')).toBe('Borrowing 100,000 Arrows 2U');
    expect(cleanName('  _Opt_  ')).toBe('Opt');
  });
});

describe('bestNameLine', () => {
  it('picks the name out of what the frame adds around it', () => {
    expect(bestNameLine('Ny\n\n( Sol Ring')).toBe('Sol Ring');
    expect(bestNameLine('5 000 2 NS QC\nSwords to Plowshares')).toBe('Swords to Plowshares');
    expect(bestNameLine('- \n\nre\n\nLotus cobra')).toBe('Lotus cobra');
    expect(bestNameLine('( Opt')).toBe('Opt');
    expect(bestNameLine('O Delver of Secrets')).toBe('Delver of Secrets');
    expect(bestNameLine('Beast Within a')).toBe('Beast Within');
    expect(bestNameLine('00 0 2\n--')).toBe('');
  });
});

describe('matching names', () => {
  it('accepts a close read and refuses another card', () => {
    expect(similarity('Lightnlng Bolt', 'Lightning Bolt')).toBeGreaterThan(0.9);
    expect(nameMatches('Hearthhull the Worldseed', 'Hearthhull, the Worldseed')).toBe(true);
    expect(nameMatches('Delver of Secrets', 'Delver of Secrets // Insectile Aberration')).toBe(true);
    expect(nameMatches('Murasa Pyromancer', 'Lotus Cobra')).toBe(false);
    expect(nameMatches('', 'Opt')).toBe(false);
  });
});
