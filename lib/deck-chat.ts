/**
 * Chatting about a deck: questions, suggestions, cuts. Every conversation is
 * saved as it goes.
 *
 * Claude gets the deck (commander, the plan, cards and their roles, the
 * sections and groups) and tools to look things up - Scryfall, the owner's
 * collection, the cards that would fill a role. It never changes the deck
 * itself: anything it suggests comes back as proposals the owner applies
 * one by one with a button (lib/chat-actions.ts): cut, add, swap, move to a
 * section, group or ungroup a card, never cut, a note, a way to win, a key
 * card.
 *
 * Each reply runs as a background job (lib/jobs.ts), so the page can be
 * left while Claude thinks. Server only.
 */

import { randomUUID } from 'crypto';

import type Anthropic from '@anthropic-ai/sdk';

import type { ClaudeParams } from './ai-claude';
import { localCards } from './card-store';
import { database, type List, type ListedCard } from './db';
import type { GapCard } from './gap-cards';
import { ROLES, type RoleCount } from './roles';
import type { ScryfallCard } from './scryfall';

/** One proposal from Claude, applied with its own button. */
export interface Change {
  kind: 'add' | 'cut' | 'swap' | 'move' | 'group' | 'ungroup' | 'never' | 'note' | 'win' | 'key';
  /** The card (the one coming in, for a swap); the note's text; the way to win's name. */
  name: string;
  why: string;
  /** A printing to add (add, swap), or the deck's copy (the others). */
  cardId: string | null;
  held: string | null;
  price: string | null;
  /** swap: the card going out. */
  out?: { name: string; cardId: string | null };
  /** add, cut, move: the section; group, ungroup: the group. */
  to?: string;
  /** way to win: its cards. */
  cards?: string[];
  /** Sent to Tune (adds and cuts, the older way). */
  done?: boolean;
  /** Applied here, with what Undo needs; null once undone. */
  applied?: { at: string; undo: unknown } | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  at: string;
  /** What it looked at to answer, in words. */
  lookups?: string[];
  changes?: Change[];
  model?: string;
}

export interface DeckChat {
  id: string;
  listId: string;
  profileId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

// --- storage ---------------------------------------------------------------

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS deck_chats (id TEXT PRIMARY KEY, listId TEXT NOT NULL, profileId TEXT NOT NULL, updatedAt TEXT NOT NULL, chat TEXT NOT NULL)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_deck_chats_list ON deck_chats (listId, updatedAt)');
    ready = true;
  }
  return d;
}

export function saveChat(chat: DeckChat): void {
  chat.updatedAt = new Date().toISOString();
  db().run(`INSERT INTO deck_chats (id, listId, profileId, updatedAt, chat) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updatedAt = excluded.updatedAt, chat = excluded.chat`,
  [chat.id, chat.listId, chat.profileId, chat.updatedAt, JSON.stringify(chat)]);
}

export function getChat(listId: string, id: string): DeckChat | null {
  const row = db().get('SELECT chat FROM deck_chats WHERE id = ? AND listId = ?', [id, listId]) as { chat: string } | null;
  return row ? JSON.parse(row.chat) as DeckChat : null;
}

export function chatsFor(listId: string): Array<Pick<DeckChat, 'id' | 'title' | 'updatedAt'> & { added: number; cut: number }> {
  return (db().all('SELECT chat FROM deck_chats WHERE listId = ? ORDER BY updatedAt DESC', [listId]) as Array<{ chat: string }>).map((r) => {
    const c = JSON.parse(r.chat) as DeckChat;
    const done = c.messages.flatMap((m) => m.changes ?? []).filter((x) => x.done);
    return { id: c.id, title: c.title, updatedAt: c.updatedAt, added: done.filter((x) => x.kind === 'add').length, cut: done.filter((x) => x.kind === 'cut').length };
  });
}

