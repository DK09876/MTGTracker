/**
 * Turning whatever was typed into search results.
 *
 *   Scryfall syntax        -> straight to Scryfall
 *   anything else          -> the model says what kind of search it is:
 *     one card by name     -> an exact-name search, then a fuzzy match
 *     combos               -> Commander Spellbook, then the pieces from Scryfall
 *     cards                -> a Scryfall query, scoped to the commander if any
 *
 * The model plans; this runs the plan. A commander is looked up on Scryfall
 * rather than taken from the model's memory, and when there is one the model
 * is shown its real rules text and asked again - so "works well with Azula"
 * is judged against what Azula actually does, and a commander printed after
 * the model was trained still works.
 *
 * Every step is recorded, so the page can show exactly what ran. Everything
 * that talks to the network is passed in, so the routing can be tested
 * without Scryfall, Spellbook, EDHREC or a model.
 */

import { colours, describeQuery, isUnfiltered } from './describe';
import { edhrecUrl, type CardStats, type CommanderStats } from './edhrec';
import type { Context, Kind, Translation, Translator } from './gemini';
import type { ScryfallCard, SearchResult } from './scryfall';
import { manaCostOf, oracleTextOf, ScryfallError, typeLineOf } from './scryfall';
import { SpellbookError, type Combo } from './spellbook';
import { exactName, looksLikeSyntax } from './syntax';

export interface CommanderRef {
  name: string;
  /** Colour identity as letters, e.g. "UBR". Empty for colourless. */
  identity: string;
  manaCost: string;
  edhrecUrl: string;
}

/** One thing that happened while answering a search, for "How this search ran". */
export interface Step {
  text: string;
  /** The query sent, when this step was a search. */
  query?: string;
  /** That query in plain English. */
  described?: string;
  /** How many results it found. */
  count?: number;
  /** What those results were, when not cards. */
  unit?: 'combo';
}

export interface Interpretation {
  /** How the input was read: as syntax, by the model, or as a misspelled name. */
  via: 'syntax' | 'ai' | 'name';
  kind: Kind;
  /**
   * The query to show and let the user edit. For a commander search this is
   * without the commander's scoping, which is added again when it is re-run.
   */
  query: string;
  explanation?: string;
  /** Something the user should know about how this search went. */
  note?: string;
  commander?: CommanderRef;
}

export interface Interpreted extends SearchResult {
  interpretation: Interpretation;
  trace: Step[];
  combos?: Combo[];
  /** EDHREC figures by Scryfall card id, when EDHREC is switched on and knows the commander. */
  stats?: Record<string, CardStats>;
}

export interface Deps {
  search: (query: string) => Promise<SearchResult>;
  findCardNamed: (fuzzy: string) => Promise<ScryfallCard | null>;
  findCommander: (mention: string) => Promise<ScryfallCard | null>;
  cardsNamed: (names: string[]) => Promise<ScryfallCard[]>;
  searchCombos: (query: string) => Promise<Combo[]>;
  /** Null unless EDHREC is switched on. */
  commanderStats: ((commander: string) => Promise<CommanderStats | null>) | null;
  /** Null when no model is configured; searches then run as typed. */
  translate: Translator | null;
  /** The clock, so the time budget can be tested. */
  now?: () => number;
}

const EMPTY: SearchResult = { cards: [], totalCards: 0, hasMore: false };

// One translation, plus one retry that sees why the first failed. More than
// that is mostly the model guessing, at a second or more per guess.
const ATTEMPTS = 2;

// How many of a commander's EDHREC cards to check against a search, and how
// long one check may be - Scryfall stops parsing at around 1,000 characters.
const EDHREC_CANDIDATES = 90;
const QUERY_BUDGET = 950;

// A search makes up to three model calls. When the model is slow each can
// take its full timeout, so the optional ones - the rules-text pass and the
// retry - are skipped once there is not time for one more.
const TIME_BUDGET_MS = 30_000;
const ONE_CALL_MS = 12_000;

// Past this many words, text is a sentence rather than a card name, and a
// name search for it is noise.
const NAME_WORDS = 5;

