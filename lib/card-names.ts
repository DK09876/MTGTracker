/**
 * Reading the owner's words for cards (AGENTS.md, "Reading the owner's words"), without a model: what they typed
 * - a rules question, a search - is matched against the name of every card (Scryfall's catalog, fetched once a
 * day: cardNameIndex in lib/cards.ts). Longest names first, so "Blade of Selves" is one card, not a blade.
 *
 * A word that begins more than one card's name - "kratos" - is a question
 * back: which Kratos? A word that is ordinary English or rules language -
 * "creature", "board", "fog" in lower case - is not taken for a card.
 *
 * A misspelt name - "Innaiz, the gale force" - is offered as "did you mean",
 * never taken: one letter off (two in a long word) from a word of a name.
 * The page shows the choices with components/CardChoice.tsx before any AI call.
 *
 * Pure: safe in the browser. Server code gets the index and the rules' words with mentionsIn (lib/cards.ts).
 */

/** A pick for a "did you mean" that says none of the cards: the question is answered without one. */
export const NOT_A_CARD = '-';

/** A choice to put to the owner, with the cards' pictures (components/CardChoice.tsx). */
export interface NamedChoice {
  mention: string;
  /** The words looked like a misspelt name: "did you mean", with "None of these". */
  typo?: boolean;
  options: Array<{ name: string; image: string | null }>;
}

export interface Mentions {
  /** Cards named in full, by their exact names. */
  cards: string[];
  /** Words that could be several cards. */
  ambiguous: Array<{ mention: string; options: string[]; typo?: boolean }>;
}

// Words that are also card names, or begin many, but are far more often just
// words in a rules question.
const COMMON = new Set((
  'a about above after again against all am an and any are as at be because been before being below between both but by '
  + 'can could did do does doing down during each few for from further had has have having he her here hers him his how i if '
  + 'in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should '
  + 'so some such than that the their them then there these they this those through to too under until up very was we were '
  + 'what when where which while who whom why will with would you your yours interact interacts interaction work works happen '
  + 'happens get gets getting got whole entire both same ruling rulings rule rules question judge '
  + 'creature creatures board wipe wiped wipes token tokens copy copies ability abilities trigger triggers triggered land lands '
  + 'spell spells card cards deck graveyard battlefield player players opponent opponents commander counter counters attack '
  + 'attacks attacking block blocks blocking combat turn turns mana cast casting equipment equip equipped sacrifice destroy '
  + 'destroyed exile exiled return draw discard legendary artifact enchantment instant sorcery planeswalker target targets '
  + 'damage life dies die dying death dead kill killed stack priority phase step upkeep end beginning control controller '
  + 'owner hand library zone first strike double flying haste trample deathtouch lifelink vigilance reach hexproof shroud '
  + 'indestructible ward protection fog shock opt act storm cascade flash flashback kicker fight fights fear doom rampage '
  + 'time day night light dark fire water earth wind wild life death blood gold silver iron stone bone shadow spirit '
  // Contractions: "can't" began Can't Quite Recall and Can't Stay Away, and asked which (2026-09-30).
  + "can't cannot don't doesn't didn't won't isn't aren't wasn't weren't couldn't shouldn't wouldn't it's i'm i've that's what's there's"
).split(' '));

const normalise = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface NameIndex {
  /** Normalised full name (or a double-faced card's front) -> the name. */
  full: Map<string, string>;
  /** First word of a name -> names that start with it. */
  first: Map<string, string[]>;
  longest: number;
  /** Every word of every name. */
  words: Set<string>;
  /** Name words of 4+ letters by length, to check a typo against (a few ms a word, and nothing kept beside the words). */
  byLength: Map<number, string[]>;
}

/** One edit apart: a letter added, taken out or changed, or two side by side swapped. Linear, for the scan over every name word. */
function oneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** Edits between two words: a letter added, taken out, changed, or two side by side swapped. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

