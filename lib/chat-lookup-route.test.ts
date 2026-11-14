/**
 * Storing a card found by hovering a name in Chat (handoff 10, item 39; review PR56, 15-17): the route reads the
 * chat again after the outside lookup and changes only that message's cards, so an answer saved meanwhile
 * survives; it refuses while Claude writes the next answer; names compare with accents and apostrophes folded.
 * The card search is stubbed.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { foldName, markedIn } from './card-lookup';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-chat-lookup-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const found = { object: 'card', id: 'new-1', oracle_id: 'o-new', name: 'Lim-Dûl’s Brand New Card', type_line: 'Instant', legalities: { commander: 'legal' }, color_identity: ['B'], image_uris: { normal: 'https://cards.scryfall.io/x.jpg' } } as unknown as ScryfallCard;

describe('names compare folded', () => {
  it('accents and curly apostrophes', () => {
    expect(foldName('Lim-Dûl’s Brand New Card')).toBe(foldName("Lim-Dul's brand new card"));
    expect(markedIn('Try [[Lim-Dul\'s Brand New Card]].', 'Lim-Dûl’s Brand New Card')).toBe(true);
    expect(markedIn('Try Lim-Dul.', 'Lim-Dûl')).toBe(false);
  });
});

describe('storing a looked-up card', { timeout: 60_000 }, () => {
  async function setup() {
    const db = await import('./db');
    // dk is the admin and signs in; an open profile needs no session.
    db.addProfile('kevin', 'Kevin');
    const list = db.createList('kevin', 'Ghoul', '', { kind: 'deck' });
    const chats = await import('./deck-chat');
    const chat = chats.newChat(list.id, 'kevin', 'what should I buy?');
    chat.messages.push({ role: 'user', text: 'what should I buy?', at: new Date().toISOString() });
    chat.messages.push({ role: 'assistant', text: 'Buy [[Lim-Dul\'s Brand New Card]].', at: new Date().toISOString(), unresolved: 1 });
    chats.saveChat(chat);
    const route = await import('../app/api/lists/[id]/chats/[chatId]/route');
    const patch = () => route.PATCH(new Request(`http://x/api/lists/${list.id}/chats/${chat.id}?profile=kevin`, { method: 'PATCH', body: JSON.stringify({ message: 1, card: { id: 'new-1', name: 'Lim-Dûl’s Brand New Card' } }) }), { params: Promise.resolve({ id: list.id, chatId: chat.id }) });
    return { list, chat, chats, patch };
  }

  it('an answer saved while the lookup waits is kept, and the card is stored on its message', async () => {
    const { list, chat, chats, patch } = await setup();
    // While the card is fetched, the owner's next question and Claude's answer land (saved by the reply job).
    vi.stubGlobal('fetch', vi.fn(async () => {
      const c = chats.getChat(list.id, chat.id)!;
      c.messages.push({ role: 'user', text: 'and lands?', at: new Date().toISOString() }, { role: 'assistant', text: 'A paid answer about lands.', at: new Date().toISOString() });
      chats.saveChat(c);
      return new Response(JSON.stringify(found), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const r = await patch();
    expect(r.status).toBe(200);
    const after = chats.getChat(list.id, chat.id)!;
    expect(after.messages.map((m) => m.text)).toEqual(['what should I buy?', 'Buy [[Lim-Dul\'s Brand New Card]].', 'and lands?', 'A paid answer about lands.']);
    expect(after.messages[1].cards).toEqual([{ name: found.name, id: 'new-1', image: 'https://cards.scryfall.io/x.jpg' }]);
    expect(after.messages[1].unresolved).toBeUndefined();
  });

  it('refuses while Claude is writing the next answer', async () => {
    const { list, chat, chats, patch } = await setup();
    const c = chats.getChat(list.id, chat.id)!;
    c.messages.push({ role: 'user', text: 'and lands?', at: new Date().toISOString() });
    chats.saveChat(c);
    const jobs = await import('./jobs');
    jobs.startJob({ kind: 'chat', label: 'Deck chat', subject: 'Ghoul', profileId: 'kevin', listId: list.id }, () => new Promise(() => {}));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(found), { status: 200 })));
    const r = await patch();
    expect(r.status).toBe(409);
  });
});
