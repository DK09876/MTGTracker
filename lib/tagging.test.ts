import { describe, expect, it } from 'vitest';

import type { ScryfallCard } from './scryfall';
import {
  assignMessage, auditMessage, describeCard, parseAssignments, parseAudit, parseProposals, proposeMessage,
  type AuditInput, type DeckCard,
} from './tagging';
import type { Tag } from './tags';

const card = (name: string, extra: Partial<ScryfallCard> = {}) =>
  ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Creature — Human', oracle_text: `${name} text`, ...extra }) as ScryfallCard;

const deck: DeckCard[] = [
  { key: 'c1', card: card('Korvold, Fae-Cursed King'), quantity: 1, commander: true },
  { key: 'c2', card: card('Viscera Seer', { oracle_text: 'Sacrifice a creature: Scry 1.', power: '1', toughness: '1' }), quantity: 1, roles: ['Card advantage'] },
  { key: 'c3', card: card('Bitterblossom', { type_line: 'Tribal Enchantment — Faerie' }), quantity: 1 },
  { key: 'c4', card: card('Delver of Secrets // Insectile Aberration', {
    oracle_text: undefined,
    card_faces: [
      { name: 'Delver of Secrets', oracle_text: 'Look at the top card.', power: '1', toughness: '1' },
      { name: 'Insectile Aberration', oracle_text: 'Flying', power: '3', toughness: '2' },
    ],
  }), quantity: 2 },
];

const tag = (id: string, name: string, extra: Partial<Tag> = {}): Tag => ({
  id, name, description: `${name} test`, color: '#e0b64a', kind: null, status: 'accepted', origin: 'ai', position: 0, examples: [], ...extra,
});

describe('describeCard', () => {
  it('gives the model every face, the stats and the known roles', () => {
    expect(describeCard(deck[1], 'c2')).toContain('Sacrifice a creature: Scry 1.');
    expect(describeCard(deck[1], 'c2')).toContain('(1/1)');
    expect(describeCard(deck[1], 'c2')).toContain('Scryfall roles: Card advantage');
    const delver = describeCard(deck[3], 'c4');
    expect(delver).toContain('2x');
    expect(delver).toContain('Insectile Aberration: Flying');
    expect(delver).toContain('Insectile Aberration 3/2');
    expect(describeCard(deck[0], 'c1')).toContain('[COMMANDER]');
  });
});

describe('messages', () => {
  const context = { commander: deck[0].card, cards: deck, brief: 'Tokens feed Korvold.' };

  it('propose shows the brief, the instructions, the owner\'s tags and the turned-down ones', () => {
    const text = proposeMessage({
      ...context, instructions: 'split removal', accepted: [tag('a', 'Ramp')], rejected: [tag('r', 'Big Butts', { status: 'rejected' })],
    });
    expect(text).toContain('Tokens feed Korvold.');
    expect(text).toContain('split removal');
    expect(text).toContain('Ramp');
    expect(text).toContain('do not suggest these again');
    expect(text).toContain('Big Butts');
    expect(text).toContain('[c3] Bitterblossom');
  });

  it('assign gives the whole deck but full text only for the batch', () => {
    const text = assignMessage({ ...context, tags: [tag('a', 'Sac outlets')], batch: ['c2'] });
    expect(text).toContain('[t1] Sac outlets');
    expect(text).toContain('[c3] Bitterblossom - Tribal Enchantment');
    expect(text).toContain('Sacrifice a creature: Scry 1.');
    expect(text).not.toContain('Bitterblossom text');
    expect(text).toContain('Tag these 1 cards');
  });

  it('audit marks the owner\'s own tags', () => {
    const input: AuditInput = {
      ...context, tags: [tag('a', 'Sac outlets')], checking: ['a'],
      members: new Map([['a', [{ key: 'c2', manual: true }]]]),
    };
    expect(auditMessage(input)).toContain('[c2] Viscera Seer (owner)');
  });
});

