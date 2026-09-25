/**
 * Deck tags in the database: the owner's choices always win over the model's.
 * Each test gets its own database file, as in db.test.ts.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-tags-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  const deck = db.createList('dk', 'Korvold', '', { kind: 'deck' });
  const tag = (name: string, status: 'accepted' | 'proposed' | 'rejected' = 'accepted') =>
    db.createTag(deck.id, { name, color: '#e0b64a', status, origin: status === 'accepted' ? 'manual' : 'ai' });
  const on = (key: string) => db.deckTags(deck.id).cardTags.filter((l) => l.key === key && l.on).map((l) => l.tagId).sort();
  return { db, deck, tag, on };
}

describe('deck tags', () => {
  it('keeps a brief and tags in order, and forgets them with the deck', async () => {
    const { db, deck, tag } = await setup();
    db.setTagBrief(deck.id, 'Aristocrats');
    const a = tag('Ramp');
    const b = tag('Draw');
    db.reorderTags(deck.id, [b.id, a.id]);
    const read = db.deckTags(deck.id);
    expect(read.brief).toBe('Aristocrats');
    expect(read.tags.map((t) => t.name)).toEqual(['Draw', 'Ramp']);
    db.setCardTag(deck.id, 'o1', a.id, true);
    db.deleteList(deck.id);
    expect(db.deckTags(deck.id).tags).toEqual([]);
    expect(db.deckTags(deck.id).cardTags).toEqual([]);
  });

  it('replaces unreviewed suggestions, keeping accepted and turned-down tags', async () => {
    const { db, deck, tag } = await setup();
    tag('Ramp');
    tag('Old idea', 'rejected');
    db.replaceProposals(deck.id, 'first read', [{ name: 'A', color: '#5fb3e8' }]);
    db.replaceProposals(deck.id, 'second read', [{ name: 'B', color: '#5fb3e8', examples: ['Sol Ring'] }]);
    const read = db.deckTags(deck.id);
    expect(read.overview).toBe('second read');
    expect(read.tags.map((t) => `${t.name}:${t.status}`)).toEqual(['Ramp:accepted', 'Old idea:rejected', 'B:proposed']);
    expect(read.tags[2].examples).toEqual(['Sol Ring']);
  });

  it('never lets the model undo what the owner set', async () => {
    const { db, deck, tag, on } = await setup();
    const sac = tag('Sac outlets');
    const tok = tag('Tokens');
    const draw = tag('Draw');

    db.setCardTag(deck.id, 'seer', sac.id, true); // owner: on
    db.applyModelTags(deck.id, ['seer'], [{ key: 'seer', tagId: tok.id, reason: 'x' }, { key: 'seer', tagId: draw.id, reason: 'scry' }]);
    expect(on('seer')).toEqual([sac.id, tok.id, draw.id].sort());

    db.setCardTag(deck.id, 'seer', draw.id, false); // owner takes the model's tag off
    db.applyModelTags(deck.id, ['seer'], [{ key: 'seer', tagId: draw.id, reason: 'again' }]);
    expect(on('seer')).toEqual([sac.id]); // model's old tags cleared, the taken-off one stays off
    expect(db.applyModelAudit(deck.id, [{ key: 'seer', tagId: draw.id, action: 'add', reason: 'x' }]).added).toBe(0);

    // An audit removes only what the model applied.
    db.applyModelTags(deck.id, ['bb'], [{ key: 'bb', tagId: tok.id, reason: 'faeries' }]);
    expect(db.applyModelAudit(deck.id, [
      { key: 'bb', tagId: tok.id, action: 'remove', reason: 'x' },
      { key: 'seer', tagId: sac.id, action: 'remove', reason: 'x' },
    ])).toEqual({ added: 0, removed: 1 });
    expect(on('seer')).toEqual([sac.id]);
    expect(on('bb')).toEqual([]);
  });

  it('forgets a tag the owner put on and then took off', async () => {
    const { db, deck, tag } = await setup();
    const t = tag('Ramp');
    db.setCardTag(deck.id, 'rock', t.id, true);
    db.setCardTag(deck.id, 'rock', t.id, false);
    expect(db.deckTags(deck.id).cardTags).toEqual([]);
  });

  it('merges one tag into another', async () => {
    const { db, deck, tag, on } = await setup();
    const a = tag('Removal');
    const b = tag('Spot removal');
    db.applyModelTags(deck.id, ['bolt', 'path'], [{ key: 'bolt', tagId: b.id, reason: 'x' }, { key: 'path', tagId: a.id, reason: 'y' }]);
    db.setCardTag(deck.id, 'path', b.id, true);
    expect(db.mergeTags(deck.id, b.id, a.id)).toBe(true);
    expect(db.deckTags(deck.id).tags.map((t) => t.name)).toEqual(['Removal']);
    expect(on('bolt')).toEqual([a.id]);
    expect(on('path')).toEqual([a.id]);
    expect(db.deckTags(deck.id).cardTags.find((l) => l.key === 'path')?.source).toBe('manual');
    expect(db.mergeTags(deck.id, a.id, a.id)).toBe(false);
  });

  it('refuses a tag from another deck', async () => {
    const { db, tag } = await setup();
    const t = tag('Ramp');
    const other = db.createList('dk', 'Other', '', { kind: 'deck' });
    expect(db.setCardTag(other.id, 'rock', t.id, true)).toBe(false);
    expect(db.updateTag(other.id, t.id, { name: 'Stolen' })).toBe(false);
  });
});
