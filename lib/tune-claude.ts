/**
 * Claude's ideas for one Tune intent: cards to add, cards to cut, swaps, or
 * cards to keep, each with a sentence why - read against the deck's plan,
 * the numbers the app computed, what you already staged and what the rules
 * suggested. Claude may go against a usual rule when it makes sense for this
 * deck; it then says which rule, and why. The ideas wait in Tune like any
 * suggestion: nothing changes until you accept one. Server only.
 */

import type { JsonModel } from './ai';
import { localCards } from './card-store';
import { deckIdentity } from './commanders';
import { cardsInList, type List } from './db';
import { planContext } from './plan-context';
import { manaCostOf, oracleTextOf, typeLineOf, type ScryfallCard } from './scryfall';
import { ref } from './tune';
import type { Intent, Suggestion, SuggestionGroup } from './tune-shared';
import { tuneStore, updateTune } from './tune-store';

const ASK: Record<Intent, string> = {
  finish: 'The owner is finishing this deck. Suggest the most important cards to add to get it to 100, following the plan.',
  find: 'The owner is looking for cards to add. Suggest cards that fill what the deck is short of and fit the plan.',
  swaps: 'The owner wants to improve the deck at its size. Suggest swaps: a card to add for a card to cut, each pair doing the deck more good.',
  cuts: 'The owner is cutting the deck down to 100. Suggest the cards to cut, and any card the rules would cut that should stay (keep).',
  fix: 'The owner says the deck has a problem in games. Suggest at most three swaps that address it.',
  lands: 'The owner is working on the mana. Suggest land swaps or changes to the land count that help the colours and the curve.',
};

export const SYSTEM = `You help a Magic: The Gathering player tune their Commander deck.
You get the deck's plan (each part with who set it), the numbers the app counted, every card in the main deck, what the owner already staged, and what the app's rules already suggest.
Answer with ideas, each an add, a cut, both (a swap), or a keep. Use exact card names. Adds must be real cards legal in Commander and in the deck's colours; cuts and keeps must be cards in the main deck.
Judge by the plan first and by what the owner is optimizing for. The default ways to judge a deck are given; you may go against one when it makes sense for this deck - then name the rule in "breaks" and say why in a sentence. Otherwise leave "breaks" empty.
Keep each "why" to one sentence a player would say at the table. Don't repeat what the rules already suggest unless you disagree with them. Don't suggest anything the owner already staged. At most eight ideas.`;

export const SCHEMA = {
  type: 'OBJECT',
  properties: {
    ideas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { add: { type: 'STRING' }, cut: { type: 'STRING' }, keep: { type: 'BOOLEAN' }, why: { type: 'STRING' }, breaks: { type: 'STRING' } },
        required: ['why'],
      },
    },
  },
  required: ['ideas'],
};

export interface IdeasInput {
  intent: Intent;
  plan: string;
  commander: ScryfallCard | null;
  main: ScryfallCard[];
  staged: string[];
  suggested: string[];
  instructions: string;
  problem?: string;
}

export function ideasMessage(input: IdeasInput): string {
  const card = (c: ScryfallCard) => `${c.name} ${manaCostOf(c)} - ${typeLineOf(c)}: ${oracleTextOf(c).replace(/\n+/g, ' | ').slice(0, 300) || '(no rules text)'}`;
  return [
    input.commander ? `Commander: ${card(input.commander)}` : 'No commander set.',
    '',
    input.plan,
    '',
    `The main deck, ${input.main.length} cards:`,
    ...input.main.map((c) => `- ${card(c)}`),
    '',
    input.staged.length ? `Already staged by the owner: ${input.staged.join('; ')}` : 'Nothing staged yet.',
    input.suggested.length ? `What the rules already suggest: ${input.suggested.slice(0, 40).join('; ')}` : '',
    '',
    `${ASK[input.intent]}${input.problem ? ` The problem: ${input.problem}.` : ''}`,
    ...(input.instructions.trim() ? ['', `The owner's instructions - follow them where they apply:\n"""\n${input.instructions.trim()}\n"""`] : []),
  ].filter((l) => l !== '').join('\n');
}