export function deleteChat(listId: string, id: string): boolean {
  return db().run('DELETE FROM deck_chats WHERE id = ? AND listId = ?', [id, listId]).changes > 0;
}

export function newChat(listId: string, profileId: string, firstQuestion: string): DeckChat {
  const now = new Date().toISOString();
  const title = firstQuestion.trim().replace(/\s+/g, ' ');
  return { id: randomUUID(), listId, profileId, title: title.length > 60 ? `${title.slice(0, 57).replace(/\s\S*$/, '')}…` : title, createdAt: now, updatedAt: now, messages: [] };
}

// --- the conversation --------------------------------------------------------

export interface ChatTools {
  /** A Scryfall search, already limited to the commander's colours and Commander-legal. */
  search: (query: string) => Promise<ScryfallCard[]>;
  /** Where the owner has a copy of each card: a box, another deck, or null. */
  held: (names: string[]) => Record<string, string | null>;
  /** Cards to fill a role. */
  gaps: (role: string, owned: boolean, max: number | null) => Promise<GapCard[]>;
}

export interface ChatDeck {
  list: List;
  cards: ListedCard[];
  brief: string;
  roles: RoleCount[] | null;
  /** The plan's styles and flip turn, in words. */
  plan?: string;
  /** The owner's tags on each card, by card name. */
  tagsOf?: Map<string, string[]>;
  /** The deck's sections besides the main deck, for cuts, adds and moves. */
  sections?: Array<{ id: string; name: string; purpose: string }>;
}

const MAX_ROUNDS = 8;
const front = (name: string) => name.split(' // ')[0];

export const CHAT_SYSTEM = `\
You are an experienced Commander player helping a friend with their deck in
MTG Tracker. Be direct and specific, and talk like a player: name cards,
say why in a sentence. Keep answers short unless asked for depth.

How to help:
- Start from what the deck is trying to do (its brief and how it wins).
  Every suggestion should serve that plan.
- Look things up rather than guess: search Scryfall for cards and check the
  owner's collection. Only suggest cards that are legal in Commander and in
  the commander's colours. Judge cards by what they do for this plan, not by
  how popular they are.
- When the owner asks for cards from their collection, check it first and
  prefer what they own.
- Cantrips are not card draw. A deck needs ways to actually win.
- Count: the deck must stay at 100 cards with the commander. When you
  suggest adding cards, suggest as many cuts, and the reverse. A swap is one
  card out and one in. One copy of each card, except basic lands: never
  propose adding a card the deck already runs.
- You can propose anything the deck's pages can do, one card or one item at
  a time: cut a card (to one of the deck's sections), add a card (to the deck
  or a section), swap one card for another, move a card between the deck and
  its sections, put a card in a group or take it out (a job, a tag, a way to
  win or one of the owner's groups; a new group name makes a new group), mark
  a card never cut, add a note to the plan, add a way to win with its cards,
  or add a key card. Never cut the commander or a card marked never cut.
- Every change you recommend goes through propose_changes, once per reply,
  so the owner gets a button for each and applies the ones they want. You
  cannot change the deck yourself; never say you have. When the owner asks
  for one specific change ("cut X"), propose just that one.`;

