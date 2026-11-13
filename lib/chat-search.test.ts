/**
 * Chat searches the owner's cards (handoff 9, Part A) and sends open-ended asks to a page (Part C), with a
 * stand-in Claude (no paid call). Each test has its own database.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClaudeParams } from './ai-claude';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-chat-search-'));
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
  ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Instant', cmc: 2, mana_cost: '{1}{U}', oracle_text: `${name} draws a card.`, color_identity: ['U'], legalities: { commander: 'legal' }, prices: { usd: '1.00' }, ...over }) as ScryfallCard;
const commander = card('Azula, Fire Lord', { type_line: 'Legendary Creature — Human Noble', cmc: 4, mana_cost: '{1}{U}{B}{R}', oracle_text: 'Whenever you cast a spell while Azula is attacking, copy it.', color_identity: ['U', 'B', 'R'] });

const spare = card('Spare Draw', { oracle_text: 'Draw two cards.' });
const lent = card('Lent Draw', { oracle_text: 'Draw two cards.' });
const waiting = card('Waiting Draw', { oracle_text: 'Draw two cards.' });
const land = card('Sulfur Falls', { type_line: 'Land', cmc: 0, mana_cost: '', oracle_text: '{T}: Add {U} or {R}.', color_identity: ['U', 'R'], produced_mana: ['U', 'R'] });
const green = card('Green Draw', { oracle_text: 'Draw two cards.', color_identity: ['G'] });
const unowned = card('Unowned Draw', { oracle_text: 'Draw two cards.' });

/** Azula with a few spells; the owner's boxes, another deck (Zuko) and this deck's Sideboard hold the rest. */
async function setup(opts: { commanderOnly?: boolean; noCommander?: boolean } = {}) {
  const db = await import('./db');
  const col = await import('./collection');
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'Azula', '', { kind: 'deck', ...(opts.noCommander ? {} : { commander }) });
  if (!opts.commanderOnly) for (let i = 1; i <= 5; i++) db.addCardToList(list.id, card(`Deck Spell ${i}`));
  db.addCardToList(list.id, waiting, 1, 'nonfoil', 'side');
  const zuko = db.createList('dk', 'Zuko', '', { kind: 'deck', commander: card('Zuko', { type_line: 'Legendary Creature', oracle_text: 'Firebending 1', color_identity: ['G'] }) });
  db.addCardToList(zuko.id, lent);
  // Known to the app (in another deck's ideas), but held nowhere.
  db.addCardToList(zuko.id, unowned, 1, 'nonfoil', 'maybe');
  for (const c of [spare, land, green]) col.addToCollection('dk', c, 1);
  const { ROLES_VERSION } = await import('./roles');
  const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
  db.saveRoles(new Map([...new Set([...ids, commander.oracle_id!])].map((id) => [id, []] as [string, string[]])), ROLES_VERSION);
  return { db, list: db.getList(list.id, 'dk')! };
}

async function tools(list: Awaited<ReturnType<typeof setup>>['list']) {
  const { tuneContext } = await import('./tune');
  const { ownedTools } = await import('./deck-chat-server');
  const tune = await tuneContext(list, 'dk').catch(() => null);
  return { search: async () => [], held: () => ({}), gaps: async () => [], ...ownedTools(list, 'dk', tune) };
}

const deckOf = (list: Awaited<ReturnType<typeof setup>>['list']) => ({ list, cards: [], brief: '', roles: null });

/** A stand-in Claude: each turn is a list of tool calls; a turn of text ends the answer. */
function stand(turns: Array<Array<{ name: string; input: unknown }> | string>) {
  const asked: ClaudeParams[] = [];
  let k = 0;
  let id = 0;
  const call = async (params: ClaudeParams) => {
    asked.push(structuredClone(params));
    const t = turns[Math.min(k++, turns.length - 1)];
    if (typeof t === 'string') return { content: [{ type: 'text', text: t }], stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: {} } as unknown as Anthropic.Beta.BetaMessage;
    return { content: t.map((u) => ({ type: 'tool_use', id: `t${id++}`, ...u })), stop_reason: 'tool_use', model: 'claude-opus-5-5', usage: {} } as unknown as Anthropic.Beta.BetaMessage;
  };
  return { call, asked };
}
const s = (query: string) => ({ name: 'search_my_cards', input: { query } });
const lastResults = (p: ClaudeParams) => (p.messages.at(-1)!.content as Array<{ content: string; cache_control?: unknown }>);

