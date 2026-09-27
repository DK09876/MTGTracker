import { describe, expect, it } from 'vitest';

import { cleanText, parseReplay, replayOf } from './recent';

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
