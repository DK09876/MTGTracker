/**
 * How well a card fits a commander, from the two cards' own text - no
 * EDHREC needed. The commander's text says what it cares about (instants,
 * tokens, +1/+1 counters, a creature type, the graveyard...); a card that
 * does those things fits. Pure; used to rank suggestions and cuts.
 */

import { commanderStyle } from './build';
import type { ScryfallCard } from './scryfall';

/** Things a commander can care about, each with how a card shows it. */
const THEMES: Array<{ name: string; commander: RegExp; card: RegExp }> = [
  { name: 'instants and sorceries', commander: /\b(instant|sorcery|noncreature) spell|magecraft|copy (that|target) (instant|sorcery|spell)/i, card: /^(Instant|Sorcery)\b|\b(instant|sorcery) spells? (you cast|cost)|magecraft|copy target (instant|sorcery)/i },
  { name: 'tokens', commander: /\btokens?\b/i, card: /\bcreate[^.]*\btokens?\b|\btokens? you control\b/i },
  { name: 'treasure', commander: /\btreasure/i, card: /\btreasure/i },
  { name: '+1/+1 counters', commander: /\+1\/\+1 counter/i, card: /\+1\/\+1 counter|proliferate/i },
  { name: 'sacrifice', commander: /\bsacrifice|\bdies\b/i, card: /\bsacrifice (a|another)|\bwhenever [^.]*\bdies\b/i },
  { name: 'the graveyard', commander: /\bgraveyard/i, card: /\b(from|in) (your|a) graveyard|\bmill\b|\breturn target [^.]*card from your graveyard/i },
  { name: 'lands', commander: /\blandfall|\bwhenever a land\b|\bplay an additional land/i, card: /\blandfall|\bplay an additional land|\bsearch your library for [^.]*\bland/i },
  { name: 'artifacts', commander: /\bartifacts?\b/i, card: /^Artifact\b|\bartifacts? you control\b|\bwhenever an artifact\b/i },
  { name: 'enchantments', commander: /\benchantments?\b/i, card: /^Enchantment\b|\benchantments? you control\b|\bconstellation/i },
  { name: 'equipment and auras', commander: /\bequipped|\benchanted creature|\battach/i, card: /\bEquipment\b|\bAura\b|\bequipped creature\b|\benchanted creature\b/i },
  { name: 'attacking', commander: /\bwhenever [^.]* attacks|\bis attacking\b|\bcombat damage to a player/i, card: /\bextra combat|\bdouble strike|\bcan't be blocked|\bwhenever [^.]* attacks/i },
  { name: 'card draw', commander: /\bwhenever you draw/i, card: /\bdraw (a|two|three|that many|cards)\b|\bwheel|\beach player draws/i },
  { name: 'life gain', commander: /\bgain life|\blifelink/i, card: /\bgain \d+ life|\blifelink|\bwhenever you gain life/i },
  { name: 'discard', commander: /\bdiscard/i, card: /\bdiscard (a|your hand|two)|\bmadness\b|\bloot/i },
  { name: 'flying', commander: /\bflying\b/i, card: /\bflying\b/i },
  { name: 'casting from exile', commander: /\bcast [^.]*from exile|\bforetell|\bcascade/i, card: /\bcascade\b|\bforetell\b|\bcast [^.]*from exile/i },
];

// Reminder text in brackets is left out: Azula's "(A copy of a permanent
// spell becomes a token.)" is not about tokens.
const textOf = (c: ScryfallCard) => [c.type_line, c.oracle_text, ...(c.card_faces ?? []).flatMap((f) => [f.type_line, f.oracle_text])]
  .filter(Boolean).join('\n').replace(/\([^)]*\)/g, '');

// Creature types worth matching: the ones on the commander's type line or named in its text.
const TYPE_WORDS = /\b(Dragon|Elf|Elves|Goblin|Zombie|Vampire|Wizard|Merfolk|Angel|Demon|Eldrazi|Dinosaur|Cat|Dog|Knight|Soldier|Warrior|Rogue|Cleric|Spirit|Sliver|Human|Faerie|Elemental|Giant|Pirate|Ninja|Samurai|Artificer|Construct|Thopter|Treefolk|Hydra|Beast|Snake|Rat|Squirrel|Bird|Insect|Spider|Horror)s?\b/g;

export interface FitProfile {
  commander: string;
  themes: typeof THEMES;
  types: string[];
}

export function fitProfile(commander: ScryfallCard | null): FitProfile | null {
  if (!commander) return null;
  const text = textOf(commander);
  const own = [...new Set([...text.matchAll(TYPE_WORDS)].map((m) => m[1].replace(/ves$/, 'f')))];
  let themes = THEMES.filter((t) => t.commander.test(text));
  // A commander whose text names nothing here still has a style.
  if (!themes.length) {
    const style = commanderStyle(commander)?.label;
    themes = THEMES.filter((t) => (style === 'Spells engine' && t.name === 'instants and sorceries') || (style === 'Go wide' && t.name === 'tokens'));
  }
  return { commander: commander.name.split(',')[0], themes, types: own };
}

export interface Fit {
  /** 0 (nothing in common) to 1 (does several things the commander wants). */
  score: number;
  /** What it matches, for a reason: "instants and sorceries, tokens". */
  matches: string[];
}

export function fitOf(card: ScryfallCard, profile: FitProfile | null): Fit {
  if (!profile) return { score: 0, matches: [] };
  const text = textOf(card);
  const matches = profile.themes.filter((t) => t.card.test(text)).map((t) => t.name);
  for (const type of profile.types) if (new RegExp(`\\b${type}s?\\b`, 'i').test(text)) matches.push(type);
  return { score: Math.min(1, matches.length / 2), matches };
}

/** How popular a card is in Commander overall, 0-1, from Scryfall's EDHREC rank (1 is the most played). */
export function popularity(card: ScryfallCard): number {
  const rank = (card as { edhrec_rank?: number }).edhrec_rank;
  if (!rank) return 0;
  return Math.max(0, 1 - Math.log(rank) / Math.log(40_000));
}
