/**
 * Reading the owner's words for cards on the server (lib/cards.ts readCards): sure cards marked, the rest asked, and
 * the owner's picks remembered for their profile so the same words aren't asked again.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-read-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.resetModules();
  mkdirSync(join(dir, 'rules'), { recursive: true });
  writeFileSync(join(dir, 'rules', 'card-names.json'), JSON.stringify([
    'Inniaz, the Gale Force', 'Gale Force', 'Flicker', 'Lightning Bolt', 'Last Chance', 'Rhystic Study', 'Kratos, God of War', 'Kratos, Stoic Father',
  ]));
  delete (globalThis as { __cardNames?: unknown }).__cardNames;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (globalThis as { __cardNames?: unknown }).__cardNames;
  rmSync(dir, { recursive: true, force: true });
});

describe('readCards', () => {
  it('marks the cards it is sure of and leaves everyday words alone', async () => {
    const { readCards } = await import('./cards');
    const r = await readCards('does rhystic study trigger off a flicker effect', { profile: 'p' });
    expect(r).toMatchObject({ text: 'does [[Rhystic Study]] trigger off a flicker effect', cards: ['Rhystic Study'], choices: [], readAs: [] });
  });

  it('asks about a misspelt name, remembers the pick, and reads the misspelt word alone next time', async () => {
    const { readCards } = await import('./cards');
    const q = 'Can you redirect Innaiz, the gale force?';
    const first = await readCards(q, { profile: 'p' });
    expect(first.choices).toEqual([{ mention: 'Innaiz, the gale force', kind: 'typo', options: [{ name: 'Inniaz, the Gale Force', image: null }, { name: 'Gale Force', image: null }] }]);
    expect(first.text).toBe(q);

    const picked = await readCards(q, { profile: 'p', picks: [{ mention: 'Innaiz, the gale force', name: 'Inniaz, the Gale Force', kind: 'typo' }] });
    expect(picked).toMatchObject({ text: 'Can you redirect [[Inniaz, the Gale Force]]?', choices: [] });

    const later = await readCards('does innaiz have flying', { profile: 'p' });
    expect(later).toMatchObject({
      text: 'does [[Inniaz, the Gale Force]] have flying', choices: [],
      readAs: [{ mention: 'innaiz', name: 'Inniaz, the Gale Force', remembered: true }],
    });
    // Another profile's words are its own.
    expect((await readCards('does Innaiz have flying', { profile: 'q' })).choices).toHaveLength(1);

    const { forgetPick } = await import('./card-picks');
    forgetPick('p', 'innaiz');
    expect((await readCards('does Innaiz have flying', { profile: 'p' })).choices).toHaveLength(1);
  });

  it('remembers "just the words" too', async () => {
    const { readCards } = await import('./cards');
    expect((await readCards('is this my last chance', { profile: 'p' })).choices[0]).toMatchObject({ kind: 'maybe', mention: 'last chance' });
    await readCards('is this my last chance', { profile: 'p', picks: [{ mention: 'last chance', name: '-', kind: 'maybe' }] });
    expect(await readCards('my last chance to win', { profile: 'p' })).toMatchObject({ text: 'my last chance to win', cards: [], choices: [] });
  });

  it('takes the card in play when the words could be several', async () => {
    const { readCards } = await import('./cards');
    expect(await readCards('how does kratos attack', { profile: 'p', known: ['Kratos, Stoic Father'] }))
      .toMatchObject({ text: 'how does [[Kratos, Stoic Father]] attack', choices: [], readAs: [{ mention: 'kratos', name: 'Kratos, Stoic Father', remembered: false }] });
  });
});
