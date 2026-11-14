/**
 * Deck chat wired to the database, Scryfall and Claude: ask a
 * question and the reply runs as a background job. Server only.
 */

import { categories } from './categories';
import { deckRoles, jobCards } from './deck-roles';
import { sectionsOf } from './sections';
import { tuneContext, whyNotAddable, type Context } from './tune';
import { appModel, claudeCall, modelFor, ModelError } from './ai';
import { deckIdentity } from './commanders';
import { cardsInList, database, deckTags, type List } from './db';
import { gapCards, heldByName } from './gap-cards';
import { planContext } from './plan-context';
import { latestJob, startJob, type Job } from './jobs';
import { newChat, recentChats, reply, saveChat, type ChatTools, type DeckChat } from './deck-chat';
import { providerOf } from './models';
import { imageOf, searchCards, ScryfallError } from './scryfall';
import { finishStore } from './finish';
import { finishPool, heldCards, type Pool } from './finish-pool';
import { searchLines } from './finish-shared';

export class ChatError extends Error {}

export { cardsNamed } from './cards-named';
import { cardsNamed } from './cards-named';

/**
 * Chat's look-ups over the owner's cards (handoff 9): search_my_cards over every card they hold that may go in
 * this deck (spare copies, this deck's sections, other decks; lands too), the pool worked out once per answer on
 * the first search; and, for my_collection, why a named card can't go in.
 */
export function ownedTools(list: List, profile: string, tune: Context | null): Pick<ChatTools, 'mine' | 'fits'> {
  let pool: Pool | null = null;
  return {
    mine: (q) => {
      if (!list.commander) return { error: 'Set the commander first: the search follows its colours. Tell the owner that.' };
      if (!tune) return { error: 'The search over the owner\'s cards isn\'t available right now. Say so, and answer without it.' };
      pool ??= finishPool(tune, 'any', heldCards(profile, list.id), { chat: true });
      return searchLines(pool.lines, q);
    },
    fits: (names) => {
      // Without Tune's checks, at least the colours: an owned card outside the commander's still says so.
      const known = cardsNamed(names);
      if (!tune) {
        if (!list.commander) return {};
        const id = new Set(list.commander.color_identity ?? []);
        return Object.fromEntries(names.map((n) => { const c = known.get(n.split(' // ')[0].toLowerCase()); return [n, c && !(c.color_identity ?? []).every((x) => id.has(x)) ? `${c.name} is outside this deck's colours` : null]; }));
      }
      return Object.fromEntries(names.map((n) => { const c = known.get(n.split(' // ')[0].toLowerCase()); return [n, c ? whyNotAddable(tune, c) : null]; }));
    },
  };
}

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
    const { mine, fits } = ownedTools(list, profile, tune);
    // Claude's reason for each card Finish picked on this deck (the open list, or the one last applied).
    const fs = finishStore(list.id);
    const finishWhy = new Map((fs.run?.items ?? fs.done?.session.run?.items ?? []).map((i) => [i.name, i.why] as const));
    const message = await reply(current, { list, cards, brief: tags.brief, roles, plan: planText, tagsOf, sections, finishWhy }, {
      search: async (q) => (await searchCards(`(${q}) id<=${identity} legal:commander`)).cards,
      held: (names) => heldByName(profile, list.id, names),
      gaps: async (role, owned, max) => (await gapCards(list, profile, role, { owned, max, show: 10 })).cards,
      check: tune ? (card, leaving) => whyNotAddable(tune, card, leaving) : undefined,
      mine,
      fits,
      resolve: (names) => [...cardsNamed(names).values()].map((c) => ({ name: c.name, id: c.id, image: imageOf(c, 'normal') })),
    }, claudeCall(model, { profile, feature: 'chat', label: list.name }), model);
    current.messages.push(message);
    saveChat(current);
    return { chatId: current.id };
  });
  return { chat: current, job };
}