export async function interpret(input: string, deps: Deps): Promise<Interpreted> {
  const text = input.trim();
  const trace: Step[] = [];
  const now = deps.now ?? Date.now;
  const deadline = now() + TIME_BUDGET_MS;
  const timeForAnotherCall = () => deadline - now() > ONE_CALL_MS;
  if (!text) return { ...EMPTY, trace, interpretation: { via: 'syntax', kind: 'cards', query: '' } };

  if (looksLikeSyntax(text)) {
    trace.push({ text: 'Read as Scryfall syntax, so it ran as written without the AI' });
    const result = await searchStep(text, deps, trace);
    return { ...result, trace, interpretation: { via: 'syntax', kind: 'cards', query: text } };
  }

  if (!deps.translate) {
    return asTyped(text, deps, trace, 'AI search is off (no GEMINI_API_KEY), so this searched card names for what you typed.');
  }

  let plan: Translation;
  try {
    plan = await deps.translate(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'the model failed';
    trace.push({ text: `Asked the AI what this means, but ${reason}` });
    return asTyped(text, deps, trace, `AI search failed (${reason}), so this searched card names for what you typed.`);
  }
  trace.push({ text: `Asked the AI what “${text}” means: ${summarise(plan)}` });

  const commander = plan.commander ? await lookUpCommander(plan.commander, deps, trace) : null;

  switch (plan.kind) {
    case 'card': return cardRoute(text, plan, deps, trace);
    case 'combos': return comboRoute(plan, commander, deps, trace);
    default: return cardsRoute(text, plan, commander, deps, trace, timeForAnotherCall);
  }
}

/**
 * Run a query as given, scoped to a commander if one is named - for a query
 * the user has edited. No model is involved.
 */
export async function runQuery(query: string, commanderName: string | null, deps: Deps): Promise<Interpreted> {
  const trace: Step[] = [{ text: 'Ran your edited query, without the AI' }];
  const commander = commanderName ? await lookUpCommander(commanderName, deps, trace) : null;
  const interpretation: Interpretation = {
    via: 'syntax', kind: 'cards', query, commander: commander ? refOf(commander) : undefined,
  };
  const result = await runCards(query, commander, deps, trace);
  return { ...result, trace, interpretation };
}

// --- routes ----------------------------------------------------------------

async function cardRoute(text: string, plan: Translation, deps: Deps, trace: Step[]): Promise<Interpreted> {
  const query = exactName(plan.cardName!);
  const interpretation: Interpretation = {
    via: 'ai', kind: 'card', query, explanation: plan.explanation || undefined,
  };
  const result = await searchStep(query, deps, trace).catch(rejectedAs(EMPTY));
  if (result.totalCards > 0) return { ...result, trace, interpretation };

  // The model may have "corrected" the name into one that does not exist.
  return (await nearestName(plan.cardName!, deps, trace))
    ?? (await nearestName(text, deps, trace))
    ?? { ...EMPTY, trace, interpretation };
}

async function comboRoute(
  plan: Translation, commander: ScryfallCard | null, deps: Deps, trace: Step[],
): Promise<Interpreted> {
  let target = commander;
  if (plan.cardName) {
    target = await deps.findCardNamed(plan.cardName) ?? await deps.findCommander(plan.cardName);
    trace.push({
      text: target
        ? `Looked up “${plan.cardName}” on Scryfall → ${target.name}`
        : `Could not find a card called “${plan.cardName}” on Scryfall`,
    });
  }

  const interpretation: Interpretation = {
    via: 'ai', kind: 'combos', query: '', explanation: plan.explanation || undefined,
    commander: commander ? refOf(commander) : undefined,
  };
  if (!target && !plan.query) {
    return { ...EMPTY, trace, interpretation: { ...interpretation, note: 'Could not work out which card to find combos for.' } };
  }

  const scope = [
    target && `card:"${target.name.replace(/"/g, '')}"`,
    commander && `coloridentity<=${identityOf(commander) || 'C'}`,
    commander && 'legal:commander',
  ].filter(Boolean).join(' ');

  let query = [scope, plan.query].filter(Boolean).join(' ');
  let combos: Combo[];
  try {
    combos = await comboStep(query, deps, trace);
  } catch (error) {
    // The model's extra terms are the only part that can be malformed; the
    // scope is ours. Drop them rather than spend another model call.
    if (!(error instanceof SpellbookError) || error.status !== 400 || !plan.query || !scope) throw error;
    query = scope;
    combos = await comboStep(query, deps, trace);
  }
  interpretation.query = query;

  if (!combos.length) {
    const about = target ? ` for ${target.name}` : '';
    const within = commander && target !== commander ? ` in ${commander.name}'s colours` : '';
    return { ...EMPTY, trace, interpretation: { ...interpretation, note: `Commander Spellbook has no combos${about}${within}.` } };
  }

  const cards = await deps.cardsNamed(combos.flatMap((c) => c.cards));
  trace.push({ text: `Fetched the ${cards.length} cards those combos use from Scryfall` });
  return { cards, totalCards: cards.length, hasMore: false, trace, interpretation, combos };
}

async function cardsRoute(
  text: string, first: Translation, commander: ScryfallCard | null, deps: Deps, trace: Step[],
  timeForAnotherCall: () => boolean,
): Promise<Interpreted> {
  const context: Context = commander ? { commander: contextOf(commander) } : {};
  let plan = first;

  if (commander && !timeForAnotherCall()) {
    trace.push({ text: `The AI was too slow to also show it ${commander.name}'s rules text, so its first answer is used` });
  } else if (commander) {
    // The first pass was written before anyone knew what the commander does.
    try {
      const grounded = await deps.translate!(text, context);
      if (grounded.kind === 'cards') {
        plan = grounded;
        trace.push({ text: `Showed the AI ${commander.name}'s rules text and asked again` });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'it failed';
      trace.push({ text: `Tried to show the AI ${commander.name}'s rules text, but ${reason}; using its first answer` });
    }
  }

  const ref = commander ? refOf(commander) : undefined;
  let last: Interpretation | undefined;
  let unfiltered: Interpreted | undefined;
  let feedback: string | undefined;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) {
      if (!timeForAnotherCall()) {
        trace.push({ text: 'The AI was too slow to ask it to try again' });
        break;
      }
      try {
        plan = await deps.translate!(text, { ...context, feedback });
        trace.push({ text: 'Asked the AI to try again, with the reason' });
      } catch {
        trace.push({ text: 'Asked the AI to try again, but it failed' });
        break;
      }
      if (plan.kind !== 'cards') break;
    }

    last = { via: 'ai', kind: 'cards', query: plan.query, explanation: plan.explanation || undefined, commander: ref };

    let result: SearchResult & { stats?: Record<string, CardStats> };
    try {
      result = await runCards(plan.query, commander, deps, trace);
    } catch (error) {
      if (!(error instanceof ScryfallError) || error.status !== 400) throw error;
      feedback = `Scryfall rejected ${plan.query}: ${error.message}`;
      last = { ...last, note: `Scryfall could not run this query: ${error.message}` };
      continue;
    }

    if (result.totalCards === 0) {
      feedback = `Scryfall found no cards for ${plan.query}. Loosen it: drop the least important `
        + 'condition, and only use otag values from the list.';
      continue;
    }

    // A query that only sets format or order matches most of Magic. Worth
    // one more try; if the model insists, it may be what was meant.
    if (!commander && attempt === 0 && isUnfiltered(plan.query)) {
      unfiltered = { ...result, trace, interpretation: last };
      feedback = `${plan.query} matched ${result.totalCards} cards because it says nothing about what the `
        + 'cards are or do. Add the condition the request implies, or return the same query if it really '
        + 'asks for everything.';
      continue;
    }

    return { ...result, trace, interpretation: last };
  }

  if (unfiltered) return unfiltered;
  if (!commander) {
    const named = await nearestName(text, deps, trace);
    if (named) return named;
  }
  return { ...EMPTY, trace, interpretation: last ?? { via: 'ai', kind: 'cards', query: '', commander: ref } };
}

