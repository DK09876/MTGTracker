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
  const { tuneContext, whyNotAddable } = await import('./tune');
  const { ownedTools, cardsNamed } = await import('./deck-chat-server');
  const tune = await tuneContext(list, 'dk').catch(() => null);
  return { search: async () => [], held: () => ({}), gaps: async () => [], resolve: (n: string[]) => [...cardsNamed(n).values()].map((c) => ({ name: c.name, id: c.id, image: null })), check: tune ? (c: ScryfallCard, l?: ScryfallCard | null) => whyNotAddable(tune, c, l) : undefined, ...ownedTools(list, 'dk', tune) };
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

  it('applies every t: filter, not only the last', async () => {
    const { searchLines } = await import('./finish-shared');
    const pool = [
      { name: 'Zed', line: 'Zed - Creature — Zombie', cmc: 2, typeLine: 'Creature — Zombie', src: 'spare' as const },
      { name: 'Bear', line: 'Bear - Creature — Bear', cmc: 2, typeLine: 'Creature — Bear', src: 'spare' as const },
      { name: 'Zombify', line: 'Zombify - Sorcery', cmc: 4, typeLine: 'Sorcery', src: 'spare' as const },
    ];
    expect(searchLines(pool, 't:zombie t:creature').lines.map((l) => l.name)).toEqual(['Zed']);
    expect(searchLines(pool, 't:creature').total).toBe(2);
    expect(searchLines(pool, 'z -t:creature').lines.map((l) => l.name)).toEqual(['Zombify']);
  });

  it('names a filter it can’t use', async () => {
    const { list } = await setup();
    const { asked } = await ask(list, [[s('draw c:u')], 'Done.']);
    expect(lastResults(asked[1])[0].content).toMatch(/Ignored, not understood: c:u\. The search takes plain words, -word, t:<type>, -t:<type>, o:word, mv<=N/);
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

describe('Chat opens a page for the full job (Part C, and review items 1-8)', { timeout: 60_000 }, () => {
  /** Azula with twelve more spells in the deck and seven more blue cards in the boxes, for caps of 5. */
  async function big() {
    const s = await setup();
    for (let i = 1; i <= 12; i++) s.db.addCardToList(s.list.id, card(`Main ${i}`));
    const col = await import('./collection');
    for (let i = 1; i <= 7; i++) col.addToCollection('dk', card(`Box ${i}`, { oracle_text: 'Draw two cards.' }), 1);
    // Roles for the new cards too, so nothing is looked up (the lookup is offline here and slow to give up).
    const { ROLES_VERSION } = await import('./roles');
    const ids = (s.db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
    s.db.saveRoles(new Map(ids.map((id) => [id, []] as [string, string[]])), ROLES_VERSION);
    return s;
  }
  const cut = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ({ name: `Main ${i + from}`, why: 'Weak.' }));
  const add = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Box ${i + 1}`, why: 'Owned.' }));

  it('a named single cut stays in Chat, with no page button', async () => {
    const { list } = await big();
    const { answer } = await ask(list, [[{ name: 'propose_changes', input: { cut: [{ name: 'Main 1', why: 'You asked.' }] } }], 'Cut it.'], 'cut Main 1');
    expect(answer.changes?.map((c) => [c.kind, c.name])).toEqual([['cut', 'Main 1']]);
    expect(answer.pages).toBeUndefined();
  });

  it('"cut 12" with three shown: the Trim button carries what is left, 9', async () => {
    const { list } = await big();
    const { answer, asked } = await ask(list, [[{ name: 'propose_changes', input: { cut: cut(3) } }, { name: 'open_page', input: { page: 'trim', why: 'Trim ranks all of them.', cut: 12 } }], 'Three here; Trim does the rest.'], 'cut 12');
    expect(answer.changes).toHaveLength(3);
    expect(answer.pages).toEqual([{ page: 'trim', why: 'Trim ranks all of them.', cut: 9 }]);
    expect(JSON.stringify(asked[1].messages)).toContain('a button that opens Trim');
  });

  it('8 cuts: 5 shown, and the button carries the 3 held back', async () => {
    const { list } = await big();
    const { answer, asked } = await ask(list, [[{ name: 'propose_changes', input: { cut: cut(8) } }], 'Done.'], 'what should I cut?');
    expect(answer.changes?.filter((c) => c.kind === 'cut')).toHaveLength(5);
    expect(answer.pages).toEqual([expect.objectContaining({ page: 'trim', cut: 3 })]);
    expect(JSON.stringify(asked[1].messages)).toContain('3 more cuts held back');
  });

  it('adds and cuts both over the cap: a button for each page', async () => {
    const { list } = await big();
    const { answer, asked } = await ask(list, [[{ name: 'propose_changes', input: { cut: cut(7), add: add(7) } }], 'Done.'], 'rebuild it');
    expect(answer.changes?.filter((c) => c.kind === 'cut')).toHaveLength(5);
    expect(answer.changes?.filter((c) => c.kind === 'add')).toHaveLength(5);
    expect(answer.pages?.map((g) => [g.page, g.cut ?? g.add]).sort()).toEqual([['finish', 2], ['trim', 2]]);
    expect(JSON.stringify(asked[1].messages)).toMatch(/a button opens (Trim and Finish|Finish and Trim) for each/);
  });

  it('groups and ungroups are counted apart: 4 and 3 are both under the cap', async () => {
    const { list } = await big();
    const g = Array.from({ length: 4 }, (_, i) => ({ name: `Main ${i + 1}`, to: 'Draw', why: '.' }));
    const u = Array.from({ length: 3 }, (_, i) => ({ name: `Main ${i + 5}`, to: 'Ramp', why: '.' }));
    const { answer } = await ask(list, [[{ name: 'propose_changes', input: { group: g, ungroup: u } }], 'Done.'], 'tidy the groups');
    expect(answer.changes).toHaveLength(7);
    expect(answer.pages).toBeUndefined();
  });

  it('the cap keeps the first five that can apply; refused rows stay to say why and don\'t count', async () => {
    const { list } = await big();
    const off = ['Green Draw', 'Green Draw', 'Green Draw'].map((name) => ({ name, why: 'Off-colour.' }));
    const { answer } = await ask(list, [[{ name: 'propose_changes', input: { add: [...off, ...add(5)] } }], 'Done.'], 'add some draw');
    expect(answer.changes?.filter((c) => !c.blocked)).toHaveLength(5);
    expect(answer.changes?.some((c) => c.blocked)).toBe(true);
    expect(answer.pages).toBeUndefined();
  });

  it('a later propose_changes replaces the earlier one, and the buttons follow it', async () => {
    const { list } = await big();
    const { answer } = await ask(list, [[{ name: 'propose_changes', input: { cut: cut(8) } }], [{ name: 'propose_changes', input: { cut: cut(2) } }], 'Done.'], 'what should I cut?');
    expect(answer.changes).toHaveLength(2);
    expect(answer.pages).toBeUndefined();
  });

  it('an earlier open_page doesn\'t block the button the cap needs', async () => {
    const { list } = await big();
    const { answer } = await ask(list, [[{ name: 'open_page', input: { page: 'check', why: 'Look at the curve.' } }, { name: 'propose_changes', input: { add: add(7) } }], 'Done.'], 'more draw please');
    expect(answer.pages?.map((g) => g.page)).toEqual(['check', 'finish']);
  });

  it('cards the owner named in their message are never held back; "just do it here" holds nothing back', async () => {
    const { list } = await big();
    const named = await ask(list, [[{ name: 'propose_changes', input: { cut: cut(7) } }], 'Done.'], 'cut these seven: Main 1, Main 2, Main 3, Main 4, Main 5, Main 6, Main 7');
    expect(named.answer.changes).toHaveLength(7);
    expect(named.answer.pages).toBeUndefined();
    const here = await ask(list, [[{ name: 'propose_changes', input: { cut: cut(8) } }], 'Done.'], 'just do it here: cut 8 cards');
    expect(here.answer.changes).toHaveLength(8);
    expect(here.answer.pages).toBeUndefined();
  });

  it('an answer that searches one at a time gets more rounds than the usual 8, enough for all 12 searches', async () => {
    const { list } = await big();
    const { asked, answer } = await ask(list, [...Array.from({ length: 12 }, (_, i) => [s(`draw ${i}`)]), 'Done.']);
    expect(answer.text).toBe('Done.');
    expect(asked).toHaveLength(13);
    expect(JSON.stringify(asked.at(-1)!.messages)).toContain('That was your last search for this answer.');
  });

  it('the button: its words, its number, and Plan while the plan is unconfirmed', async () => {
    const { goLabel, pageGo, finishWant } = await import('./chat-pages');
    expect(pageGo({ page: 'nowhere', why: '' })).toBeNull();
    expect(pageGo({ page: 'finish', why: 'Fill it.', add: 42, cut: 3 })).toEqual({ page: 'finish', why: 'Fill it.', add: 42 });
    expect(pageGo({ page: 'trim', why: '', cut_to: 95 })).toEqual({ page: 'trim', why: '', cutTo: 95 });
    expect(goLabel({ page: 'trim', why: '', cut: 12 }, true)).toBe('Open Trim · cut 12');
    expect(goLabel({ page: 'trim', why: '', cut: 12 }, false)).toBe('Confirm the plan first · Open Plan');
    expect(goLabel({ page: 'tags', why: '' }, false)).toBe('Open Tags');
    // "add 99" on a commander-only deck is a fill to 100; 97 cards and "add 5" is 5.
    expect(finishWant(99, 1)).toBeNull();
    expect(finishWant(5, 97)).toBe(5);
    expect(goLabel({ page: 'finish', why: '', add: 99 }, true, 1)).toBe('Open Finish · fill to 100');
    expect(goLabel({ page: 'finish', why: '', add: 5 }, true, 97)).toBe('Open Finish · add 5');
  });
});

describe('the rest of review item 7, and item 29', { timeout: 60_000 }, () => {
  it('basics the owner holds are searchable in Chat though the deck has some', async () => {
    const { list } = await setup();
    const col = await import('./collection');
    col.addToCollection('dk', card('Island', { type_line: 'Basic Land — Island', cmc: 0, mana_cost: '', oracle_text: '({T}: Add {U}.)', color_identity: [] }), 3);
    const { asked } = await ask(list, [[s('t:basic island')], 'Done.']);
    expect(lastResults(asked[1])[0].content).toMatch(/^1 match/);
  });

  it('without Tune\'s checks, my_collection still says an owned card is outside the colours', async () => {
    const { list } = await setup();
    const { ownedTools } = await import('./deck-chat-server');
    const t = ownedTools(list, 'dk', null);
    expect(t.fits!(['Green Draw', 'Spare Draw'])).toEqual({ 'Green Draw': 'Green Draw is outside this deck\'s colours', 'Spare Draw': null });
    expect(t.mine!('draw')).toEqual({ error: expect.stringContaining('isn\'t available right now') });
  });

  it('an answer keeps the cards its look-ups returned, with ids and pictures, for the page to link', async () => {
    const { list } = await setup();
    const { answer } = await ask(list, [[s('draw two')], 'Spare Draw is the one.']);
    expect(answer.cards?.map((c) => c.name).sort()).toEqual(['Lent Draw', 'Spare Draw', 'Waiting Draw']);
    expect(answer.cards?.every((c) => !!c.id)).toBe(true);
  });

  it('the text: whole card names, longest first; bold and lists without asterisks', async () => {
    const { splitNames, boldRuns, blocksOf } = await import('./chat-text');
    const parts = splitNames('Cut Bastion of Remembrance, keep Bastion and play a second bastionx.', ['Bastion', 'Bastion of Remembrance']);
    expect(parts.filter((p) => p.name).map((p) => p.name)).toEqual(['Bastion of Remembrance', 'Bastion']);
    expect(splitNames('Feral Ghouls', ['Feral Ghoul']).some((p) => p.name)).toBe(false);
    expect(boldRuns('**Mire Triton → Blood Artist:** drains on every death')).toEqual([{ text: 'Mire Triton → Blood Artist:', bold: true }, { text: ' drains on every death', bold: false }]);
    expect(blocksOf('Swaps:\n- **A → B:** why\n- C\nDone.').map((b) => [b.list, b.lines.length])).toEqual([[false, 1], [true, 2], [false, 1]]);
  });
});

describe('review item 31: answer in words, and replaced proposals; item 30: marked names', { timeout: 60_000 }, () => {
  it('an answer that only describes its buttons is asked once for the answer in words, which goes first', async () => {
    const { list } = await setup();
    const { answer, asked } = await ask(list, [
      [{ name: 'propose_changes', input: { cut: [{ name: 'Deck Spell 1', why: 'Weak.' }] } }],
      "That's one button.",
      'Your theme is solid: Zombies dying is what the commander wants, and you own about 44. Rad counters are a bonus, not a plan.',
    ], 'is my theme solid?');
    expect(asked).toHaveLength(3);
    expect(JSON.stringify(asked[2].messages)).toContain('answer my question itself in words');
    expect(asked[2].tool_choice).toEqual({ type: 'none' });
    expect(answer.text.startsWith('Your theme is solid')).toBe(true);
    expect(answer.text).toContain("That's one button.");
  });

  it('a later answer that proposes something else for the same card marks the earlier proposal replaced', async () => {
    const { list } = await setup();
    const { reply, newChat } = await import('./deck-chat');
    const chat = newChat(list.id, 'dk', 'swap');
    chat.messages.push({ role: 'user', text: 'what should replace Deck Spell 1?', at: '' });
    const first = stand([[{ name: 'propose_changes', input: { swap: [{ out: 'Deck Spell 1', in: 'Spare Draw', why: 'Draws two.' }] } }], 'Spare Draw draws two for two. Deck Spell 1 draws one. Swap them.']);
    chat.messages.push(await reply(chat, deckOf(list) as never, await tools(list), first.call as never, 'claude-opus-5-5'));
    chat.messages.push({ role: 'user', text: 'not Spare Draw', at: '' });
    const second = stand([[{ name: 'propose_changes', input: { swap: [{ out: 'Deck Spell 1', in: 'Waiting Draw', why: 'From your Sideboard.' }] } }], 'I was wrong about Spare Draw: Waiting Draw is already in your Sideboard. Same job. Swap that instead.']);
    chat.messages.push(await reply(chat, deckOf(list) as never, await tools(list), second.call as never, 'claude-opus-5-5'));
    expect(chat.messages[1].changes![0].replaced).toBe(true);
    expect(chat.messages[3].changes![0].replaced).toBeUndefined();
    // The model reads it as replaced in the history.
    const third = stand(['Fine.']);
    chat.messages.push({ role: 'user', text: 'ok', at: '' });
    await reply(chat, deckOf(list) as never, await tools(list), third.call as never, 'claude-opus-5-5');
    expect(JSON.stringify(third.asked[0].messages)).toContain('replaced by a later answer');
  });

  it('names marked [[like this]] resolve to cards and are kept with the answer; one that matches nothing is counted', async () => {
    const { list } = await setup();
    const { answer } = await ask(list, ['Play [[Spare Draw]] over [[Deck Spell 2]], and look for [[Not A Real Card]]. Both draw. One is better.']);
    expect(answer.cards?.map((c) => c.name).sort()).toEqual(['Deck Spell 2', 'Spare Draw']);
    expect(answer.unresolved).toBe(1);
    const { splitMarked, marksNames } = await import('./chat-text');
    expect(marksNames(answer.text)).toBe(true);
    expect(splitMarked('Play [[Opt]] and keep your Opt').filter((p) => p.name).map((p) => p.name)).toEqual(['Opt']);
  });

  it('Finish\'s reason for a card it picked is in the deck list Chat reads', async () => {
    const { deckText } = await import('./deck-chat');
    const { list } = await setup();
    const db = await import('./db');
    const text = deckText({ list, cards: db.cardsInList(list.id), brief: '', roles: null, finishWhy: new Map([['Deck Spell 3', 'A Zombie that comes back by itself.']]) } as never);
    expect(text).toContain('Deck Spell 3 - Instant (Finish: A Zombie that comes back by itself.)');
  });
});

describe('review round 2: Chat items 7-13', { timeout: 60_000 }, () => {
  it('7: the words check catches only answers about their buttons, not short real answers', async () => {
    const { onlyButtons } = await import('./deck-chat');
    expect(onlyButtons("I've put up six buttons for you to apply.", 6)).toBe(true);
    expect(onlyButtons("That's two buttons.", 2)).toBe(true);
    expect(onlyButtons('Here you go.', 4)).toBe(true);
    expect(onlyButtons('Cut it.', 1)).toBe(false);
    expect(onlyButtons('Zombies: about 44 (42 spare, 2 in other decks), from t:zombie; standouts A, B, C\nAristocrats: about 30, from sacrifice; standouts D, E\nPick: Zombies, because the commander counts them.\nMissing: a finisher.', 1)).toBe(false);
  });

  it('9: only a newer row that can apply replaces one, and undoing it gives the earlier one back', async () => {
    const { markReplaced, unreplace } = await import('./deck-chat');
    const row = (over: Record<string, unknown>) => ({ kind: 'swap', name: 'In', why: '', cardId: 'x', held: null, price: null, out: { name: 'Out', cardId: 'o' }, ...over });
    const chat = { messages: [{ role: 'assistant', text: '', at: '', changes: [row({})] }] } as never as import('./deck-chat').DeckChat;
    markReplaced(chat, [row({ blocked: 'off-colour' })] as never, 1);
    expect(chat.messages[0].changes![0].replaced).toBeUndefined();
    markReplaced(chat, [row({ name: 'Other' })] as never, 1);
    expect(chat.messages[0].changes![0]).toMatchObject({ replaced: true, replacedBy: [1, 0] });
    unreplace(chat, 1, 0);
    expect(chat.messages[0].changes![0].replaced).toBe(false);
  });

  it('10: asked to fill a commander-only deck, the Finish button stays a fill however many adds are shown', async () => {
    const { pageButtons } = await import('./deck-chat');
    const adds = [1, 2, 3].map((i) => ({ kind: 'add', name: `A${i}`, why: '', cardId: `a${i}`, held: null, price: null }));
    expect(pageButtons(adds as never, [], { page: 'finish', why: 'Fill it.', add: 99 }, 1)).toEqual([{ page: 'finish', why: 'Fill it.', fill: true }]);
    expect(pageButtons(adds as never, [], { page: 'finish', why: '', add: 10 }, 60)).toEqual([{ page: 'finish', why: '', add: 7 }]);
    const { goLabel } = await import('./chat-pages');
    expect(goLabel({ page: 'finish', why: '', fill: true }, true)).toBe('Open Finish · fill to 100');
  });

  it('11: a card counts as named only as a whole word', async () => {
    const { list } = await setup();
    const db = await import('./db');
    for (let i = 1; i <= 7; i++) db.addCardToList(list.id, card(`Opt ${i}`));
    const cuts = Array.from({ length: 7 }, (_, i) => ({ name: `Opt ${i + 1}`, why: '.' }));
    const { answer } = await ask(list, [[{ name: 'propose_changes', input: { cut: cuts } }], 'Cut these.'], 'what options do I have? optimise it');
    expect(answer.changes).toHaveLength(5);
  });

  it('12: stray brackets never show; headings and numbered lists render', async () => {
    const { splitMarked, blocksOf } = await import('./chat-text');
    expect(splitMarked('Play [[[[Opt]]]] now [[ and').map((p) => p.text).join('')).toBe('Play Opt now  and');
    expect(splitMarked('Play [[[[Opt]]]]').find((p) => p.name)?.name).toBe('Opt');
    expect(blocksOf('## Picks\n1. A\n2. B').map((b) => [b.list, b.lines])).toEqual([[false, ['**Picks**']], [true, ['A', 'B']]]);
  });

  it('8, 13: marked names always resolve past the cap, and deck cards keep their ids', async () => {
    const { list } = await setup();
    const db = await import('./db');
    const main = db.cardsInList(list.id);
    const { reply, newChat } = await import('./deck-chat');
    const chat = newChat(list.id, 'dk', 'q');
    chat.messages.push({ role: 'user', text: 'q', at: '' });
    // 21 searches of 15 different cards each: 315 cards, past the 300 kept from tool results.
    let k = 0;
    const t = { ...(await tools(list)), search: async () => Array.from({ length: 15 }, () => { k += 1; return { ...card(`Found ${k}`), id: `f${k}` }; }) as never };
    const st = stand([Array.from({ length: 21 }, (_, i) => ({ name: 'search_cards', input: { query: `q${i}` } })), 'Keep [[Deck Spell 2]] and add [[Spare Draw]].']);
    const answer = await reply(chat, { list, cards: main, brief: '', roles: null } as never, t as never, st.call as never, 'claude-opus-5-5');
    expect(answer.cards!.length).toBeGreaterThan(300);
    expect(answer.cards?.find((c) => c.name === 'Spare Draw')).toBeTruthy();
    expect(answer.cards?.find((c) => c.name === 'Deck Spell 2')?.id).toBe('Deck Spell 2');
  });
});

describe('real runs of PR 55, item 1: the answer travels with the proposals', { timeout: 60_000 }, () => {
  it('the answer field is shown first, and the closing remark after it; no second call', async () => {
    const { list } = await setup();
    const words = 'Zombies: about 44 (42 spare, 2 in other decks), from t:zombie; standouts Undead Augur, Cemetery Reaper\nPick: Zombie aristocrats, because the Ghoul counts nontoken Zombies dying.\nMissing: free sacrifice outlets.';
    const { answer, asked } = await ask(list, [
      [{ name: 'propose_changes', input: { answer: words, note: [{ text: 'Theme: Zombie aristocrats.' }] } }],
      'The note button saves Zombie aristocrats as the theme.',
    ]);
    expect(asked).toHaveLength(2);
    expect(answer.text.startsWith('Zombies: about 44')).toBe(true);
    expect(answer.text).toContain('The note button saves');
  });

  it('the backstop catches what the real runs kept: a first sentence about the buttons, naming few proposed cards', async () => {
    const { onlyButtons } = await import('./deck-chat');
    const a = 'The note button saves Zombie aristocrats as the deck\'s theme, and the Finish button can build the other 99 from your cards around it. One thing to watch: Zombie tokens don\'t trigger The Ghoul, so cards like [[Josu Vess, Lich Knight]] are support, not engines.';
    const d = 'The buttons cover the four swaps above, plus a fifth that saves "Extra combats with Azula" as a way to win in the deck\'s plan. Taking [[Great Train Heist]] leaves a hole in your World at War deck, so you\'d need a replacement there.';
    expect(onlyButtons(a, 1, ['Theme: Zombie aristocrats'])).toBe(true);
    // The cards it proposes (the way to win, a name in quotes, isn't a card).
    expect(onlyButtons(d, 5, ['Aggravated Assault', 'Great Train Heist', 'Combat Celebrant', 'Karlach, Fury of Avernus'])).toBe(true);
    expect(onlyButtons('Cut Propaganda and Eel Umbra first: neither chains spells. Turnabout is slow. The buttons below do it.', 3, ['Propaganda', 'Eel Umbra', 'Turnabout'])).toBe(false);
  });
});
