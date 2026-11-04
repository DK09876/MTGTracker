/**
 * Deck chat wired to the database, Scryfall, EDHREC and Claude: ask a
 * question and the reply runs as a background job. Server only.
 */

import { deckRoles } from './deck-roles';
import { appModel, claudeCall, modelFor, ModelError } from './ai';
import { cardsInList, deckTags, type List } from './db';
import { commanderPage, edhrecEnabled } from './edhrec';
import { gapCards, heldByName } from './gap-cards';
import { startJob, type Job } from './jobs';
import { newChat, reply, saveChat, type DeckChat } from './deck-chat';
import { providerOf } from './models';
import { searchCards, ScryfallError } from './scryfall';

export class ChatError extends Error {}

/** Add the owner's question to a chat (a new one when no id) and start Claude's reply. */
export async function ask(list: List, profile: string, text: string, chat: DeckChat | null): Promise<{ chat: DeckChat; job: Job }> {
  const model = modelFor(profile, 'chat');
  if (providerOf(model) !== 'anthropic' || !appModel(profile, 'chat')) throw new ChatError('Deck chat needs Claude: no Anthropic key is set on the server');
  const current = chat ?? newChat(list.id, profile, text);
  current.messages.push({ role: 'user', text: text.trim(), at: new Date().toISOString() });
  saveChat(current);

  const job = startJob({
    kind: 'chat', label: 'Deck chat', subject: list.name, profileId: profile, listId: list.id,
    errorLevel: (e) => (e instanceof ModelError || e instanceof ScryfallError ? 'warn' : 'error'),
  }, async ({ progress }) => {
    progress('Claude is reading the deck');
    const cards = cardsInList(list.id);
    const main = cards.filter((c) => c.board === 'main');
    const roles = await deckRoles(list.id, main).catch(() => null);
    const identity = (list.commander?.color_identity ?? []).join('') || 'c';
    const message = await reply(current, { list, cards, brief: deckTags(list.id).brief, roles }, {
      search: async (q) => (await searchCards(`(${q}) id<=${identity} legal:commander`)).cards,
      held: (names) => heldByName(profile, list.id, names),
      edhrec: async () => (list.commander && edhrecEnabled() ? commanderPage(list.commander.name).catch(() => null) : null),
      gaps: async (role, owned, max) => (await gapCards(list, profile, role, { owned, max, show: 10 })).cards,
    }, claudeCall(model, { profile, feature: 'chat', label: list.name }), model);
    current.messages.push(message);
    saveChat(current);
    return { chatId: current.id };
  });
  return { chat: current, job };
}