// --- steps -----------------------------------------------------------------

async function searchStep(query: string, deps: Deps, trace: Step[]): Promise<SearchResult> {
  const step: Step = { text: 'Searched Scryfall', query, described: describeQuery(query) };
  trace.push(step);
  try {
    const result = await deps.search(query);
    step.count = result.totalCards;
    return result;
  } catch (error) {
    step.text = `Searched Scryfall, which said: ${error instanceof Error ? error.message : 'it failed'}`;
    throw error;
  }
}

async function comboStep(query: string, deps: Deps, trace: Step[]): Promise<Combo[]> {
  const step: Step = { text: 'Asked Commander Spellbook for combos', query, unit: 'combo' };
  trace.push(step);
  try {
    const combos = await deps.searchCombos(query);
    step.count = combos.length;
    return combos;
  } catch (error) {
    step.text = `Asked Commander Spellbook for combos, which said: ${error instanceof Error ? error.message : 'it failed'}`;
    throw error;
  }
}

/** A Scryfall search for cards, scoped to a commander and ranked by EDHREC when there is one. */
async function runCards(
  query: string, commander: ScryfallCard | null, deps: Deps, trace: Step[],
): Promise<SearchResult & { stats?: Record<string, CardStats> }> {
  const full = scoped(query, commander);
  const result = await searchStep(full, deps, trace);
  if (!commander || !deps.commanderStats || result.totalCards === 0) return result;

  const stats = await deps.commanderStats(commander.name);
  if (!stats) {
    trace.push({ text: `EDHREC had nothing for ${commander.name}, so results are in overall Commander popularity order` });
    return result;
  }
  return rankByEdhrec(full, result, commander, stats, deps, trace);
}

