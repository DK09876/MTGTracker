/**
 * The deck chat's tool loop, with Claude and the look-ups stood in for.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-chat-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

const card = (name: string, extra: Partial<ScryfallCard> = {}) => ({ id: `id-${name}`, oracle_id: `o-${name}`, name, type_line: 'Instant', ...extra }) as ScryfallCard;
const deck = () => ({
  list: { id: 'l1', name: 'Azula', commander: card('Fire Lord Azula', { type_line: 'Legendary Creature', color_identity: ['U', 'B', 'R'], oracle_text: 'Firebending 2' }) } as never,
  cards: [{ card: card('Brainsurge'), quantity: 1, board: 'main' }, { card: card('Opt'), quantity: 1, board: 'main' }] as never,
  brief: 'Storm off rituals.',
  roles: null,
});

const message = (content: unknown[], stop: string) => ({ content, stop_reason: stop, model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 1 } }) as never;

describe('deck chat', () => {
  it('runs the tools Claude asks for, then turns its proposals into buttons', async () => {
    const { reply, newChat, deckText } = await import('./deck-chat');
    expect(deckText(deck())).toMatch(/Commander: Fire Lord Azula[\s\S]*The owner's brief:\nStorm off rituals\.[\s\S]*1 Brainsurge/);

    const calls: unknown[] = [];
    const call = vi.fn(async (params: { messages: unknown[] }) => {
      calls.push(structuredClone(params.messages));
      if (calls.length === 1) {
        return message([{ type: 'tool_use', id: 't1', name: 'my_collection', input: { names: ['Grapeshot'] } }], 'tool_use');
      }
      if (calls.length === 2) {
        return message([{ type: 'tool_use', id: 't2', name: 'propose_changes', input: { add: [{ name: 'Grapeshot', why: 'A storm kill.' }], cut: [{ name: 'Brainsurge', why: 'Weakest cantrip.' }] } }], 'tool_use');
      }
      return message([{ type: 'text', text: 'Add Grapeshot, cut Brainsurge.' }], 'end_turn');
    });
    const chat = newChat('l1', 'dk', 'What finisher should I add?');
    chat.messages.push({ role: 'user', text: 'What finisher should I add?', at: '' });
    const answer = await reply(chat, deck(), {
      search: async () => [],
      held: (names) => Object.fromEntries(names.map((n) => [n, n === 'Grapeshot' ? 'yours, Box 4' : null])),
      edhrec: async () => null,
      gaps: async () => [],
    }, call as never, 'claude-sonnet-5-5');

    expect(call).toHaveBeenCalledTimes(3);
    // The collection answer went back to Claude.
    expect(JSON.stringify(calls[1])).toContain('Grapeshot: yours, Box 4');
    expect(answer.text).toBe('Add Grapeshot, cut Brainsurge.');
    expect(answer.lookups).toEqual(['Looked at your collection']);
    expect(answer.changes?.map((c) => [c.kind, c.name, c.cardId, c.held])).toEqual([
      ['add', 'Grapeshot', null, 'yours, Box 4'],
      ['cut', 'Brainsurge', 'id-Brainsurge', null],
    ]);
  });

  it('names a new chat after its first question', async () => {
    const { newChat } = await import('./deck-chat');
    expect(newChat('l1', 'dk', 'What should I cut to make room for three new cards from the Avatar set?').title)
      .toBe('What should I cut to make room for three new cards from…');
  });
});
