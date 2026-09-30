import { describe, expect, it } from 'vitest';

import { findMentions, nameIndex } from './names';

const names = [
  'Blade of Selves', 'Kratos, God of War', 'Kratos, Stoic Father', 'Blasphemous Act', 'Opt', 'Fog', 'Counterspell',
  'Response // Resurgence', 'Stop Cold', 'Stop That', 'Does Machines', 'Clone', 'Hearthhull, the Worldseed',
  'Atraxa, Grand Unifier', "Atraxa, Praetors' Voice", 'Delver of Secrets // Insectile Aberration',
];
const idx = nameIndex(names);
// The rules' own words, as vocabulary() gives them.
const ordinary = new Set(['stop', 'response', 'clone', 'damage', 'trample', 'creature', 'dies', 'copied']);
const find = (q: string) => findMentions(q, idx, ordinary);

describe('findMentions', () => {
  it('finds full names, with or without the comma', () => {
    expect(find('how does blade of selves interact with kratos, stoic father').cards).toEqual(['Blade of Selves', 'Kratos, Stoic Father']);
    expect(find('does blasphemous act kill it').cards).toEqual(['Blasphemous Act']);
  });

  it('asks which card when a word begins several names', () => {
    expect(find('how does blade of selves interact with kratos')).toEqual({
      cards: ['Blade of Selves'],
      ambiguous: [{ mention: 'kratos', options: ['Kratos, God of War', 'Kratos, Stoic Father'] }],
    });
  });

  it('takes one card for a word that begins one name, and a double-faced card by its front', () => {
    expect(find('what if hearthhull gets copied').cards).toEqual(['Hearthhull, the Worldseed']);
    expect(find('does delver of secrets flip').cards).toEqual(['Delver of Secrets // Insectile Aberration']);
  });

  it('leaves ordinary and rules words alone unless written as a name', () => {
    expect(find('does fog stop damage from a creature with trample')).toEqual({ cards: [], ambiguous: [] });
    expect(find('Can I Opt in response to Counterspell?').cards).toEqual(['Opt', 'Counterspell']);
    expect(find('copied by a clone').cards).toEqual([]);
    expect(find('copied by Clone').cards).toEqual(['Clone']);
    expect(find('Does it trigger?').cards).toEqual([]);
  });
});
