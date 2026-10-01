/**
 * Answering a rules question.
 *
 *   1. Find the cards: named in the question (lib/rules/names), plus the
 *      conversation's cards for a follow-up. A word that could be several
 *      cards ("kratos") stops here to ask which; the answer carries on with
 *      the picks, no model spent.
 *   2. A quick look at what the question needs (research.ts, on a small
 *      model): the rules concepts to look up, whether a follow-up only asks
 *      about the last answer, and anything left open that the answer turns
 *      on - which stops here to ask the player.
 *   3. Gather evidence: each card's Oracle text and official rulings; the
 *      rules for each concept; the Comprehensive Rules that bear on the
 *      question and the cards' keywords, with the glossary and what it
 *      points to; MTG Wiki pages for the keywords. A follow-up carries the
 *      sources the last answer cited, and its working.
 *   4. Fit it to the model's size limit, most important first.
 *   5. One model request: work it out and answer from that evidence, citing
 *      it (answer.ts).
 *
 * The network and the model are passed in, so the tests run without them.
 */

import { ModelError, type CallOptions, type JsonModel } from '../ai';
import type { Ruling, ScryfallCard } from '../scryfall';
import { anchorRules } from './anchors';
import { ANSWER_SCHEMA, ANSWER_SYSTEM, answerMessage, CHECK_SCHEMA, CHECK_SYSTEM, checkMessage, compactWorking, parseAnswer, type Earlier, type Source, type Turn } from './answer';
import { keywordRules, placeWeight, referencedRules, ruleWithContext, searchRules, tokens, type RulesIndex } from './cr';
import { findMentions, type NameIndex } from './names';
import { parseResearch, RESEARCH_SCHEMA, RESEARCH_SYSTEM, researchMessage, type Clarify, type Research } from './research';
import type { WikiPage } from './sources';

export interface AskDeps {
  rules: () => Promise<{ index: RulesIndex; vocab: Set<string> }>;
  names: () => Promise<NameIndex>;
  /** Cards by exact name. */
  cards: (names: string[]) => Promise<ScryfallCard[]>;
  rulings: (card: ScryfallCard) => Promise<Ruling[]>;
  wiki: (title: string) => Promise<WikiPage | null>;
  model: JsonModel;
  /** A small model for the look at what the question needs; without it, that step is skipped. */
  helper?: JsonModel | null;
  /** The most the answer request may send, in tokens (models.ts inputTokens). */
  inputTokens?: number;
  now?: () => Date;
}

export interface AskInput {
  question: string;
  /** Earlier turns of this conversation. */
  earlier?: Turn[];
  /** Answers to "which card?": mention -> the card's name. */
  picks?: Record<string, string>;
  /** Have the answer checked by a second request before it is given. */
  secondCheck?: boolean;
  /** Add the rules the cards' own words call for (anchors.ts). On unless turned off, as for testing without them. */
  anchors?: boolean;
  /** The player's answers to clarifying questions asked about this question. */
  clarifications?: Array<{ question: string; answer: string }>;
}

