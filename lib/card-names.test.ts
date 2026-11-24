import { describe, expect, it } from 'vitest';

import { findMentions, markText, nameIndex, NOT_A_CARD, phrasesForPick } from './card-names';

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
// What a test checks: the cards and the questions (spans have their own tests).
const brief = ({ cards, ambiguous }: ReturnType<typeof findMentions>) => ({ cards, ambiguous });
const quiet = (m: ReturnType<typeof findMentions>) => ({ cards: m.cards, ambiguous: m.ambiguous, suggestions: m.suggestions });
const find = (q: string) => brief(findMentions(q, idx, ordinary));

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
      ambiguous: [{ mention: 'kratos', options: ['Kratos, God of War', 'Kratos, Stoic Father'], kind: 'several' }],
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
  const typo = (q: string) => brief(findMentions(q, typoIdx, new Set([...ordinary, 'redirected', 'force'])));

  it('offers the misspelt name, and the exact name found inside it, never taking either', () => {
    expect(typo('Can you use a redirect spell on Innaiz, the gale force')).toEqual({
      cards: ['Redirect'],
      ambiguous: [{ mention: 'Innaiz, the gale force', options: ['Inniaz, the Gale Force', 'Gale Force'], kind: 'typo' }],
    });
    expect(typo('can i redirect innaiz the gale force').ambiguous[0].options).toEqual(['Inniaz, the Gale Force', 'Gale Force']);
  });

  it('offers a misspelt word written as a name on its own', () => {
    expect(typo('Can I target Innaiz?').ambiguous).toEqual([{ mention: 'Innaiz', options: ['Inniaz, the Gale Force'], kind: 'typo' }]);
    expect(typo('Does Sheoldredd trigger on my draws?').ambiguous[0].options).toEqual(['Sheoldred, the Apocalypse']);
  });

  it('leaves exact names as they were', () => {
    expect(typo('Can you redirect Inniaz, the gale force')).toEqual({ cards: ['Inniaz, the Gale Force', 'Redirect'], ambiguous: [] });
    expect(typo('does gale force kill inniaz').cards).toEqual(['Gale Force', 'Inniaz, the Gale Force']);
  });

  it("finds a name with an apostrophe, written with or without it, and a typo in it", () => {
    expect(typo("Can I flash in Teferi's Protection during combat?").cards).toEqual(["Teferi's Protection"]);
    expect(typo('Does Thassas Oracle win with an empty library').cards).toEqual(["Thassa's Oracle"]);
    expect(typo("Can I flash in Teferi's Protecton during combat?").ambiguous).toEqual([{ mention: "Teferi's Protecton", options: ["Teferi's Protection"], kind: 'typo' }]);
  });

  it('catches a four-letter typo inside a full name, never on its own', () => {
    const idx2 = nameIndex(['Sol Ring', 'Rally the Ranks']);
    expect(findMentions('is Sol Rnig worth keeping', idx2).ambiguous).toEqual([{ mention: 'Sol Rnig', options: ['Sol Ring'], kind: 'typo' }]);
    expect(findMentions('is the Rnig good', idx2).ambiguous).toEqual([]);
  });

  it('never takes ordinary words for a misspelt name', () => {
    expect(typo('does it really work if it was redirected')).toEqual({ cards: [], ambiguous: [] });
    expect(typo('can my creatur block')).toEqual({ cards: [], ambiguous: [] });
    expect(typo('How many Soldier tokens do I get?').ambiguous).toEqual([]);
  });
});

