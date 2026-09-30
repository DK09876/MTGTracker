/**
 * Finding the cards a rules question is about, without a model: the question
 * is matched against the name of every card (Scryfall's catalog, fetched once
 * a day). Longest names first, so "Blade of Selves" is one card, not a blade.
 *
 * A word that begins more than one card's name - "kratos" - is a question
 * back: which Kratos? A word that is ordinary English or rules language -
 * "creature", "board", "fog" in lower case - is not taken for a card.
 */

export interface Mentions {
  /** Cards named in full, by their exact names. */
  cards: string[];
  /** Words that could be several cards. */
  ambiguous: Array<{ mention: string; options: string[] }>;
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
}

export function nameIndex(names: string[]): NameIndex {
  const full = new Map<string, string>();
  const first = new Map<string, string[]>();
  let longest = 1;
  for (const name of names) {
    const fronts = [name, ...(name.includes(' // ') ? [name.split(' // ')[0]] : [])];
    for (const n of fronts) {
      const key = normalise(n);
      if (!full.has(key)) full.set(key, name);
      longest = Math.max(longest, key.split(' ').length);
    }
    const w = normalise(name).split(' ')[0];
    if (w) first.set(w, [...(first.get(w) ?? []), name]);
  }
  return { full, first, longest: Math.min(longest, 10) };
}

/**
 * `ordinary`: words of the game's own language - every word of the
 * Comprehensive Rules - which are only a card when written with a capital:
 * "copied by a clone" is a clone effect, "copied by Clone" is the card.
 */
export function findMentions(question: string, index: NameIndex, ordinary: Set<string> = new Set()): Mentions {
  const plain = (w: string) => COMMON.has(w) || ordinary.has(w);
  // A capital means a name, except at the start of the question.
  const capital = (i: number) => i > 0 && /^[A-Z]/.test(raw[i]);
  // Keep the words as typed, to know which were capitalised.
  const raw = question.replace(/[’']/g, "'").split(/[^A-Za-z0-9',]+/).filter(Boolean);
  const words = raw.map((w) => normalise(w).replace(/'s$/, ''));
  const used = new Array(words.length).fill(false);
  const cards: string[] = [];
  const ambiguous: Mentions['ambiguous'] = [];

  // Full names, longest first. A comma in a name ("Kratos, Stoic Father") is optional.
  for (let n = Math.min(index.longest, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const phrase = words.slice(i, i + n).join(' ');
      const name = index.full.get(phrase);
      if (!name) continue;
      // One common word ("fog", "opt") is only a card if it was written like one.
      if (n === 1 && plain(phrase) && !capital(i)) continue;
      if (n === 1 && phrase.length < 3) continue;
      cards.push(name);
      for (let k = i; k < i + n; k++) used[k] = true;
    }
  }

  // Then a word that begins card names: one is that card, a few are a question.
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (used[i] || w.length < 4 || /^\d+$/.test(w)) continue;
    // Plain English never begins a name here; the game's words only with a capital.
    if (COMMON.has(w) || (ordinary.has(w) && !capital(i))) continue;
    const options = index.first.get(w);
    if (!options?.length || options.length > 12) continue;
    if (options.length === 1) cards.push(options[0]);
    else ambiguous.push({ mention: raw[i].replace(/[,']+$/, ''), options: [...options].sort() });
    used[i] = true;
  }
  return { cards: [...new Set(cards)], ambiguous };
}