/** Claude's answer, kept to cards that exist: cuts and keeps in the deck, adds legal and in its colours. */
export function parseIdeas(data: unknown, main: ScryfallCard[], identity: Set<string>, find: (names: string[]) => ScryfallCard[] = localCards): Suggestion[] {
  const ideas = ((data as { ideas?: unknown[] })?.ideas ?? []).slice(0, 8);
  const inMain = new Map(main.map((c) => [c.name.toLowerCase(), c]));
  const frontOf = (n: string) => n.split(' // ')[0].toLowerCase();
  for (const c of main) inMain.set(frontOf(c.name), c);
  const wanted = ideas.map((i) => String((i as { add?: unknown }).add ?? '').trim()).filter(Boolean);
  const pool = find(wanted);
  const byName = new Map(pool.flatMap((c) => [[c.name.toLowerCase(), c], [frontOf(c.name), c]] as Array<[string, ScryfallCard]>));
  const out: Suggestion[] = [];
  ideas.forEach((raw, n) => {
    const i = raw as { add?: string; cut?: string; keep?: boolean; why?: string; breaks?: string };
    const why = String(i.why ?? '').slice(0, 300);
    if (!why) return;
    const cutCard = i.cut ? inMain.get(String(i.cut).trim().toLowerCase()) : undefined;
    const addCard = i.add ? byName.get(String(i.add).trim().toLowerCase()) : undefined;
    if (i.cut && !cutCard) return;
    if (i.add && (!addCard || addCard.legalities?.commander !== 'legal' || !(addCard.color_identity ?? []).every((x) => identity.has(x)) || inMain.has(addCard.name.toLowerCase()))) return;
    if (!addCard && !cutCard) return;
    const breaks = String(i.breaks ?? '').trim().slice(0, 200) || undefined;
    out.push({
      key: `claude:${n}:${addCard?.name ?? ''}:${cutCard?.name ?? ''}`,
      ...(addCard ? { add: { ...ref(addCard), quantity: 1 } } : {}),
      ...(cutCard ? { cut: { ...ref(cutCard, { from: 'main' }), quantity: 1 } } : {}),
      ...(i.keep && cutCard && !addCard ? { keep: true } : {}),
      why, breaks,
    });
  });
  return out;
}

/** Ask Claude for one intent's ideas and keep them with the deck, replacing its last ones for that intent. */
export async function tuneIdeas(model: JsonModel, list: List, input: { intent: Intent; instructions: string; suggested: string[]; problem?: string }): Promise<SuggestionGroup> {
  const all = cardsInList(list.id);
  const main = all.filter((c) => c.board === 'main');
  const partner = main.find((c) => c.slot === 'partner')?.card;
  const identity = deckIdentity([list.commander, partner]);
  const store = tuneStore(list.id);
  const staged = [...store.changes.add.map((s) => `add ${s.card.name}`), ...store.changes.cut.map((s) => `cut ${s.card.name}`)];
  const answer = await model({
    step: 'tune ideas',
    system: SYSTEM,
    user: ideasMessage({ intent: input.intent, plan: await planContext(list).catch(() => ''), commander: list.commander, main: main.map((c) => c.card), staged, suggested: input.suggested, instructions: input.instructions, problem: input.problem }),
    schema: SCHEMA,
    thinking: 'medium',
  }, { maxBusy: 1 });
  const items = parseIdeas(answer.data, main.map((c) => c.card), identity);
  const group: SuggestionGroup = {
    key: `claude:${input.intent}:${Date.now().toString(36)}`,
    title: `Claude’s ideas · ${items.length}`,
    why: `${answer.model ? `From ${answer.model}` : 'From Claude'}${input.instructions.trim() ? `, with your instructions: “${input.instructions.trim().slice(0, 120)}”` : ''}. Read against your plan; nothing changes until you accept one.`,
    source: 'claude',
    items,
  };
  updateTune(list.id, (s) => { s.proposals[input.intent] = [group]; });
  return group;
}
