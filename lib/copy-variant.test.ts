import { describe, expect, it } from 'vitest';

import { isProxy, parseVariant, variantBadges, variantKey } from './copy-variant';

describe('copy variants', () => {
  it('says nothing for a plain English near-mint copy', () => {
    expect(variantKey({})).toBe('');
    expect(variantKey({ language: 'en', condition: 'NM' })).toBe('');
    expect(variantKey({ language: 'EN', condition: 'Mint' })).toBe('');
    expect(variantBadges('')).toEqual([]);
  });

  it('keeps language, condition and marks, and reads them back', () => {
    const key = variantKey({ language: 'ja', condition: 'lp', proxy: true, signed: true });
    expect(key).toBe('lang:ja,cond:LP,proxy,signed');
    expect(parseVariant(key)).toEqual({ language: 'ja', condition: 'LP', proxy: true, altered: false, signed: true, misprint: false });
    expect(isProxy(key)).toBe(true);
    expect(isProxy('lang:ja')).toBe(false);
    expect(variantBadges(key).map((b) => b.text)).toEqual(['Proxy', 'JA', 'LP', 'Signed']);
    expect(variantBadges('lang:ph')[0].title).toBe('Phyrexian');
  });
});
