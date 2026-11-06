/**
 * Claude's second opinion on the cut list, two ways:
 *
 * - top: the rules rank the cards; the model reads the deck's plan, styles and
 *   tags and the top of that list - about twice as many as the deck is over -
 *   and says for each whether it agrees, with one line why.
 * - whole: every card in the main deck, each given a tier (S what the deck is
 *   built on, C what it would miss least) against the plan.
 *
 * Each review is told what the last one said and what the owner did about it
 * (cut, or ★ kept), so it does not repeat itself; cards already settled have
 * left the list anyway. One card can be re-rated with the owner's reason.
 * It never cuts anything itself; the review is kept with the deck until the
 * next one.
 */

import type { JsonModel } from './ai';
import type { CutCandidate } from './cut-score';
import { cardsInList, database } from './db';
import { keeps } from './deck-roles';
import { manaCostOf, oracleTextOf, typeLineOf, type ScryfallCard } from './scryfall';

import { TIERS, verdictOfTier, type CutReview, type ReviewItem, type ReviewMode, type Tier } from './cut-review-shared';

export { reviewSize, TIERS, verdictOfTier, type CutReview, type ReviewItem, type ReviewMode, type Tier } from './cut-review-shared';

const SYSTEM = `You help a Magic: The Gathering player cut their Commander deck down to 100 cards.
You get the deck's plan in the owner's words, its styles, the owner's tags, and the cards a rule-based list ranks as the best cuts, each with its rules text and the list's reasons.
For each listed card decide: "cut" (agree it should go), "keep" (it matters to this deck's plan - say why), or "unsure".
Judge by the plan first: a card that does what the deck is built to do should usually stay even if the list ranks it high; a card that does nothing for the plan should go even if it is powerful in general.
Keep each reason to one short sentence a player would say at the table. Use the card names exactly as given. Follow the owner's instructions where they apply.
If you are told what you said last time and what the owner did about it, build on it: don't argue again with a choice the owner made, and stay consistent unless the deck has changed.`;

const SYSTEM_WHOLE = `You help a Magic: The Gathering player judge every card in their Commander deck against its plan.
You get the deck's plan in the owner's words, its styles, the owner's tags, and every card in the main deck with its rules text (and, for cards the rule-based cut list ranks high, its reasons).
Give every card a tier: "S" - the deck is built on it; "A" - a strong part of the plan; "B" - fine, replaceable; "C" - what the deck would miss least, the first to cut.
Judge by the plan first: a card that does what the deck is built to do rates high even if it is weak in general; a powerful card that does nothing for the plan rates low.
Spread the tiers honestly: in a deck over 100, at least as many C as the deck is over.
Keep each reason to one short sentence a player would say at the table. Use the card names exactly as given. Follow the owner's instructions where they apply.
If you are told what you said last time and what the owner did about it, build on it and stay consistent unless the deck has changed.`;

const SYSTEM_RERATE = `You rated one card in a Magic: The Gathering Commander deck against the deck's plan, and the owner disagrees.
Tiers: "S" - the deck is built on it; "A" - a strong part of the plan; "B" - fine, replaceable; "C" - the first to cut.
Weigh the owner's reason seriously - they know how they play the deck - and give the card's tier now, with one short sentence why. Move it if their reason holds; keep your tier if it doesn't, and say why.`;

const TIER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, tier: { type: 'STRING', enum: TIERS }, why: { type: 'STRING' } },
        required: ['name', 'tier', 'why'],
      },
    },
  },
  required: ['items'],
};

const RERATE_SCHEMA = {
  type: 'OBJECT',
  properties: { tier: { type: 'STRING', enum: TIERS }, why: { type: 'STRING' } },
  required: ['tier', 'why'],
};

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
  /** The plan as Claude reads it (plan-context.ts). */
  plan?: string;
  styles: string[];
  tags: Array<{ name: string; description: string; cards: string[] }>;
  candidates: Array<CutCandidate & { card: ScryfallCard }>;
  over: number;
  instructions: string;
  mode?: ReviewMode;
  /** Whole-deck reviews: every card in the main deck. */
  cards?: ScryfallCard[];
  /** What the last review said, and what the owner did since. */
  previous?: Previous | null;
}

export interface Previous {
  at: string;
  items: ReviewItem[];
  /** Names the owner cut (moved off the main deck) or ★ kept since. */
  cut: string[];
  kept: string[];
}

/** The names on the main deck now, and the ones starred to keep. */
export function deckNames(listId: string): { main: Set<string>; kept: Set<string> } {
  const kept = keeps(listId);
  const main = cardsInList(listId).filter((c) => (c.board ?? 'main') === 'main');
  return {
    main: new Set(main.map((c) => c.card.name)),
    kept: new Set(main.filter((c) => kept.has(c.card.oracle_id ?? c.card.id)).map((c) => c.card.name)),
  };
}

/** What the owner did about the last review: which of its cards are gone from the main deck, and which they starred. */
export function settled(review: CutReview | null, mainNames: Set<string>, keptNames: Set<string>): { cut: string[]; kept: string[] } {
  const items = review?.items ?? [];
  return {
    cut: items.filter((i) => !mainNames.has(i.name)).map((i) => i.name),
    kept: items.filter((i) => mainNames.has(i.name) && keptNames.has(i.name)).map((i) => i.name),
  };
}