/**
 * Put the cards a commander's decks actually play first.
 *
 * The first page of a broad search is only the most popular cards overall,
 * so a card that is niche everywhere except in this commander's decks may
 * not be on it. Its EDHREC cards are checked against the same search in a
 * few batches, and the ones that match are added.
 */
async function rankByEdhrec(
  full: string, result: SearchResult, commander: ScryfallCard, stats: CommanderStats,
  deps: Deps, trace: Step[],
): Promise<SearchResult & { stats: Record<string, CardStats> }> {
  const statFor = (card: ScryfallCard) => stats.get(card.name) ?? stats.get(card.name.split(' // ')[0]);
  const shown = new Set(result.cards.map((c) => c.name.split(' // ')[0]));

  const candidates = [...stats.entries()]
    .filter(([name]) => !shown.has(name.split(' // ')[0]))
    .sort(([, a], [, b]) => b.inclusion - a.inclusion)
    .slice(0, EDHREC_CANDIDATES)
    .map(([name]) => name);

  const extra: ScryfallCard[] = [];
  for (const batch of batches(full, candidates)) {
    try {
      extra.push(...(await deps.search(batch)).cards);
    } catch { /* one failed batch only costs its own cards */ }
  }
  trace.push({
    text: `Checked ${candidates.length} of the cards ${commander.name}'s decks play most on EDHREC against the `
      + `same search, and found ${extra.length} more`,
  });

  const cards = [...result.cards, ...extra];
  const byId: Record<string, CardStats> = {};
  for (const card of cards) {
    const s = statFor(card);
    if (s) byId[card.id] = s;
  }
  // Stable sort: EDHREC-known cards by how often they are played, then the
  // rest in Scryfall's order.
  const order = new Map(cards.map((c, i) => [c.id, i]));
  cards.sort((a, b) => {
    const sa = byId[a.id]?.inclusion ?? -1;
    const sb = byId[b.id]?.inclusion ?? -1;
    return sb - sa || order.get(a.id)! - order.get(b.id)!;
  });
  return { ...result, cards, stats: byId };
}

/** `full` plus an exact-name group, as many names per query as fit. */
function batches(full: string, names: string[]): string[] {
  const out: string[] = [];
  let group: string[] = [];
  const build = (g: string[]) => `${full} (${g.map(exactName).join(' or ')})`;
  for (const name of names) {
    if (group.length && build([...group, name]).length > QUERY_BUDGET) {
      out.push(build(group));
      group = [];
    }
    group.push(name);
  }
  if (group.length) out.push(build(group));
  return out;
}

/**
 * Add a commander's colour identity and Commander legality to a query, and
 * leave out the commander itself. With or without one, sort by how much a
 * card is played unless the query says otherwise - Scryfall's own default is
 * alphabetical, which put "Abomination" first in "new red cards".
 */
