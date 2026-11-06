/**
 * The parts of a deck's plan the app can read from the cards alone, each
 * with how sure it is and how it got there - no model. The Plan tab shows
 * these as "detected" until the owner (or Claude, with the owner's say-so)
 * sets them. Every rule here follows docs/deckbuilding-reference.md; the
 * words shown on the page say the rule, never where it came from.
 *
 * Strength: 'clear' when the evidence is plain, 'likely' when it leans one
 * way, 'guess' when there is little to go on. Pure.
 */

import { bracketFloor } from './bracket';
import type { How, Job } from './deck-numbers';
import { primaryType } from './deckview';
import { fitOf, fitProfile, THEMES, type FitProfile } from './fit';
import type { RoleCount } from './roles';
import { oracleTextOf, type ScryfallCard } from './scryfall';
import type { BracketReport, Combo } from './spellbook';
import { detectStyles, type Style } from './styles';
import type { WinRoute } from './wincons';

export type Strength = 'clear' | 'likely' | 'guess';

/** How a part was worked out: what went in, the steps, and the idea behind it in plain words. */
export interface Explained extends How {
  idea: string;
}

export interface Detected<T> {
  value: T;
  strength: Strength;
  how: Explained;
}

type Cards = Array<{ card: ScryfallCard; quantity: number }>;

const textOf = (c: ScryfallCard) => oracleTextOf(c).replace(/\([^)]*\)/g, '');
const isLand = (c: ScryfallCard) => primaryType(c) === 'Lands';
const count = (list: Cards) => list.reduce((n, c) => n + c.quantity, 0);
const short = (name: string) => name.split(',')[0];
const few = (names: string[], n = 3) => names.slice(0, n).join(', ') + (names.length > n ? '…' : '');

// --- the bracket ---------------------------------------------------------------

/** The lowest bracket the list fits: from the bracket report when it could be asked, else from Game Changers alone. */
export function detectBracket(cards: Cards, commanders: ScryfallCard[], report: Pick<BracketReport, 'cards' | 'combos'> | null): Detected<number> {
  const idea = 'The bracket is a promise to the table about how strong the deck plays; suggestions stay inside the one you pick.';
  if (report) {
    const floor = bracketFloor(report);
    const value = floor.floor === 1 ? 2 : floor.floor;
    return {
      value, strength: 'likely',
      how: {
        inputs: [
          `Game Changers: ${report.cards.filter((c) => c.gameChanger).length}`,
          `Two-card combos: ${report.combos.filter((c) => c.twoCard).length}`,
          `Extra turns: ${report.cards.filter((c) => c.extraTurn).length}`,
          `Mass land destruction: ${report.cards.filter((c) => c.massLandDenial).length}`,
        ],
        steps: [
          ...floor.reasons.map((r) => `${r.text}${r.cards.length ? ` (${few(r.cards)})` : ''} → ${r.floor} or higher.`),
          floor.reasons.length ? `So the lowest bracket this list fits is ${value}.` : 'Nothing that needs a higher bracket, so it fits bracket 2 (1 and 2 differ by intent, not cards).',
          'This is the floor, not a verdict: pick the bracket you are aiming for.',
        ],
        idea,
      },
    };
  }
  const gc = [...commanders, ...cards.map((c) => c.card)].filter((c) => c.game_changer === true).map((c) => c.name);
  const value = gc.length > 3 ? 4 : gc.length ? 3 : 2;
  return {
    value, strength: 'guess',
    how: {
      inputs: [`Game Changers: ${gc.length}${gc.length ? ` (${few(gc)})` : ''}`, 'Combos, extra turns and land destruction: not checked (the combo lookup did not answer)'],
      steps: ['Brackets 1–2 allow no Game Changers, 3 allows up to three, 4 and 5 any number.', `${gc.length} Game Changer${gc.length === 1 ? '' : 's'} → looks like ${value}.`],
      idea,
    },
  };
}

// --- styles ----------------------------------------------------------------------