async function ask(list: Awaited<ReturnType<typeof setup>>['list'], turns: Parameters<typeof stand>[0], question = 'Which theme do my cards support best?') {
  const { reply, newChat } = await import('./deck-chat');
  const chat = newChat(list.id, 'dk', question);
  chat.messages.push({ role: 'user', text: question, at: '' });
  const st = stand(turns);
  const answer = await reply(chat, deckOf(list) as never, await tools(list), st.call as never, 'claude-opus-5-5');
  return { answer, asked: st.asked };
}

describe('search_my_cards', { timeout: 60_000 }, () => {
  it('answers from the owner’s cards only, and every line says where the copy is', async () => {
    const { list } = await setup();
    const { asked, answer } = await ask(list, [[s('draw two')], 'Done.']);
    const result = lastResults(asked[1])[0].content;
    expect(result).toMatch(/^3 match \(1 spare copy, 1 in other decks, 1 in this deck's sections\)/);
    expect(result).toContain('Spare Draw {1}{U} - Instant - Draw two cards. (spare copy)');
    expect(result).toContain('Lent Draw {1}{U} - Instant - Draw two cards. (in Zuko)');
    // A Sideboard card names the Sideboard, not the Maybeboard.
    expect(result).toContain("Waiting Draw {1}{U} - Instant - Draw two cards. (in this deck's Sideboard)");
    // Not owned, and off-colour: never.
    expect(result).not.toContain('Unowned Draw');
    expect(result).not.toContain('Green Draw');
    expect(answer.lookups).toEqual(['Searched your cards: draw two']);
  });

  it('finds lands in Chat; Finish still leaves them out, and its lines are as before', async () => {
    const { list } = await setup();
    const { asked } = await ask(list, [[s('t:land')], 'Done.']);
    expect(lastResults(asked[1])[0].content).toContain('Sulfur Falls');
    const { tuneContext } = await import('./tune');
    const { finishPool } = await import('./finish-pool');
    const ctx = await tuneContext(list, 'dk');
    const finish = finishPool(ctx, 'any');
    expect(finish.lines.map((l) => l.name)).toEqual(['Lent Draw', 'Spare Draw', 'Waiting Draw']);
    // Finish's lines end "(in <deck>)" only for another deck's card: its prompt reads them that way.
    expect(finish.lines.map((l) => l.line.match(/\(.*\)$/)?.[0] ?? null)).toEqual(['(in Zuko)', null, null]);
    // Finish's row names the section a card waits in.
    expect(finish.lines.find((l) => l.name === 'Waiting Draw')?.section).toBe('Sideboard');
  });

  it('refuses the 13th search in one answer in code; the earlier ones are answered', async () => {
    const { list } = await setup();
    const { asked } = await ask(list, [Array.from({ length: 13 }, (_, i) => s(`draw ${i}`)), 'Done.']);
    const results = lastResults(asked[1]);
    expect(results).toHaveLength(13);
    expect(results.slice(0, 12).every((r) => /match/.test(r.content))).toBe(true);
    expect(results[11].content).toContain('That was your last search for this answer.');
    expect(results[12].content).toBe('No searches left for this answer. Answer with what you have.');
  });

  it('marks only the newest tool result as the cache point, round after round', async () => {
    const { list } = await setup();
    const { asked } = await ask(list, [[s('draw')], [s('land'), { name: 'my_collection', input: { names: ['Spare Draw'] } }], [s('two')], 'Done.']);
    for (const p of asked.slice(1)) {
      const marked = p.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => (b as { cache_control?: unknown }).cache_control);
      expect(marked).toHaveLength(1);
      expect(marked[0]).toBe((p.messages.at(-1)!.content as unknown[]).at(-1));
    }
  });

  it('works on a deck with only its commander; with no commander it says to set one', async () => {
    const only = await setup({ commanderOnly: true });
    const { asked } = await ask(only.list, [[s('draw')], 'Done.']);
    expect(lastResults(asked[1])[0].content).toMatch(/^3 match/);
    vi.resetModules();
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), 'mtg-chat-search-'));
    vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
    vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
    const none = await setup({ noCommander: true });
    const r = await ask(none.list, [[s('draw')], 'Set the commander first.']);
    expect(lastResults(r.asked[1])[0].content).toBe('Set the commander first: the search follows its colours. Tell the owner that.');
    expect(r.answer.lookups).toEqual([]);
  });

  it('names a filter it can’t use', async () => {
    const { list } = await setup();
    const { asked } = await ask(list, [[s('draw c:u')], 'Done.']);
    expect(lastResults(asked[1])[0].content).toMatch(/Ignored, not understood: c:u\. The search takes plain words, -word, t:<type>, o:word, mv<=N/);
  });

  it('my_collection says when an owned card can’t go in this deck, and why', async () => {
    const { list } = await setup();
    const { asked } = await ask(list, [[{ name: 'my_collection', input: { names: ['Green Draw', 'Spare Draw'] } }], 'Done.']);
    const out = lastResults(asked[1])[0].content;
    expect(out).toMatch(/Green Draw: .*; can't go in this deck: Green Draw is outside this deck's colours/);
    expect(out).not.toMatch(/Spare Draw: .*can't go/);
  });

  it('no look-up line names a source', async () => {
    const { list } = await setup();
    const { answer } = await ask(list, [[s('draw'), { name: 'search_cards', input: { query: 'otag:draw' } }, { name: 'my_collection', input: { names: ['Opt'] } }], 'Done.']);
    expect(answer.lookups).toEqual(['Searched your cards: draw', 'Searched all cards: otag:draw', 'Looked at your collection']);
    expect(JSON.stringify(answer)).not.toMatch(/scryfall/i);
  });
});

