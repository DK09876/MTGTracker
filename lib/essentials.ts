/**
 * Naming cards and checking every name (handoff 10, Part C, item 33): the
 * step Finish runs when the owner would buy cards for a deck. Claude is sent
 * the commander, the plan with the owner's notes, the cards already in the
 * deck and how many to name; it names cards from memory (no search), each
 * with a group and a reason. The app then checks every name the way Upgrades
 * checks its cards to buy (checkNamed): the card exists, Tune's checks,
 * where the owner's copy is (never the model's word), and the price, where
 * none is "no price", never free. Server only.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { ModelError } from './ai';
import type { ClaudeParams } from './ai-claude';
import { cardPrices } from './card-price';
import type { List } from './db';
import { cardsNamed } from './cards-named';
import { isLand, type Held } from './finish-pool';
import { FINISH_GROUPS, type FinishGroup } from './finish-shared';
import { planContext } from './plan-context';
import { manaCostOf, oracleTextOf, typeLineOf, type ScryfallCard } from './scryfall';
import { whyNotAddable, type Context } from './tune';
import { ownOf } from './upgrades';
import type { UpgradeOwn } from './upgrades-shared';

const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
const keyOf = (c: ScryfallCard) => c.oracle_id ?? c.id;
const quote = (t: string) => `"${t.replace(/\s+/g, ' ').trim()}"`;

/** "The ones that matter": the most essentials Claude names before the search fills the rest (proposed: 15). */
export const ESSENTIALS_MAX = 15;

export interface Named { card: ScryfallCard; group: FinishGroup; theme?: string; why: string; own: UpgradeOwn }

/**
 * Names checked by the app: resolved (stored cards, then the card data), Tune's checks, not a land, not taken or
 * left out, then where the owner's copy is and the price for one they don't have. With a budget per card, a card
 * with no price can't be shown as within it and is dropped, with why.
 */
export function checkNamed(ctx: Context, held: Map<string, Held>, raw: Array<{ name?: unknown; group?: unknown; theme?: unknown; why?: unknown }>, opts: { need: number; taken: Set<string>; leaveOut: Set<string>; resolve?: (names: string[]) => Map<string, ScryfallCard> }): { picks: Named[]; dropped: Array<{ name: string; why: string }> } {
  const names = raw.map((r) => String(r?.name ?? '').trim()).filter(Boolean);
  const found = (opts.resolve ?? cardsNamed)(names);
  const owned = new Map([...held.values()].map((h) => [keyOf(h.card), h]));
  const picks: Named[] = [];
  const dropped: Array<{ name: string; why: string }> = [];
  const used = new Set(opts.taken);
  for (const r of raw) {
    const name = String(r?.name ?? '').trim();
    if (!name) continue;
    const card = found.get(front(name));
    if (!card) { dropped.push({ name, why: 'not a card the app could find' }); continue; }
    const k = front(card.name);
    if (used.has(k)) continue;
    if (opts.leaveOut.has(k)) { dropped.push({ name: card.name, why: 'skipped on this deck before' }); continue; }
    if (isLand(card)) { dropped.push({ name: card.name, why: 'a land: the app chooses those' }); continue; }
    const why = whyNotAddable(ctx, card);
    if (why) { dropped.push({ name: card.name, why: why.replace(`${card.name} `, '') }); continue; }
    if (picks.length >= opts.need) continue;
    used.add(k);
    const group = (FINISH_GROUPS as readonly string[]).includes(String(r.group)) ? r.group as FinishGroup : 'theme';
    const theme = group === 'theme' && typeof r.theme === 'string' && r.theme.trim() ? r.theme.trim().slice(0, 40) : undefined;
    picks.push({ card, group, ...(theme ? { theme } : {}), why: String(r.why ?? '').trim().slice(0, 300) || 'Claude’s pick', own: ownOf(owned.get(keyOf(card))) ?? { kind: 'buy', price: null } });
  }
  const prices = cardPrices(picks.filter((p) => p.own.kind === 'buy').map((p) => p.card), owned);
  const out: Named[] = [];
  for (const p of picks) {
    if (p.own.kind !== 'buy') { out.push(p); continue; }
    const price = prices.get(keyOf(p.card)) ?? null;
    if (price === null && ctx.plan.budget !== null) { dropped.push({ name: p.card.name, why: `has no price, so it can’t be checked against your $${ctx.plan.budget} budget` }); continue; }
    out.push({ ...p, own: { kind: 'buy', price } });
  }
  return { picks: out, dropped };
}

/**
 * Cards to buy taken in Claude's order until the total is reached (item 32): the rest are listed as over the
 * limit with their prices, not dropped silently. A card with no price doesn't count toward the total.
 */
