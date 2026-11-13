/**
 * Chatting about a deck: questions, suggestions, cuts. Every conversation is
 * saved as it goes.
 *
 * Claude gets the deck (commander, the plan, cards and their roles, the
 * sections and groups) and tools to look things up - a search over all of
 * Magic, a search over the owner's own cards (handoff 9), whether the owner
 * has named cards, the cards that would fill a role. It never changes the deck
 * itself: anything it suggests comes back as proposals the owner applies
 * one by one with a button (lib/chat-actions.ts): cut, add, swap, move to a
 * section, group or ungroup a card, never cut, a note, a way to win, a key
 * card. For an open-ended ask a page does better (many cuts, a whole fill),
 * it adds a button that opens that page (lib/chat-pages.ts).
 *
 * Each reply runs as a background job (lib/jobs.ts), so the page can be
 * left while Claude thinks. Server only.
 */

import { randomUUID } from 'crypto';

import type Anthropic from '@anthropic-ai/sdk';

import type { ClaudeParams } from './ai-claude';
import { localCards } from './card-store';
import { CHAT_CHANGE_LIMIT, PAGE_FOR, pageGo, PAGE_LABEL, type ChatGo } from './chat-pages';
import { CHAT_SEARCH_LIMIT, searchText, type PoolLine, type Source } from './finish-shared';
import { database, type List, type ListedCard } from './db';
import type { GapCard } from './gap-cards';
import { ROLES, type RoleCount } from './roles';
import { imageOf, type ScryfallCard } from './scryfall';

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
  /** The incoming card's picture (add, swap), for its hover. */
  image?: string | null;
  /** Why Apply would refuse it (an add or swap into the main deck that fails Tune's checks), shown on the row. */
  blocked?: string;
  /** A later answer proposed something else for the same card: no longer applied from here (review item 31). */
  replaced?: boolean;
  /** The row that replaced it: [message, change]. */
  replacedBy?: [number, number];
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
  /**
   * The cards this answer's look-ups returned and its proposals name, with id and picture, so the page can link
   * each name in the text (review item 29). The deck's own cards the page knows already.
   */
  cards?: ChatCard[];
  /** Card names the answer marked [[like this]] that matched no card: shown plain, counted. */
  unresolved?: number;
  /** Pages to open for the rest of the job (Part C), as buttons under the answer. */
  pages?: ChatGo[];
  /** One page button, as answers stored before pages were a list had it. */
  go?: ChatGo;
  model?: string;
}

export interface ChatCard { name: string; id: string; image: string | null }

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

/** A profile's newest chats on a deck, whole (for spotting a question sent twice). */
export function recentChats(listId: string, profileId: string, limit = 5): DeckChat[] {
  return (db().all('SELECT chat FROM deck_chats WHERE listId = ? AND profileId = ? ORDER BY updatedAt DESC LIMIT ?', [listId, profileId, limit]) as Array<{ chat: string }>).map((r) => JSON.parse(r.chat) as DeckChat);
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
  /** Why a card can't go into the main deck (Tune's checks), or null; `leaving` goes out in the same swap. */
  check?: (card: ScryfallCard, leaving?: ScryfallCard | null) => string | null;
  /** A search over the owner's cards that may go in this deck, or why it can't run (no commander, no Tune context). */
  mine?: (query: string) => MineResult | { error: string };
  /** Cards by name (stored first, then the full card data), for the names an answer marks [[like this]]. */
  resolve?: (names: string[]) => ChatCard[];
  /** Why each named card can't go in this deck, or null; my_collection says so beside "owned". */
  fits?: (names: string[]) => Record<string, string | null>;
}

export interface MineResult { total: number; lines: PoolLine[]; ignored: string[]; bySrc: Record<Source, number> }

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
  /** Claude's reason for each card Finish picked on this deck, by name (review item 31). */
  finishWhy?: Map<string, string>;
}

const MAX_ROUNDS = 8;
const front = (name: string) => name.split(' // ')[0];

