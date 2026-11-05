/**
 * What a deck is built to do, as styles: read from the commander's text
 * and from how many of the deck's own cards share it. The main style and a
 * second one are a starting point - the owner can change either on the Plan
 * tab - and each style moves the usual role counts: a discard deck runs
 * more draw, a landfall deck more ramp. Pure.
 */

import type { ScryfallCard } from './scryfall';

export interface Style {
  id: string;
  label: string;
  note: string;
  /** Rules text that says a commander (or a card) plays this way. */
  test: RegExp;
  /** How the usual counts move for this style, by role. */
  shift: Record<string, [number, number]>;
}

// The first that fits a commander, when several do and the cards cannot
// tell them apart, so the more specific ones come first.
export const STYLES: Style[] = [
  { id: 'spells', label: 'Spells engine', note: 'Rewards casting instants and sorceries: cheap spells, rituals and copy effects are the deck.',
    test: /whenever you cast (an? )?(instant|sorcery|noncreature)|copy (that|target) (instant|sorcery|spell)|magecraft/i, shift: { draw: [12, 15], ramp: [8, 10] } },
  { id: 'discard', label: 'Discard', note: 'Discarding is the engine: outlets, wheels, madness and payoffs for cards leaving your hand.',
    test: /\bdiscards? (a|one|two|that|any number of|your hand|cards?)\b|\bmadness\b|each player discards|whenever you discard/i, shift: { draw: [12, 16] } },
  { id: 'aristocrats', label: 'Aristocrats', note: 'Rewards creatures dying or being sacrificed: fodder, sac outlets and death payoffs.',
    test: /whenever (a|another) (creature|nontoken creature)[^.]* dies|sacrifice (a|another) creature/i, shift: {} },
  { id: 'landfall', label: 'Lands', note: 'Rewards land drops: extra lands, fetches and landfall payoffs.',
    test: /landfall|whenever a land enters|play an additional land/i, shift: { ramp: [12, 15] } },
  { id: 'counters', label: '+1/+1 counters', note: 'Spreads and multiplies counters: counter makers, doublers and payoffs.',
    test: /\+1\/\+1 counters? on/i, shift: {} },
  { id: 'tokens', label: 'Go wide', note: 'Makes or rewards many creatures: token makers, anthems and overruns.',
    test: /create[^.]* (creature )?tokens?|for each creature you control/i, shift: { wipe: [1, 3] } },
  { id: 'voltron', label: 'Voltron', note: 'Wins with commander damage: equipment, auras and protection for one creature.',
    test: /equipped creature|enchanted creature|\battach\b/i, shift: { interaction: [7, 11], wipe: [1, 3] } },
  { id: 'graveyard', label: 'Graveyard', note: 'Uses the graveyard: self-mill, reanimation and recursion.',
    test: /from your graveyard|\bmill\b|return target creature card/i, shift: {} },
  { id: 'artifacts', label: 'Artifacts', note: 'Rewards artifacts: rocks, treasures and artifact payoffs.',
    test: /whenever (an|another) artifact|artifacts? you control|for each artifact/i, shift: { ramp: [12, 15] } },
  { id: 'draw', label: 'Card draw', note: 'Rewards drawing cards: wheels, draw engines and draw payoffs.',
    test: /whenever you draw/i, shift: { draw: [12, 16] } },
  { id: 'lifegain', label: 'Lifegain', note: 'Rewards gaining life: lifelink, gain-life triggers and payoffs.',
    test: /whenever you gain life/i, shift: {} },
  { id: 'combat', label: 'Combat', note: 'Rewards attacking: evasion, extra combats and ways to push damage through.',
    test: /whenever [^.]* attacks|combat damage to a player|extra combat/i, shift: { draw: [8, 11] } },
];

export const VALUE: Style = { id: 'value', label: 'Value', note: 'No single thing it rewards: a deck of strong cards built around what it does.', test: /$^/, shift: {} };

export const styleById = (id: string | null | undefined): Style | null => (id === 'value' ? VALUE : STYLES.find((s) => s.id === id) ?? null);

const textOf = (c: ScryfallCard) => [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n')
  // Reminder text names mechanics a card does not use.
  .replace(/\([^)]*\)/g, '');

export interface Detected {
  primary: Style;
  secondary: Style | null;
  /** How many of the deck's cards share each style, for showing why. */
  support: Record<string, number>;
}

/**
 * The commander's styles, ranked by how many of the deck's cards share
 * them; a second style is another the commander has, or one a good share of
 * the deck plays even if the commander does not say so.
 */
export function detectStyles(commander: ScryfallCard | null, cards: Array<{ card: ScryfallCard; quantity: number }>): Detected {
  const support: Record<string, number> = {};
  for (const s of STYLES) support[s.id] = cards.filter((c) => s.test.test(textOf(c.card))).reduce((n, c) => n + c.quantity, 0);
  const own = commander ? STYLES.filter((s) => s.test.test(textOf(commander))) : [];
  const ranked = [...own].sort((a, b) => support[b.id] - support[a.id]);
  const primary = ranked[0] ?? VALUE;
  const second = ranked.find((s) => s !== primary && support[s.id] >= 8)
    ?? STYLES.filter((s) => s !== primary && !own.includes(s)).sort((a, b) => support[b.id] - support[a.id]).find((s) => support[s.id] >= 15)
    ?? null;
  return { primary, secondary: second, support };
}

/** The usual counts for a deck of these styles: the main style first, then the second where the main says nothing. */
export function styleTargets(base: Record<string, [number, number]>, primary: Style | null, secondary: Style | null): Record<string, [number, number]> {
  const out = { ...base };
  for (const [role, range] of Object.entries(secondary?.shift ?? {})) out[role] = range;
  for (const [role, range] of Object.entries(primary?.shift ?? {})) out[role] = range;
  return out;
}
