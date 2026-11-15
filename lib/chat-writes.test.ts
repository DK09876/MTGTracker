/**
 * Every writer of a chat keeps what the others wrote (review PR56 round 2, 1-2, 5): the reply job appends its
 * answer to the chat as stored now, and Apply, Undo and "sent to Tune" set flags on one change after their
 * awaits. Each interleaving is played out with the deck change held open while the other write lands.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;
let gate: { open: () => void; wait: Promise<void> };
const newGate = () => { let open = () => {}; const wait = new Promise<void>((r) => { open = r; }); gate = { open, wait }; };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-chat-writes-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  vi.resetModules();
  newGate();
  // The deck change itself is held open on the gate, so the other write can land in the middle of it.
  vi.doMock('./chat-actions', async (orig) => ({
    ...(await orig<typeof import('./chat-actions')>()),
    applyChange: vi.fn(async () => { await gate.wait; return { kind: 'note' }; }),
    undoChange: vi.fn(async () => { await gate.wait; }),
  }));
});
afterEach(() => {
  vi.doUnmock('./chat-actions');
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const at = () => new Date().toISOString();
const note = (name: string) => ({ kind: 'note' as const, name, why: 'because', cardId: null, held: null, price: null });

async function setup() {
  const db = await import('./db');
  db.addProfile('kevin', 'Kevin');
  const list = db.createList('kevin', 'Ghoul', '', { kind: 'deck' });
  const chats = await import('./deck-chat');
  const chat = chats.newChat(list.id, 'kevin', 'what now?');
  chat.messages.push({ role: 'user', text: 'what now?', at: at() });
  chat.messages.push({ role: 'assistant', text: 'Save a note.', at: at(), changes: [note('A note')] });
  chats.saveChat(chat);
  const route = await import('../app/api/lists/[id]/chats/[chatId]/route');
  const patch = (body: object) => route.PATCH(new Request(`http://x/api/lists/${list.id}/chats/${chat.id}?profile=kevin`, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: list.id, chatId: chat.id }) });
  // An answer to a follow-up landing, as the reply job writes it.
  const answerLands = () => {
    const c = chats.getChat(list.id, chat.id)!;
    c.messages.push({ role: 'user', text: 'and then?', at: at() });
    chats.saveChat(c);
    chats.appendReply(list.id, chat.id, { role: 'assistant', text: 'A paid answer.', at: at() });
  };
  return { list, chat, chats, patch, answerLands };
}

describe('chat writes', { timeout: 60_000 }, () => {
  it('Apply while an answer lands: both kept', async () => {
    const { list, chat, chats, patch, answerLands } = await setup();
    const pending = patch({ message: 1, change: 0, do: 'apply' });
    await new Promise((r) => setTimeout(r, 50));
    answerLands();
    gate.open();
    expect((await pending).status).toBe(200);
    const after = chats.getChat(list.id, chat.id)!;
    expect(after.messages.map((m) => m.text)).toEqual(['what now?', 'Save a note.', 'and then?', 'A paid answer.']);
    expect(after.messages[1].changes![0].applied).toBeTruthy();
  });

  it('a second Apply while the first runs is refused, never applied twice', async () => {
    const { patch } = await setup();
    const first = patch({ message: 1, change: 0, do: 'apply' });
    await new Promise((r) => setTimeout(r, 50));
    expect((await patch({ message: 1, change: 0, do: 'apply' })).status).toBe(409);
    gate.open();
    expect((await first).status).toBe(200);
  });

  it('Undo while an answer lands: both kept', async () => {
    const { list, chat, chats, patch, answerLands } = await setup();
    chats.updateChange(list.id, chat.id, 1, 0, (c) => { c.applied = { at: at(), undo: { kind: 'note' } }; });
    const pending = patch({ message: 1, change: 0, do: 'undo' });
    await new Promise((r) => setTimeout(r, 50));
    answerLands();
    gate.open();
    expect((await pending).status).toBe(200);
    const after = chats.getChat(list.id, chat.id)!;
    expect(after.messages.at(-1)!.text).toBe('A paid answer.');
    expect(after.messages[1].changes![0].applied).toBeNull();
  });

  it('"sent to Tune" after an answer landed keeps the answer', async () => {
    const { list, chat, chats, patch, answerLands } = await setup();
    answerLands();
    expect((await patch({ message: 1, change: 0 })).status).toBe(200);
    const after = chats.getChat(list.id, chat.id)!;
    expect(after.messages.at(-1)!.text).toBe('A paid answer.');
    expect(after.messages[1].changes![0].done).toBe(true);
  });

  it('the reply job\'s answer keeps an Apply made while it was writing, and marks what it replaces on the stored chat', async () => {
    const { list, chat, chats } = await setup();
    // The job read the chat before the reply; meanwhile the owner applied the note.
    chats.updateChange(list.id, chat.id, 1, 0, (c) => { c.applied = { at: at(), undo: { kind: 'note' } }; c.blocked = undefined; });
    chats.appendReply(list.id, chat.id, { role: 'assistant', text: 'Another note.', at: at(), changes: [note('A note')] });
    const after = chats.getChat(list.id, chat.id)!;
    expect(after.messages[1].changes![0].applied).toBeTruthy();
    // An applied proposal is never marked replaced.
    expect(after.messages[1].changes![0].replaced).toBeFalsy();
    expect(after.messages.at(-1)!.text).toBe('Another note.');
  });
});