export const CHAT_SYSTEM = `\
You are an experienced Commander player helping a friend with their deck in
MTG Tracker. Be direct and specific, and talk like a player: name cards,
say why in a sentence. Keep answers short unless asked for depth.

Answering:
- Answer the owner's question in words first: your judgement and your
  reasons, and for a "how many / enough / too many" question the count,
  taken from the deck in front of you (name what you counted). When you
  propose changes or open a page, that answer goes in the tool's "answer"
  field, whole, and is shown above the buttons; anything you write after
  the tools is a short closing note at most. A reply that only describes
  its buttons has not answered.
- A judgement question ("is my theme solid?", "am I using the commander
  well?") gets at most two proposals unless the owner asks for changes.
- Never say the owner asked for something that isn't in their messages,
  the plan or their notes.
- When you change your mind about something you proposed earlier in this
  chat, say so in words ("I was wrong about X: ...") and propose the
  replacement; the app marks the earlier one replaced.
- When you propose a combo, name its cost or risk in one clause.
- A card Finish picked shows Claude's reason in the deck list ("Finish:
  ..."). Read it before calling the card weak; if you still disagree, say
  why.
- Write every card name as [[Card Name]], as printed, so the page can link
  it. Otherwise plain text: no bold, no headings.

How to help:
- Start from what the deck is trying to do (its brief and how it wins).
  Every suggestion should serve that plan.
- Look things up rather than guess. Only suggest cards that are legal in
  Commander and in the commander's colours. Judge cards by what they do for
  this plan, not by how popular they are.
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
  for one specific change ("cut X"), propose just that one.

The owner's cards:
- For any question about what the owner owns, or what they could build from
  it, search their cards with search_my_cards. Don't name cards from memory
  and then check them. my_collection is for checking a few cards by name;
  search_cards is for cards they don't own.
- search_my_cards only returns cards that may go in this deck. Each line says
  where the copy is: a spare copy, one of this deck's sections, or another
  deck ("(in <deck>)"). When you recommend a card that sits in another deck,
  say which. When you give counts, split them into spare copies and cards in
  other decks. If the owner says "only spare copies" or "only from <deck>",
  keep to those lines.
- To compare themes for a commander: first count what the commander's own
  text names (a creature type, a card type, an action). Then choose three or
  four themes it supports and run two or three narrow searches for each, one
  for payoffs and one for enablers. Counts come from the search totals, never
  from memory. Search words differ in breadth ("token" also finds Treasure
  makers), so give counts as "about N", say what each was a search for, and
  never rank themes by raw totals alone.
- A theme answer stays under about 150 words, in this shape:
  one line per theme, "<theme>: about N (X spare, Y in other decks), from
  <what you searched>; standouts A, B, C"; then one line "Pick: <theme>,
  because <one reason>"; then one line "Missing: <what it lacks>". No
  paragraph per theme, no extra card lists, no lands count. Buttons don't
  count toward that: after the pick, propose it as a note to the plan, and on
  a deck that is only its commander add the Finish button.
- If the search says the commander isn't set, tell the owner to set it first.

Doing it here, or opening a page:
- Do it here when the owner has made the decision: they name the cards or
  the change ("cut Sol Ring", "swap X for Y", "add these three"), or ask for
  one or a few picks ("my worst card?", "one more board wipe I own").
- A question about one card stays here start to finish: compare it with the
  cards doing the same job in this deck. If it should go, propose that one
  cut; if it should stay, you may propose marking it never cut. Don't mention
  Trim for one card.
- When the ask is open-ended and a page has a flow built for it, answer in a
  sentence or two first, propose your top few if that helps, and add the
  page's button with open_page:
  - trim: many cuts ("cut 12", "get it to 100", "what should I cut?" for more
    than a handful). Give the number.
  - finish: finishing or filling the deck from their cards ("finish this
    deck", "draft the rest"). Give how many. Never draft a whole deck here.
    If this conversation settled a theme, also propose it as a note, so the
    plan carries it into Finish.
  - tags: sorting the deck into groups, retagging it.
  - check: the mana, the curve, how the deck plays.
  - plan: what the deck is trying to do, its bracket or budget.
- Up to ${CHAT_CHANGE_LIMIT} changes of one kind in one answer. Past that, propose the best
  ${CHAT_CHANGE_LIMIT} and open the page for the rest.
- The owner outranks this: "just do it here" or "don't send me to Trim"
  means do it here (set in_chat on propose_changes) with no page button.`;

