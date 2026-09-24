/**
 * Turning whatever was typed into search results.
 *
 *   Scryfall syntax        -> straight to Scryfall
 *   anything else          -> the model says what kind of search it is:
 *     one card by name     -> an exact-name search, then a fuzzy match
 *     combos               -> Commander Spellbook, then the pieces from Scryfall
 *     cards                -> a Scryfall query, scoped to the commander if any
 *
 * When a commander is named, the answer comes in views the page shows as
 * tabs: what that commander's decks actually play (EDHREC), every card that
 * fits (Scryfall), and combos (Commander Spellbook).
 *
 * The model plans; this runs the plan. A commander is looked up on Scryfall
 * rather than taken from the model's memory, and the model is shown its real
 * rules text - so "works well with Azula" is judged against what Azula does,
 * and a commander printed after the model was trained still works.
 *
 * A follow-up ("only instants") is planned against the search it follows,
 * so the model changes what was asked and keeps the rest.
 *
 * Every step is recorded, so the page can show exactly what ran. Everything
 * that talks to the network is passed in, so the routing can be tested
 * without Scryfall, Spellbook, EDHREC or a model.
 */

import { colours, describeQuery, isUnfiltered } from './describe';
import { edhrecUrl, type CardStats, type CommanderPage } from './edhrec';
import type { Context, Kind, Previous, Translation, Translator } from './gemini';
import type { ScryfallCard, SearchResult } from './scryfall';
import { imageOf, manaCostOf, oracleTextOf, ScryfallError, typeLineOf } from './scryfall';
import { DEFAULT_SORT, sortKey, sortLabel, splitSort, type Sort } from './sort';
import { SpellbookError, type Combo } from './spellbook';
import { exactName, looksLikeSyntax } from './syntax';

export interface CommanderRef {
  name: string;
  /** Colour identity as letters, e.g. "UBR". Empty for colourless. */
  identity: string;
  manaCost: string;
  edhrecUrl: string;
  image?: string | null;
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
  /** The order the card results are in. */
  sort?: Sort;
  /** What the EDHREC tab was narrowed by: only the conditions the request stated. */
  constraints?: string;
}

/** What a commander's decks play, from EDHREC, as the page's first tab. */
export interface EdhrecView {
  commander: string;
  /** Decks EDHREC has seen for this commander. */
  decks: number;
  url: string;
  cards: ScryfallCard[];
  /** Figures by Scryfall card id. */
  stats: Record<string, CardStats>;
  /** EDHREC's own lists when nothing narrowed them; one list of matches when the search did. */
  sections: Array<{ header: string; ids: string[] }>;
  /** True when the search's conditions narrowed EDHREC's list. */
  filtered: boolean;
}

export interface Interpreted extends SearchResult {
  interpretation: Interpretation;
  trace: Step[];
  combos?: Combo[];
  /** EDHREC figures for the Scryfall results, by card id, when a commander is named. */
  stats?: Record<string, CardStats>;
  edhrec?: EdhrecView;
  /**
   * The commander named could be several; the page asks which, then sends
   * `plan` back with the answer so the search carries on without asking the
   * model again.
   */
  choice?: { mention: string; options: CommanderRef[] };
  plan?: Translation;
}

/** A search paused to ask which commander was meant, resumed with the answer. */
export interface Resume {
  plan: Translation;
  commander: string;
}

export interface Deps {
  search: (query: string, sort?: Sort, page?: number) => Promise<SearchResult>;
  findCardNamed: (fuzzy: string) => Promise<ScryfallCard | null>;
  findCommanders: (mention: string) => Promise<ScryfallCard[]>;
  cardsNamed: (names: string[]) => Promise<ScryfallCard[]>;
  searchCombos: (query: string) => Promise<Combo[]>;
  /** Null unless EDHREC is switched on. */
  edhrec: ((commander: string) => Promise<CommanderPage | null>) | null;
  /** Null when no model is configured; searches then run as typed. */
  translate: Translator | null;
  /** The clock, so the time budget can be tested. */
  now?: () => number;
}

const EMPTY: SearchResult = { cards: [], totalCards: 0, hasMore: false };

// One translation, plus one retry that sees why the first failed. More than
// that is mostly the model guessing, at a second or more per guess.
const ATTEMPTS = 2;

// Scryfall stops parsing a query at around 1,000 characters, so EDHREC's
// card names are checked against a search in batches that fit.
const QUERY_BUDGET = 950;