export type AskResult =
  | { choice: Array<{ mention: string; options: string[] }> }
  | { clarify: Clarify[] }
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
function searchTerms(question: string, cards: ScryfallCard[], keywords: Map<string, string>, handPicked = true): Map<string, number> {
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
  if (handPicked && legendary && copies) { add('legend rule', 3.5); add('legendary', 2); }
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
/**
 * How much each source matters when not everything fits: 0 is kept first.
 * Card text; then what the last answer cited; then the rules for the
 * concepts looked up and the cards' own anchors; the first rulings; the
 * search's best rules; then the rest; the wiki last.
 */
export type Priority = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Gathered { sources: Source[]; priority: Map<string, Priority> }

const PREFIX: Record<Source['kind'], 'O' | 'R' | 'C' | 'G' | 'W'> = { oracle: 'O', ruling: 'R', rule: 'C', glossary: 'G', wiki: 'W' };

export interface GatherOptions {
  anchors?: boolean;
  /** Rules concepts to look up, each on its own (research.ts). */
  concepts?: string[];
  /** Sources the last answer cited, kept for a follow-up. */
  carried?: Source[];
  /** A follow-up only about the last answer: no broad search, no wiki. */
  narrow?: boolean;
}

export async function gatherSources(
  question: string, cards: ScryfallCard[], deps: Pick<AskDeps, 'rules' | 'rulings' | 'wiki'>, options: GatherOptions = {},
): Promise<Source[]> {
  return (await gather(question, cards, deps, options)).sources;
}

async function gather(
  question: string, cards: ScryfallCard[], deps: Pick<AskDeps, 'rules' | 'rulings' | 'wiki'>,
  { anchors: useAnchors = true, concepts = [], carried = [], narrow = false }: GatherOptions = {},
): Promise<Gathered> {
  const sources: Source[] = [];
  const priority = new Map<string, Priority>();
  let n = { O: 0, R: 0, C: 0, G: 0, W: 0 };
  const next = (k: keyof typeof n) => { n = { ...n, [k]: n[k] + 1 }; return `${k}${n[k]}`; };
  const add = (source: Omit<Source, 'id'>, p: Priority) => {
    if (sources.some((x) => x.label === source.label && x.text === source.text)) return;
    const id = next(PREFIX[source.kind]);
    sources.push({ id, ...source });
    priority.set(id, p);
  };

  for (const c of cards) add({ kind: 'oracle', label: c.name, url: c.scryfall_uri?.split('?')[0], text: oracleOf(c) }, 0);
  for (const c of carried) if (c.kind !== 'oracle') add({ kind: c.kind, label: c.label, url: c.url, text: c.text, date: c.date }, 1);
  const rulings = await Promise.all(cards.map((c) => deps.rulings(c).catch(() => [] as Ruling[])));
  cards.forEach((c, i) => {
    pickRulings(rulings[i], question).forEach((r, k) => add({
      kind: 'ruling', label: `${r.source === 'wotc' ? 'Ruling' : 'Scryfall note'}: ${c.name}`,
      url: c.scryfall_uri ? `${c.scryfall_uri.split('?')[0]}#rulings` : undefined, text: r.comment, date: r.published_at,
    }, k < 4 ? 3 : 5));
  });

  const { index } = await deps.rules();
  const taken = new Set(sources.filter((x) => x.kind === 'rule').map((x) => x.label));
  const addRule = (r: string, p: Priority, why?: string) => {
    const label = `CR ${r}`;
    const text = ruleWithContext(index, r);
    if (!text || taken.has(label)) return;
    taken.add(label);
    add({ kind: 'rule', label, url: ruleUrl(r), text: why ? `${text}\n[Included because: ${why}]` : text }, p);
  };
  const addGlossary = (term: string, p: Priority) => {
    const entry = index.glossary.get(term);
    if (entry) add({ kind: 'glossary', label: `Glossary: ${entry.term}`, url: glossaryUrl(entry.term), text: entry.text }, p);
    return entry;
  };

  const keywords = keywordsInPlay(question, cards, index);
  const inPlay = new Set(keywords.values());
  // Each concept looked up on its own, so one common idea cannot crowd out
  // the others: its glossary entry and the rule that points to, and its best
  // two rules - weighed like the broad search, so other formats' rules
  // (Archenemy, Planechase) and keywords not in play rarely win.
  for (const concept of concepts) {
    const entry = addGlossary(concept.toLowerCase(), 2);
    for (const r of referencedRules(entry?.text ?? '').slice(0, 1)) if (index.rules.has(r)) addRule(r, 2, concept);
    const hits = searchRules(index, new Map([[concept, 1]]), 6, (id) => placeWeight(id, inPlay)).filter((h) => !h.id.startsWith('g:')).slice(0, 2);
    for (const h of hits) addRule(h.id, 2, concept);
  }
  if (narrow) return { sources, priority };
  const allKeywords = keywordRules(index);
  // A keyword's glossary entry counts only when the keyword is in play, like its rules.
  const hits = searchRules(index, searchTerms(question, cards, keywords, useAnchors), 14,
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
  for (const g of glossary.slice(0, 5)) addGlossary(g, 4);
  // The rules the cards' own words call for come first (anchors.ts), then
  // what the search found, up to eighteen in all.
  const anchors = useAnchors ? anchorRules(question, cards).filter((a) => index.rules.has(a.rule)) : [];
  for (const a of anchors) addRule(a.rule, 2, a.why);
  rules.filter((r) => !anchors.some((a) => a.rule === r)).slice(0, 18).forEach((r, k) => addRule(r, k < 8 ? 4 : 5));

  // The wiki explains keyword abilities well (myriad, equip); everyday keyword
  // actions (cast, exile) it has nothing to add on. One page each, at most three.
  const titles = [...keywords].filter(([, number]) => number.startsWith('702')).slice(0, 3).map(([k]) => k[0].toUpperCase() + k.slice(1));
  const pages = await Promise.all(titles.map((k) => deps.wiki(k).catch(() => null)));
  for (const p of pages) if (p) add({ kind: 'wiki', label: `MTG Wiki: ${p.title}`, url: p.url, text: p.text }, 6);
  return { sources, priority };
}

// About how many characters make a token, for sizing a request; a little
// under the usual four, as rules text and JSON run shorter.
const CHARS_PER_TOKEN = 3.4;

/** The most important sources that fit in `room` characters, in their original order. */
export function fitSources({ sources, priority }: Gathered, room: number): Source[] {
  const cost = (x: Source) => x.label.length + x.text.length + 12;
  const byPriority = [...sources].sort((a, b) => (priority.get(a.id) ?? 5) - (priority.get(b.id) ?? 5));
  const keep = new Set<string>();
  let used = 0;
  for (const x of byPriority) {
    // Card text always goes: nothing can be answered without it.
    if (used + cost(x) > room && priority.get(x.id) !== 0) continue;
    keep.add(x.id);
    used += cost(x);
  }
  return sources.filter((x) => keep.has(x.id));
}

/** What the conversation carries into a follow-up: the last turn in full, older ones briefly. */
function earlierFrom(turns: Turn[]): Earlier | null {
  if (!turns.length) return null;
  const labelIn = (t: Turn) => (id: string) => t.sources.find((x) => x.id === id)?.label ?? id;
  const last = turns[turns.length - 1];
  return {
    older: turns.slice(0, -1).map((t) => ({
      question: t.question, verdict: t.answer.verdict,
      key: t.answer.citations.filter((c) => c.role === 'key').map((c) => labelIn(t)(c.id)),
    })),
    last: { question: last.question, verdict: last.answer.verdict, working: compactWorking(last.answer, labelIn(last)) },
  };
}

/** The sources the last answer cited, to keep in a follow-up. */
function carriedFrom(turns: Turn[], max = 8): Source[] {
  const last = turns[turns.length - 1];
  if (!last) return [];
  return last.answer.citations.map((c) => last.sources.find((x) => x.id === c.id)).filter((x): x is Source => !!x).slice(0, max);
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

  const clarifications = input.clarifications ?? [];
  const research = await look(question, earlier, clarifications, cards, deps);
  if (research.clarify.length) return { clarify: research.clarify };

  const gathered = await gather(question, cards, deps, {
    anchors: input.anchors !== false,
    concepts: research.concepts,
    carried: carriedFrom(earlier),
    narrow: research.kind === 'about-earlier',
  });
  const { index } = await deps.rules();
  const context = earlierFrom(earlier);
  // Fit the request to the model: what the prompt and schema leave of its
  // size limit goes to sources, most important first. If the model still
  // says it is too big, send less, twice.
  const fixed = ANSWER_SYSTEM.length + JSON.stringify(ANSWER_SCHEMA).length + answerMessage(question, context, [], clarifications).length;
  const room = (deps.inputTokens ?? 30_000) * CHARS_PER_TOKEN - fixed;
  let sources: Source[] = [];
  let answer: Awaited<ReturnType<JsonModel>> | null = null;
  for (const share of [1, 0.7, 0.45]) {
    sources = fitSources(gathered, room * share);
    try {
      answer = await deps.model({
        system: ANSWER_SYSTEM,
        user: answerMessage(question, context, sources, clarifications),
        schema: ANSWER_SCHEMA,
        thinking: 'high',
        temperature: 0.2,
        // Room for a wait on a per-minute limit (Groq's free tier) as well as the answer.
        timeoutMs: 150_000,
      }, options);
      break;
    } catch (error) {
      if (!(error instanceof ModelError && error.kind === 'too-big') || share === 0.45) throw error;
    }
  }
  if (!answer) throw new ModelError('the model did not answer');
  let final = parseAnswer(answer.data, sources);
  let check: Turn['check'];
  if (input.secondCheck) {
    try {
      const checked = await deps.model({
        system: CHECK_SYSTEM, user: checkMessage(question, context, sources, final, clarifications), schema: CHECK_SCHEMA,
        thinking: 'high', temperature: 0.1, timeoutMs: 90_000,
      }, options);
      const changes = String((checked.data as { changes?: unknown }).changes ?? '').trim() || 'No changes';
      final = parseAnswer(checked.data, sources);
      check = { changes, model: checked.model };
    } catch (error) {
      // The first answer still stands; the page says the check did not run.
      check = { failed: error instanceof Error ? error.message : 'The second check failed' };
    }
  }
  return {
    turn: {
      question,
      ...(clarifications.length ? { clarifications } : {}),
      answer: final,
      ...(check ? { check } : {}),
      sources,
      cards: cards.map((c) => c.name),
      model: answer.model,
      rulesEdition: index.effective,
      at: (deps.now?.() ?? new Date()).toISOString(),
    },
  };
}

/**
 * The quick look before answering (research.ts). Without a helper model, or
 * if it fails, the question is answered without it: the broad search still
 * runs, and nothing is asked.
 */
async function look(
  question: string, earlier: Turn[], clarifications: Array<{ question: string; answer: string }>, cards: ScryfallCard[], deps: AskDeps,
): Promise<Research> {
  const fallback: Research = { kind: earlier.length ? 'new-situation' : 'first', concepts: [], clarify: [] };
  if (!deps.helper) return fallback;
  try {
    const reply = await deps.helper({
      system: RESEARCH_SYSTEM,
      user: researchMessage({
        question, clarifications,
        earlier: earlier.map((t) => ({ question: t.question, verdict: t.answer.verdict })),
        oracle: cards.map(oracleOf),
      }),
      schema: RESEARCH_SCHEMA,
      thinking: 'low',
      temperature: 0.1,
      timeoutMs: 30_000,
    }, { maxBusy: 1 });
    return parseResearch(reply.data, earlier.length > 0, clarifications.length > 0);
  } catch {
    return fallback;
  }
}