export const CHAT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_cards',
    description: 'Search Scryfall with its search syntax (e.g. "otag:board-wipe cmc<=4", "o:\'draw a card\' t:creature"). Results are limited to the commander\'s colours and Commander-legal cards. Returns up to 15 cards with cost, type, text and price.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'my_collection',
    description: 'Which of these cards the owner has, and where: a box in their collection, or in another of their decks.',
    input_schema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] },
  },
  {
    name: 'cards_for_role',
    description: `Cards that would fill a role or a job in this deck, not already in it, ranked by fit with the commander and how good they are at the job, with where the owner has a copy. Roles and jobs: interaction, finishers, ${ROLES.map((r) => r.id).join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: { role: { type: 'string' }, owned_first: { type: 'boolean' }, max_price: { type: 'number' } },
      required: ['role'],
    },
  },
  {
    name: 'propose_changes',
    description: 'Every change you recommend, each with a one-sentence reason; the owner gets a button for each and applies the ones they want. Use only the lists you need. "to" for a cut, add or move is a section of the deck (its name, or "main"); for group/ungroup it is the group\'s name. Call at most once per reply, after looking things up.',
    input_schema: {
      type: 'object',
      properties: {
        add: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string' }, to: { type: 'string' } }, required: ['name', 'why'] } },
        cut: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string' }, to: { type: 'string' } }, required: ['name', 'why'] } },
        swap: { type: 'array', items: { type: 'object', properties: { out: { type: 'string' }, in: { type: 'string' }, why: { type: 'string' } }, required: ['out', 'in', 'why'] } },
        move: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, to: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'to', 'why'] } },
        group: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, to: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'to', 'why'] } },
        ungroup: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, to: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'to', 'why'] } },
        never_cut: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'why'] } },
        note: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
        way_to_win: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, how: { type: 'string' }, cards: { type: 'array', items: { type: 'string' } } }, required: ['name', 'how'] } },
        key_card: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'why'] } },
      },
    },
  },
];

/** The deck as Claude reads it: commander, brief, every card with its roles. */
export function deckText(deck: ChatDeck): string {
  const rolesOf = new Map<string, string[]>();
  for (const r of deck.roles ?? []) for (const c of r.cards) rolesOf.set(c, [...(rolesOf.get(c) ?? []), r.label]);
  const main = deck.cards.filter((c) => c.board === 'main');
  const counts = (deck.roles ?? []).filter((r) => r.count > 0 || r.target)
    .map((r) => `${r.label} ${r.count}${r.target ? ` (guideline ${r.target[0]}-${r.target[1]})` : ''}`).join('; ');
  const c = deck.list.commander;
  return [
    `Deck: ${deck.list.name}`,
    c ? `Commander: ${c.name} - ${c.type_line}. ${c.oracle_text ?? (c.card_faces ?? []).map((f) => f.oracle_text).join(' // ')}` : 'No commander yet.',
    c ? `Colours: ${(c.color_identity ?? []).join('') || 'colourless'}` : '',
    '',
    deck.brief.trim() ? `The owner's brief:\n${deck.brief.trim()}` : 'The owner has not written a brief.',
    deck.plan ? deck.plan : '',
    '',
    counts ? `Counts against the plan's guidelines (card draw leaves out cantrips and impulse draw; interaction is removal, counterspells and wipes together): ${counts}` : '',
    '',
    `Main deck (${main.reduce((n, x) => n + x.quantity, 0) + (c ? 1 : 0)} cards with the commander):`,
    ...main.map((x) => {
      const tags = [...(rolesOf.get(x.card.name) ?? []), ...(deck.tagsOf?.get(x.card.name) ?? []).map((t) => `#${t}`)];
      return `${x.quantity} ${x.card.name} - ${x.card.type_line ?? ''}${tags.length ? ` [${tags.join(', ')}]` : ''}`;
    }),
    ...(deck.sections?.length ? ['', `Sections besides the main deck: ${deck.sections.map((x) => `${x.name} (${x.purpose === 'out' ? 'cards that came out' : x.purpose === 'in' ? 'cards to bring in' : x.purpose})`).join('; ')}`] : []),
    ...(deck.cards.some((x) => x.board !== 'main') ? ['', 'In the sections:', ...deck.cards.filter((x) => x.board !== 'main').map((x) => `${x.quantity} ${x.card.name}${deck.sections ? ` (${deck.sections.find((s) => s.id === x.board)?.name ?? x.board})` : ''}`)] : []),
  ].filter((l) => l !== undefined).join('\n');
}

const cardLine = (c: ScryfallCard) => `${c.name} ${c.mana_cost ?? ''} - ${c.type_line ?? ''}: ${(c.oracle_text ?? (c.card_faces ?? []).map((f) => f.oracle_text).join(' // ')).replace(/\n/g, ' ').slice(0, 220)}${c.prices?.usd ? ` ($${c.prices.usd})` : ''}`;