// A search makes up to three model calls. When the model is slow each can
// take its full timeout, so the optional ones - the rules-text pass and the
// retry - are skipped once there is not time for one more.
const TIME_BUDGET_MS = 30_000;
const ONE_CALL_MS = 12_000;

// Past this many words, text is a sentence rather than a card name, and a
// name search for it is noise.
const NAME_WORDS = 5;

export async function interpret(input: string, deps: Deps, previous?: Previous, resume?: Resume): Promise<Interpreted> {
  const text = input.trim();
  const trace: Step[] = [];
  const now = deps.now ?? Date.now;
  const deadline = now() + TIME_BUDGET_MS;
  const timeForAnotherCall = () => deadline - now() > ONE_CALL_MS;
  if (!text) return { ...EMPTY, trace, interpretation: { via: 'syntax', kind: 'cards', query: '' } };

  if (!previous && !resume && looksLikeSyntax(text)) {
    trace.push({ text: 'Read as Scryfall syntax, so it ran as written without the AI' });
    const { filters, sort } = splitSort(text);
    const used = sort ?? DEFAULT_SORT;
    const result = await searchStep(filters, deps, trace, used);
    return { ...result, trace, interpretation: { via: 'syntax', kind: 'cards', query: filters, sort: used } };
  }

  if (!deps.translate) {
    if (previous) {
      return { ...EMPTY, trace, interpretation: { via: 'syntax', kind: 'cards', query: '', note: 'Follow-ups need the AI, and it is off (no GEMINI_API_KEY).' } };
    }
    return asTyped(text, deps, trace, 'AI search is off (no GEMINI_API_KEY), so this searched card names for what you typed.');
  }

  // A follow-up keeps the commander it had, so the model can be shown its
  // rules text in the first call instead of needing a second.
  const known = previous?.commander && !resume ? await findExactly(previous.commander, deps) : null;
  const context: Context = { previous, commander: known ? contextOf(known) : undefined };

  let plan: Translation;
  try {
    plan = resume?.plan ?? await deps.translate(text, context);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'the model failed';
    trace.push({ text: `Asked the AI what this means, but ${reason}` });
    if (previous) {
      return { ...EMPTY, trace, interpretation: { via: 'syntax', kind: 'cards', query: '', note: `AI search failed (${reason}). Try the follow-up again in a moment.` } };
    }
    return asTyped(text, deps, trace, `AI search failed (${reason}), so this searched card names for what you typed.`);
  }
  if (!resume) {
    trace.push({
      text: previous
        ? `Asked the AI to apply “${text}” to the previous search: ${summarise(plan)}`
        : `Asked the AI what “${text}” means: ${summarise(plan)}`,
    });
  }

  let commander: ScryfallCard | null = null;
  let grounded = false;
  if (resume) {
    commander = await findExactly(resume.commander, deps);
    trace.push({ text: `You picked ${commander?.name ?? resume.commander}` });
  } else if (plan.commander && known && sameCard(plan.commander, known.name)) {
    commander = known;
    grounded = true;
    trace.push({ text: `Kept the commander, ${known.name}` });
  } else if (plan.commander) {
    const found = await lookUpCommander(plan.commander, deps, trace);
    if (found && 'choices' in found) {
      return {
        ...EMPTY, trace, plan,
        choice: { mention: plan.commander, options: found.choices.map(refOf) },
        interpretation: { via: 'ai', kind: plan.kind, query: plan.query, explanation: plan.explanation || undefined },
      };
    }
    commander = found;
  }

  switch (plan.kind) {
    case 'card': return cardRoute(text, plan, deps, trace);
    case 'combos': return comboRoute(plan, commander, deps, trace);
    default: return cardsRoute(text, plan, commander, deps, trace, { previous, grounded, timeForAnotherCall });
  }
}

/**
 * Run a query as given, scoped to a commander if one is named - for an
 * edited query, a different sort, or a tab opened later. No model.
 */