export function scoped(query: string, commander: ScryfallCard | null): string {
  const display = query.match(DISPLAY) ?? [];
  const order = display.some((d) => /order:/i.test(d)) ? '' : 'order:edhrec';
  if (!commander) return [query, order].filter(Boolean).join(' ');

  // Sorting and display options are not allowed inside parentheses, so they
  // come out before the rest is wrapped - and the rest is wrapped because
  // Scryfall's `or` binds looser than the terms added here.
  const filters = query.replace(DISPLAY, ' ').replace(/\s+/g, ' ').trim();
  return [
    /\bor\b/i.test(filters) ? `(${filters})` : filters,
    `id<=${identityOf(commander).toLowerCase() || 'c'}`,
    /(^|[\s(])-?(f|format|legal):/i.test(filters) ? '' : 'f:commander',
    `-${exactName(commander.name)}`,
    ...display.map((d) => d.trim()),
    order,
  ].filter(Boolean).join(' ');
}

const DISPLAY = /(?:^|\s)(?:order|direction|unique|prefer|display):\S+/gi;

async function lookUpCommander(mention: string, deps: Deps, trace: Step[]): Promise<ScryfallCard | null> {
  const card = await deps.findCommander(mention);
  trace.push({
    text: card
      ? `Looked up commander “${mention}” on Scryfall → ${card.name} (${colours(identityOf(card)) || 'colourless'})`
      : `Could not find a commander called “${mention}” on Scryfall, so this searched without one`,
  });
  return card;
}

async function nearestName(text: string, deps: Deps, trace: Step[]): Promise<Interpreted | null> {
  const named = await deps.findCardNamed(text);
  trace.push({
    text: named
      ? `Nothing matched, so tried the closest card name to “${text}” → ${named.name}`
      : `Nothing matched, and no card name is close to “${text}”`,
  });
  if (!named) return null;
  return {
    cards: [named], totalCards: 1, hasMore: false, trace,
    interpretation: {
      via: 'name', kind: 'card', query: exactName(named.name),
      note: 'Nothing matched that as a description, so this is the closest card name.',
    },
  };
}

/** No usable plan: search Scryfall for the text itself, then its nearest name. */
async function asTyped(text: string, deps: Deps, trace: Step[], note: string): Promise<Interpreted> {
  const interpretation: Interpretation = { via: 'syntax', kind: 'cards', query: text, note };
  if (text.split(/\s+/).length > NAME_WORDS) {
    return {
      ...EMPTY, trace,
      interpretation: { ...interpretation, query: '', note: `${note.split(', so ')[0]}. Try again in a moment, or use Scryfall syntax.` },
    };
  }
  const result = await searchStep(text, deps, trace).catch(rejectedAs(EMPTY));
  if (result.totalCards > 0) return { ...result, trace, interpretation };

  const named = await nearestName(text, deps, trace);
  if (named) return { ...named, interpretation: { ...named.interpretation, note } };
  return { ...EMPTY, trace, interpretation };
}

// --- helpers ---------------------------------------------------------------

/** Treat a Scryfall 400 (bad syntax) as a fallback value; let anything else through. */
const rejectedAs = <T>(fallback: T) => (error: unknown): T => {
  if (error instanceof ScryfallError && error.status === 400) return fallback;
  throw error;
};

const WUBRG = 'WUBRG';
const identityOf = (card: ScryfallCard) =>
  [...(card.color_identity ?? [])].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('');

function refOf(card: ScryfallCard): CommanderRef {
  return { name: card.name, identity: identityOf(card), manaCost: manaCostOf(card), edhrecUrl: edhrecUrl(card.name) };
}

function contextOf(card: ScryfallCard): NonNullable<Context['commander']> {
  return { name: card.name, manaCost: manaCostOf(card), typeLine: typeLineOf(card), text: oracleTextOf(card) };
}

function summarise(plan: Translation): string {
  switch (plan.kind) {
    case 'card': return `one card, “${plan.cardName}”`;
    case 'combos': return `combos${plan.cardName ? ` with ${plan.cardName}` : ''}${plan.commander ? ` for commander “${plan.commander}”` : ''}`;
    default: return `cards${plan.commander ? ` for commander “${plan.commander}”` : ''}`;
  }
}