/** Runs one tool, answering with text for Claude and a line for the owner. */
async function runTool(name: string, input: Record<string, unknown>, deck: ChatDeck, tools: ChatTools): Promise<{ result: string; lookup: string }> {
  switch (name) {
    case 'search_cards': {
      const query = String(input.query ?? '');
      const cards = (await tools.search(query)).slice(0, 15);
      return { result: cards.length ? cards.map(cardLine).join('\n') : 'No cards found.', lookup: `Searched Scryfall: ${query}` };
    }
    case 'my_collection': {
      const names = (input.names as string[] | undefined ?? []).slice(0, 40);
      const held = tools.held(names);
      return { result: names.map((n) => `${n}: ${held[n] ?? 'not owned'}`).join('\n'), lookup: 'Looked at your collection' };
    }
    case 'cards_for_role': {
      const role = String(input.role ?? '');
      const cards = await tools.gaps(role, input.owned_first !== false, typeof input.max_price === 'number' ? input.max_price : null);
      return {
        result: cards.length ? cards.map((c) => `${c.name} - ${c.typeLine}; ${c.held ? `owned (${c.held})` : `not owned${c.price ? `, $${c.price}` : ''}`}; ${c.why}`).join('\n') : 'Nothing fits.',
        lookup: `Cards for ${ROLES.find((r) => r.id === role)?.label.toLowerCase() ?? role}`,
      };
    }
    default:
      return { result: `No tool called ${name}.`, lookup: '' };
  }
}

/** The proposals, matched to real cards: printings to add, the deck's copies for the rest. */
export function resolveChanges(input: Record<string, unknown>, deck: ChatDeck, held: ChatTools['held']): Change[] {
  const str = (x: unknown, n = 300) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const rows = (key: string) => (Array.isArray(input[key]) ? input[key] as Array<Record<string, unknown>> : []).filter((x) => !!x && typeof x === 'object').slice(0, 30);
  const inDeck = new Map([...deck.cards.map((c) => [front(c.card.name).toLowerCase(), c.card] as const), ...(deck.list.commander ? [[front(deck.list.commander.name).toLowerCase(), deck.list.commander] as const] : [])]);
  const incoming = [...rows('add').map((x) => str(x.name, 150)), ...rows('swap').map((x) => str(x.in, 150))].filter(Boolean);
  const known = new Map(localCards(incoming).map((c) => [front(c.name).toLowerCase(), c]));
  const where = held(incoming);
  const mine = (name: string) => inDeck.get(front(name).toLowerCase());
  const base = (kind: Change['kind'], name: string, why: string, extra: Partial<Change> = {}): Change => ({ kind, name: mine(name)?.name ?? name, why, cardId: mine(name)?.id ?? null, held: null, price: null, ...extra });
  const add = (name: string) => { const card = known.get(front(name).toLowerCase()); return { name: card?.name ?? name, cardId: card?.id ?? null, held: where[name] ?? null, price: card?.prices?.usd ?? null }; };
  return [
    ...rows('add').map((x) => ({ kind: 'add' as const, ...add(str(x.name, 150)), why: str(x.why), ...(str(x.to, 60) ? { to: str(x.to, 60) } : {}) })).filter((c) => c.name),
    ...rows('cut').map((x) => base('cut', str(x.name, 150), str(x.why), str(x.to, 60) ? { to: str(x.to, 60) } : {})).filter((c) => c.name),
    ...rows('swap').map((x) => ({ kind: 'swap' as const, ...add(str(x.in, 150)), why: str(x.why), out: { name: mine(str(x.out, 150))?.name ?? str(x.out, 150), cardId: mine(str(x.out, 150))?.id ?? null } })).filter((c) => c.name && c.out.name),
    ...rows('move').map((x) => base('move', str(x.name, 150), str(x.why), { to: str(x.to, 60) })).filter((c) => c.name && c.to),
    ...rows('group').map((x) => base('group', str(x.name, 150), str(x.why), { to: str(x.to, 60) })).filter((c) => c.name && c.to),
    ...rows('ungroup').map((x) => base('ungroup', str(x.name, 150), str(x.why), { to: str(x.to, 60) })).filter((c) => c.name && c.to),
    ...rows('never_cut').map((x) => base('never', str(x.name, 150), str(x.why))).filter((c) => c.name),
    ...rows('note').map((x) => ({ kind: 'note' as const, name: str(x.text, 600), why: '', cardId: null, held: null, price: null })).filter((c) => c.name),
    ...rows('way_to_win').map((x) => ({ kind: 'win' as const, name: str(x.name, 80), why: str(x.how), cardId: null, held: null, price: null, cards: (Array.isArray(x.cards) ? x.cards : []).map((n) => mine(String(n))?.name).filter((n): n is string => !!n).slice(0, 20) })).filter((c) => c.name),
    ...rows('key_card').map((x) => base('key', str(x.name, 150), str(x.why))).filter((c) => c.name),
  ];
}