export const CHAT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_cards',
    description: 'Search Scryfall with its search syntax (e.g. "otag:board-wipe cmc<=4", "o:\'draw a card\' t:creature"). Results are limited to the commander\'s colours and Commander-legal cards. Returns up to 15 cards with cost, type, text and price.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'search_my_cards',
    description: `Search the owner's own cards that may go in this deck: in its colours, Commander-legal, not already in it, within the plan's budget, deck rule and bracket. Lands included. Covers spare copies, this deck's sections and cards in the owner's other decks; each line ends with where the copy is. Plain words must all match the name, type line or rules text; add t:<type>, mv<=N, mv>=N, mv=N or o:word to narrow, and -word or -t:<type> to leave cards out. Nothing else is understood (no colour filters): a filter it can't use is named in the answer. Answers with the total, how many are spare copies and how many sit in other decks, and up to 40 cards. At most ${CHAT_SEARCH_LIMIT} searches for one answer.`,
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'my_collection',
    description: 'Which of these cards the owner has, and where: a box in their collection, or in another of their decks. Says when a card can\'t go in this deck, and why.',
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
    description: 'Every change you recommend, each with a one-sentence reason; the owner gets a button for each and applies the ones they want. Use only the lists you need. "to" for a cut, add or move is a section of the deck (its name, or "main"); for group/ungroup it is the group\'s name. Call at most once per reply, after looking things up. "answer" is your full answer to the owner\'s question in words, exactly as it should read above the buttons: the judgement, the reasons, any counts. Never just a remark about the buttons.',
    input_schema: {
      type: 'object',
      required: ['answer'],
      properties: {
        answer: { type: 'string', description: 'The full answer in words, shown above the buttons.' },
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
        in_chat: { type: 'boolean', description: 'True only when the owner asked for this to be done here in Chat rather than on a page.' },
      },
    },
  },
  {
    name: 'open_page',
    description: `A button under your answer that opens one of this deck's pages, for a job the page does better than Chat: trim (many cuts; cut: how many, or cut_to: the size to cut to), finish (fill from the owner's cards; add: how many), tags (sort into groups), check (mana, curve, how it plays), plan (what the deck is for, bracket, budget). why: one sentence. At most once per reply.`,
    input_schema: {
      type: 'object',
      properties: {
        page: { type: 'string', enum: ['trim', 'finish', 'tags', 'check', 'plan'] }, why: { type: 'string' }, cut: { type: 'number' }, cut_to: { type: 'number' }, add: { type: 'number' },
        answer: { type: 'string', description: 'Your full answer in words, shown above the button (the same as propose_changes\' answer when you call both: give it once).' },
      },
      required: ['page', 'why', 'answer'],
    },
  },
];

/** A search over the owner's cards as Claude reads it: the total split by where the copies are, then the lines. */
export function mineText(r: MineResult): string {
  const split = [`${r.bySrc.spare} spare cop${r.bySrc.spare === 1 ? 'y' : 'ies'}`, `${r.bySrc.other} in other decks`, ...(r.bySrc.maybe ? [`${r.bySrc.maybe} in this deck's sections`] : [])].join(', ');
  return searchText(r).replace(/^[^\n]*/, (first) => `${first} (${split})`).replace('The search takes plain words, -word, t:<type>, -t:<type>, mv<=N, mv>=N and mv=N only.', 'The search takes plain words, -word, t:<type>, -t:<type>, o:word, mv<=N, mv>=N and mv=N only.');
}

/** A proposal Apply can act on: not refused by Tune's checks, and (an add or swap) a card the app found. */
export const usable = (c: Change) => !c.blocked && !((c.kind === 'add' || c.kind === 'swap') && !c.cardId);