export function withinTotal<T extends { own: UpgradeOwn }>(picks: T[], limit: number | null): { taken: T[]; over: T[] } {
  if (limit === null) return { taken: picks, over: [] };
  let spent = 0;
  const taken: T[] = [];
  const over: T[] = [];
  for (const p of picks) {
    if (p.own.kind !== 'buy' || p.own.price === null) { taken.push(p); continue; }
    if (spent + p.own.price <= limit + 1e-9) { spent += p.own.price; taken.push(p); } else over.push(p);
  }
  return { taken, over };
}

export const ESSENTIALS_SYSTEM = `You help a Magic: The Gathering player build a Commander deck. Name cards by their exact names, from memory: there is no search.
You get the deck's plan (each part with who set it, the owner's notes word for word), the cards already in the deck, cards the owner skipped on this deck before with their reasons, and how many cards to name.
- "matter": the cards that matter most for this commander and plan: the engine pieces, the best payoffs, the staples a good builder would never leave out. Most important first.
- "all": the whole list of non-land cards for the deck, as a good builder would make it for this plan, most important first.
- Name only real cards you are sure of, legal in Commander and in the commander's colours. The app checks every name, says which the owner has and prices the rest; a card that fails is dropped.
- No lands: the app chooses those.
- Each card: one group (ramp, draw, interaction, theme, wins, protection; name the theme for theme cards) and one short sentence why, as a player would say it at the table, about this card in this deck.
- Judge by the plan first and by what the owner wants. Keep within the plan's budget per card when it has one.`;

export const ESSENTIALS_TOOLS: Anthropic.Beta.BetaTool[] = [{
  name: 'give_cards',
  description: 'The cards, most important first. Ends the turn.',
  input_schema: {
    type: 'object',
    properties: {
      cards: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, group: { type: 'string', enum: [...FINISH_GROUPS] }, theme: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'group', 'why'] } },
      reply: { type: 'string', description: 'One or two sentences on the build.' },
    },
    required: ['cards', 'reply'],
  },
}];

export type Call = (params: ClaudeParams, step: string) => Promise<Anthropic.Beta.BetaMessage>;

/** One naming call: "matter" (the essentials) or "all" (the whole list); `extra` is the conversation for a later round. */
export async function nameCards(call: Call, model: string, ctx: Context, list: List, input: { kind: 'matter' | 'all'; count: number; skipped: Array<{ name: string; why: string }>; chosen: string[]; extra?: string[] }): Promise<{ raw: Array<Record<string, unknown>>; reply: string }> {
  if (!list.commander) throw new ModelError('Set the commander first.');
  const deck = [
    `Commander: ${list.commander.name} ${manaCostOf(list.commander)} - ${typeLineOf(list.commander)}: ${oracleTextOf(list.commander).replace(/\n+/g, ' | ')}`,
    '',
    await planContext(list).catch(() => ''),
    '',
    ctx.main.length ? `Already in the deck (${ctx.main.reduce((n, c) => n + c.quantity, 0)}): ${ctx.main.map((c) => c.card.name).join('; ')}` : 'Nothing else is in the deck yet.',
    ...(input.skipped.length ? ['', '## Skipped on this deck before, with the owner\'s reasons (never name these; apply the reasons to similar cards)', ...input.skipped.map((x) => `- ${x.name}${x.why ? `: ${quote(x.why)}` : ''}`)] : []),
  ].join('\n');
  const task = [
    ...(input.extra ?? []),
    ...(input.chosen.length ? ['', `## Already chosen (count them as in the deck; don't name them again)\n${input.chosen.join('; ')}`] : []),
    '',
    '## The task',
    input.kind === 'matter' ? `Name up to ${input.count} cards that matter most for this deck ("matter").` : `Name ${input.count} non-land cards for the deck ("all").`,
  ].join('\n').trim();
  const message = await call({
    model, max_tokens: 16_000,
    system: [{ type: 'text', text: ESSENTIALS_SYSTEM }, { type: 'text', text: deck, cache_control: { type: 'ephemeral' } }],
    thinking: { type: 'adaptive' }, tools: ESSENTIALS_TOOLS,
    messages: [{ role: 'user', content: task }],
  } as ClaudeParams, `essentials: ${input.kind === 'matter' ? 'the ones that matter' : 'any card'}`);
  const use = message.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'give_cards');
  const data = (use?.input ?? {}) as { cards?: unknown; reply?: unknown };
  if (!use || !Array.isArray(data.cards)) throw new ModelError('Claude didn’t name its cards. Nothing was changed; try again.');
  return { raw: data.cards as Array<Record<string, unknown>>, reply: typeof data.reply === 'string' ? data.reply.trim().slice(0, 1200) : '' };
}
