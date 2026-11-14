/**
 * A card name Chat marked that the app couldn't find (handoff 10, item 39): looked up on hover, once per name,
 * shown when found, "couldn't find" with a retry when not. The lookup is stubbed (no card search is reached).
 */

import { describe, expect, it, vi } from 'vitest';

import { cardLookup, exactName } from './card-lookup';
import { splitMarked } from './chat-text';

describe('an unresolved [[name]]', () => {
  it('stays a link (a marked name) that looks up on hover: found, kept, one lookup per name', async () => {
    expect(splitMarked('Add [[Brand New Card]] for the drain.').map((p) => p.name ?? null)).toEqual([null, 'Brand New Card', null]);
    const find = vi.fn(async (n: string) => (n === 'Brand New Card' ? { name: n, id: 'x1' } : null));
    const look = cardLookup(find);
    expect(look.state('Brand New Card')).toEqual({ status: 'idle' });
    const first = look.look('Brand New Card');
    expect(look.state('Brand New Card')).toEqual({ status: 'loading' });
    // A second hover while it looks waits on the same lookup.
    const again = look.look('brand new card');
    expect(await first).toEqual({ status: 'found', card: { name: 'Brand New Card', id: 'x1' } });
    expect(await again).toEqual(await first);
    await look.look('Brand New Card');
    expect(find).toHaveBeenCalledTimes(1);
    expect(exactName('Brand "New" Card')).toBe('!"Brand New Card"');
  });

  it('not found: says so, isn\'t looked up again on the next hover, and a retry asks again', async () => {
    let n = 0;
    const find = vi.fn(async () => { n += 1; if (n === 1) throw new Error('offline'); return n === 2 ? null : { name: 'Typo Card', id: 't' }; });
    const look = cardLookup(find);
    expect(await look.look('Typo Card')).toEqual({ status: 'missing' });
    expect(await look.look('Typo Card')).toEqual({ status: 'missing' });
    expect(find).toHaveBeenCalledTimes(1);
    expect(await look.look('Typo Card', true)).toEqual({ status: 'missing' });
    expect((await look.look('Typo Card', true)).status).toBe('found');
    expect(find).toHaveBeenCalledTimes(3);
  });
});