export function detectStyleParts(commander: ScryfallCard | null, cards: Cards): Detected<{ primary: Style; secondary: Style | null; support: Record<string, number> }> {
  const found = detectStyles(commander, cards);
  const n = found.support[found.primary.id] ?? 0;
  const total = count(cards);
  const strength: Strength = found.primary.id === 'value' || total < 30 ? 'guess' : n >= 20 && (!found.secondary || n >= (found.support[found.secondary.id] ?? 0)) ? 'clear' : n >= 8 ? 'likely' : 'guess';
  const commanderSays = commander ? detectStyles(commander, []).primary : null;
  return {
    value: found,
    strength,
    how: {
      inputs: [
        commander ? `${short(commander.name)}’s text points at: ${commanderSays && commanderSays.id !== 'value' ? commanderSays.label : 'no one style'}` : 'No commander',
        ...Object.entries(found.support).filter(([, k]) => k > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, k]) => `Cards that play ${id}: ${k} of ${total}`),
      ],
      steps: [
        'Every style the commander’s text matches, ranked by how many of the deck’s cards share it.',
        'A second style needs 8 or more cards; a style the commander doesn’t name needs 15 or more.',
        found.secondary && (found.support[found.secondary.id] ?? 0) > n ? `The second style has more cards (${found.support[found.secondary.id]}) than the main one (${n}): worth checking which leads.` : `Main style: ${found.primary.label} (${n} cards).`,
      ],
      idea: 'Read the commander clause by clause for what it rewards, then let the cards confirm it.',
    },
  };
}

// --- what the commander does for the deck ----------------------------------------

export type CommanderRole = 'Engine' | 'Payoff' | 'Enabler' | 'Covers a weakness' | 'Multiplier';
export const COMMANDER_ROLES: CommanderRole[] = ['Engine', 'Payoff', 'Enabler', 'Covers a weakness', 'Multiplier'];

