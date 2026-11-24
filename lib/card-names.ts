/**
 * Reading the owner's words for cards (AGENTS.md, "Reading the owner's words"), without a model: what they typed
 * - a rules question, a search, a chat message - is matched against the name of every card (Scryfall's catalog,
 * fetched once a day: cardNameIndex in lib/cards.ts). Longest names first, so "Blade of Selves" is one card.
 *
 * Only a card we're sure of is taken; an AI call is never given a card the owner may not have meant:
 *   - sure: a card already in play (`known`: the deck's, the conversation's), one the owner picked before
 *     (`remembered`), a full name of three or more words, a two-word name with a word that isn't everyday English
 *     ("rhystic study"), a name written with a capital ("Flicker"), or a word that begins only one name and isn't
 *     everyday English ("hearthhull").
 *   - asked (`choices`), before anything is sent: a misspelt name ("Innaiz, the gale force": did you mean...?) or
 *     a word that begins several names ("kratos": which?). The owner clearly meant a card; sending would be wrong.
 *   - suggested (`suggestions`), never asked: a card's exact name in lower-case everyday words ("lightning bolt",
 *     "last chance", "humility"). It may be the card or just English, so the page offers it quietly as they type
 *     (components/CardChoice.tsx, CardSuggestions); left alone, the words go as words.
 *   - left as words: everyday English and the game's own words in lower case ("flicker effect", "really", "wrath").
 *
 * The page asks with components/CardChoice.tsx (useCardCheck) before any AI call. Pure: safe in the browser; the
 * server reads text with readCards (lib/cards.ts), which brings the index, the word lists and the owner's picks.
 */

/** A pick that says "not a card": a suggestion the owner closed. Those words stay words, and it's remembered. */
export const NOT_A_CARD = '-';

/** typo: no card has the name, these are close. several: the words begin several names. */
export type ChoiceKind = 'typo' | 'several';

/** A choice to put to the owner, with the cards' pictures (components/CardChoice.tsx). */
export interface NamedChoice {
  mention: string;
  kind: ChoiceKind;
  options: Array<{ name: string; image: string | null }>;
}

/** The owner's answer to a choice, or a suggestion closed (`suggest`, name NOT_A_CARD). */
export interface CardPick { mention: string; name: string; kind: ChoiceKind | 'suggest' }

/** A card the words may be, offered quietly (never asked): "lightning bolt" -> Lightning Bolt. */
export interface Suggestion { mention: string; name: string }

/** The owner's words, read (readCards in lib/cards.ts; POST /api/cards/read). */
export interface CardReading {
  /** The text with the cards we're sure of marked [[like this]]. */
  text: string;
  cards: string[];
  /** What to ask before the text goes anywhere, first one first. */
  choices: NamedChoice[];
  /** Words read loosely, to say so: "innaiz" as Inniaz, the Gale Force; `remembered` ones can be forgotten. */
  readAs: Array<{ mention: string; name: string; remembered: boolean }>;
  /** Cards the words may be, to offer as the owner types; nothing is sent for them unless they're tapped. */
  suggestions: Suggestion[];
}

/** Where a sure card was found: the words as typed, and how it was settled. */
export interface Span {
  mention: string;
  name: string;
  how: 'exact' | 'remembered' | 'known';
}

export interface Mentions {
  /** The cards we're sure of, by their exact names. */
  cards: string[];
  /** Each sure card's words, to mark [[like this]] (markText) and to say how a loose one was read. */
  spans: Span[];
  /** What to ask the owner. */
  ambiguous: Array<{ mention: string; options: string[]; kind: ChoiceKind }>;
  /** What to offer, never ask. */
  suggestions: Suggestion[];
}