/** The owner said to do it here, in their own words (the model's in_chat is the other way). */
export const saysHere = (text: string) => /\b(just do it here|do it here|do it in (the )?chat|here in (the )?chat|don'?t send me|no need to (go|send)|not in trim)\b/i.test(text);

/**
 * More than CHAT_CHANGE_LIMIT usable changes of one kind that has a page: the first ones that can apply stay,
 * and the rest are held back for that page's button (pageButtons). Each kind has its own count. Rows that can
 * never apply (refused, card not found) are kept to say why, and don't count. Cards the owner named in their
 * own message are never held back, and nothing is when they asked for it here.
 */
export function capChanges(changes: Change[], opts: { inChat: boolean; named?: Set<string> } = { inChat: false }): { changes: Change[]; held: Array<{ kind: Change['kind']; n: number }> } {
  if (opts.inChat) return { changes, held: [] };
  const named = opts.named ?? new Set<string>();
  const counts = new Map<Change['kind'], number>();
  const held = new Map<Change['kind'], number>();
  const kept = changes.filter((c) => {
    if (!PAGE_FOR[c.kind as keyof typeof PAGE_FOR] || !usable(c) || named.has(front(c.name).toLowerCase())) return true;
    const n = (counts.get(c.kind) ?? 0) + 1;
    counts.set(c.kind, n);
    if (n <= CHAT_CHANGE_LIMIT) return true;
    held.set(c.kind, (held.get(c.kind) ?? 0) + 1);
    return false;
  });
  return { changes: kept, held: [...held.entries()].map(([kind, n]) => ({ kind, n })) };
}

/**
 * The page buttons under an answer, worked out once from the final proposals: Claude's own open_page (its
 * number less the shown proposals of that kind that can apply, since those are applied here first), and one
 * button for each page whose kind was held back, carrying the number held back. A count that comes to nothing
 * drops the button.
 */
export function pageButtons(changes: Change[], held: Array<{ kind: Change['kind']; n: number }>, asked: ChatGo | null, size: number | null = null): ChatGo[] {
  const shown = (kind: Change['kind']) => changes.filter((c) => c.kind === kind && usable(c)).length;
  const out: ChatGo[] = [];
  if (asked) {
    if (asked.page === 'trim' && asked.cut) { const left = asked.cut - shown('cut'); if (left > 0) out.push({ ...asked, cut: left }); }
    // An add that brings the deck to 100 is a fill: it stays one however many adds are shown here (round 2, item 10).
    else if (asked.page === 'finish' && asked.add && size !== null && size + asked.add >= 100) out.push({ page: 'finish', why: asked.why, fill: true });
    else if (asked.page === 'finish' && asked.add) { const left = asked.add - shown('add'); if (left > 0) out.push({ ...asked, add: left }); }
    else out.push(asked);
  }
  for (const h of held) {
    const page = PAGE_FOR[h.kind as keyof typeof PAGE_FOR];
    if (!page || out.some((g) => g.page === page)) continue;
    out.push({ page, why: `More than ${CHAT_CHANGE_LIMIT} at once: ${PAGE_LABEL[page]} does the rest.`, ...(page === 'trim' ? { cut: h.n } : page === 'finish' ? { add: h.n } : {}) });
  }
  return out;
}

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
      const why = deck.finishWhy?.get(x.card.name);
      return `${x.quantity} ${x.card.name} - ${x.card.type_line ?? ''}${tags.length ? ` [${tags.join(', ')}]` : ''}${why ? ` (Finish: ${why})` : ''}`;
    }),
    ...(deck.sections?.length ? ['', `Sections besides the main deck: ${deck.sections.map((x) => `${x.name} (${x.purpose === 'out' ? 'cards that came out' : x.purpose === 'in' ? 'cards to bring in' : x.purpose})`).join('; ')}`] : []),
    ...(deck.cards.some((x) => x.board !== 'main') ? ['', 'In the sections:', ...deck.cards.filter((x) => x.board !== 'main').map((x) => `${x.quantity} ${x.card.name}${deck.sections ? ` (${deck.sections.find((s) => s.id === x.board)?.name ?? x.board})` : ''}`)] : []),
  ].filter((l) => l !== undefined).join('\n');
}

const cardLine = (c: ScryfallCard) => `${c.name} ${c.mana_cost ?? ''} - ${c.type_line ?? ''}: ${(c.oracle_text ?? (c.card_faces ?? []).map((f) => f.oracle_text).join(' // ')).replace(/\n/g, ' ').slice(0, 220)}${c.prices?.usd ? ` ($${c.prices.usd})` : ''}`;