/**
 * Claude's reply to the newest question: the tool loop, run to an answer.
 * `call` is a charged Claude call (ai.ts claudeCall); tests give their own.
 */
export async function reply(
  chat: DeckChat,
  deck: ChatDeck,
  tools: ChatTools,
  call: (params: ClaudeParams, step: string) => Promise<Anthropic.Beta.BetaMessage>,
  model: string,
): Promise<ChatMessage> {
  const history: Anthropic.Beta.BetaMessageParam[] = chat.messages.map((m) => ({
    role: m.role,
    content: m.role === 'assistant' && m.changes?.length
      ? `${m.text}\n\n(Proposed: ${m.changes.map((c) => `${c.kind} ${c.kind === 'swap' ? `${c.out?.name} for ` : ''}${c.name}${c.to ? ` (${c.to})` : ''}${c.applied ? ' - applied by the owner' : c.done ? ' - sent to Tune' : ''}`).join('; ')})`
      : m.text,
  }));
  const lookups: string[] = [];
  let changes: Change[] = [];
  const messages = [...history];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const answer = await call({
      model,
      max_tokens: 16_000,
      system: [
        { type: 'text', text: CHAT_SYSTEM },
        { type: 'text', text: deckText(deck), cache_control: { type: 'ephemeral' } },
      ],
      thinking: { type: 'adaptive' },
      tools: CHAT_TOOLS,
      messages,
    } as ClaudeParams, round === 0 ? 'answer' : 'look things up');

    const uses = answer.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const text = answer.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (answer.stop_reason !== 'tool_use' || !uses.length) {
      return { role: 'assistant', text: text || (answer.stop_reason === 'refusal' ? 'Claude declined to answer that.' : '…'), at: new Date().toISOString(), lookups, changes, model: answer.model };
    }
    messages.push({ role: 'assistant', content: answer.content as Anthropic.Beta.BetaContentBlockParam[] });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const input = (use.input ?? {}) as Record<string, unknown>;
      if (use.name === 'propose_changes') {
        changes = resolveChanges(input, deck, tools.held);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: `Shown to the owner as ${changes.length} button${changes.length === 1 ? '' : 's'}.` });
        continue;
      }
      try {
        const { result, lookup } = await runTool(use.name, input, deck, tools);
        if (lookup && !lookups.includes(lookup)) lookups.push(lookup);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: result });
      } catch (error) {
        results.push({ type: 'tool_result', tool_use_id: use.id, content: `That failed: ${error instanceof Error ? error.message : 'unknown error'}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { role: 'assistant', text: 'I looked up a lot and ran out of steps before answering - ask again, more narrowly.', at: new Date().toISOString(), lookups, changes };
}
