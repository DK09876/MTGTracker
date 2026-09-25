/**
 * The model's three steps in tagging a deck - propose, assign, audit - each
 * one request, reading the deck and writing what the model found. The job
 * runner (tag-jobs.ts) calls them in turn; everything the model is told and
 * how its answer is checked lives in tagging.ts.
 */

import type { CallOptions, JsonModel } from './ai';
import { applyModelAudit, applyModelTags, deckTags, replaceProposals, type List } from './db';
import type { Board } from './decklist';
import { taggingDeck, type TaggingDeck } from './tag-deck';
import {
  ASSIGN_SCHEMA, ASSIGN_SYSTEM, assignMessage, AUDIT_SCHEMA, AUDIT_SYSTEM, auditMessage,
  parseAssignments, parseAudit, parseProposals, PROPOSE_SCHEMA, PROPOSE_SYSTEM, proposeMessage,
} from './tagging';
import { nextColor } from './tags';

export class StepError extends Error {}

export interface StepDeck {
  list: List;
  boards: Board[];
}

function read({ list, boards }: StepDeck) {
  const deck = taggingDeck(list, boards);
  if (!deck.cards.length) throw new StepError('The deck has no cards to tag');
  const current = deckTags(list.id);
  const accepted = current.tags.filter((t) => t.status === 'accepted');
  return { deck, current, accepted, context: { commander: list.commander, cards: deck.cards, brief: current.brief } };
}

/** Suggest tags for the owner to review. Answers how many were suggested and by which model. */
export async function proposeStep(model: JsonModel, at: StepDeck, instructions: string, options?: CallOptions) {
  const { deck, current, context } = read(at);
  const input = { ...context, instructions, accepted: current.tags.filter((t) => t.status === 'accepted'), rejected: current.tags.filter((t) => t.status === 'rejected') };
  const answer = await model({ system: PROPOSE_SYSTEM, user: proposeMessage(input), schema: PROPOSE_SCHEMA, temperature: 0.4 }, options);
  const { overview, tags } = parseProposals(answer.data, deck.cards, current.tags.filter((t) => t.status !== 'proposed'));
  if (!tags.length) throw new StepError('The model suggested nothing new - try different instructions');
  const used = current.tags.filter((t) => t.status === 'accepted').map((t) => t.color);
  replaceProposals(at.list.id, overview, tags.map((t) => {
    const color = nextColor(used);
    used.push(color);
    return { ...t, color };
  }));
  return { proposed: tags.length, model: answer.model };
}

/** Tag a batch of cards, given by tag key, with the accepted tags. */
export async function assignStep(model: JsonModel, at: StepDeck, keys: string[], options?: CallOptions) {
  const { deck, accepted, context } = read(at);
  if (!accepted.length) throw new StepError('Accept some tags first');
  const batch = keys.map((k) => deck.refOf.get(k)).filter((r): r is string => !!r);
  if (!batch.length) return { tagged: 0, skipped: keys.length, added: 0, model: null };
  const input = { ...context, tags: accepted, batch };
  const answer = await model({ system: ASSIGN_SYSTEM, user: assignMessage(input), schema: ASSIGN_SCHEMA }, options);
  const { assignments, answered } = parseAssignments(answer.data, accepted, batch, deck.cards);
  // Only cards the model answered for lose their old model tags; a card it
  // skipped keeps what it had rather than being wiped.
  const added = applyModelTags(at.list.id, answered.map((r) => deck.keyOf.get(r)!),
    assignments.map((a) => ({ ...a, key: deck.keyOf.get(a.key)! })));
  return { tagged: answered.length, skipped: batch.length - answered.length, added, model: answer.model };
}

/** Recheck these tags across the whole deck for misses and mistakes. */
export async function auditStep(model: JsonModel, at: StepDeck, tagIds: string[], options?: CallOptions) {
  const { deck, current, accepted, context } = read(at);
  const checking = accepted.filter((t) => tagIds.includes(t.id)).map((t) => t.id);
  if (!checking.length) return { added: 0, removed: 0, model: null };
  const members = new Map<string, Array<{ key: string; manual: boolean }>>();
  for (const link of current.cardTags) {
    const ref = deck.refOf.get(link.key);
    if (!link.on || !ref || !checking.includes(link.tagId)) continue;
    members.set(link.tagId, [...(members.get(link.tagId) ?? []), { key: ref, manual: link.source === 'manual' }]);
  }
  // A card the owner took a tag off is not the model's to put back.
  const blocked = new Set(current.cardTags.filter((l) => !l.on).map((l) => `${l.key}:${l.tagId}`));
  const input = { ...context, tags: accepted, checking, members };
  const answer = await model({ system: AUDIT_SYSTEM, user: auditMessage(input), schema: AUDIT_SCHEMA }, options);
  const changes = parseAudit(answer.data, input)
    .map((c) => ({ ...c, key: deck.keyOf.get(c.key)! }))
    .filter((c) => !blocked.has(`${c.key}:${c.tagId}`));
  const result = applyModelAudit(at.list.id, changes);
  return { ...result, model: answer.model };
}

/** The cards to tag, by tag key: all of them, or those with no tag on yet. */
export function cardsToTag(deck: TaggingDeck, cardTags: Array<{ key: string; on: boolean }>, scope: 'all' | 'untagged'): string[] {
  const tagged = new Set(cardTags.filter((l) => l.on).map((l) => l.key));
  return deck.cards.map((c) => deck.keyOf.get(c.key)!).filter((k) => scope === 'all' || !tagged.has(k));
}