function previousLines(prev: Previous | null | undefined): string[] {
  if (!prev?.items.length) return [];
  const said = prev.items.map((i) => `- ${i.name}: ${i.tier ? `tier ${i.tier}` : i.verdict}${i.disputed ? ` (the owner disputed it: "${i.disputed.reason}")` : ''}`);
  return [
    '',
    `Last time (${prev.at.slice(0, 10)}) you said:`,
    ...said.slice(0, 80),
    prev.cut.length ? `Since then the owner cut: ${prev.cut.join(', ')}.` : 'The owner has cut none of them since.',
    prev.kept.length ? `And starred to keep for good: ${prev.kept.join(', ')}.` : '',
  ];
}

export function reviewMessage(input: ReviewInput): string {
  const card = (c: ScryfallCard) => `${c.name} ${manaCostOf(c)} - ${typeLineOf(c)}\n  ${oracleTextOf(c).replace(/\n+/g, ' | ') || '(no rules text)'}`;
  const head = [
    input.commander ? `Commander: ${card(input.commander)}` : 'No commander set.',
    '',
    `The plan, in the owner's words:\n"""\n${input.brief.trim() || '(not written)'}\n"""`,
    input.styles.length ? `Styles: ${input.styles.join(' + ')}` : '',
    input.plan ?? '',
    input.tags.length ? `The owner's tags:\n${input.tags.map((t) => `- ${t.name}${t.description ? `: ${t.description}` : ''} (${t.cards.length} cards)`).join('\n')}` : '',
    '',
  ];
  const body = input.mode === 'whole'
    ? (() => {
      const reasons = new Map(input.candidates.map((c) => [c.name, c.reasons]));
      const cards = input.cards ?? [];
      return [
        `The deck is ${input.over > 0 ? `${input.over} over 100` : 'at 100 or under'}. Rate all ${cards.length} cards in the main deck:`,
        ...cards.map((c, i) => `${i + 1}. ${card(c)}${reasons.has(c.name) ? `\n  The cut list says: ${reasons.get(c.name)!.join('; ')}` : ''}`),
      ];
    })()
    : [
      `The deck is ${input.over > 0 ? `${input.over} over 100` : 'at 100 or under'}. The list's top ${input.candidates.length} cuts, best first:`,
      ...input.candidates.map((c, i) => `${i + 1}. ${card(c.card)}\n  List says (score ${c.score}): ${c.reasons.join('; ')}`),
    ];
  return [
    ...head,
    ...body,
    ...previousLines(input.previous),
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
    const tier = TIERS.includes(it.tier as Tier) ? it.tier as Tier : undefined;
    const verdict = tier ? verdictOfTier(tier) : it.verdict === 'cut' || it.verdict === 'keep' ? it.verdict : 'unsure';
    out.push({ name, verdict, why: String(it.why ?? '').slice(0, 300), ...(tier ? { tier } : {}) });
  }
  return out;
}

export async function reviewCuts(model: JsonModel, input: ReviewInput): Promise<{ items: ReviewItem[]; model: string }> {
  const whole = input.mode === 'whole';
  const answer = await model({
    step: whole ? 'rate the whole deck' : 'review the cuts',
    system: whole ? SYSTEM_WHOLE : SYSTEM,
    user: reviewMessage(input),
    schema: whole ? TIER_SCHEMA : SCHEMA,
    thinking: 'medium',
    // A tier and a sentence for every card in a deck is a long answer: more time.
    ...(whole ? { timeoutMs: 6 * 60_000 } : {}),
  }, { maxBusy: 1 });
  const asked = whole ? (input.cards ?? []).map((c) => c.name) : input.candidates.map((c) => c.name);
  return { items: parseReview(answer.data, asked), model: answer.model };
}

export interface RerateInput {
  commander: ScryfallCard | null;
  brief: string;
  /** The plan as Claude reads it (plan-context.ts). */
  plan?: string;
  styles: string[];
  card: ScryfallCard;
  was: ReviewItem | null;
  wantTier: Tier | null;
  reason: string;
}

export function rerateMessage(input: RerateInput): string {
  const c = input.card;
  return [
    input.commander ? `Commander: ${input.commander.name}` : 'No commander set.',
    `The plan, in the owner's words:\n"""\n${input.brief.trim() || '(not written)'}\n"""`,
    input.styles.length ? `Styles: ${input.styles.join(' + ')}` : '',
    input.plan ?? '',
    '',
    `The card: ${c.name} ${manaCostOf(c)} - ${typeLineOf(c)}\n  ${oracleTextOf(c).replace(/\n+/g, ' | ') || '(no rules text)'}`,
    input.was ? `You said: ${input.was.tier ? `tier ${input.was.tier}` : input.was.verdict} - ${input.was.why}` : '',
    input.wantTier ? `The owner thinks it is tier ${input.wantTier}.` : 'The owner disagrees.',
    `Their reason:\n"""\n${input.reason.trim() || '(no reason given)'}\n"""`,
  ].filter(Boolean).join('\n');
}

/** Re-rate one card with the owner's reason. */
export async function rerateCard(model: JsonModel, input: RerateInput): Promise<{ tier: Tier; why: string; model: string }> {
  const answer = await model({ step: 're-rate a card', system: SYSTEM_RERATE, user: rerateMessage(input), schema: RERATE_SCHEMA, thinking: 'low' }, { maxBusy: 1 });
  const d = answer.data as { tier?: string; why?: string };
  const tier = TIERS.includes(d?.tier as Tier) ? d.tier as Tier : input.was?.tier ?? 'B';
  return { tier, why: String(d?.why ?? '').slice(0, 300), model: answer.model };
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