describe('Chat opens a page for the full job (Part C)', { timeout: 60_000 }, () => {
  const cuts = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Deck Spell ${(i % 5) + 1}`, why: 'Weak.' }));

  it('a named single cut stays in Chat, with no page button', async () => {
    const { list } = await setup();
    const { answer } = await ask(list, [[{ name: 'propose_changes', input: { cut: [{ name: 'Deck Spell 1', why: 'You asked.' }] } }], 'Cut it.'], 'cut Deck Spell 1');
    expect(answer.changes?.map((c) => [c.kind, c.name])).toEqual([['cut', 'Deck Spell 1']]);
    expect(answer.go).toBeUndefined();
  });

  it('"cut 12": a few proposals plus the Trim button carrying 12', async () => {
    const { list } = await setup();
    const { answer, asked } = await ask(list, [[{ name: 'propose_changes', input: { cut: cuts(3) } }, { name: 'open_page', input: { page: 'trim', why: 'Trim ranks all of them.', cut: 12 } }], 'Here are three; Trim does the rest.'], 'cut 12');
    expect(answer.changes).toHaveLength(3);
    expect(answer.go).toEqual({ page: 'trim', why: 'Trim ranks all of them.', cut: 12 });
    expect(JSON.stringify(asked[1].messages)).toContain('a button that opens Trim');
  });

  it('more than 5 of one kind: code keeps the first 5 and adds the page, even when the prompt is ignored', async () => {
    const { list } = await setup();
    const { answer, asked } = await ask(list, [[{ name: 'propose_changes', input: { cut: cuts(8), add: [{ name: 'Spare Draw', why: 'Owned.' }] } }], 'Done.'], 'what should I cut?');
    expect(answer.changes?.filter((c) => c.kind === 'cut')).toHaveLength(5);
    expect(answer.changes?.filter((c) => c.kind === 'add')).toHaveLength(1);
    expect(answer.go).toMatchObject({ page: 'trim', cut: 8 });
    expect(JSON.stringify(asked[1].messages)).toContain('3 more cuts held back');
  });

  it('"just do it here": every proposal stays and no button', async () => {
    const { list } = await setup();
    const { answer } = await ask(list, [[{ name: 'propose_changes', input: { cut: cuts(8), in_chat: true } }], 'Done.'], 'just do it here');
    expect(answer.changes).toHaveLength(8);
    expect(answer.go).toBeUndefined();
  });

  it('a question about one card ends with at most one proposal for it and no page button', async () => {
    const { list } = await setup();
    const { answer } = await ask(list, [[{ name: 'propose_changes', input: { never_cut: [{ name: 'Deck Spell 2', why: 'Your best draw.' }] } }], 'Keep it.'], 'how valuable is Deck Spell 2 compared to the others?');
    expect(answer.changes?.map((c) => [c.kind, c.name])).toEqual([['never', 'Deck Spell 2']]);
    expect(answer.go).toBeUndefined();
  });

  it('the button: its words, its number, and Plan while the plan is unconfirmed', async () => {
    const { goLabel, pageGo } = await import('./chat-pages');
    expect(pageGo({ page: 'nowhere', why: '' })).toBeNull();
    expect(pageGo({ page: 'finish', why: 'Fill it.', add: 42, cut: 3 })).toEqual({ page: 'finish', why: 'Fill it.', add: 42 });
    expect(pageGo({ page: 'trim', why: '', cut_to: 95 })).toEqual({ page: 'trim', why: '', cutTo: 95 });
    expect(goLabel({ page: 'trim', why: '', cut: 12 }, true)).toBe('Open Trim · cut 12');
    expect(goLabel({ page: 'finish', why: '', add: 42 }, true)).toBe('Open Finish · add 42');
    expect(goLabel({ page: 'trim', why: '', cut: 12 }, false)).toBe('Confirm the plan first · Open Plan');
    expect(goLabel({ page: 'tags', why: '' }, false)).toBe('Open Tags');
  });
});
