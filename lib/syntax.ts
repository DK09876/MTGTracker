/**
 * Telling Scryfall syntax apart from everything else typed into search.
 *
 * Syntax goes straight to Scryfall; anything else is a card name or a
 * description and goes through the translator. Getting this wrong in the
 * direction of "syntax" costs a useless search, and in the direction of "not
 * syntax" costs a second of waiting on the model - so it only claims syntax
 * when it sees a real Scryfall keyword followed by an operator.
 *
 * Pure, so the search box can use it too without pulling in server code.
 */

// Scryfall's search keywords. An unknown `word:` in plain English ("note: I
// want dragons") must not count, so this is a list rather than a pattern.
const KEYWORDS = [
  'a', 'art', 'artist', 'atag', 'arttag', 'b', 'banned', 'block', 'border',
  'c', 'ci', 'cmc', 'cn', 'color', 'commander', 'cube', 'date', 'devotion',
  'direction', 'e', 'edition', 'f', 'flavor', 'fo', 'format', 'frame', 'ft',
  'function', 'game', 'has', 'id', 'identity', 'in', 'is', 'k', 'keyword',
  'kw', 'lang', 'legal', 'loy', 'loyalty', 'm', 'mana', 'manavalue', 'mv',
  'n', 'name', 'new', 'not', 'number', 'o', 'oracle', 'oracletag', 'order',
  'otag', 'pow', 'power', 'prefer', 'prints', 'produces', 'r', 'rarity',
  'restricted', 's', 'set', 'st', 'stamp', 't', 'tix', 'tou', 'toughness',
  'type', 'unique', 'usd', 'eur', 'watermark', 'wm', 'year',
];

const OPERATOR = String.raw`(?:!=|<=|>=|[:=<>])`;
const TERM = new RegExp(String.raw`(?:^|[\s(])-?(?:${KEYWORDS.join('|')})${OPERATOR}\S`, 'i');

// `!"Lightning Bolt"` and `!Fireball` are exact-name searches.
const EXACT_NAME = /(?:^|\s)!"?\w/;

export function looksLikeSyntax(input: string): boolean {
  return TERM.test(input) || EXACT_NAME.test(input);
}

/** An exact-name search for one card, as Scryfall writes it. */
export function exactName(name: string): string {
  return `!"${name.replace(/"/g, '')}"`;
}
