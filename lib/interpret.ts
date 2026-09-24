/**
 * Turning whatever was typed into search results.
 *
 *   Scryfall syntax      -> straight to Scryfall
 *   anything else        -> translated to syntax by the model, then Scryfall
 *   a bad or empty query -> back to the model once, with Scryfall's answer
 *   still nothing        -> Scryfall's fuzzy name match, as a last resort
 *
 * The fuzzy match is last on purpose: it is generous enough that "green
 * ramp" finds Greenbelt Rampager, so trying it first would hijack sentences.
 *
 * Everything that talks to the network is passed in, so the routing can be
 * tested without Scryfall or a model.
 */

import type { Translation } from './gemini';
import type { ScryfallCard, SearchResult } from './scryfall';
import { ScryfallError } from './scryfall';
import { exactName, looksLikeSyntax } from './syntax';

export interface Interpretation {
  /** How the input was read: as syntax, by the model, or as a misspelled name. */
  via: 'syntax' | 'ai' | 'name';
  /** The query Scryfall actually ran, so it can be shown and edited. */
  query: string;
  explanation?: string;
  /** Something the user should know about how this search went. */
  note?: string;
}

export interface Interpreted extends SearchResult {
  interpretation: Interpretation;
}

export interface Deps {
  search: (query: string) => Promise<SearchResult>;
  findCardNamed: (fuzzy: string) => Promise<ScryfallCard | null>;
  /** Null when no model is configured; searches then run as typed. */
  translate: ((request: string, feedback?: string) => Promise<Translation>) | null;
}

const EMPTY: SearchResult = { cards: [], totalCards: 0, hasMore: false };

// One translation, plus one retry that sees why the first failed. More than
// that is mostly the model guessing, at a second or two per guess.
const ATTEMPTS = 2;

export async function interpret(input: string, deps: Deps): Promise<Interpreted> {
  const text = input.trim();
  if (!text) return { ...EMPTY, interpretation: { via: 'syntax', query: '' } };

  if (looksLikeSyntax(text)) {
    return { ...(await deps.search(text)), interpretation: { via: 'syntax', query: text } };
  }

  if (!deps.translate) {
    return asTyped(text, deps, 'AI search is off (no GEMINI_API_KEY), so this searched card names for what you typed.');
  }

  let feedback: string | undefined;
  let last: Interpretation | undefined;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let translation: Translation;
    try {
      translation = await deps.translate(text, feedback);
    } catch (error) {
      // A failed retry still leaves the first attempt's answer, which is
      // better than a plain name search.
      if (last) break;
      const reason = error instanceof Error ? error.message : 'the model failed';
      return asTyped(text, deps, `AI search failed (${reason}), so this searched card names for what you typed.`);
    }

    const query = translation.cardName
      ? exactName(translation.cardName)
      : await withCommander(translation, deps);
    last = { via: 'ai', query, explanation: translation.explanation || undefined };

    try {
      const result = await deps.search(query);
      if (result.totalCards > 0) return { ...result, interpretation: last };
      feedback = `Scryfall found no cards for ${query}. Loosen it: drop the least important condition, `
        + 'and only use otag values from the list.';
    } catch (error) {
      if (!(error instanceof ScryfallError) || error.status !== 400) throw error;
      feedback = `Scryfall rejected ${query}: ${error.message}`;
      last = { ...last, note: `Scryfall could not run this query: ${error.message}` };
    }
  }

  const named = await deps.findCardNamed(text);
  if (named) {
    return {
      cards: [named],
      totalCards: 1,
      hasMore: false,
      interpretation: {
        via: 'name',
        query: exactName(named.name),
        note: 'Nothing matched that as a description, so this is the closest card name.',
      },
    };
  }

  return { ...EMPTY, interpretation: last ?? { via: 'ai', query: '' } };
}

/**
 * Add the commander's real colour identity to a translated query.
 *
 * The model is asked for the commander's name, not its colours. It knows the
 * name far more reliably, and Scryfall knows the colours exactly - including
 * for commanders printed after the model was trained.
 */
async function withCommander(translation: Translation, deps: Deps): Promise<string> {
  if (!translation.commander) return translation.query;
  const commander = await deps.findCardNamed(translation.commander);
  if (!commander?.color_identity) return translation.query;
  const identity = commander.color_identity.join('').toLowerCase() || 'c';
  return `${translation.query} id<=${identity}`;
}

/** No usable translation: search Scryfall for the text itself, then its nearest name. */
async function asTyped(text: string, deps: Deps, note: string): Promise<Interpreted> {
  const result = await deps.search(text).catch((error) => {
    if (error instanceof ScryfallError && error.status === 400) return EMPTY;
    throw error;
  });
  if (result.totalCards > 0) return { ...result, interpretation: { via: 'syntax', query: text, note } };

  const named = await deps.findCardNamed(text);
  if (named) {
    return {
      cards: [named],
      totalCards: 1,
      hasMore: false,
      interpretation: { via: 'name', query: exactName(named.name), note },
    };
  }
  return { ...EMPTY, interpretation: { via: 'syntax', query: text, note } };
}
