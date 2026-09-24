/**
 * Sorts, apart from queries.
 *
 * A sort chosen from the menu travels as a Scryfall parameter; one typed as
 * `order:` in a query is lifted out so there is only ever one.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_SORT, parseSortKey, sortKey, sortLabel, splitSort } from './sort';

describe('splitSort', () => {
  it('lifts order and direction out of a query', () => {
    expect(splitSort('t:elf order:usd direction:asc c:g'))
      .toEqual({ filters: 't:elf c:g', sort: { order: 'usd', dir: 'asc' } });
  });

  it('leaves a query with no order alone', () => {
    expect(splitSort('(t:elf or t:goblin) mv<2')).toEqual({ filters: '(t:elf or t:goblin) mv<2', sort: null });
  });

  it('ignores a direction with no order', () => {
    expect(splitSort('t:elf direction:asc').sort).toBeNull();
  });
});

describe('sort keys', () => {
  it('round-trips through the menu value', () => {
    expect(parseSortKey(sortKey({ order: 'usd', dir: 'desc' }))).toEqual({ order: 'usd', dir: 'desc' });
  });

  it('refuses a value that is not an order', () => {
    expect(parseSortKey('usd desc; drop')).toBeNull();
    expect(parseSortKey(null)).toBeNull();
  });
});

describe('sortLabel', () => {
  it('defaults to most played in Commander', () => {
    expect(sortLabel(DEFAULT_SORT)).toBe('Most played in Commander');
  });

  it('describes an order the menu does not list', () => {
    expect(sortLabel({ order: 'artist', dir: 'asc' })).toBe('By artist, low to high');
  });
});
