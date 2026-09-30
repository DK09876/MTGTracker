/**
 * Answering a rules question.
 *
 *   1. Find the cards: named in the question (lib/rules/names), plus the
 *      conversation's cards for a follow-up. A word that could be several
 *      cards ("kratos") stops here to ask which; the answer carries on with
 *      the picks, no model spent.
 *   2. Gather evidence: each card's Oracle text and official rulings; the
 *      Comprehensive Rules that bear on the question and the cards'
 *      keywords, with the glossary and what it points to; MTG Wiki pages for
 *      the keywords.
 *   3. One model request: answer from that evidence, citing it (answer.ts).
 *
 * The network and the model are passed in, so the tests run without them.
 */

import type { CallOptions, JsonModel } from '../ai';
import type { Ruling, ScryfallCard } from '../scryfall';
import { ANSWER_SCHEMA, ANSWER_SYSTEM, answerMessage, parseAnswer, type Source, type Turn } from './answer';
import { keywordRules, placeWeight, referencedRules, ruleWithContext, searchRules, tokens, type RulesIndex } from './cr';
import { findMentions, type NameIndex } from './names';
import type { WikiPage } from './sources';

export interface AskDeps {
  rules: () => Promise<{ index: RulesIndex; vocab: Set<string> }>;
  names: () => Promise<NameIndex>;
  /** Cards by exact name. */
  cards: (names: string[]) => Promise<ScryfallCard[]>;
  rulings: (card: ScryfallCard) => Promise<Ruling[]>;
  wiki: (title: string) => Promise<WikiPage | null>;
  model: JsonModel;
  now?: () => Date;
}

export interface AskInput {
  question: string;
  /** Earlier turns of this conversation. */
  earlier?: Turn[];
  /** Answers to "which card?": mention -> the card's name. */
  picks?: Record<string, string>;
}

export type AskResult =
  | { choice: Array<{ mention: string; options: string[] }> }
  | { turn: Turn };

// Rules ideas worth looking up when they appear in a question or a card's text.
const CONCEPTS = [
  'dies', 'leaves the battlefield', 'enters the battlefield', 'enters', 'token', 'copy', 'copies', 'legendary', 'legend rule',
  'sacrifice', 'destroy', 'exile', 'graveyard', 'counter target', 'counters', '+1/+1 counter', 'trigger', 'triggered ability',
  'activated ability', 'static ability', 'state-based action', 'replacement effect', 'prevent', 'damage', 'combat damage',
  'attack', 'attacking', 'block', 'blocking', 'equipped', 'attach', 'aura', 'equipment', 'cast', 'spell', 'stack', 'resolve',
  'target', 'control', 'controller', 'owner', 'commander', 'command zone', 'mana value', 'cost', 'additional cost', 'x',
  'layer', 'timestamp', 'dependency', 'characteristic', 'power', 'toughness', 'loses all abilities', 'protection',
  'indestructible', 'regenerate', 'phase out', 'flicker', 'return to the battlefield', 'simultaneously', 'at the same time',
  'look back in time', 'look back', 'draw', 'discard', 'library', 'shuffle', 'upkeep', 'end step', 'cleanup', 'untap',
  'extra turn', 'extra combat', 'tapped and attacking', 'defending player', 'double', 'doubling', 'proliferate',
];

// Keywords about building a deck, not about how cards play together.
const DECKBUILDING = new Set(['partner', 'companion', 'background', 'friends forever', 'choose a background', 'doctor\'s companion']);

/** The keyword abilities and actions in play: on the cards (granted ones too, "has myriad") or in the question. */
function keywordsInPlay(question: string, cards: ScryfallCard[], index: RulesIndex): Map<string, string> {
  const all = keywordRules(index);
  const text = `${question} ${cards.map((c) => `${c.oracle_text ?? ''} ${c.card_faces?.map((f) => f.oracle_text).join(' ') ?? ''} ${(c.keywords ?? []).join(' ')}`).join(' ')}`.toLowerCase();
  const found = new Map<string, string>();
  for (const [name, number] of all) {
    if (DECKBUILDING.has(name) || name.length < 3) continue;
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) found.set(name, number);
  }
  return found;
}