export function detectCommanderRole(commander: ScryfallCard | null, cards: Cards, roles: RoleCount[], jobs: Job[], commanderRoles: string[]): Detected<CommanderRole> {
  const idea = 'Decide what the commander does for the deck before judging how much the deck depends on it, and back up in the 99 any job only the commander does.';
  if (!commander) return { value: 'Enabler', strength: 'guess', how: { inputs: ['No commander'], steps: ['Nothing to read.'], idea } };
  const text = textOf(commander);
  const profile = fitProfile(commander);
  const dependent = profile ? cards.filter((c) => !isLand(c.card) && fitOf(c.card, profile).matches.length).length : 0;
  const engines = (roles.find((r) => r.id === 'engine')?.cards ?? []).length;
  const repeatable = /\b(at the beginning of|whenever)\b/i.test(text) && /\b(draw|create|exile the top|add \{|treasure|token)/i.test(text);
  const short_ = jobs.filter((j) => j.range && j.count < j.range[0] && commanderRoles.some((r) => (j.id === 'draw' && r === 'draw') || (j.id === 'ramp' && r === 'ramp') || (j.id === 'interaction' && (r === 'removal' || r === 'wipe' || r === 'counter'))));
  const inputs = [
    `${short(commander.name)}’s text: ${repeatable ? 'makes cards, mana or bodies every turn' : 'no every-turn engine'}`,
    `Cards in the 99 that play to its text: ${dependent}`,
    `Other repeatable card-advantage engines in the deck: ${engines}`,
    ...(short_.length ? [`Jobs it does that the 99 is short of: ${short_.map((j) => j.label.toLowerCase()).join(', ')}`] : []),
  ];
  let value: CommanderRole;
  let why: string;
  if (/\b(twice|double|an additional time|that many plus|additional (combat|trigger))\b/i.test(text)) {
    value = 'Multiplier'; why = 'Its text doubles or repeats what other cards do.';
  } else if (repeatable && engines <= 3) {
    value = 'Engine'; why = `It makes value every turn and the 99 has only ${engines} other engine${engines === 1 ? '' : 's'}: the deck runs on it.`;
  } else if (short_.length && dependent < 10) {
    value = 'Covers a weakness'; why = 'It fills a job the 99 is light on, and few cards play to its text.';
  } else if (/^\s*whenever\b/im.test(text) && dependent >= 10) {
    value = 'Payoff'; why = `It triggers on what ${dependent} cards in the 99 do: it rewards the deck’s plan.`;
  } else {
    value = 'Enabler'; why = 'It makes the deck’s plan happen rather than paying it off.';
  }
  const strength: Strength = cards.length < 30 ? 'guess' : value === 'Multiplier' || (value === 'Engine' && engines <= 1) ? 'likely' : 'guess';
  return { value, strength, how: { inputs, steps: [why, value === 'Engine' ? 'An engine commander sets “leans on the commander” high unless the 99 has engines of its own.' : 'This feeds how much the deck leans on its commander.'], idea } };
}

// --- broad or dense ------------------------------------------------------------------

export type DeckBuild = 'Broad' | 'Dense';

/**
 * Dense: a narrow theme (a creature type, snow, curses) with 20+ cards, or a
 * broad one with 30+. The theme cards carry the deck. Otherwise broad: any
 * good card can fill a job, and cards are judged on quality.
 */
export function detectBuild(cards: Cards, fit: FitProfile | null): Detected<DeckBuild> & { top: { name: string; count: number; narrow: boolean } | null } {
  const idea = 'In a broad deck any good card can fill a job, so swaps are easy. In a dense deck the theme cards carry it, and cutting them breaks it.';
  if (!fit) return { value: 'Broad', strength: 'guess', top: null, how: { inputs: ['No commander theme to read'], steps: ['Broad until there is a theme.'], idea } };
  const counts = new Map<string, number>();
  for (const { card } of cards.filter((c) => !isLand(c.card))) for (const m of fitOf(card, fit).matches) counts.set(m, (counts.get(m) ?? 0) + 1);
  const [name, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  const narrow = fit.types.includes(name) || /snow|curse/i.test(name);
  const need = narrow ? 20 : 30;
  const value: DeckBuild = n >= need ? 'Dense' : 'Broad';
  const margin = Math.abs(n - need);
  return {
    value, top: name ? { name, count: n, narrow } : null,
    strength: count(cards) < 30 ? 'guess' : margin >= 8 ? 'clear' : 'likely',
    how: {
      inputs: [`Largest theme: ${name || 'none'}, ${n} cards`, `Narrow card pool (a creature type, snow, curses): ${narrow ? 'yes' : 'no'}`],
      steps: [`Dense when a narrow theme has 20 or more cards, or a broad one 30 or more.`, `${n} ${n >= need ? '≥' : '<'} ${need} → ${value.toLowerCase()}.`],
      idea,
    },
  };
}

// --- themes ------------------------------------------------------------------------------

export interface ThemeFound {
  /** Stable: the theme's name, lowercased. */
  id: string;
  name: string;
  /** Cards in the pool that belong. */
  cards: string[];
  /** Does the commander's text ask for it? */
  commander: boolean;
  size: number;
  enablers: number;
  payoffs: number;
  multipliers: number;
  strength: Strength;
}

// Words to look for in Scryfall's tag names, per theme: tags are many and
// named loosely, so a word in the slug is enough.
const TAG_WORDS: Record<string, RegExp> = {
  tokens: /token/, treasure: /treasure/, '+1/+1 counters': /counter(s)?-(matter|synergy)|\+1|proliferate/, sacrifice: /sacrific|sac-outlet|aristocrat|death-trigger/,
  'the graveyard': /graveyard|reanimat|self-mill|recursion/, lands: /landfall|extra-land/, artifacts: /artifact/, enchantments: /enchantment/,
  'equipment and auras': /equipment|aura|voltron/, 'life gain': /lifegain|gain-life/, discard: /discard|madness|loot/, 'casting from exile': /impulse|cast-from-exile|cascade|foretell/,
};
const MULTIPLY = /\b(twice|double|an additional time|that many plus|additional (combat|trigger)|copy (it|that))\b/i;
const PAYOFF = /^\s*(whenever|at the beginning of)\b/im;

/**
 * Themes read from the commander's text, the cards' rules text and their
 * Scryfall tags. Shown: themes the commander asks for, and any other with 8
 * or more cards. The biggest theme the commander asks for is the main one,
 * sized 16; the rest 8.
 */
export function detectThemes(commander: ScryfallCard | null, pool: Cards, tagsOf: (card: ScryfallCard) => string[] = () => []): Detected<ThemeFound[]> {
  const commanderText = commander ? textOf(commander) : '';
  const spells = pool.filter((c) => !isLand(c.card));
  const found: ThemeFound[] = [];
  for (const t of THEMES) {
    const words = TAG_WORDS[t.name];
    const members = spells.filter((c) => t.card.test(`${c.card.type_line ?? ''}\n${textOf(c.card)}`) || (!!words && tagsOf(c.card).some((s) => words.test(s))));
    const asks = !!commander && t.commander.test(commanderText);
    if (!asks && members.length < 8) continue;
    const names = [...new Set(members.map((c) => c.card.name))].sort();
    const multipliers = members.filter((c) => MULTIPLY.test(textOf(c.card))).length;
    const payoffs = members.filter((c) => !MULTIPLY.test(textOf(c.card)) && PAYOFF.test(textOf(c.card))).length;
    found.push({
      id: t.name.toLowerCase(), name: t.name[0].toUpperCase() + t.name.slice(1), cards: names, commander: asks, size: 8,
      multipliers, payoffs, enablers: names.length - multipliers - payoffs,
      strength: asks && names.length >= 8 ? 'clear' : names.length >= 8 ? 'likely' : 'guess',
    });
  }
  found.sort((a, b) => Number(b.commander) - Number(a.commander) || b.cards.length - a.cards.length);
  const main = found.find((t) => t.commander) ?? found[0];
  if (main) main.size = 16;
  const shown = found.slice(0, 6);
  return {
    value: shown,
    strength: shown.length && shown.every((t) => t.strength !== 'guess') ? 'likely' : 'guess',
    how: {
      inputs: [commander ? `${short(commander.name)}’s text asks for: ${found.filter((t) => t.commander).map((t) => t.name.toLowerCase()).join(', ') || 'no one theme'}` : 'No commander', `Cards read: ${count(spells)} spells`],
      steps: [
        'A card is in a theme when its rules text or its Scryfall tags say it does that thing.',
        'Shown: themes the commander asks for, and any other with 8 or more cards.',
        main ? `The biggest theme the commander asks for (${main.name}) is the main one, sized 16; the rest 8.` : 'No theme yet.',
        'Members are split into enablers (make it happen), payoffs (reward it) and multipliers (double it).',
      ],
      idea: 'A theme is a package of cards doing one thing. Eight cards give about a 62% chance of seeing one by turn 4, sixteen about 87%. An engine wants 12 or more enablers, about half as many payoffs, and about three multipliers.',
    },
  };
}

// --- win routes and how much the deck leans on its commander -------------------------------

export interface RouteFound extends WinRoute {
  needsCommander: boolean;
}

export function detectRoutes(routes: WinRoute[], commander: ScryfallCard | null, role: CommanderRole, themes: ThemeFound[]): Detected<RouteFound[]> {
  const cmd = commander?.name ?? '';
  const mainTheme = themes.find((t) => t.commander);
  const out = routes.map((r) => ({
    ...r,
    // The commander is in it, it's commander damage, or the route's cards mostly feed off what an engine commander makes.
    needsCommander: r.cards.includes(cmd) || r.id === 'voltron' || (role === 'Engine' && !!mainTheme && r.cards.filter((n) => mainTheme.cards.includes(n)).length >= Math.ceil(r.cards.length / 2)),
  }));
  return {
    value: out,
    strength: out.some((r) => r.strength === 'strong') ? 'likely' : 'guess',
    how: {
      inputs: [`Routes found: ${out.length}`, `Needing the commander: ${out.filter((r) => r.needsCommander).length}`],
      steps: [
        'From combos that end the game, cards that win outright, extra turns, finishers, and the deck’s shape (go-wide combat, commander damage, drain, mill).',
        'A route needs the commander when the commander is one of its pieces, it is commander damage, or most of its cards run on what an engine commander makes.',
        out.length && out.every((r) => r.needsCommander) ? 'Every route needs the commander: the deck has no way to win without it.' : out.length ? 'At least one route works without the commander.' : 'No way to win found yet.',
      ],
      idea: 'A plan needs a way to win, and not only through the commander. A theme on its own is not a way to win.',
    },
  };
}

export type Lean = 'Low' | 'Medium' | 'High';

export function detectLean(role: CommanderRole, routes: RouteFound[], dependentShare: number, cards: number): Detected<Lean> {
  let score = role === 'Engine' ? 2 : role === 'Covers a weakness' ? 0 : 1;
  const needing = routes.filter((r) => r.needsCommander).length;
  if (routes.length && needing === routes.length) score += 2;
  else if (needing) score += 1;
  if (dependentShare >= 0.25) score += 1;
  const value: Lean = score >= 3 ? 'High' : score === 2 ? 'Medium' : 'Low';
  return {
    value, strength: cards < 30 ? 'guess' : score >= 4 || score <= 0 ? 'clear' : 'likely',
    how: {
      inputs: [`What the commander does: ${role}`, `Win routes needing it: ${needing} of ${routes.length}`, `Share of the 99 that plays to its text: ${Math.round(dependentShare * 100)}%`],
      steps: [
        `Engine +2, covers a weakness +0, anything else +1 → ${role === 'Engine' ? 2 : role === 'Covers a weakness' ? 0 : 1}.`,
        `Every route needs it +2, some do +1 → ${routes.length && needing === routes.length ? 2 : needing ? 1 : 0}.`,
        `A quarter or more of the 99 plays to its text +1 → ${dependentShare >= 0.25 ? 1 : 0}.`,
        `Total ${score}: 3 or more is high, 2 medium, less low. Protection: low 1–2, medium 2–3, high 3–5.`,
      ],
      idea: 'The more a deck relies on its commander, the more it needs to protect it, and the more it needs a way to win without it.',
    },
  };
}

/** Protection by how much the deck leans on its commander. */
export const PROTECTION_BY_LEAN: Record<Lean, [number, number]> = { Low: [1, 2], Medium: [2, 3], High: [3, 5] };

// --- key cards, flip turn, stages, archetype --------------------------------------------

/** Cards to offer as key cards: named in the brief, in two or more win routes, or pieces of a combo that wins. */
export function keyCandidates(pool: Cards, brief: string, routes: WinRoute[], combos: Combo[] | null, commander: ScryfallCard | null): string[] {
  const names = new Set(pool.map((c) => c.card.name));
  const out = new Set<string>();
  // Strongest first: pieces of a combo that wins, cards in two or more ways
  // to win, cards that win on their own.
  for (const c of (combos ?? []).filter((x) => x.produces.some((p) => /win the game|each opponent loses/i.test(p))).slice(0, 2)) for (const n of c.cards) if (names.has(n)) out.add(n);
  const seen = new Map<string, number>();
  for (const r of routes) for (const n of r.cards) seen.set(n, (seen.get(n) ?? 0) + 1);
  for (const [n, k] of seen) if (k >= 2 && names.has(n)) out.add(n);
  for (const r of routes.filter((x) => x.id === 'alt-win')) for (const n of r.cards) if (names.has(n)) out.add(n);
  // Cards the brief names - but a brief that lists a dozen cards is listing
  // the deck, not naming what it is built around.
  const lower = brief.toLowerCase();
  const named = [...names].filter((n) => n.length > 4 && lower.includes(short(n).toLowerCase()));
  if (named.length <= 3) for (const n of named) out.add(n);
  if (commander) out.delete(commander.name);
  return [...out].slice(0, 4);
}

export function detectFlip(commander: ScryfallCard | null, keyCards: ScryfallCard[]): Detected<number> {
  const mv = commander?.cmc ?? 4;
  const engine = keyCards.filter((c) => c.name !== commander?.name).sort((a, b) => (b.cmc ?? 0) - (a.cmc ?? 0))[0];
  const value = Math.max(1, Math.min(10, Math.round(engine && (engine.cmc ?? 0) > mv ? engine.cmc ?? mv : mv)));
  return {
    value, strength: commander ? 'clear' : 'guess',
    how: {
      inputs: [commander ? `${short(commander.name)}’s mana value: ${mv}` : 'No commander: 4', ...(engine ? [`Key card ${engine.name}: ${engine.cmc}`] : [])],
      steps: [engine && (engine.cmc ?? 0) > mv ? `A key card costs more than the commander, so the deck gets going when it can cast that: ${value}.` : `The commander’s mana value: ${value}.`, 'Ramp’s range follows it: 12 at 4 mana, one more or fewer per mana.'],
      idea: 'The flip turn is the mana the deck needs before it stops setting up and starts doing its thing.',
    },
  };
}

export interface Stages { early: string; mid: string; close: string }

export function detectStages(commander: ScryfallCard | null, flip: number, styles: Style[], routes: RouteFound[], jobs: Job[]): Detected<Stages> {
  const ramp = jobs.find((j) => j.id === 'ramp')?.cards ?? [];
  const main = routes.find((r) => r.strength === 'strong') ?? routes[0];
  const who = commander ? short(commander.name) : 'the deck';
  return {
    value: {
      early: `Ramp to ${flip} mana${ramp.length ? ` (${few(ramp, 2)})` : ''} and cast ${who} by turn ${Math.max(3, flip)}.`,
      mid: styles.length ? styles.map((s) => s.note.split(':')[0]).join('; ') + '.' : 'Build the board and answer what threatens it.',
      close: main ? `${main.label}: ${few(main.cards, 3)}.` : 'No way to win found yet.',
    },
    strength: 'guess',
    how: {
      inputs: [`Flip turn: ${flip}`, `Styles: ${styles.map((s) => s.label).join(' + ') || 'none'}`, `Main win route: ${main?.label ?? 'none'}`],
      steps: ['Early: the jobs that get to the flip turn.', 'Middle: what the styles do once the commander is out.', 'Close: the main way to win.'],
      idea: 'A plan is a board you are building toward, when you get there, and how it wins.',
    },
  };
}

export type Archetype = 'Aggro' | 'Midrange' | 'Control' | 'Combo';

export function detectArchetype(cards: Cards, jobs: Job[], routes: RouteFound[]): Detected<Archetype> {
  const n = (id: string) => jobs.find((j) => j.id === id)?.count ?? 0;
  const creatures = count(cards.filter((c) => primaryType(c.card) === 'Creatures'));
  const spells = cards.filter((c) => !isLand(c.card));
  const avg = count(spells) ? spells.reduce((s, c) => s + (c.card.cmc ?? 0) * c.quantity, 0) / count(spells) : 0;
  const main = routes.find((r) => r.strength === 'strong') ?? routes[0];
  let value: Archetype = 'Midrange';
  let why = 'None of the others fit, so midrange: most decks are.';
  if (main && (main.id === 'combo' || main.id === 'engine-combo') && main.strength === 'strong') { value = 'Combo'; why = 'The main way to win is a combo that ends the game.'; }
  else if (n('interaction') >= 15 && n('draw') >= 14 && creatures < 15) { value = 'Control'; why = 'Lots of interaction and draw, few creatures.'; }
  else if (creatures >= 30 && avg < 3) { value = 'Aggro'; why = 'Many cheap creatures.'; }
  return {
    value, strength: count(cards) < 30 ? 'guess' : 'likely',
    how: {
      inputs: [`Interaction ${n('interaction')}, card draw ${n('draw')}, ramp ${n('ramp')}`, `Creatures: ${creatures}`, `Average mana value: ${avg.toFixed(2)}`, `Main way to win: ${main?.label ?? 'none'}`],
      steps: ['Combo: the main way to win is a combo. Control: interaction 15+ and draw 14+ with under 15 creatures. Aggro: 30+ creatures averaging under 3 mana.', why],
      idea: 'Archetype is a spread of numbers, not a label: most decks are midrange, and one combo doesn’t make a combo deck.',
    },
  };
}

/** Share of the 99's spells that play to the commander's text, for how much the deck leans on it. */
export function dependentShare(commander: ScryfallCard | null, cards: Cards): number {
  const profile = fitProfile(commander);
  const spells = cards.filter((c) => !isLand(c.card));
  if (!profile || !spells.length) return 0;
  return spells.filter((c) => fitOf(c.card, profile).matches.length).length / spells.length;
}
