/**
 * Chat's proposals: every kind is read from Claude's answer, applies with
 * its button, and undoes. Each test has its own database; nothing calls out.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Change } from './deck-chat';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-chat-actions-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.resetModules();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }); });

const card = (name: string, over: Partial<ScryfallCard> = {}) =>
  ({ id: `id-${name}`, oracle_id: `o-${name}`, name, type_line: 'Instant', cmc: 2, oracle_text: `${name} does a thing.`, color_identity: [], legalities: { commander: 'legal' }, ...over }) as ScryfallCard;
const commander = card('Azula', { type_line: 'Legendary Creature — Human Noble' });

async function deck() {
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'Azula', '', { kind: 'deck', commander });
  for (const n of ['Opt', 'Bolt', 'Shock', 'Ponder']) db.addCardToList(list.id, card(n));
  // A card the app knows that isn't in the deck, for adds and swaps.
  db.addCardToList(list.id, card('Grapeshot'), 1, 'nonfoil', 'maybe');
  db.setQuantity(list.id, 'id-Grapeshot', 0);
  const { ROLES_VERSION } = await import('./roles');
  db.saveRoles(new Map(['Opt', 'Bolt', 'Shock', 'Ponder', 'Grapeshot', 'Azula'].map((n) => [`o-${n}`, []] as [string, string[]])), ROLES_VERSION);
  return { db, list: db.getList(list.id, 'dk')! };
}
const ch = (c: Partial<Change> & Pick<Change, 'kind' | 'name'>): Change => ({ why: 'Because.', cardId: null, held: null, price: null, ...c });
const where = (db: typeof import('./db'), listId: string, name: string) => db.cardsInList(listId).filter((c) => c.card.name === name).map((c) => `${c.board}:${c.quantity}`).join(',');

describe('chat proposals', { timeout: 60_000 }, () => {
  it('reads every kind of proposal from Claude’s answer', async () => {
    const { resolveChanges } = await import('./deck-chat');
    const d = { list: { id: 'l', name: 'Azula', commander } as never, cards: [{ card: card('Opt'), quantity: 1, board: 'main' }, { card: card('Bolt'), quantity: 1, board: 'main' }] as never, brief: '', roles: null };
    const out = resolveChanges({
      cut: [{ name: 'opt', why: 'Weak.', to: 'Sideboard' }], swap: [{ out: 'Bolt', in: 'Grapeshot', why: 'Better.' }], move: [{ name: 'Bolt', to: 'Maybeboard', why: 'x' }],
      group: [{ name: 'Bolt', to: 'Burn', why: 'x' }], ungroup: [{ name: 'Opt', to: 'Card draw', why: 'x' }], never_cut: [{ name: 'Bolt', why: 'x' }],
      note: [{ text: 'Keep the curve low.' }], way_to_win: [{ name: 'Burn out', how: 'Burn spells.', cards: ['Bolt', 'Not here'] }], key_card: [{ name: 'Azula', why: 'x' }],
    }, d, () => ({}));
    expect(out.map((c) => [c.kind, c.name, c.to ?? null])).toEqual([
      ['cut', 'Opt', 'Sideboard'], ['swap', 'Grapeshot', null], ['move', 'Bolt', 'Maybeboard'], ['group', 'Bolt', 'Burn'], ['ungroup', 'Opt', 'Card draw'],
      ['never', 'Bolt', null], ['note', 'Keep the curve low.', null], ['win', 'Burn out', null], ['key', 'Azula', null],
    ]);
    expect(out.find((c) => c.kind === 'swap')!.out).toEqual({ name: 'Bolt', cardId: 'id-Bolt' });
    expect(out.find((c) => c.kind === 'win')!.cards).toEqual(['Bolt']);
  });

  it('applies and undoes a cut, an add, a swap and a move, each in History', async () => {
    const { db, list } = await deck();
    const a = await import('./chat-actions');
    let u = await a.applyChange(list, 'dk', ch({ kind: 'cut', name: 'Opt' }));
    expect(where(db, list.id, 'Opt')).not.toContain('main');
    await a.undoChange(list, 'dk', u);
    expect(where(db, list.id, 'Opt')).toBe('main:1');
    u = await a.applyChange(list, 'dk', ch({ kind: 'add', name: 'Grapeshot', cardId: 'id-Grapeshot' }));
    expect(where(db, list.id, 'Grapeshot')).toBe('main:1');
    await a.undoChange(list, 'dk', u);
    expect(where(db, list.id, 'Grapeshot')).toBe('');
    u = await a.applyChange(list, 'dk', ch({ kind: 'swap', name: 'Grapeshot', cardId: 'id-Grapeshot', out: { name: 'Bolt', cardId: 'id-Bolt' } }));
    expect([where(db, list.id, 'Grapeshot'), where(db, list.id, 'Bolt').includes('main')]).toEqual(['main:1', false]);
    await a.undoChange(list, 'dk', u);
    expect([where(db, list.id, 'Grapeshot'), where(db, list.id, 'Bolt')]).toEqual(['', 'main:1']);
    u = await a.applyChange(list, 'dk', ch({ kind: 'move', name: 'Shock', to: 'maybeboard' }));
    expect(where(db, list.id, 'Shock')).toBe('maybe:1');
    await a.undoChange(list, 'dk', u);
    expect(where(db, list.id, 'Shock')).toBe('main:1');
    const labels = (await import('./deck-history')).changes(list.id).map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['From Chat: cut Opt', 'From Chat: add Grapeshot', 'From Chat: Bolt out, Grapeshot in', 'From Chat: move Shock']));
  });

  it('never adds a second copy of a card already in the deck', async () => {
    const { db, list } = await deck();
    const a = await import('./chat-actions');
    db.storeCard(card('Bolt', { id: 'id-Bolt-2' }));
    await expect(a.applyChange(list, 'dk', ch({ kind: 'add', name: 'Bolt', cardId: 'id-Bolt-2' }))).rejects.toThrow(/already in the deck/);
    await expect(a.applyChange(list, 'dk', ch({ kind: 'swap', name: 'Bolt', cardId: 'id-Bolt-2', out: { name: 'Opt', cardId: 'id-Opt' } }))).rejects.toThrow(/already in the deck/);
    expect(where(db, list.id, 'Bolt')).toBe('main:1');
    expect(where(db, list.id, 'Opt')).toBe('main:1');
  });

  it('never cuts the commander or a never-cut card', async () => {
    const { list } = await deck();
    const a = await import('./chat-actions');
    await expect(a.applyChange(list, 'dk', ch({ kind: 'cut', name: 'Azula' }))).rejects.toThrow(/isn't in the deck|commander/);
    await a.applyChange(list, 'dk', ch({ kind: 'never', name: 'Bolt' }));
    await expect(a.applyChange(list, 'dk', ch({ kind: 'cut', name: 'Bolt' }))).rejects.toThrow(/never cut/);
    await expect(a.applyChange(list, 'dk', ch({ kind: 'swap', name: 'Grapeshot', cardId: 'id-Grapeshot', out: { name: 'Bolt', cardId: 'id-Bolt' } }))).rejects.toThrow(/never cut/);
  });

  it('applies and undoes a group, never cut, a note, a way to win and a key card', async () => {
    const { list } = await deck();
    const a = await import('./chat-actions');
    const cats = async () => (await (await import('./tags-tab')).tagsTab(list)).categories;
    const plan = async () => (await import('./plan-help')).planState(list);
    // A new group, made with the card in it; undo takes the group away.
    let u = await a.applyChange(list, 'dk', ch({ kind: 'group', name: 'Bolt', to: 'Burn' }));
    expect((await cats()).find((c) => c.name === 'Burn')!.cards.map((x) => x.name)).toEqual(['Bolt']);
    await expect(a.applyChange(list, 'dk', ch({ kind: 'group', name: 'Bolt', to: 'Burn' }))).rejects.toThrow(/already in/);
    const shock = await a.applyChange(list, 'dk', ch({ kind: 'group', name: 'Shock', to: 'burn' }));
    expect((await cats()).find((c) => c.name === 'Burn')!.cards.map((x) => x.name).sort()).toEqual(['Bolt', 'Shock']);
    await a.undoChange(list, 'dk', shock);
    expect((await cats()).find((c) => c.name === 'Burn')!.cards.map((x) => x.name)).toEqual(['Bolt']);
    await a.undoChange(list, 'dk', u);
    expect((await cats()).some((c) => c.name === 'Burn')).toBe(false);
    u = await a.applyChange(list, 'dk', ch({ kind: 'never', name: 'Opt' }));
    expect((await plan()).neverCut.cards.map((x) => x.name)).toEqual(['Opt']);
    await a.undoChange(list, 'dk', u);
    expect((await plan()).neverCut.cards).toEqual([]);
    u = await a.applyChange(list, 'dk', ch({ kind: 'note', name: 'Keep the curve low.' }));
    expect((await plan()).notes.map((n) => n.text)).toEqual(['Keep the curve low.']);
    await a.undoChange(list, 'dk', u);
    expect((await plan()).notes).toEqual([]);
    u = await a.applyChange(list, 'dk', ch({ kind: 'win', name: 'Burn out', why: 'Burn spells.', cards: ['Bolt', 'Shock'] }));
    expect((await plan()).wins.map((w) => [w.name, w.cards.length])).toEqual([['Burn out', 2]]);
    await a.undoChange(list, 'dk', u);
    expect((await plan()).wins).toEqual([]);
    u = await a.applyChange(list, 'dk', ch({ kind: 'key', name: 'Ponder' }));
    expect((await plan()).key!.cards.map((x) => x.name)).toEqual(['Ponder']);
    await a.undoChange(list, 'dk', u);
    expect((await plan()).key?.cards ?? []).toEqual([]);
  });
});
