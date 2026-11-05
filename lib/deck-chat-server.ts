/**
 * Deck chat wired to the database, Scryfall and Claude: ask a
 * question and the reply runs as a background job. Server only.
 */

import { deckRoles } from './deck-roles';
import { appModel, claudeCall, modelFor, ModelError } from './ai';
import { deckIdentity } from './commanders';
import { cardsInList, deckTags, type List } from './db';
import { gapCards, heldByName } from './gap-cards';
import { planContext } from './plan-context';
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
    // Both commanders' colours, when the deck has two.
    const identity = [...deckIdentity([list.commander, main.find((c) => c.slot === 'partner')?.card])].join('') || 'c';
    const tags = deckTags(list.id);
    const names = new Map(tags.tags.filter((t) => t.status === 'accepted').map((t) => [t.id, t.name]));
    const byKey = new Map(main.map((c) => [c.card.oracle_id ?? c.card.id, c.card.name]));
    const tagsOf = new Map<string, string[]>();
    for (const ct of tags.cardTags) {
      const name = byKey.get(ct.key);
      if (ct.on && name && names.has(ct.tagId)) tagsOf.set(name, [...(tagsOf.get(name) ?? []), names.get(ct.tagId)!]);
    }
    const planText = await planContext(list).catch(() => '');
    const message = await reply(current, { list, cards, brief: tags.brief, roles, plan: planText, tagsOf }, {
      search: async (q) => (await searchCards(`(${q}) id<=${identity} legal:commander`)).cards,
      held: (names) => heldByName(profile, list.id, names),
      gaps: async (role, owned, max) => (await gapCards(list, profile, role, { owned, max, show: 10 })).cards,
    }, claudeCall(model, { profile, feature: 'chat', label: list.name }), model);
    current.messages.push(message);
    saveChat(current);
    return { chatId: current.id };
  });
  return { chat: current, job };
}
