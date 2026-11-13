/**
 * One count per job, everywhere: a deck with a card added to a job by hand
 * and one taken out reads the same count on the Tags tab, the Cards header
 * (the health route's roles), Trim's numbers now and after cutting the added
 * card, and the text sent to Claude. Each test has its own database; nothing
 * calls out.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-job-counts-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const card = (name: string, over: Partial<ScryfallCard> = {}) =>
  ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Instant', cmc: 2, oracle_text: `${name} does a thing.`, color_identity: [], legalities: { commander: 'legal' }, ...over }) as ScryfallCard;
const commander = card('Azula, Fire Lord', { type_line: 'Legendary Creature — Human Noble', cmc: 5 });
const island = card('Island', { type_line: 'Basic Land — Island', cmc: 0, oracle_text: '' });

/** 108 cards: Spells 1-12 draw by the card data, the rest nothing. */
async function deck() {
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'Azula', '', { kind: 'deck', commander });
  db.addCardToList(list.id, island, 37);
  for (let i = 1; i <= 70; i++) db.addCardToList(list.id, card(`Spell ${i}`));
  const { ROLES_VERSION } = await import('./roles');
  const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
  const draws = new Set(Array.from({ length: 12 }, (_, i) => `o-Spell ${i + 1}`));
  db.saveRoles(new Map([...new Set([...ids, commander.oracle_id!])].map((id) => [id, draws.has(id) ? ['draw'] : []] as [string, string[]])), ROLES_VERSION);
  return { db, list: db.getList(list.id, 'dk')! };
}

describe('one count per job', { timeout: 60_000 }, () => {
  it('reads the same Card draw count on Tags, Cards, Trim (now and after a cut) and in what Claude is sent', async () => {
    const { list } = await deck();
    const c = await import('./categories');
    const draw = c.addCategory(list.id, { kind: 'job', name: 'Card draw', by: 'cards', jobId: 'draw' });
    // The owner adds Spells 40 and 41 to Card draw by hand and takes Spell 1 out: 13, where the card data alone says 12.
    c.setCategoryCard(list.id, draw, { key: 'o-Spell 40', name: 'Spell 40' }, true);
    c.setCategoryCard(list.id, draw, { key: 'o-Spell 41', name: 'Spell 41' }, true);
    c.setCategoryCard(list.id, draw, { key: 'o-Spell 1', name: 'Spell 1' }, false);

    const tags = (await (await import('./tags-tab')).tagsTab(list, 'dk')).jobNumbers.draw.count;
    expect(tags).toBe(13);
    const cards = (await (await import('./deck-roles')).deckRoles(list.id)).find((r) => r.id === 'draw')!.count;
    expect(cards).toBe(tags);
    const tune = await import('./tune');
    const ctx = await tune.tuneContext(list, 'dk');
    const row = (rows: Array<{ id: string; before: number; after: number }>) => rows.find((r) => r.id === 'draw')!;
    // Trim's bar: now, and after cutting the card the owner added (it counts, so it comes off), then one the owner took out (it doesn't).
    expect(row((await tune.cutImpact(ctx, [])).rows).before).toBe(tags);
    expect(row((await tune.cutImpact(ctx, ['Spell 40'])).rows).after).toBe(tags - 1);
    expect(row((await tune.cutImpact(ctx, ['Spell 1'])).rows).after).toBe(tags);
    expect(row((await tune.cutImpact(ctx, ['Spell 2'])).rows).after).toBe(tags - 1);
    // What Claude is sent: the shared context and the Trim message's numbers.
    const text = await (await import('./plan-context')).planContext(list);
    expect(text).toMatch(new RegExp(`^- Card draw: ${tags}\\b`, 'm'));
    const { user } = await (await import('./trim')).trimMessage(list, 'dk');
    expect(user).toMatch(new RegExp(`^- Card draw: ${tags}\\b`, 'm'));
    expect(user).not.toMatch(/^- Card draw: 12\b/m);
  });
});
