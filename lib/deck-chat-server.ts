/**
 * Deck chat wired to the database, Scryfall and Claude: ask a
 * question and the reply runs as a background job. Server only.
 */

import { categories } from './categories';
import { deckRoles, jobCards } from './deck-roles';
import { sectionsOf } from './sections';
import { tuneContext, whyNotAddable } from './tune';
import { appModel, claudeCall, modelFor, ModelError } from './ai';
import { deckIdentity } from './commanders';
import { cardsInList, deckTags, type List } from './db';
import { gapCards, heldByName } from './gap-cards';
import { planContext } from './plan-context';
import { latestJob, startJob, type Job } from './jobs';
import { newChat, recentChats, reply, saveChat, type DeckChat } from './deck-chat';
import { providerOf } from './models';
import { searchCards, ScryfallError } from './scryfall';

export class ChatError extends Error {}

/** Add the owner's question to a chat (a new one when no id) and start Claude's reply. */
export async function ask(list: List, profile: string, text: string, chat: DeckChat | null): Promise<{ chat: DeckChat; job: Job }> {
  const model = modelFor(profile, 'chat');
  if (providerOf(model) !== 'anthropic' || !appModel(profile, 'chat')) throw new ChatError('Deck chat needs Claude: no Anthropic key is set on the server');
  // The same question twice in a row (a double tap, or a phone resending) is one question.
  const running = latestJob('chat', list.id);
  if (chat && chat.messages.at(-1)?.role === 'user' && running?.status === 'running') {
    if (chat.messages.at(-1)!.text === text.trim()) return { chat, job: running };
    throw new ChatError('Claude is still answering the last question in this chat');
  }
  if (!chat) {
    const again = recentChats(list.id, profile).find((c) => c.messages.length && c.messages[0].role === 'user' && c.messages[0].text === text.trim() && Date.now() - Date.parse(c.createdAt) < 30_000);
    if (again && running) return { chat: again, job: running };
  }
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
    // Each card's groups, as the Tags tab has them (jobs, card-data tags, ways to win, key cards, the owner's groups).
    const tagsOf = new Map<string, string[]>();
    for (const c of await categories(list, jobCards).catch(() => [])) for (const x of c.cards) tagsOf.set(x.name, [...(tagsOf.get(x.name) ?? []), c.name]);
    const planText = await planContext(list).catch(() => '');
    const sections = sectionsOf(list.id).map((x) => ({ id: x.id, name: x.name, purpose: x.purpose }));
    // Tune's checks for a card going into the main deck, so a proposal that Apply would refuse says why up front.
    const tune = await tuneContext(list, profile).catch(() => null);
    const message = await reply(current, { list, cards, brief: tags.brief, roles, plan: planText, tagsOf, sections }, {
      search: async (q) => (await searchCards(`(${q}) id<=${identity} legal:commander`)).cards,
      held: (names) => heldByName(profile, list.id, names),
      gaps: async (role, owned, max) => (await gapCards(list, profile, role, { owned, max, show: 10 })).cards,
      check: tune ? (card, leaving) => whyNotAddable(tune, card, leaving) : undefined,
    }, claudeCall(model, { profile, feature: 'chat', label: list.name }), model);
    current.messages.push(message);
    saveChat(current);
    return { chatId: current.id };
  });
  return { chat: current, job };
}