export function nameIndex(names: string[]): NameIndex {
  const full = new Map<string, string>();
  const first = new Map<string, string[]>();
  let longest = 1;
  for (const name of names) {
    const fronts = [name, ...(name.includes(' // ') ? [name.split(' // ')[0]] : [])];
    for (const n of fronts) {
      const key = normalise(n);
      // A question's "teferi's" is read as "teferi", and "thassas" is typed for "thassa's": both find the name.
      for (const k of [key, key.replace(/'s\b/g, ''), key.replace(/'/g, '')]) if (!full.has(k)) full.set(k, name);
      longest = Math.max(longest, key.split(' ').length);
    }
    const w = normalise(name).split(' ')[0];
    if (w) first.set(w, [...(first.get(w) ?? []), name]);
  }
  const words = new Set([...full.keys()].flatMap((k) => k.split(' ')));
  const byLength = new Map<number, string[]>();
  for (const w of words) {
    if (w.length < 4 || /\d/.test(w)) continue;
    byLength.set(w.length, [...(byLength.get(w.length) ?? []), w]);
  }
  return { full, first, longest: Math.min(longest, 10), words, byLength };
}

/** Name words a typed word is likely a misspelling of: one edit off, or else two in a word of 9+ letters with the same first letter. */
function closeWords(w: string, index: NameIndex): string[] {
  const one: string[] = [];
  const two: string[] = [];
  for (let len = w.length - 2; len <= w.length + 2; len++) {
    for (const c of index.byLength.get(len) ?? []) {
      if (Math.abs(len - w.length) <= 1 && oneEdit(w, c)) one.push(c);
      else if (w.length >= 9 && c[0] === w[0] && distance(w, c) === 2) two.push(c);
    }
  }
  // Two letters off only when nothing is one off.
  return one.length ? one : two;
}

/**
 * `ordinary`: words of the game's own language - every word of the
 * Comprehensive Rules - which are only a card when written with a capital:
 * "copied by a clone" is a clone effect, "copied by Clone" is the card.
 */
