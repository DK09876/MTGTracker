/**
 * Claude's second opinion on the cut list. The rules rank the cards; the
 * model reads the deck's plan, its styles and tags, and the top of that list
 * with each card's text and reasons, and says for each whether it agrees -
 * with one line why - plus anything the owner asked it to weigh. It never
 * cuts anything itself; the review is kept with the deck until the next one.
 */

import type { JsonModel } from './ai';
import type { CutCandidate } from './cut-score';
import { database } from './db';
import { manaCostOf, oracleTextOf, typeLineOf, type ScryfallCard } from './scryfall';

export interface ReviewItem {
  name: string;
  verdict: 'cut' | 'keep' | 'unsure';
  why: string;
}

export interface CutReview {
  at: string;
  model: string;
  instructions: string;
  /** How many cards the deck needed to lose when it was asked. */
  over: number;
  items: ReviewItem[];
}

export const REVIEW_SIZE = 30;

const SYSTEM = `You help a Magic: The Gathering player cut their Commander deck down to 100 cards.
You get the deck's plan in the owner's words, its styles, the owner's tags, and the cards a rule-based list ranks as the best cuts, each with its rules text and the list's reasons.
For each listed card decide: "cut" (agree it should go), "keep" (it matters to this deck's plan - say why), or "unsure".
Judge by the plan first: a card that does what the deck is built to do should usually stay even if the list ranks it high; a card that does nothing for the plan should go even if it is powerful in general.
Keep each reason to one short sentence a player would say at the table. Use the card names exactly as given. Follow the owner's instructions where they apply.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, verdict: { type: 'STRING', enum: ['cut', 'keep', 'unsure'] }, why: { type: 'STRING' } },
        required: ['name', 'verdict', 'why'],
      },
    },
  },
  required: ['items'],
};

export interface ReviewInput {
  commander: ScryfallCard | null;
  brief: string;
  styles: string[];
  tags: Array<{ name: string; description: string; cards: string[] }>;
  candidates: Array<CutCandidate & { card: ScryfallCard }>;
  over: number;
  instructions: string;
}

export function reviewMessage(input: ReviewInput): string {
  const card = (c: ScryfallCard) => `${c.name} ${manaCostOf(c)} - ${typeLineOf(c)}\n  ${oracleTextOf(c).replace(/\n+/g, ' | ') || '(no rules text)'}`;
  return [
    input.commander ? `Commander: ${card(input.commander)}` : 'No commander set.',
    '',
    `The plan, in the owner's words:\n"""\n${input.brief.trim() || '(not written)'}\n"""`,
    input.styles.length ? `Styles: ${input.styles.join(' + ')}` : '',
    input.tags.length ? `The owner's tags:\n${input.tags.map((t) => `- ${t.name}${t.description ? `: ${t.description}` : ''} (${t.cards.length} cards)`).join('\n')}` : '',
    '',
    `The deck is ${input.over > 0 ? `${input.over} over 100` : 'at 100 or under'}. The list's top ${input.candidates.length} cuts, best first:`,
    ...input.candidates.map((c, i) => `${i + 1}. ${card(c.card)}\n  List says (score ${c.score}): ${c.reasons.join('; ')}`),
    ...(input.instructions.trim() ? ['', `The owner's instructions - follow them where they apply:\n"""\n${input.instructions.trim()}\n"""`] : []),
  ].filter((l) => l !== '').join('\n');
}

/** The model's answer, kept to cards that were asked about. */
export function parseReview(data: unknown, asked: string[]): ReviewItem[] {
  const items = (data as { items?: unknown[] })?.items ?? [];
  const byName = new Map(asked.map((n) => [n.toLowerCase(), n]));
  const out: ReviewItem[] = [];
  for (const raw of items) {
    const it = raw as Partial<ReviewItem>;
    const name = byName.get(String(it.name ?? '').toLowerCase());
    if (!name || out.some((o) => o.name === name)) continue;
    out.push({ name, verdict: it.verdict === 'cut' || it.verdict === 'keep' ? it.verdict : 'unsure', why: String(it.why ?? '').slice(0, 300) });
  }
  return out;
}

export async function reviewCuts(model: JsonModel, input: ReviewInput): Promise<{ items: ReviewItem[]; model: string }> {
  const answer = await model({ step: 'review the cuts', system: SYSTEM, user: reviewMessage(input), schema: SCHEMA, thinking: 'medium' }, { maxBusy: 1 });
  return { items: parseReview(answer.data, input.candidates.map((c) => c.name)), model: answer.model };
}

// --- Kept with the deck ----------------------------------------------------

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run('CREATE TABLE IF NOT EXISTS deck_cut_reviews (listId TEXT PRIMARY KEY, review TEXT NOT NULL)');
    ready = true;
  }
  return d;
}

export function lastReview(listId: string): CutReview | null {
  const r = db().get('SELECT review FROM deck_cut_reviews WHERE listId = ?', [listId]) as { review: string } | null;
  return r ? JSON.parse(r.review) as CutReview : null;
}

export function saveReview(listId: string, review: CutReview): void {
  db().run('INSERT INTO deck_cut_reviews (listId, review) VALUES (?, ?) ON CONFLICT(listId) DO UPDATE SET review = excluded.review', [listId, JSON.stringify(review)]);
}