describe('findMentions, only cards we are sure of', () => {
  const sureIdx = nameIndex([
    'Flicker', 'Lightning Bolt', 'Last Chance', 'Rhystic Study', 'Really Charming Prince', 'Really Epic Punch', 'Wrath of God',
    'Wrath of the Skies', 'Inniaz, the Gale Force', 'Gale Force', 'Kratos, God of War', 'Kratos, Stoic Father', 'Blade of Selves',
  ]);
  const everyday = new Set(['flicker', 'lightning', 'bolt', 'last', 'chance', 'study', 'really', 'wrath', 'gale', 'force', 'blade']);
  const read = (q: string, opts: Parameters<typeof findMentions>[3] = {}) => findMentions(q, sureIdx, ordinary, { everyday, ...opts });

  it('leaves an everyday word as a word unless written as a name, offering the card quietly', () => {
    expect(quiet(read('can I bounce my commander with a flicker effect'))).toEqual({ cards: [], ambiguous: [], suggestions: [{ mention: 'flicker', name: 'Flicker' }] });
    expect(read('can I respond to Flicker').cards).toEqual(['Flicker']);
    expect(brief(read('does it really work'))).toEqual({ cards: [], ambiguous: [] });
    expect(brief(read('does a wrath kill everything'))).toEqual({ cards: [], ambiguous: [] });
    expect(read('does a Wrath kill everything').ambiguous[0]).toMatchObject({ mention: 'Wrath', kind: 'several' });
  });

  it('offers a two-word name in everyday words, never asking, and takes one that is plainly a name', () => {
    expect(quiet(read('is this my last chance'))).toEqual({ cards: [], ambiguous: [], suggestions: [{ mention: 'last chance', name: 'Last Chance' }] });
    expect(read('can lightning bolt kill it').suggestions).toEqual([{ mention: 'lightning bolt', name: 'Lightning Bolt' }]);
    expect(read('can Lightning Bolt kill it').cards).toEqual(['Lightning Bolt']);
    expect(read('does rhystic study trigger').cards).toEqual(['Rhystic Study']);
    expect(read('how does blade of selves work').cards).toEqual(['Blade of Selves']);
  });

  it('takes a card in play without asking', () => {
    expect(read('how does kratos attack', { known: ['Kratos, Stoic Father'] })).toMatchObject({ cards: ['Kratos, Stoic Father'], ambiguous: [] });
    expect(read('can lightning bolt kill it', { known: ['Lightning Bolt'] })).toMatchObject({ cards: ['Lightning Bolt'], suggestions: [] });
    const r = read('can I redirect Innaiz, the gale force', { known: ['Inniaz, the Gale Force'] });
    expect(r.cards).toEqual(['Inniaz, the Gale Force']);
    expect(r.spans).toEqual([{ mention: 'Innaiz, the gale force', name: 'Inniaz, the Gale Force', how: 'known' }]);
  });

  it('takes an earlier pick without asking, including just the misspelt word', () => {
    const remembered = new Map(phrasesForPick('Innaiz, the gale force', 'Inniaz, the Gale Force', 'typo', sureIdx).map((p) => [p, 'Inniaz, the Gale Force']));
    expect([...remembered.keys()]).toEqual(['innaiz the gale force', 'innaiz']);
    const r = read('what about innaiz attacking', { remembered });
    expect(r.cards).toEqual(['Inniaz, the Gale Force']);
    expect(r.spans).toEqual([{ mention: 'innaiz', name: 'Inniaz, the Gale Force', how: 'remembered' }]);
    const closed = new Map([['last chance', NOT_A_CARD]]);
    expect(quiet(read('is this my last chance', { remembered: closed }))).toEqual({ cards: [], ambiguous: [], suggestions: [] });
    // Closed in lower case; written with capitals, it's the card again.
    expect(read('can I copy Last Chance', { remembered: closed }).cards).toEqual(['Last Chance']);
  });
});

describe('markText', () => {
  it('marks the cards where their words were, and leaves marks already there alone', () => {
    expect(markText('Can you redirect innaiz, the gale force?', [{ mention: 'innaiz, the gale force', name: 'Inniaz, the Gale Force' }]))
      .toBe('Can you redirect [[Inniaz, the Gale Force]]?');
    expect(markText('what about teferi’s protection', [{ mention: "teferi's protection", name: "Teferi's Protection" }])).toBe("what about [[Teferi's Protection]]");
    expect(markText('[[Sol Ring]] or sol ring', [{ mention: 'sol ring', name: 'Sol Ring' }])).toBe('[[Sol Ring]] or [[Sol Ring]]');
    expect(markText('a Flickering flicker', [{ mention: 'flicker', name: 'Flicker' }])).toBe('a Flickering [[Flicker]]');
  });
});