/** Runs one tool, answering with text for Claude and a line for the owner. */
async function runTool(name: string, input: Record<string, unknown>, deck: ChatDeck, tools: ChatTools): Promise<{ result: string; lookup: string; cards?: ChatCard[] }> {
  switch (name) {
    case 'search_cards': {
      const query = String(input.query ?? '');
      const cards = (await tools.search(query)).slice(0, 15);
      return { result: cards.length ? cards.map(cardLine).join('\n') : 'No cards found.', lookup: `Searched all cards: ${query}`, cards: cards.map((c) => ({ name: c.name, id: c.id, image: imageOf(c, 'normal') })) };
    }
    case 'my_collection': {
      const names = (input.names as string[] | undefined ?? []).slice(0, 40);
      const held = tools.held(names);
      const fits = tools.fits?.(names) ?? {};
      return { result: names.map((n) => `${n}: ${held[n] ?? 'not owned'}${fits[n] ? `; can't go in this deck: ${fits[n]}` : ''}`).join('\n'), lookup: 'Looked at your collection' };
    }
    case 'cards_for_role': {
      const role = String(input.role ?? '');
      const cards = await tools.gaps(role, input.owned_first !== false, typeof input.max_price === 'number' ? input.max_price : null);
      return {
        result: cards.length ? cards.map((c) => `${c.name} - ${c.typeLine}; ${c.held ? `owned (${c.held})` : `not owned${c.price ? `, $${c.price}` : ''}`}; ${c.why}`).join('\n') : 'Nothing fits.',
        lookup: `Cards for ${ROLES.find((r) => r.id === role)?.label.toLowerCase() ?? role}`,
        cards: cards.map((c) => ({ name: c.name, id: c.id, image: c.image })),
      };
    }
    default:
      return { result: `No tool called ${name}.`, lookup: '' };
  }
}

/** The proposals, matched to real cards: printings to add, the deck's copies for the rest. */
export function resolveChanges(input: Record<string, unknown>, deck: ChatDeck, held: ChatTools['held'], check?: ChatTools['check']): Change[] {
  const str = (x: unknown, n = 300) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const rows = (key: string) => (Array.isArray(input[key]) ? input[key] as Array<Record<string, unknown>> : []).filter((x) => !!x && typeof x === 'object').slice(0, 30);
  const inDeck = new Map([...deck.cards.map((c) => [front(c.card.name).toLowerCase(), c.card] as const), ...(deck.list.commander ? [[front(deck.list.commander.name).toLowerCase(), deck.list.commander] as const] : [])]);
  const incoming = [...rows('add').map((x) => str(x.name, 150)), ...rows('swap').map((x) => str(x.in, 150))].filter(Boolean);
  const known = new Map(localCards(incoming).map((c) => [front(c.name).toLowerCase(), c]));
  // A card the bulk card data doesn't have yet may still be one the app has stored for a deck.
  for (const n of incoming) {
    if (known.has(front(n).toLowerCase())) continue;
    const r = database().get(`SELECT data FROM cards WHERE json_extract(data, '$.name') = ? LIMIT 1`, [n]) as { data: string } | null;
    if (r) known.set(front(n).toLowerCase(), JSON.parse(r.data) as ScryfallCard);
  }
  const where = held(incoming);
  const mine = (name: string) => inDeck.get(front(name).toLowerCase());
  const base = (kind: Change['kind'], name: string, why: string, extra: Partial<Change> = {}): Change => ({ kind, name: mine(name)?.name ?? name, why, cardId: mine(name)?.id ?? null, held: null, price: null, ...extra });
  const add = (name: string) => { const card = known.get(front(name).toLowerCase()); return { name: card?.name ?? name, cardId: card?.id ?? null, held: where[name] ?? null, price: card?.prices?.usd ?? null, ...(card ? { image: imageOf(card, 'normal') } : {}) }; };
  // Into the main deck only: an add to a section just has to exist.
  const toMain = (to: string) => !to || /^(main|deck|main deck)$/i.test(to);
  const blocked = (name: string, leaving?: string) => {
    const card = known.get(front(name).toLowerCase());
    const why = card && check ? check(card, leaving ? mine(leaving) ?? null : null) : null;
    return why ? { blocked: why } : {};
  };
  return [
    ...rows('add').map((x) => ({ kind: 'add' as const, ...add(str(x.name, 150)), why: str(x.why), ...(str(x.to, 60) ? { to: str(x.to, 60) } : {}), ...(toMain(str(x.to, 60)) ? blocked(str(x.name, 150)) : {}) })).filter((c) => c.name),
    ...rows('cut').map((x) => base('cut', str(x.name, 150), str(x.why), str(x.to, 60) ? { to: str(x.to, 60) } : {})).filter((c) => c.name),
    ...rows('swap').map((x) => ({ kind: 'swap' as const, ...add(str(x.in, 150)), why: str(x.why), out: { name: mine(str(x.out, 150))?.name ?? str(x.out, 150), cardId: mine(str(x.out, 150))?.id ?? null }, ...blocked(str(x.in, 150), str(x.out, 150)) })).filter((c) => c.name && c.out.name),
    ...rows('move').map((x) => base('move', str(x.name, 150), str(x.why), { to: str(x.to, 60) })).filter((c) => c.name && c.to),
    ...rows('group').map((x) => base('group', str(x.name, 150), str(x.why), { to: str(x.to, 60) })).filter((c) => c.name && c.to),
    ...rows('ungroup').map((x) => base('ungroup', str(x.name, 150), str(x.why), { to: str(x.to, 60) })).filter((c) => c.name && c.to),
    ...rows('never_cut').map((x) => base('never', str(x.name, 150), str(x.why))).filter((c) => c.name),
    ...rows('note').map((x) => ({ kind: 'note' as const, name: str(x.text, 600), why: '', cardId: null, held: null, price: null })).filter((c) => c.name),
    ...rows('way_to_win').map((x) => ({ kind: 'win' as const, name: str(x.name, 80), why: str(x.how), cardId: null, held: null, price: null, cards: (Array.isArray(x.cards) ? x.cards : []).map((n) => mine(String(n))?.name).filter((n): n is string => !!n).slice(0, 20) })).filter((c) => c.name),
    ...rows('key_card').map((x) => base('key', str(x.name, 150), str(x.why))).filter((c) => c.name),
  ];
}

/** Asked once when an answer's words only describe its buttons. */
export const WORDS_FIRST = 'Before the buttons: answer my question itself in words - your judgement, your reasons, and any count I asked for, taken from the deck. Don\'t describe the buttons again.';

/**
 * An answer whose words only talk about its buttons (review item 31, round 2 item 7): it opens with or is mostly
 * "I've put up / that's N buttons / see below", or it is under about 15 words while more than two proposals wait.
 * Lines and list items count as sentences, so a short theme answer in lines, or "Cut it." with one proposal, is
 * an answer and never asked again.
 */
export function onlyButtons(text: string, proposals: number, proposed: string[] = []): boolean {
  const t = text.trim();
  const units = t.split(/\n+|(?<=[.!?])\s+/).map((x) => x.replace(/^\s*([-*•]|\d+[.)])\s+/, '').trim()).filter((x) => x.length > 2);
  const about = /\b(buttons?|proposals?|see (them )?below|below|I'?ve (put|proposed|added|queued)|that'?s (one|two|three|four|five|six|seven|eight|\d+))\b/i;
  const opens = /^(I'?ve (put|proposed|added|queued)|I have (put|proposed|added)|That'?s (one|two|three|four|five|six|seven|eight|\d+) (button|proposal|change)|See (the )?(buttons|below)|Here are (the|your|some) (buttons|proposals|changes))/i;
  const words = t.split(/\s+/).filter(Boolean).length;
  if (!units.length) return proposals > 0;
  // A first sentence about the buttons ("The note button saves…", "The buttons cover the four swaps above") in a text
  // that names fewer than two of the cards it proposes: what the real runs kept (PR 55 real runs, item 1).
  const first = /\b(buttons?|above|below)\b/i.test(units[0]);
  const named = proposed.filter((n) => n && t.toLowerCase().includes(front(n).toLowerCase())).length;
  if (proposals > 0 && first && named < 2) return true;
  const aboutShare = units.filter((u) => about.test(u)).length / units.length;
  return (opens.test(units[0]) && units.length - units.filter((u) => about.test(u)).length <= 1) || aboutShare >= 0.6 || (words < 15 && proposals > 2);
}

/** The card a change takes out or acts on, for spotting a later proposal that replaces an earlier one. */
const outOf = (c: Change) => (c.kind === 'swap' ? c.out?.name : c.kind === 'cut' || c.kind === 'move' || c.kind === 'add' ? c.name : null);

/**
 * A new answer's proposals replace earlier unapplied ones on the same card: those are marked and can't also be
 * applied. Only a newer row that can apply replaces one (round 2, item 9), and each marked row says which row
 * replaced it, so undoing that one gives it back. `at` is the new answer's place in the chat.
 */
export function markReplaced(chat: DeckChat, now: Change[], at: number): void {
  const by = new Map<string, number>();
  now.forEach((c, j) => { const k = outOf(c); if (k && usable(c)) by.set(front(k).toLowerCase(), j); });
  if (!by.size) return;
  for (const m of chat.messages) for (const c of m.changes ?? []) {
    if (now.includes(c) || c.applied || c.done) continue;
    const k = outOf(c);
    const j = k ? by.get(front(k).toLowerCase()) : undefined;
    if (j !== undefined) { c.replaced = true; c.replacedBy = [at, j]; }
  }
}

/** Undoing a proposal gives back the earlier ones it replaced. */
export function unreplace(chat: DeckChat, message: number, change: number): void {
  for (const m of chat.messages) for (const c of m.changes ?? []) {
    if (c.replacedBy?.[0] === message && c.replacedBy?.[1] === change) { c.replaced = false; delete c.replacedBy; }
  }
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
      ? `${m.text}\n\n(Proposed: ${m.changes.map((c) => `${c.kind} ${c.kind === 'swap' ? `${c.out?.name} for ` : ''}${c.name}${c.to ? ` (${c.to})` : ''}${c.applied ? ' - applied by the owner' : c.done ? ' - sent to Tune' : c.replaced ? ' - replaced by a later answer' : ''}`).join('; ')})`
      : m.text,
  }));
  const lookups: string[] = [];
  let changes: Change[] = [];
  // Cards the look-ups returned, for linking names in the answer.
  const seenCards = new Map<string, ChatCard>();
  // Cards from tool results are capped; a name the answer itself marks is always kept (round 2, item 8).
  const note = (cs: ChatCard[] | undefined, always = false) => { for (const c of cs ?? []) if (c.id && (always || seenCards.size < 300) && !seenCards.has(c.name)) seenCards.set(c.name, c); };
  const cardsNow = () => {
    note(changes.filter((c) => c.cardId && (c.kind === 'add' || c.kind === 'swap')).map((c) => ({ name: c.name, id: c.cardId!, image: c.image ?? null })));
    return seenCards.size ? { cards: [...seenCards.values()] } : {};
  };
  // Claude's own page button, and what the cap held back; the buttons are worked out from the final proposals.
  let asked: ChatGo | null = null;
  let held: Array<{ kind: Change['kind']; n: number }> = [];
  let searches = 0;
  // The owner's newest message: cards they named themselves are never held back, and their words can say "do it here".
  const ownerText = [...chat.messages].reverse().find((m) => m.role === 'user')?.text ?? '';
  const ownerSays = ownerText.toLowerCase();
  const deckSize = deck.cards.filter((c) => c.board === 'main').reduce((n, c) => n + c.quantity, 0) + (deck.list.commander ? 1 : 0);
  const pagesNow = () => { const p = pageButtons(changes, held, asked, deckSize); return p.length ? { pages: p } : {}; };
  // The answer, stored: [[names]] resolved to cards (kept with the message, so an old chat still links them), and
  // earlier proposals this answer replaces marked so they can't also be applied.
  const finish = (text: string, model?: string): ChatMessage => {
    const marked = [...new Set([...text.matchAll(/\[\[+([^[\]]{2,120})\]\]+/g)].map((m) => m[1].trim()))];
    let unresolved = 0;
    if (marked.length) {
      // The deck's own cards keep their ids too, so the link lives on after a card leaves the deck (round 2, item 13).
      const deckCards = new Map([...deck.cards.map((c) => c.card), ...(deck.list.commander ? [deck.list.commander] : [])].map((c) => [front(c.name).toLowerCase(), c]));
      const seen = new Set([...seenCards.keys()].map((n) => front(n).toLowerCase()));
      const fromDeck = marked.map((n) => deckCards.get(front(n).toLowerCase())).filter((c): c is ScryfallCard => !!c);
      note(fromDeck.map((c) => ({ name: c.name, id: c.id, image: imageOf(c, 'normal') })), true);
      const want = marked.filter((n) => !deckCards.has(front(n).toLowerCase()) && !seen.has(front(n).toLowerCase()));
      const found = want.length && tools.resolve ? tools.resolve(want) : [];
      note(found, true);
      const got = new Set(found.map((c) => front(c.name).toLowerCase()));
      unresolved = want.filter((n) => !got.has(front(n).toLowerCase())).length;
    }
    markReplaced(chat, changes, chat.messages.length);
    return { role: 'assistant', text, at: new Date().toISOString(), lookups, changes, ...pagesNow(), ...cardsNow(), ...(unresolved ? { unresolved } : {}), ...(model ? { model } : {}) };
  };
  // Searching one at a time can use more rounds than an answer usually takes: an answer that searches gets more.
  const roundsFor = () => (searches > 0 ? MAX_ROUNDS + 8 : MAX_ROUNDS);
  // What Claude writes in every round: its explanation often comes in the same turn as a look-up or its proposals.
  const said: string[] = [];
  // The answer in words that came with the proposals or the page button: shown first, whatever else was said.
  let answerText = '';
  const takeAnswer = (input: Record<string, unknown>) => { const a = typeof input.answer === 'string' ? input.answer.trim() : ''; if (a.length > answerText.length) answerText = a.slice(0, 6000); };
  const withAnswer = () => {
    if (!answerText) return said;
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();
    return [answerText, ...said.filter((x) => !norm(answerText).includes(norm(x)) && !norm(x).includes(norm(answerText)))];
  };
  const messages = [...history];
  for (let round = 0; round < roundsFor(); round++) {
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
    if (text) said.push(text);
    if (answer.stop_reason !== 'tool_use' || !uses.length) {
      // Buttons with no answer in words (review item 31): ask once for the answer itself, and put it first.
      if (changes.length && answer.stop_reason !== 'refusal' && onlyButtons(withAnswer().join('\n\n'), changes.length, changes.filter((c) => c.kind !== 'note' && c.kind !== 'win').map((c) => c.name))) {
        const more = await call({
          model, max_tokens: 4_000,
          system: [{ type: 'text', text: CHAT_SYSTEM }, { type: 'text', text: deckText(deck), cache_control: { type: 'ephemeral' } }],
          tools: CHAT_TOOLS, tool_choice: { type: 'none' },
          messages: [...messages, { role: 'assistant', content: answer.content as Anthropic.Beta.BetaContentBlockParam[] }, { role: 'user', content: WORDS_FIRST }],
        } as ClaudeParams, 'answer in words').catch(() => null);
        const words = more?.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (words) said.unshift(words);
      }
      return finish(withAnswer().join('\n\n') || (answer.stop_reason === 'refusal' ? 'Claude declined to answer that.' : '…'), answer.model);
    }
    messages.push({ role: 'assistant', content: answer.content as Anthropic.Beta.BetaContentBlockParam[] });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const input = (use.input ?? {}) as Record<string, unknown>;
      if (use.name === 'propose_changes') {
        takeAnswer(input);
        const all = resolveChanges(input, deck, tools.held, tools.check);
        // Whole names on word boundaries: "Opt" isn't named in "option" (round 2, item 11).
        const named = new Set(all.map((c) => front(c.name).toLowerCase()).filter((n) => n.length >= 3 && new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(ownerSays)));
        const capped = capChanges(all, { inChat: input.in_chat === true || saysHere(ownerText), named });
        // A later propose_changes replaces the earlier one whole: its proposals and what it held back.
        changes = capped.changes;
        held = capped.held;
        const refused = changes.filter((x) => x.blocked);
        const pages = capped.held.map((h) => PAGE_LABEL[PAGE_FOR[h.kind as keyof typeof PAGE_FOR]!]).filter((p, k, a) => a.indexOf(p) === k);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: `Shown to the owner as ${changes.length} button${changes.length === 1 ? '' : 's'}.${refused.length ? ` These can't be applied, and say why on their row: ${refused.map((x) => x.blocked).join('; ')}. Offer something else for them if it matters.` : ''}${capped.held.length ? ` Only the first ${CHAT_CHANGE_LIMIT} of each kind that can apply are shown (${capped.held.map((h) => `${h.n} more ${h.kind}${h.n === 1 ? '' : 's'} held back`).join(', ')}); a button opens ${pages.join(' and ')} for ${capped.held.length === 1 ? 'them' : 'each'}. Say so in one line.` : ''}` });
        continue;
      }
      if (use.name === 'open_page') {
        takeAnswer(input);
        const page = pageGo(input);
        if (page) asked = page;
        results.push({ type: 'tool_result', tool_use_id: use.id, content: page ? `Shown to the owner as a button that opens ${PAGE_LABEL[page.page]}.` : 'No such page: trim, finish, tags, check or plan.', ...(page ? {} : { is_error: true }) });
        continue;
      }
      if (use.name === 'search_my_cards') {
        const q = String(input.query ?? '').trim().slice(0, 200);
        if (searches >= CHAT_SEARCH_LIMIT) { results.push({ type: 'tool_result', tool_use_id: use.id, content: 'No searches left for this answer. Answer with what you have.' }); continue; }
        searches += 1;
        const r = tools.mine ? tools.mine(q) : { error: 'The search over the owner\'s cards isn\'t available right now. Say so, and answer without it.' };
        if (!('error' in r)) { const l = `Searched your cards: ${q}`; if (!lookups.includes(l)) lookups.push(l); note(r.lines.filter((x) => x.id).map((x) => ({ name: x.name, id: x.id!, image: x.image ?? null }))); }
        const left = roundsFor() - round - 1;
        results.push({ type: 'tool_result', tool_use_id: use.id, content: 'error' in r ? r.error : mineText(r) + (searches >= CHAT_SEARCH_LIMIT ? '\n\nThat was your last search for this answer.' : left <= 3 ? `\n\n${left} round${left === 1 ? '' : 's'} left in this answer: run the searches you still need together, then answer.` : '') });
        continue;
      }
      try {
        const { result, lookup, cards } = await runTool(use.name, input, deck, tools);
        if (lookup && !lookups.includes(lookup)) lookups.push(lookup);
        note(cards);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: result });
      } catch (error) {
        results.push({ type: 'tool_result', tool_use_id: use.id, content: `That failed: ${error instanceof Error ? error.message : 'unknown error'}`, is_error: true });
      }
    }
    // Every round re-sends the look-ups so far. Mark the newest result (and only it) as the cache point, so the
    // next round reads everything before it from the cache instead of paying for it again (as Finish does).
    for (const m of messages) if (m.role === 'user' && Array.isArray(m.content)) for (const b of m.content) delete (b as { cache_control?: unknown }).cache_control;
    if (results.length) results[results.length - 1] = { ...results[results.length - 1], cache_control: { type: 'ephemeral' } };
    messages.push({ role: 'user', content: results });
  }
  return finish([...withAnswer(), 'I looked up a lot and ran out of steps before finishing - ask again, more narrowly.'].join('\n\n'));
}