export async function runQuery(
  query: string, commanderName: string | null, deps: Deps,
  sort: Sort | null = null, { withEdhrec = true, page = 1 } = {},
): Promise<Interpreted> {
  const trace: Step[] = [{ text: 'Ran the query without the AI' }];
  const commander = commanderName ? await findExactly(commanderName, deps) : null;
  // An `order:` typed into the query wins over the menu.
  const { filters, sort: typed } = splitSort(query);
  const edhrecPage = commander ? await pageFor(commander, deps, trace) : null;
  const { sort: used, ...result } = await runCards(filters, commander, edhrecPage, deps, trace, typed ?? sort ?? DEFAULT_SORT, page);
  // A later page of results only adds to the Scryfall tab.
  const edhrec = commander && edhrecPage && withEdhrec && page === 1
    ? await edhrecView(filters, commander, edhrecPage, deps, trace)
    : undefined;
  const interpretation: Interpretation = {
    via: 'syntax', kind: 'cards', query: filters, sort: used,
    commander: commander ? refOf(commander) : undefined,
  };
  return { ...result, trace, interpretation, edhrec };
}

/** Combos for a commander, for the Combos tab when it is opened later. */
export async function runCombos(commanderName: string, deps: Deps): Promise<Interpreted> {
  const trace: Step[] = [];
  const commander = await findExactly(commanderName, deps);
  const plan: Translation = { kind: 'combos', cardName: null, commander: commanderName, query: '', constraints: null, explanation: '' };
  return comboRoute(plan, commander, deps, trace);
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
    target = await deps.findCardNamed(plan.cardName) ?? await findExactly(plan.cardName, deps);
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
    return { ...EMPTY, trace, combos, interpretation: { ...interpretation, note: `Commander Spellbook has no combos${about}${within}.` } };
  }

  const cards = await deps.cardsNamed(combos.flatMap((c) => c.cards));
  trace.push({ text: `Fetched the ${cards.length} cards those combos use from Scryfall` });
  return { cards, totalCards: cards.length, hasMore: false, trace, interpretation, combos };
}

interface CardsOptions {
  previous?: Previous;
  /** The model has already seen the commander's rules text. */
  grounded: boolean;
  timeForAnotherCall: () => boolean;
}