export interface ReadOptions {
  /** Everyday English (lib/everyday-words.ts): only a card when written with a capital. */
  everyday?: ReadonlySet<string>;
  /** Cards already in play here (the deck, the conversation): these win when the words could be them. */
  known?: string[];
  /** The owner's earlier picks: the words, normalised (phraseKey) -> the card, or NOT_A_CARD. */
  remembered?: ReadonlyMap<string, string>;
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

/** The key a phrase is remembered by: lower case, no punctuation. */
export const phraseKey = (s: string) => normalise(s);

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
 * `ordinary`: words of the game's own language - every word of the Comprehensive Rules - which are only a card when
 * written with a capital: "copied by a clone" is a clone effect, "copied by Clone" is the card.
 */
export function findMentions(question: string, index: NameIndex, ordinary: ReadonlySet<string> = new Set(), opts: ReadOptions = {}): Mentions {
  const { everyday = new Set<string>(), known = [], remembered = new Map<string, string>() } = opts;
  // Keep the words as typed, to know which were capitalised.
  const raw = question.replace(/[’']/g, "'").split(/[^A-Za-z0-9',]+/).filter(Boolean);
  const words = raw.map((w) => normalise(w).replace(/'s$/, ''));
  // A capital means a name, except at the start of the question.
  const capital = (i: number) => i > 0 && /^[A-Z]/.test(raw[i]);
  const game = (w: string) => COMMON.has(w) || ordinary.has(w);
  // Everyday English, or a plain form of it ("bounces", "flickering").
  const stems = (w: string) => [w, w.replace(/(s|es|ed|ing|er|ers|ly)$/, ''), w.replace(/(s|ed|er|ers|d)$/, '')];
  const plainWord = (w: string) => game(w) || stems(w).some((x) => everyday.has(x));
  const knownKey = new Map(known.map((k) => [normalise(k.split(' // ')[0]), k]));
  const isKnown = (name: string) => knownKey.has(normalise(name.split(' // ')[0]));
  const used = new Array(words.length).fill(false);
  const mention = (start: number, end: number) => raw.slice(start, end + 1).join(' ').replace(/[,']+$/, '');
  // Cards found, with the words they took: a misspelt longer name over the same words replaces them.
  const hits: Array<{ name: string; start: number; end: number; how: Span['how'] }> = [];
  const asks: Array<Mentions['ambiguous'][number] & { start: number; end: number }> = [];
  const take = (name: string, start: number, end: number, how: Span['how']) => {
    hits.push({ name, start, end, how });
    for (let k = start; k <= end; k++) used[k] = true;
  };
  // Several options, or a loose one: a card in play settles it; else it's a question.
  const offers: Array<Suggestion & { start: number; end: number }> = [];
  // A card's name in everyday words: in play, it's the card; else offered, and the words stay words.
  const offer = (name: string, start: number, end: number) => {
    if (isKnown(name)) { take(name, start, end, 'exact'); return; }
    offers.push({ mention: mention(start, end), name, start, end });
    for (let k = start; k <= end; k++) used[k] = true;
  };
  const settle = (options: string[], start: number, end: number, kind: ChoiceKind) => {
    const inPlay = options.filter(isKnown);
    if (inPlay.length === 1) take(inPlay[0], start, end, 'known');
    else {
      asks.push({ mention: mention(start, end), options, kind, start, end });
      for (let k = start; k <= end; k++) used[k] = true;
    }
  };
  const lookup = (phrase: string, n: number) =>
    index.full.get(phrase) ?? (n > 1 && phrase.endsWith('s') ? index.full.get(phrase.slice(0, -1)) : undefined);

  // The owner's earlier picks, longest first: "innaiz" is Inniaz, the Gale Force; "last chance" is just words.
  if (remembered.size) {
    for (let n = Math.min(index.longest, words.length); n >= 1; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        if (used.slice(i, i + n).some(Boolean)) continue;
        const picked = remembered.get(words.slice(i, i + n).join(' '));
        if (!picked) continue;
        // "Not a card" was said of the words in lower case: written with a capital, they're the card again.
        if (picked === NOT_A_CARD && Array.from({ length: n }, (_, k) => capital(i + k)).some(Boolean)) continue;
        if (picked === NOT_A_CARD) for (let k = i; k < i + n; k++) used[k] = true;
        else take(picked, i, i + n - 1, 'remembered');
      }
    }
  }

  // Full names, longest first. A comma in a name ("Kratos, Stoic Father") is optional.
  for (let n = Math.min(index.longest, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const phrase = words.slice(i, i + n).join(' ');
      // "forsaken monuments" is Forsaken Monument: a plural last word still finds the name.
      const name = lookup(phrase, n);
      if (!name) continue;
      const written = Array.from({ length: n }, (_, k) => capital(i + k)).some(Boolean);
      if (n === 1) {
        if (phrase.length < 3) continue;
        // One everyday or game word ("flicker", "fog") is only a card if it was written like one, or is in play.
        // An everyday one ("humility") is offered; the game's own words ("fog", "clone") aren't, they're too common.
        if (plainWord(phrase) && !written && !isKnown(name)) {
          if (!game(phrase)) offer(name, i, i);
          continue;
        }
        take(name, i, i, 'exact');
      } else if (n === 2 && !written && words.slice(i, i + 2).every(plainWord)) {
        // "lightning bolt", "last chance": maybe the card, maybe the words. Offered, never asked.
        offer(name, i, i + 1);
      } else take(name, i, i + n - 1, 'exact');
    }
  }

  // Then a misspelt name: "Innaiz, the gale force" -> did you mean Inniaz, the Gale Force (or Gale Force, which the
  // exact pass found inside it)? A word already in some name, plain English, a game word, or one that is a name
  // word's other form ("redirected") is never taken for a typo.
  const typoUsed = new Array(words.length).fill(false);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // Four letters is enough inside a full name ("Sol Rnig"), where the other words must match too; on its own, five.
    if (used[i] || w.length < 4 || /\d/.test(w) || index.words.has(w)) continue;
    if (COMMON.has(w) || (ordinary.has(w) && !capital(i)) || (!capital(i) && stems(w).some((x) => everyday.has(x)))) continue;
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
    if (!found && capital(i) && w.length >= 5) {
      const names = [...new Set(fixes.filter((f) => !game(f) && !everyday.has(f)).flatMap((f) => index.first.get(f) ?? []))];
      if (names.length && names.length <= 12) found = { names: names.sort(), start: i, end: i };
    }
    if (!found) continue;
    const { start, end } = found;
    // An exact name inside the misspelt one ("gale force") is the other option.
    const inside = hits.filter((h) => h.start >= start && h.end <= end);
    for (const h of inside) hits.splice(hits.indexOf(h), 1);
    const offeredInside = offers.filter((a) => a.start >= start && a.end <= end);
    for (const a of offeredInside) offers.splice(offers.indexOf(a), 1);
    for (let k = start; k <= end; k++) { used[k] = false; typoUsed[k] = true; }
    settle([...new Set([...found.names, ...inside.map((h) => h.name), ...offeredInside.map((a) => a.name)])], start, end, 'typo');
  }

  // Then a word that begins card names: one is that card, a few are a question.
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (used[i] || w.length < 4 || /^\d+$/.test(w)) continue;
    // Plain English and the game's words never begin a name here, unless written with a capital.
    if (COMMON.has(w) || (!capital(i) && plainWord(w))) continue;
    // A type before "token" or "creature" is the type: "Soldier tokens" are not Soldier of Fortune (2026-09-30).
    if (ordinary.has(w) && /^(tokens?|creatures?|cards?|spells?|permanents?)$/.test(words[i + 1] ?? '')) continue;
    const options = index.first.get(w);
    if (!options?.length || options.length > 12) continue;
    if (options.length === 1) take(options[0], i, i, 'exact');
    else settle([...options].sort(), i, i, 'several');
  }

  const sure = [...hits].sort((a, b) => a.start - b.start);
  return {
    cards: [...new Set(hits.map((h) => h.name))],
    spans: sure.map((h) => ({ mention: mention(h.start, h.end), name: h.name, how: h.how })),
    ambiguous: asks.sort((a, b) => a.start - b.start).map(({ mention: m, options, kind }) => ({ mention: m, options, kind })),
    suggestions: offers.sort((a, b) => a.start - b.start).map(({ mention: m, name }) => ({ mention: m, name })),
  };
}

/**
 * The phrases to remember for a pick: the words as typed, and for a misspelt name each misspelt word on its own
 * ("innaiz"), so the owner needn't type the whole name again.
 */
export function phrasesForPick(mention: string, name: string, kind: CardPick['kind'], index: NameIndex): string[] {
  const out = [phraseKey(mention)];
  if (kind === 'typo' && name !== NOT_A_CARD) {
    const nameWords = new Set(normalise(name).split(' '));
    for (const w of phraseKey(mention).split(' ').map((x) => x.replace(/'s$/, ''))) {
      if (w.length >= 4 && !index.words.has(w) && closeWords(w, index).some((c) => nameWords.has(c))) out.push(w);
    }
  }
  return [...new Set(out)];
}

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]");

/**
 * The owner's text with cards marked [[like this]] where their words were (spans from findMentions), so the card is
 * exactly that one from then on (lib/agent-context.ts). Words already inside a mark are left alone.
 */
export function markText(text: string, spans: Array<{ mention: string; name: string }>): string {
  // Keep existing marks out of reach while the words are found.
  const kept: string[] = [];
  let out = text.replace(/\[\[+[^[\]]*\]\]+/g, (m) => `\u0000${kept.push(m) - 1}\u0000`);
  for (const { mention, name } of spans) {
    const words = mention.split(/\s+/).filter(Boolean).map(escape);
    if (!words.length) continue;
    const at = new RegExp(`(?<![A-Za-z0-9])${words.join("[^A-Za-z0-9',’]+")}(?![A-Za-z0-9])`, 'i');
    out = out.replace(at, () => `\u0000${kept.push(`[[${name}]]`) - 1}\u0000`);
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_, k) => kept[Number(k)]);
}

/** The card a name is, exactly (case, punctuation and a double-faced card's front aside); undefined when none. */
export function exactCard(name: string, index: NameIndex): string | undefined {
  return index.full.get(normalise(name.split(' // ')[0]));
}
