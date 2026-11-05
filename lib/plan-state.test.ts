/**
 * The Plan tab's picture of a real (small) deck, read end to end without a
 * network: every part present, detected values marked, the snapshot kept
 * for other pages, and the plan in words for Claude.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-plan-state-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  // Scryfall and Spellbook can't be reached: the plan still reads.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const card = (id: string, name: string, text: string, extra: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({ id, oracle_id: `o-${id}`, name, oracle_text: text, type_line: 'Artifact', cmc: 2, legalities: { commander: 'legal' }, ...extra } as ScryfallCard);
const prosper = card('prosper', 'Prosper, Tome-Bound', 'At the beginning of your end step, exile the top card of your library. Until the end of your next turn, you may play that card.\nWhenever you play a card from exile, create a Treasure token.', { cmc: 4, type_line: 'Legendary Creature — Tiefling Warlock', color_identity: ['B', 'R'] });

describe('the plan state', () => {
  it('reads every part, marks what was detected, and keeps a snapshot', { timeout: 20_000 }, async () => {
    const db = await import('./db');
    const { planState } = await import('./plan-server');
    const { planFor } = await import('./deck-plan');
    const { planText } = await import('./plan-context');
    db.addProfile('dk', 'DK');
    const deck = db.createList('dk', 'Prosper', '', { kind: 'deck', commander: prosper });
    for (let i = 0; i < 12; i++) db.addCardToList(deck.id, card(`t${i}`, `Treasure Maker ${i}`, 'Create a Treasure token.'));
    db.addCardToList(deck.id, card('revel', 'Revel in Riches', 'At the beginning of your upkeep, if you control ten or more Treasures, you win the game.', { cmc: 5, type_line: 'Enchantment' }));
    const list = db.getList(deck.id, 'dk')!;
    // Roles already looked up, as the nightly refresh leaves them: nothing is searched.
    const { ROLES_VERSION } = await import('./roles');
    db.saveRoles(new Map([...db.cardsInList(deck.id).map((c) => [c.card.oracle_id!, c.card.name.startsWith('Treasure') ? ['ramp'] : []] as [string, string[]]), [prosper.oracle_id!, ['draw']]]), ROLES_VERSION);

    const s = await planState(list);
    for (const id of ['goal', 'commanders', 'bracket', 'budget', 'own', 'rule', 'brief', 'style', 'role', 'build', 'key', 'themes', 'stages', 'routes', 'lean', 'flip', 'lands', 'ranges', 'protected', 'archetype']) {
      expect(s.parts[id], id).toBeTruthy();
    }
    expect(s.parts.style.source).toBe('detected');
    expect(s.parts.budget.source).toBe('unset');
    expect((s.parts.themes.value as Array<{ id: string; size: number }>).find((t) => t.id === 'treasure')?.size).toBe(16);
    expect(s.small).toBe(false);
    expect(s.confirmed).toBe(false);
    expect(s.lookFirst.some((x) => x.id === 'bracket')).toBe(true);
    expect(s.rules.some((r) => r.name === 'Lands')).toBe(true);
    // Every How? says the rule, never where it came from.
    const how = JSON.stringify(Object.values(s.parts).map((p) => p.how));
    expect(how).not.toMatch(/Karsten|Template|Elk|Snail|EDHREC|V\d{1,2}\b/);

    const plan = planFor(deck.id, '', prosper, db.cardsInList(deck.id));
    expect(plan.snapshot.lean).toBeTruthy();
    const text = planText(plan, null);
    expect(text).toContain('Default ways to judge a Commander deck');
    expect(text).toContain('Leans on the commander');
  });
});