describe('parseProposals', () => {
  it('keeps real, new tags and only examples that are in the deck', () => {
    const { overview, tags } = parseProposals({
      overview: 'Aristocrats.',
      tags: [
        { name: 'Sac Outlets', description: 'Repeatable.', kind: 'synergy', examples: ['viscera seer', 'Blood Artist'] },
        { name: 'Ramp', description: 'dupe of an owner tag', kind: 'role', examples: [] },
        { name: 'sac outlets', description: 'dupe of the first', kind: 'synergy', examples: [] },
        { name: '', description: 'nameless', kind: 'role', examples: [] },
        { name: 'Fliers', description: 'x', kind: 'nonsense', examples: ['Delver of Secrets'] },
      ],
    }, deck, [tag('a', 'Ramp')]);
    expect(overview).toBe('Aristocrats.');
    expect(tags.map((t) => t.name)).toEqual(['Sac Outlets', 'Fliers']);
    expect(tags[0].examples).toEqual(['Viscera Seer']);
    expect(tags[1].kind).toBeNull();
    expect(tags[1].examples).toEqual(['Delver of Secrets // Insectile Aberration']);
  });

  it('survives an answer that is not the right shape', () => {
    expect(parseProposals(null, deck, [])).toEqual({ overview: '', tags: [] });
    expect(parseProposals({ tags: 'no' }, deck, []).tags).toEqual([]);
  });
});

describe('parseAssignments', () => {
  const tags = [tag('id-sac', 'Sac outlets'), tag('id-tok', 'Token makers')];

  it('maps short refs back and keeps each tag once per card, in the batch only', () => {
    const { assignments, answered } = parseAssignments({
      cards: [
        { card: 'c2', tags: [{ tag: 't1', reason: 'Sacrifice a creature: cost.' }, { tag: '[t1]', reason: 'dupe' }, { tag: 't9', reason: 'no such tag' }] },
        { card: '[c3]', tags: [{ tag: 't2', reason: 'Makes faeries.' }] },
        { card: 'c4', tags: [{ tag: 't2', reason: 'not in the batch' }] },
      ],
    }, tags, ['c2', 'c3'], deck);
    expect(answered).toEqual(['c2', 'c3']);
    expect(assignments).toEqual([
      { key: 'c2', tagId: 'id-sac', reason: 'Sacrifice a creature: cost.' },
      { key: 'c3', tagId: 'id-tok', reason: 'Makes faeries.' },
    ]);
  });

  it('counts a card answered with no tags as answered', () => {
    expect(parseAssignments({ cards: [{ card: 'c2', tags: [], note: 'fits nothing' }] }, tags, ['c2'], deck).answered).toEqual(['c2']);
  });

  it('reads cards and tags written by name, as the smaller models do', () => {
    const { assignments } = parseAssignments({
      cards: [
        { card: 'Viscera Seer', tags: [{ tag: 'Sac Outlets', reason: 'a' }] },
        { card: 'Delver of Secrets', tags: [{ tag: 't2 Token makers', reason: 'b' }] },
        { card: '[c3] Bitterblossom', tags: [{ tag: 'token makers', reason: 'c' }] },
      ],
    }, tags, ['c2', 'c3', 'c4'], deck);
    expect(assignments.map((a) => `${a.key}:${a.tagId}`)).toEqual(['c2:id-sac', 'c4:id-tok', 'c3:id-tok']);
  });
});

describe('parseAudit', () => {
  const tags = [tag('id-sac', 'Sac outlets'), tag('id-tok', 'Token makers')];
  const input: AuditInput = {
    commander: null, cards: deck, brief: '', tags, checking: ['id-sac'],
    members: new Map([['id-sac', [{ key: 'c2', manual: true }, { key: 'c4', manual: false }]]]),
  };

  it('adds what is missing, removes the model\'s mistakes, never the owner\'s', () => {
    const changes = parseAudit({
      changes: [
        { tag: 't1', card: 'c3', action: 'add', reason: 'Faeries can be sacrificed.' },
        { tag: 't1', card: 'c4', action: 'remove', reason: 'No sacrifice text.' },
        { tag: 't1', card: 'c2', action: 'remove', reason: 'owner set it' },
        { tag: 't1', card: 'c2', action: 'add', reason: 'already there' },
        { tag: 't2', card: 'c3', action: 'add', reason: 'not being checked' },
        { tag: 't1', card: 'c99', action: 'add', reason: 'no such card' },
        { tag: 't1', card: 'c1', action: 'remove', reason: 'not tagged' },
        { tag: 'Sac outlets', card: 'Korvold, Fae-Cursed King', action: 'add', reason: 'by name' },
      ],
    }, input);
    expect(changes).toEqual([
      { key: 'c3', tagId: 'id-sac', action: 'add', reason: 'Faeries can be sacrificed.' },
      { key: 'c4', tagId: 'id-sac', action: 'remove', reason: 'No sacrifice text.' },
      { key: 'c1', tagId: 'id-sac', action: 'add', reason: 'by name' },
    ]);
  });
});
