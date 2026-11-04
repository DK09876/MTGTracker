/**
 * Which cards a tagging run looks at, and which tags it may change.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardsToTag } from './tag-steps';
import type { TaggingDeck } from './tag-deck';

const deck = { cards: ['a', 'b', 'c', 'd'].map((k) => ({ key: k })), keyOf: new Map(['a', 'b', 'c', 'd'].map((k) => [k, `key-${k}`])) } as unknown as TaggingDeck;
const links = [
  { key: 'key-a', tagId: 'wheels', on: true },
  { key: 'key-b', tagId: 'outlet', on: true },
  { key: 'key-c', tagId: 'wheels', on: false },
];

describe('cards to tag', () => {
  it('takes the whole deck, the untagged, those missing a tag, or the picked', () => {
    expect(cardsToTag(deck, links, 'all')).toEqual(['key-a', 'key-b', 'key-c', 'key-d']);
    // A tag the owner switched off does not count as tagged.
    expect(cardsToTag(deck, links, 'untagged')).toEqual(['key-c', 'key-d']);
    expect(cardsToTag(deck, links, 'missing', { missingTag: 'wheels' })).toEqual(['key-b', 'key-c', 'key-d']);
    expect(cardsToTag(deck, links, 'picked', { picked: ['key-d', 'key-a', 'nope'] })).toEqual(['key-a', 'key-d']);
  });
});

describe('a run limited to some tags', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-tagscope-'));
    vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
    vi.resetModules();
  });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

  it('replaces only those tags the model put on, leaving its others', async () => {
    const db = await import('./db');
    db.addProfile('dk', 'DK');
    const list = db.createList('dk', 'Deck', '', { kind: 'deck' });
    const wheels = db.createTag(list.id, { name: 'Wheels', color: '#fff', status: 'accepted', origin: 'manual' });
    const outlet = db.createTag(list.id, { name: 'Outlet', color: '#fff', status: 'accepted', origin: 'manual' });
    db.applyModelTags(list.id, ['k1'], [{ key: 'k1', tagId: wheels.id, reason: '' }, { key: 'k1', tagId: outlet.id, reason: '' }]);
    // Retag k1 for Wheels only: the model says no Wheels now; Outlet stays.
    db.applyModelTags(list.id, ['k1'], [], [wheels.id]);
    expect(db.deckTags(list.id).cardTags.filter((t) => t.key === 'k1').map((t) => t.tagId)).toEqual([outlet.id]);
  });
});
