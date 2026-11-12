/**
 * The block every AI step on the deck pages reads (Tune, Trim, the tags
 * read): the confirmed plan with who set each part, never-cut, ways to win
 * and key cards with who added each, the owner's notes word for word, and
 * every category on the deck with who added it - then the rules that travel
 * with it. Built from the same records the Plan and Tags tabs show.
 * Server only.
 */

import { categories, SIX_JOBS, type AddedBy, type Category } from './categories';
import { cardsInList, type List } from './db';
import { noteBy, planFor } from './deck-plan';
import { jobCards, keeps } from './deck-roles';
import { owner } from './plan-help';
import { COMMANDER_ROLES } from './plan-help-shared';
import { tagKey } from './tags';

const WHO: Record<AddedBy, string> = { owner: "the owner's", cards: 'from the card data', ai: 'suggested by AI, accepted by the owner' };
const who = (by: AddedBy) => ` [${WHO[by]}]`;

/** The rules that travel with the block. */
export const CONTEXT_RULES = `How to read this:
- The owner's settings and the categories they made are fixed.
- Categories from the card data or accepted from AI are probably right. Say so if a card's rules text says otherwise.
- Categories describe; they do not protect. Owners cut theme cards as often as any other card, so a category is never a reason a card must stay.
- Only the never-cut cards and the commander are blocked, and the app's code enforces that.
- Where the list and the owner's aim differ, that is the work: say which aim a cut or add serves.`;

const cardsLine = (c: Category, max = 14) => `${c.cards.slice(0, max).map((x) => x.name).join(', ') || 'no cards'}${c.cards.length > max ? `, and ${c.cards.length - max} more` : ''}`;

/** The block, from the pages as they are now. */
export async function deckContext(list: Pick<List, 'id' | 'commander'>, opts: { rules?: boolean } = {}): Promise<string> {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const plan = planFor(list.id, '', list.commander, main);
  const o = owner(list.id);
  const cats = await categories(list, jobCards);
  const kept = keeps(list.id);
  const commanders = [list.commander?.name, ...main.filter((c) => c.slot === 'partner').map((c) => c.card.name)].filter((x): x is string => !!x);
  const roles = o.commanderRoles.filter((r) => r !== 'unsure');
  const goal = [...plan.goal.chips, ...(plan.goal.text ? [`"${plan.goal.text}"`] : [])];
  const wins = cats.filter((c) => c.kind === 'win');
  const key = cats.find((c) => c.kind === 'key');
  const notes = plan.notes.filter((n) => noteBy(n) === 'owner');
  const rest = cats.filter((c) => c.kind === 'job' || c.kind === 'tag' || c.kind === 'own');
  const L = [
    `The deck's plan (the owner's intent${o.confirmedAt ? ', confirmed' : ', not confirmed yet'}):`,
    `- What the commander does for the deck: ${roles.length ? roles.map((r) => COMMANDER_ROLES.find((x) => x.id === r)!.label).join(', ') + (o.commanderBy === 'ai' ? ' [suggested by AI, accepted by the owner]' : " [the owner's]") : 'not sure'}`,
    `- What they want from the deck: ${goal.length ? `${goal.join(', ')} [the owner's]` : 'nothing said'}`,
    `- Bracket aimed for: ${plan.bracket === null ? 'not sure' : `${plan.bracket}${plan.stored.bracket?.by === 'claude' ? ' [suggested by AI, accepted by the owner]' : " [the owner's]"}`}`,
    `- Budget per card: ${plan.budget ? `$${plan.budget}, cards they own always allowed` : 'any'}. Only cards they own: ${plan.own ? 'yes' : 'no'}.${plan.rule.text ? ` Deck rule: ${plan.rule.text}${plan.rule.filter ? ` (cards must match: ${plan.rule.filter})` : ''}` : ''}`,
    `- Never cut: ${[...commanders.map((n) => `${n} (the commander)`), ...main.filter((c) => kept.has(tagKey(c.card)) && !commanders.includes(c.card.name)).map((c) => c.card.name)].join(', ')}`,
    `- How the deck wins: ${o.planText.trim() ? `"${o.planText.trim()}"${o.planBy === 'ai' ? ` [${o.direction ? 'an AI direction picked by the owner' : 'suggested by AI, accepted by the owner'}]` : " [the owner's]"}` : 'not sure'}`,
    `- Ways to win: ${wins.length ? '' : 'none listed'}`,
    ...wins.map((w) => `  - ${w.name}${who(w.by)}${w.how ? `: ${w.how}` : ''} Cards: ${w.cards.map((x) => `${x.name}${x.by !== w.by ? who(x.by) : ''}`).join(', ') || 'none yet'}`),
    `- Key cards: ${key?.cards.length ? key.cards.map((x) => `${x.name}${who(x.by)}`).join(', ') : 'none listed'}`,
  ];
  if (notes.length) L.push('', "The owner's notes, in their words:", ...notes.map((n) => `- ${n.text}`));
  L.push('', 'Categories on this deck (who added each):');
  if (!rest.length) L.push('- none');
  for (const c of rest) {
    const kind = c.kind === 'job' ? `a job the deck tracks, ${c.cards.length} cards` : c.kind === 'tag' ? 'a tag from the card data, stays live' : 'a group';
    L.push(`- ${c.name}${who(c.by)} (${kind}): ${cardsLine(c)}`);
  }
  const missing = SIX_JOBS.filter((j) => !rest.some((c) => c.jobId === j.id));
  if (missing.length && missing.length < SIX_JOBS.length) L.push(`Jobs not tracked on this deck (no counts or warnings for them): ${missing.map((j) => j.label).join(', ')}.`);
  if (opts.rules !== false) L.push('', CONTEXT_RULES);
  return L.join('\n');
}