/** How much each word or phrase counts in the rules search. */
function searchTerms(question: string, cards: ScryfallCard[], keywords: Map<string, string>): Map<string, number> {
  const terms = new Map<string, number>();
  const add = (t: string, w: number) => terms.set(t, Math.max(terms.get(t) ?? 0, w));
  const q = question.toLowerCase();
  const oracle = cards.map((c) => (c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text).join(' ') ?? '').toLowerCase()).join(' ');
  for (const c of CONCEPTS) {
    if (new RegExp(`\\b${c.replace(/[+/]/g, (m) => `\\${m}`)}\\b`).test(q)) add(c, 2.5);
    else if (new RegExp(`\\b${c.replace(/[+/]/g, (m) => `\\${m}`)}\\b`).test(oracle)) add(c, 1);
  }
  // The keyword abilities in play are the rules the cards most need (myriad,
  // equip); keyword actions (cast, create, exile) are everyday and count less.
  for (const [k, number] of keywords) add(k, number.startsWith('702') ? 3 : 1.2);
  // A legendary creature that gets copied meets the legend rule.
  const legendary = cards.some((c) => /legendary/i.test(c.type_line ?? ''));
  const copies = /\b(cop(y|ies)|token|myriad|clone|populate|embalm|eternalize|encore)\b/i.test(`${q} ${oracle}`);
  if (legendary && copies) { add('legend rule', 3.5); add('legendary', 2); }
  // Supertypes and types that have rules of their own.
  for (const c of cards) {
    const type = (c.type_line ?? '').toLowerCase();
    if (type.includes('legendary')) add('legendary', 2);
    for (const t of ['equipment', 'aura', 'saga', 'vehicle', 'planeswalker', 'battle', 'spacecraft', 'class', 'case']) if (type.includes(t)) add(t, 1.5);
  }
  // And the question's own words, lightly.
  for (const w of new Set(tokens(question))) if (!terms.has(w)) add(w, 0.6);
  return terms;
}

/** The rulings most to do with the question - all of them if there are few. */
function pickRulings(rulings: Ruling[], question: string, max = 8): Ruling[] {
  if (rulings.length <= max) return rulings;
  const words = new Set(tokens(question));
  return [...rulings]
    .map((r) => ({ r, score: tokens(r.comment).filter((w) => words.has(w)).length + (r.source === 'wotc' ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.r);
}

const oracleOf = (c: ScryfallCard) => (c.card_faces?.length
  ? c.card_faces.map((f) => `${f.name}${f.mana_cost ? ` ${f.mana_cost}` : ''} - ${f.type_line ?? ''}\n${f.oracle_text ?? ''}`).join('\n// ')
  : `${c.name}${c.mana_cost ? ` ${c.mana_cost}` : ''} - ${c.type_line ?? ''}\n${c.oracle_text ?? ''}`);

// Yawgatog's hyperlinked copy of the Comprehensive Rules, kept current, with an
// anchor on every rule (#R60310a) and glossary entry (#legend_rule).
const RULES_SITE = 'https://yawgatog.com/resources/magic-rules/';
const ruleUrl = (number: string) => `${RULES_SITE}#R${number.replace(/\./g, '')}`;
const glossaryUrl = (term: string) => `${RULES_SITE}#${term.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

/** Everything the answer may draw on, each with an id to cite. */
export async function gatherSources(question: string, cards: ScryfallCard[], deps: Pick<AskDeps, 'rules' | 'rulings' | 'wiki'>): Promise<Source[]> {
  const sources: Source[] = [];
  let n = { O: 0, R: 0, C: 0, G: 0, W: 0 };
  const next = (k: keyof typeof n) => { n = { ...n, [k]: n[k] + 1 }; return `${k}${n[k]}`; };

  for (const c of cards) {
    sources.push({ id: next('O'), kind: 'oracle', label: c.name, url: c.scryfall_uri?.split('?')[0], text: oracleOf(c) });
  }
  const rulings = await Promise.all(cards.map((c) => deps.rulings(c).catch(() => [] as Ruling[])));
  cards.forEach((c, i) => {
    for (const r of pickRulings(rulings[i], question)) {
      sources.push({
        id: next('R'), kind: 'ruling', label: `${r.source === 'wotc' ? 'Ruling' : 'Scryfall note'}: ${c.name}`,
        url: c.scryfall_uri ? `${c.scryfall_uri.split('?')[0]}#rulings` : undefined, text: r.comment, date: r.published_at,
      });
    }
  });

  const { index } = await deps.rules();
  const keywords = keywordsInPlay(question, cards, index);
  const inPlay = new Set(keywords.values());
  const allKeywords = keywordRules(index);
  // A keyword's glossary entry counts only when the keyword is in play, like its rules.
  const hits = searchRules(index, searchTerms(question, cards, keywords), 14,
    (id) => (id.startsWith('g:') ? (keywords.has(id.slice(2)) || !allKeywords.has(id.slice(2)) ? 1 : 0.3) : placeWeight(id, inPlay)));
  const rules: string[] = [];
  const glossary: string[] = [];
  for (const h of hits) {
    if (h.id.startsWith('g:')) glossary.push(h.id.slice(2));
    else rules.push(h.id);
  }
  // A glossary entry says where the rule is: bring that rule too.
  for (const g of glossary.slice(0, 5)) {
    for (const r of referencedRules(index.glossary.get(g)?.text ?? '').slice(0, 2)) if (!rules.includes(r) && index.rules.has(r)) rules.push(r);
  }
  for (const g of glossary.slice(0, 5)) {
    const entry = index.glossary.get(g)!;
    sources.push({ id: next('G'), kind: 'glossary', label: `Glossary: ${entry.term}`, url: glossaryUrl(entry.term), text: entry.text });
  }
  for (const r of rules.slice(0, 14)) {
    const text = ruleWithContext(index, r);
    if (text) sources.push({ id: next('C'), kind: 'rule', label: `CR ${r}`, url: ruleUrl(r), text });
  }

  // The wiki explains keyword abilities well (myriad, equip); everyday keyword
  // actions (cast, exile) it has nothing to add on. One page each, at most three.
  const titles = [...keywords].filter(([, number]) => number.startsWith('702')).slice(0, 3).map(([k]) => k[0].toUpperCase() + k.slice(1));
  const pages = await Promise.all(titles.map((k) => deps.wiki(k).catch(() => null)));
  for (const p of pages) if (p) sources.push({ id: next('W'), kind: 'wiki', label: `MTG Wiki: ${p.title}`, url: p.url, text: p.text });
  return sources;
}

