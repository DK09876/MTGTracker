import { describe, expect, it } from 'vitest';

import { cleanText, parseReplay, parseSession, replayOf, sameSession } from './recent';

const interpretation = {
  via: 'ai' as const, kind: 'cards' as const, query: 't:enchantment',
  commander: { name: 'Fire Lord Azula', id: 'x', colorIdentity: ['U', 'B', 'R'] },
  sort: { order: 'edhrec', dir: 'auto' }, explanation: 'Enchantments for Azula', constraints: 't:enchantment',
};

describe('replayOf', () => {
  it('keeps what the model read the request as, so it can run again without it', () => {
    expect(replayOf({ interpretation } as never)).toEqual({
      kind: 'query', query: 't:enchantment', commander: 'Fire Lord Azula', sort: 'edhrec:auto',
      explanation: 'Enchantments for Azula', constraints: 't:enchantment',
    });
  });
  it('keeps a combo search by its commander', () => {
    expect(replayOf({ interpretation: { ...interpretation, kind: 'combos' } } as never))
      .toMatchObject({ kind: 'combos', commander: 'Fire Lord Azula' });
  });
  it('keeps nothing for a search that stopped to ask which commander', () => {
    expect(replayOf({ interpretation, choice: { mention: 'omnath', options: [] } } as never)).toBeNull();
  });
});

describe('parseReplay', () => {
  it('accepts the three kinds and refuses anything else', () => {
    expect(parseReplay({ kind: 'name', name: 'Opt' })).toEqual({ kind: 'name', name: 'Opt' });
    expect(parseReplay({ kind: 'combos', commander: 'Vivi Ornitier' })).toMatchObject({ kind: 'combos', commander: 'Vivi Ornitier' });
    expect(parseReplay({ kind: 'query', query: 'o:scry' })).toMatchObject({ kind: 'query', query: 'o:scry' });
    expect(parseReplay({ kind: 'query' })).toBeNull();
    expect(parseReplay({ kind: 'nope' })).toBeNull();
    expect(parseReplay('x')).toBeNull();
    expect(parseReplay({ kind: 'query', query: 'x'.repeat(5000) })).toBeNull();
  });
});

describe('cleanText', () => {
  it('trims and folds spaces, and refuses empty or huge', () => {
    expect(cleanText('  green   ramp ')).toBe('green ramp');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(3)).toBeNull();
  });
});

describe('sessions', () => {
  const replay = { kind: 'query' as const, query: 't:instant', commander: 'Omnath, Locus of Rage' };

  it('keeps what was asked and what was on screen, and checks it', () => {
    expect(parseSession({ thread: ['green ramp for omnath', 'only instants'], replay, tab: 'cards', pages: 3, edhrecFull: true, junk: 1 }))
      .toEqual({ thread: ['green ramp for omnath', 'only instants'], replay, tab: 'cards', pages: 3, edhrecFull: true });
    expect(parseSession({ thread: ['x'], replay, tab: 'nope', pages: 999 })).toEqual({ thread: ['x'], replay, pages: 10 });
    expect(parseSession({ thread: ['x'] })).toBeNull();
  });

  it('marks a card search, so it comes back as one', () => {
    expect(replayOf({ interpretation: { via: 'ai', kind: 'card', query: '!"Opt"' } } as never)).toMatchObject({ card: true });
  });

  it('tells a changed session from the same one, scroll aside', () => {
    const a = { thread: ['a'], replay, tab: 'cards' as const, scrollY: 100 };
    expect(sameSession(a, { ...a, scrollY: 900 })).toBe(true);
    expect(sameSession(a, { ...a, tab: 'edhrec' })).toBe(false);
    expect(sameSession(a, { ...a, thread: ['a', 'b'] })).toBe(false);
    expect(sameSession(a, { ...a, pages: 1 })).toBe(true);
  });
});