export function findMentions(question: string, index: NameIndex, ordinary: Set<string> = new Set(), { asName = false } = {}): Mentions {
  const plain = (w: string) => COMMON.has(w) || ordinary.has(w);
  // A capital means a name, except at the start of the question. `asName`: the text is meant as a card's name.
  const capital = (i: number) => asName || (i > 0 && /^[A-Z]/.test(raw[i]));
  const shortest = asName ? 4 : 5;
  // Keep the words as typed, to know which were capitalised.
  const raw = question.replace(/[’']/g, "'").split(/[^A-Za-z0-9',]+/).filter(Boolean);
  const words = raw.map((w) => normalise(w).replace(/'s$/, ''));
  const used = new Array(words.length).fill(false);
  // Names found in full, with the words they took: a misspelt longer name over the same words replaces them.
  const hits: Array<{ name: string; start: number; end: number }> = [];
  const ambiguous: Mentions['ambiguous'] = [];
  const lookup = (phrase: string, n: number) =>
    index.full.get(phrase) ?? (n > 1 && phrase.endsWith('s') ? index.full.get(phrase.slice(0, -1)) : undefined);

  // Full names, longest first. A comma in a name ("Kratos, Stoic Father") is optional.
  for (let n = Math.min(index.longest, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const phrase = words.slice(i, i + n).join(' ');
      // "forsaken monuments" is Forsaken Monument: a plural last word still finds the name.
      const name = lookup(phrase, n);
      if (!name) continue;
      // One common word ("fog", "opt") is only a card if it was written like one.
      if (n === 1 && plain(phrase) && !capital(i)) continue;
      if (n === 1 && phrase.length < 3) continue;
      hits.push({ name, start: i, end: i + n - 1 });
      for (let k = i; k < i + n; k++) used[k] = true;
    }
  }

  // Then a misspelt name: "Innaiz, the gale force" -> did you mean Inniaz, the Gale Force (or Gale Force, which the
  // exact pass found inside it)? A word already in some name, plain English, a game word, or one that is a name
  // word's other form ("redirected") is never taken for a typo.
  const typoUsed = new Array(words.length).fill(false);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (used[i] || w.length < shortest || /\d/.test(w) || index.words.has(w)) continue;
    if (COMMON.has(w) || (ordinary.has(w) && !capital(i))) continue;
    if (/(s|es|ed|ing|er|ers)$/.test(w) && [w.replace(/(s|es|ed|ing|er|ers)$/, ''), w.replace(/(s|ed|er|ers)$/, '')].some((x) => index.words.has(x))) continue;
    // Inside a full name any word may be the fix ("Teferi's Protecton"); on its own, not an ordinary one.
    const fixes = closeWords(w, index);
    if (!fixes.length || fixes.length > 3) continue;

    // The longest full name over the words around it, the one word corrected.
    let found: { names: string[]; start: number; end: number } | null = null;
    for (let n = Math.min(index.longest, words.length); n >= 2 && !found; n--) {
      const names = new Set<string>();
      let start = -1;
      for (let s = Math.max(0, i - n + 1); s <= i && s + n <= words.length; s++) {
        if (typoUsed.slice(s, s + n).some(Boolean)) continue;
        for (const f of fixes) {
          const name = lookup(words.slice(s, s + n).map((x, k) => (s + k === i ? f : x)).join(' '), n);
          if (name) { names.add(name); if (start < 0) start = s; }
        }
      }
      if (names.size) found = { names: [...names], start, end: start + n - 1 };
    }
    // A word on its own is only a name if written like one ("Innaiz?"): lower case, "really" is not Rally the Ranks.
    if (!found && capital(i)) {
      const names = [...new Set(fixes.filter((f) => !COMMON.has(f) && !ordinary.has(f)).flatMap((f) => index.first.get(f) ?? []))];
      if (names.length && names.length <= 12) found = { names: names.sort(), start: i, end: i };
    }
    if (!found) continue;
    const { start, end } = found;
    // An exact name inside the misspelt one is the other option.
    const inside = hits.filter((h) => h.start >= start && h.end <= end);
    for (const h of inside) hits.splice(hits.indexOf(h), 1);
    ambiguous.push({
      mention: raw.slice(start, end + 1).join(' ').replace(/[,']+$/, ''),
      options: [...new Set([...found.names, ...inside.map((h) => h.name)])],
      typo: true,
    });
    for (let k = start; k <= end; k++) { used[k] = true; typoUsed[k] = true; }
  }

  // Then a word that begins card names: one is that card, a few are a question.
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (used[i] || w.length < 4 || /^\d+$/.test(w)) continue;
    // Plain English never begins a name here; the game's words only with a capital.
    if (COMMON.has(w) || (ordinary.has(w) && !capital(i))) continue;
    // A type before "token" or "creature" is the type: "Soldier tokens" are not Soldier of Fortune (2026-09-30).
    if (ordinary.has(w) && /^(tokens?|creatures?|cards?|spells?|permanents?)$/.test(words[i + 1] ?? '')) continue;
    const options = index.first.get(w);
    if (!options?.length || options.length > 12) continue;
    if (options.length === 1) hits.push({ name: options[0], start: i, end: i });
    else ambiguous.push({ mention: raw[i].replace(/[,']+$/, ''), options: [...options].sort() });
    used[i] = true;
  }
  return { cards: [...new Set(hits.map((h) => h.name))], ambiguous };
}

/**
 * The card names closest to one the owner wrote that no card has ("[[Innaiz, the Gale Force]]"), most likely first;
 * [] when none is close. To offer, never to take in its place.
 */
export function nearNames(name: string, index: NameIndex, max = 3): string[] {
  const m = findMentions(name, index, new Set(), { asName: true });
  // The whole name was meant as one card: not a shorter name found inside it ("Gale Force").
  const words = (n: string) => normalise(n.split(' // ')[0]).split(' ').length;
  const typed = words(name);
  return [...new Set(m.ambiguous.filter((a) => a.typo).flatMap((a) => a.options))].filter((o) => words(o) === typed).slice(0, max);
}

/**
 * The owner's text with a choice made: the words of `mention` replaced by the card, marked [[like this]] so it is
 * that card from then on (lib/agent-context.ts) and not asked about again.
 */
export function withPick(text: string, mention: string, name: string): string {
  const words = mention.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]"));
  if (!words.length) return text;
  const at = new RegExp(words.join("[^A-Za-z0-9',’]+"), 'i');
  return at.test(text) ? text.replace(at, `[[${name}]]`) : `${text} [[${name}]]`;
}