export async function askRules(input: AskInput, deps: AskDeps, options?: CallOptions): Promise<AskResult> {
  const question = input.question.trim();
  const earlier = input.earlier ?? [];
  const [{ vocab }, names] = await Promise.all([deps.rules(), deps.names()]);
  const found = findMentions(question, names, vocab);

  // A follow-up that says "Kratos" means the Kratos already in the
  // conversation; only a word the conversation cannot settle is asked about.
  const previous = earlier.flatMap((t) => t.cards);
  const picks = { ...input.picks };
  for (const a of found.ambiguous) {
    if (picks[a.mention]) continue;
    const known = a.options.filter((o) => previous.includes(o) || found.cards.includes(o));
    if (known.length === 1) picks[a.mention] = known[0];
  }
  const unanswered = found.ambiguous.filter((a) => !picks[a.mention] || !a.options.includes(picks[a.mention]));
  if (unanswered.length) return { choice: unanswered };

  // The conversation's cards stay in play for a follow-up that does not name them.
  const named = [...found.cards, ...found.ambiguous.map((a) => picks[a.mention])];
  const wanted = [...new Set([...named, ...previous])].slice(0, 6);
  const cards = wanted.length ? await deps.cards(wanted) : [];

  const sources = await gatherSources(question, cards, deps);
  const { index } = await deps.rules();
  const answer = await deps.model({
    system: ANSWER_SYSTEM,
    user: answerMessage(question, earlier.map((t) => ({ question: t.question, verdict: t.answer.verdict })), sources),
    schema: ANSWER_SCHEMA,
    thinking: 'high',
    temperature: 0.2,
    timeoutMs: 90_000,
  }, options);
  return {
    turn: {
      question,
      answer: parseAnswer(answer.data, sources),
      sources,
      cards: cards.map((c) => c.name),
      model: answer.model,
      rulesEdition: index.effective,
      at: (deps.now?.() ?? new Date()).toISOString(),
    },
  };
}