async function cardsRoute(
  text: string, first: Translation, commander: ScryfallCard | null, deps: Deps, trace: Step[],
  { previous, grounded, timeForAnotherCall }: CardsOptions,
): Promise<Interpreted> {
  const context: Context = { previous, commander: commander ? contextOf(commander) : undefined };
  let plan = first;

  if (commander && !grounded) {
    if (!timeForAnotherCall()) {
      trace.push({ text: `The AI was too slow to also show it ${commander.name}'s rules text, so its first answer is used` });
    } else {
      // The first pass was written before anyone knew what the commander does.
      try {
        const reread = await deps.translate!(text, context);
        if (reread.kind === 'cards') {
          plan = reread;
          trace.push({ text: `Showed the AI ${commander.name}'s rules text and asked again` });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'it failed';
        trace.push({ text: `Tried to show the AI ${commander.name}'s rules text, but ${reason}; using its first answer` });
      }
    }
  }

  const ref = commander ? refOf(commander) : undefined;
  const page = commander ? await pageFor(commander, deps, trace) : null;
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

    const { filters, sort } = splitSort(plan.query);
    last = { via: 'ai', kind: 'cards', query: filters, explanation: plan.explanation || undefined, commander: ref };

    let result: SearchResult & { stats?: Record<string, CardStats> };
    try {
      const { sort: used, ...found } = await runCards(filters, commander, page, deps, trace, sort ?? DEFAULT_SORT);
      result = found;
      last = { ...last, sort: used };
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
    if (!commander && attempt === 0 && isUnfiltered(filters)) {
      unfiltered = { ...result, trace, interpretation: last };
      feedback = `${plan.query} matched ${result.totalCards} cards because it says nothing about what the `
        + 'cards are or do. Add the condition the request implies, or return the same query if it really '
        + 'asks for everything.';
      continue;
    }

    // The EDHREC tab takes only what was asked for, not the model's synergy guesses.
    const stated = plan.constraints === null ? filters : splitSort(plan.constraints).filters;
    const edhrec = commander && page ? await edhrecView(stated, commander, page, deps, trace) : undefined;
    return { ...result, trace, interpretation: { ...last, constraints: stated }, edhrec };
  }

  if (unfiltered) return unfiltered;
  if (!commander) {
    const named = await nearestName(text, deps, trace);
    if (named) return named;
  }
  return { ...EMPTY, trace, interpretation: last ?? { via: 'ai', kind: 'cards', query: '', commander: ref } };
}

// --- steps -----------------------------------------------------------------

async function searchStep(
  query: string, deps: Deps, trace: Step[], sort: Sort = DEFAULT_SORT, page = 1,
): Promise<SearchResult> {
  // Shown as the equivalent syntax, so the line can be pasted into Scryfall.
  const order = sortKey(sort) === 'name:auto' ? '' : ` order:${sort.order}${sort.dir === 'auto' ? '' : ` direction:${sort.dir}`}`;
  const step: Step = {
    text: page > 1 ? `Searched Scryfall, page ${page}` : 'Searched Scryfall',
    query: query + order,
    described: `${describeQuery(query)} · sorted by ${sortLabel(sort).toLowerCase()}`,
  };
  trace.push(step);
  try {
    const result = await deps.search(query, sort, page);
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

/** A commander's EDHREC page, noting in the trace when there is none. */
async function pageFor(commander: ScryfallCard, deps: Deps, trace: Step[]): Promise<CommanderPage | null> {
  if (!deps.edhrec) return null;
  const page = await deps.edhrec(commander.name);
  trace.push({
    text: page
      ? `Read EDHREC's page for ${commander.name}: ${page.decks.toLocaleString()} decks, ${page.stats.size} cards listed`
      : `EDHREC has no data for ${commander.name} yet`,
  });
  return page;
}

/**
 * Every card that fits, from Scryfall, scoped to the commander if there is
 * one. With EDHREC data, each card also carries how often that commander's
 * decks play it - shown on the tile, whatever the sort.
 */
async function runCards(
  filters: string, commander: ScryfallCard | null, edhrecPage: CommanderPage | null,
  deps: Deps, trace: Step[], sort: Sort, page = 1,
): Promise<SearchResult & { stats?: Record<string, CardStats>; sort: Sort }> {
  const result = await searchStep(scoped(filters, commander), deps, trace, sort, page);
  if (!edhrecPage) return { ...result, sort };
  return { ...result, sort, stats: statsById(result.cards, edhrecPage.stats) };
}

/**
 * What the commander's decks actually play, for the EDHREC tab.
 *
 * With no conditions this is EDHREC's own lists. With conditions ("green
 * ramp"), every card EDHREC lists is checked against the same Scryfall
 * search, in batches that fit Scryfall's query length, and the matches are
 * ranked by how many of the commander's decks run them. Only cards those
 * decks really play can appear here.
 */
async function edhrecView(
  filters: string, commander: ScryfallCard, page: CommanderPage, deps: Deps, trace: Step[],
): Promise<EdhrecView> {
  const names = [...page.stats.keys()];
  const base = { commander: commander.name, decks: page.decks, url: edhrecUrl(commander.name) };

  if (!filters.trim()) {
    const cards = await deps.cardsNamed(names);
    trace.push({ text: `Fetched the ${cards.length} cards EDHREC lists for ${commander.name} from Scryfall` });
    const idOf = nameIndex(cards);
    const sections = page.sections
      .map((s) => ({ header: s.header, ids: s.names.map(idOf).filter((id): id is string => !!id) }))
      .filter((s) => s.ids.length);
    return { ...base, cards, stats: statsById(cards, page.stats), sections, filtered: false };
  }

  const full = scoped(filters, commander);
  const found = new Map<string, ScryfallCard>();
  for (const batch of batches(full, names)) {
    try {
      for (const card of (await deps.search(batch, DEFAULT_SORT)).cards) found.set(card.id, card);
    } catch { /* one failed batch only costs its own cards */ }
  }
  const stats = statsById([...found.values()], page.stats);
  const cards = [...found.values()].sort((a, b) => (stats[b.id]?.inclusion ?? 0) - (stats[a.id]?.inclusion ?? 0));
  trace.push({
    text: `Checked all ${names.length} cards EDHREC lists for ${commander.name} against the same search`,
    described: describeQuery(full),
    count: cards.length,
  });
  return { ...base, cards, stats, sections: [{ header: 'Matching your search', ids: cards.map((c) => c.id) }], filtered: true };
}

function statsById(cards: ScryfallCard[], stats: Map<string, CardStats>): Record<string, CardStats> {
  const byId: Record<string, CardStats> = {};
  for (const card of cards) {
    const s = stats.get(card.name) ?? stats.get(front(card.name));
    if (s) byId[card.id] = s;
  }
  return byId;
}

/** Name -> card id, matching a double-faced card by either its full name or its front. */
function nameIndex(cards: ScryfallCard[]): (name: string) => string | undefined {
  const ids = new Map<string, string>();
  for (const card of cards) {
    ids.set(card.name, card.id);
    ids.set(front(card.name), card.id);
  }
  return (name) => ids.get(name) ?? ids.get(front(name));
}

const front = (name: string) => name.split(' // ')[0];

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
 * leave out the commander itself. The sort is not part of this: it travels
 * separately, as a Scryfall parameter.
 */
export function scoped(query: string, commander: ScryfallCard | null): string {
  if (!commander) return query;

  // Display options are not allowed inside parentheses, so they come out
  // before the rest is wrapped - and the rest is wrapped because Scryfall's
  // `or` binds looser than the terms added here.
  const display = query.match(DISPLAY) ?? [];
  const filters = query.replace(DISPLAY, ' ').replace(/\s+/g, ' ').trim();
  return [
    /\bor\b/i.test(filters) ? `(${filters})` : filters,
    `id<=${identityOf(commander).toLowerCase() || 'c'}`,
    /(^|[\s(])-?(f|format|legal):/i.test(filters) ? '' : 'f:commander',
    `-${exactName(commander.name)}`,
    ...display.map((d) => d.trim()),
  ].filter(Boolean).join(' ');
}

const DISPLAY = /(?:^|\s)(?:order|direction|unique|prefer|display):\S+/gi;

/**
 * Which commander a mention means, or the ones it could mean.
 *
 * A candidate has to match the mention word by word - "omnath" is Omnath,
 * Locus of Rage but not Henrika Domnathi, which only contains the letters.
 * One candidate, or one whose name is exactly what was written, is the
 * answer. Several equally good ones are a question for the user: guessing
 * "the most played Omnath" picked Locus of Rage when Locus of Creation was
 * meant, because Scryfall's popularity counts every deck a card is in, not
 * the decks it leads.
 */
export function pickCommander(mention: string, found: ScryfallCard[]): { card: ScryfallCard } | { choices: ScryfallCard[] } | null {
  const wanted = words(mention);
  const fits = found.filter((c) => wanted.every((w) => words(c.name).some((n) => n.startsWith(w))));
  // A fuzzy match for a typo will not fit word by word, and is still the answer.
  const pool = fits.length ? fits : found;
  if (!pool.length) return null;
  const exact = pool.find((c) => squash(c.name) === squash(mention) || squash(front(c.name)) === squash(mention));
  if (exact) return { card: exact };
  if (pool.length === 1) return { card: pool[0] };
  return { choices: pool.slice(0, MAX_CHOICES) };
}

const MAX_CHOICES = 8;
const words = (s: string) => s.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function lookUpCommander(
  mention: string, deps: Deps, trace: Step[],
): Promise<ScryfallCard | { choices: ScryfallCard[] } | null> {
  const picked = pickCommander(mention, await deps.findCommanders(mention));
  if (picked && 'choices' in picked) {
    trace.push({ text: `“${mention}” could be ${picked.choices.length} commanders, so this asks which` });
    return picked;
  }
  const card = picked?.card ?? null;
  trace.push({
    text: card
      ? `Looked up commander “${mention}” on Scryfall → ${card.name} (${colours(identityOf(card)) || 'colourless'})`
      : `Could not find a commander called “${mention}” on Scryfall, so this searched without one`,
  });
  return card;
}

/** A commander named in full - one already picked or kept - without asking again. */
async function findExactly(name: string, deps: Deps): Promise<ScryfallCard | null> {
  const picked = pickCommander(name, await deps.findCommanders(name));
  if (!picked) return null;
  return 'card' in picked ? picked.card : picked.choices[0];
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

/** "azula" names Fire Lord Azula; "Fire Lord Azula" does too. */
function sameCard(mention: string, name: string): boolean {
  const a = mention.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return !!a && (b.includes(a) || a.includes(b));
}

const WUBRG = 'WUBRG';
const identityOf = (card: ScryfallCard) =>
  [...(card.color_identity ?? [])].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('');

function refOf(card: ScryfallCard): CommanderRef {
  return {
    name: card.name, identity: identityOf(card), manaCost: manaCostOf(card),
    edhrecUrl: edhrecUrl(card.name), image: imageOf(card, 'small'),
  };
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
