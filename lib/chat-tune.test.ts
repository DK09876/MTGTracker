/**
 * Chat reading the Tune page (read_tune): only with the owner's leave - their message asks about Tune, or they
 * let it in this chat - and otherwise the answer carries a request for it, never a guess at what's there.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-chat-tune-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.resetModules();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }); });

const card = (name: string, extra: Partial<ScryfallCard> = {}) => ({ id: `id-${name}`, oracle_id: `o-${name}`, name, type_line: 'Instant', ...extra }) as ScryfallCard;
const deck = () => ({
  list: { id: 'l1', name: 'Azula', commander: card('Fire Lord Azula', { type_line: 'Legendary Creature', color_identity: ['U', 'B', 'R'] }) } as never,
  cards: [{ card: card('Opt'), quantity: 1, board: 'main' }] as never,
  brief: '', roles: null,
});
const message = (content: unknown[], stop: string) => ({ content, stop_reason: stop, model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 } }) as never;

/** Claude asks for the Tune page once, then answers with whatever it was given. */
function claude() {
  const sent: string[] = [];
  let n = 0;
  const call = vi.fn(async (params: { messages: Array<{ content: unknown }> }) => {
    sent.push(JSON.stringify(params.messages.at(-1)?.content));
    return ++n === 1
      ? message([{ type: 'tool_use', id: 't1', name: 'read_tune', input: { part: 'finish' } }], 'tool_use')
      : message([{ type: 'text', text: 'Here is what I see.' }], 'end_turn');
  });
  return { call, sent };
}

async function ask(text: string, tuneAccess?: boolean) {
  const { reply, newChat } = await import('./deck-chat');
  const chat = newChat('l1', 'dk', text);
  if (tuneAccess !== undefined) chat.tuneAccess = tuneAccess;
  chat.messages.push({ role: 'user', text, at: '' });
  const tune = vi.fn(() => 'THE TUNE PAGE');
  const { call, sent } = claude();
  const answer = await reply(chat, deck(), { search: async () => [], held: () => ({}), gaps: async () => [], tune }, call as never, 'claude-opus-5-5');
  return { answer, sent, tune };
}

describe('Chat reading the Tune page', () => {
  it('without leave, gives nothing and asks the owner instead of guessing', async () => {
    const { answer, sent, tune } = await ask('Is Opt worth it?');
    expect(tune).not.toHaveBeenCalled();
    expect(sent[1]).toContain('don\'t have the owner\'s leave');
    expect(answer.askTune).toBe(true);
    expect(answer.lookups).toEqual([]);
  });

  it('reads it when the owner’s message asks about Tune, and says so', async () => {
    const { answer, sent, tune } = await ask('Why did Finish pick these? Look at my finish picks.');
    expect(tune).toHaveBeenCalledWith('finish');
    expect(sent[1]).toContain('THE TUNE PAGE');
    expect(answer.askTune).toBeUndefined();
    expect(answer.lookups).toEqual(['Read your Tune page']);
  });

  it('reads it when the owner let it in this chat, and never when they turned it off', async () => {
    expect((await ask('Is Opt worth it?', true)).tune).toHaveBeenCalled();
    expect((await ask('Is Opt worth it?', false)).answer.askTune).toBe(true);
  });

  it('knows asking about Tune from ordinary words', async () => {
    const { saysTune } = await import('./deck-chat');
    for (const yes of ['what have I staged?', 'go through my upgrades list', 'why are these in my finish picks', 'look at the tune page', 'what is on tune right now']) expect(saysTune(yes), yes).toBe(true);
    for (const no of ['maybe cut Opt', 'how do I finish the deck', 'what should I upgrade', 'is this a good pick']) expect(saysTune(no), no).toBe(false);
  });

  it('the page as text: an empty Tune says nothing is open', async () => {
    (await import('./db')).addProfile('dk', 'DK');
    const { tuneSnapshot } = await import('./tune-snapshot');
    const text = tuneSnapshot('l1');
    expect(text).toContain('## Finish\nNo list open.');
    expect(text).toContain('## Staged in Tune\nNothing staged.');
  });

  it('the page as text: each Finish pick with Claude’s reason and the owner’s mark and reason', async () => {
    const db = await import('./db');
    db.addProfile('dk', 'DK');
    const finish = await import('./finish');
    finish.finishStore('l1');
    const item = (name: string, why: string, group = 'ramp') => ({ name, cardId: `id-${name}`, group, why, src: 'spare', mark: null });
    db.database().run('INSERT INTO deck_finish (listId, state, updatedAt) VALUES (?, ?, ?)', ['l1', JSON.stringify({
      run: { id: 'r', at: '', model: 'm', round: 2, want: 3, full: false, short: 0, reply: 'Leaned into artifacts.', items: [item('Sol Ring', 'Fast mana.'), item('Opt', 'Smooths draws.', 'draw'), item('Mind Stone', 'Ramp that cycles.')], dropped: 0, combos: [], owned: null, combosFailed: false },
      choices: { Opt: { choice: 'skip', text: 'too weak' }, 'Mind Stone': { choice: 'maybe', text: 'love it, too slow' } },
    }), '']);
    const text = (await import('./tune-snapshot')).tuneSnapshot('l1', 'finish');
    expect(text).toContain('List 2: 3 picks for 3 slots. Marked: 1 Add, 0 Rethink, 1 Maybe, 1 Skip.');
    expect(text).toContain('Claude said: Leaned into artifacts.');
    expect(text).toContain('- [[Sol Ring]] (spare copy): owner Add. Claude: Fast mana.');
    expect(text).toContain('- [[Opt]] (spare copy): owner Skip "too weak". Claude: Smooths draws.');
    expect(text).toContain('- [[Mind Stone]] (spare copy): owner Maybe (to the Maybeboard) "love it, too slow". Claude: Ramp that cycles.');
  });
});
