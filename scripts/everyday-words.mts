/**
 * Writes lib/everyday-words.ts: the everyday English words that are also words of some card's name ("really",
 * "flicker", "wrath"), so the owner's lower-case "flicker effect" isn't taken for the card Flicker. Run now and then
 * (new sets add names):
 *
 *   npx tsx scripts/everyday-words.mts [data/rules/card-names.json]
 *
 * The words come from Webster's Second International (1913/1934, public domain), as /usr/share/dict/web2 on macOS:
 * its lower-case entries only (capitalised ones are proper names).
 */

import { readFileSync, writeFileSync } from 'fs';

import { nameIndex } from '../lib/card-names';

const namesFile = process.argv[2] ?? 'data/rules/card-names.json';
const names = JSON.parse(readFileSync(namesFile, 'utf8')) as string[];
const nameWords = nameIndex(names).words;
const english = readFileSync('/usr/share/dict/web2', 'utf8').split('\n').filter((w) => /^[a-z]{2,}$/.test(w));
const everyday = [...new Set(english.filter((w) => nameWords.has(w)))].sort();

writeFileSync('lib/everyday-words.ts', `/**
 * Everyday English words that are also words of some card's name (${everyday.length} of them). Written by
 * scripts/everyday-words.mts from Webster's Second International (public domain) and Scryfall's card names; a
 * lower-case one is a word, not a card (lib/card-names.ts). Don't edit by hand: run the script again.
 */
export const EVERYDAY_WORDS: ReadonlySet<string> = new Set(${JSON.stringify(everyday.join(' '))}.split(' '));
`);
console.log(`${everyday.length} words`);
