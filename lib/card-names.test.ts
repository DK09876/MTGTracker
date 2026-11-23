import { describe, expect, it } from 'vitest';

import { findMentions, nameIndex, nearNames, withPick } from './card-names';

const names = [
  'Blade of Selves', 'Kratos, God of War', 'Kratos, Stoic Father', 'Blasphemous Act', 'Opt', 'Fog', 'Counterspell',
  'Response // Resurgence', 'Stop Cold', 'Stop That', 'Does Machines', 'Clone', 'Hearthhull, the Worldseed',
  'Atraxa, Grand Unifier', "Atraxa, Praetors' Voice", 'Delver of Secrets // Insectile Aberration',
  "Can't Quite Recall", "Can't Stay Away", 'Soldier of Fortune', 'Soldier On',
  'Forsaken Monument', 'Forsaken Crossroads', 'Monument to Endurance', 'Monument to Perfection',
];
const idx = nameIndex(names);
// The rules' own words, as vocabulary() gives them.
const ordinary = new Set(['soldier', 'stop', 'response', 'clone', 'damage', 'trample', 'creature', 'dies', 'copied']);
const find = (q: string) => findMentions(q, idx, ordinary);

describe('findMentions', () => {
  it('reads a type before "tokens" as the type, not a card', () => {
    expect(find('How many Soldier tokens do I get from Hero of Bladehold?').ambiguous).toEqual([]);
  });

  it('reads a contraction as English, not the start of a name', () => {
    expect(find("Can I counter a spell that can't be countered?")).toEqual({ cards: [], ambiguous: [] });
  });

  it('finds full names, with or without the comma', () => {
    expect(find('how does blade of selves interact with kratos, stoic father').cards).toEqual(['Blade of Selves', 'Kratos, Stoic Father']);
    expect(find('does blasphemous act kill it').cards).toEqual(['Blasphemous Act']);
  });

  it('finds a name with a plural last word, and never a similar name instead', () => {
    expect(find('what do forsaken monuments do')).toEqual({ cards: ['Forsaken Monument'], ambiguous: [] });
    expect(find('does forsaken monument boost colorless creatures')).toEqual({ cards: ['Forsaken Monument'], ambiguous: [] });
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

describe('findMentions, misspelt names', () => {
  const typoIdx = nameIndex([...names, 'Inniaz, the Gale Force', 'Gale Force', 'Redirect', 'Rally the Ranks', 'Force of Will', 'Sheoldred, the Apocalypse', 'Counterspell', "Teferi's Protection", "Thassa's Oracle", 'Oracle', 'Protector of the Crown']);
  const typo = (q: string) => findMentions(q, typoIdx, new Set([...ordinary, 'redirected', 'force']));

  it('offers the misspelt name, and the exact name found inside it, never taking either', () => {
    expect(typo('Can you use a redirect spell on Innaiz, the gale force')).toEqual({
      cards: ['Redirect'],
      ambiguous: [{ mention: 'Innaiz, the gale force', options: ['Inniaz, the Gale Force', 'Gale Force'], typo: true }],
    });
    expect(typo('can i redirect innaiz the gale force').ambiguous[0].options).toEqual(['Inniaz, the Gale Force', 'Gale Force']);
  });

  it('offers a misspelt word written as a name on its own', () => {
    expect(typo('Can I target Innaiz?').ambiguous).toEqual([{ mention: 'Innaiz', options: ['Inniaz, the Gale Force'], typo: true }]);
    expect(typo('Does Sheoldredd trigger on my draws?').ambiguous[0].options).toEqual(['Sheoldred, the Apocalypse']);
  });

  it('leaves exact names as they were', () => {
    expect(typo('Can you redirect Inniaz, the gale force')).toEqual({ cards: ['Inniaz, the Gale Force', 'Redirect'], ambiguous: [] });
    expect(typo('does gale force kill inniaz').cards).toEqual(['Gale Force', 'Inniaz, the Gale Force']);
  });

  it("finds a name with an apostrophe, written with or without it, and a typo in it", () => {
    expect(typo("Can I flash in Teferi's Protection during combat?").cards).toEqual(["Teferi's Protection"]);
    expect(typo('Does Thassas Oracle win with an empty library').cards).toEqual(["Thassa's Oracle"]);
    expect(typo("Can I flash in Teferi's Protecton during combat?").ambiguous).toEqual([{ mention: "Teferi's Protecton", options: ["Teferi's Protection"], typo: true }]);
  });

  it('never takes ordinary words for a misspelt name', () => {
    expect(typo('does it really work if it was redirected')).toEqual({ cards: [], ambiguous: [] });
    expect(typo('can my creatur block')).toEqual({ cards: [], ambiguous: [] });
    expect(typo('How many Soldier tokens do I get?').ambiguous).toEqual([]);
  });
});

describe('nearNames and withPick', () => {
  const idx = nameIndex(['Inniaz, the Gale Force', 'Gale Force', 'Sol Ring', 'Kratos, God of War', 'Kratos, Stoic Father']);

  it('finds the closest name to one no card has, never a shorter name inside it', () => {
    expect(nearNames('Innaiz, the Gale Force', idx)).toEqual(['Inniaz, the Gale Force']);
    expect(nearNames('Sol Rign', idx)).toEqual(['Sol Ring']);
    expect(nearNames('Zzyzx Qwop', idx)).toEqual([]);
  });

  it('puts the picked card in place of the words, marked', () => {
    expect(withPick('Can you use a redirect spell on Innaiz, the gale force', 'Innaiz, the gale force', 'Inniaz, the Gale Force'))
      .toBe('Can you use a redirect spell on [[Inniaz, the Gale Force]]');
    expect(withPick('what about teferi’s protecton?', "teferi's protecton", "Teferi's Protection")).toBe("what about [[Teferi's Protection]]?");
  });
});
