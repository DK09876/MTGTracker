/**
 * The numbers every screen shows for a deck, worked out in one place so
 * Health, Plan, Tune, the cut list, Chat and Playtest never disagree: how
 * many lands it wants, and the jobs - ramp, card draw, interaction, board
 * wipes, protection, ways to finish - counted the same way everywhere, each
 * with its range.
 *
 * Every number carries what went into it and the steps, in plain words, so
 * a page can show how it was worked out. The rules follow the deck-building
 * reference (docs/deckbuilding-reference.md):
 *
 *   - Lands: 31.42 + 3.13 x the spells' average mana value - 0.28 x the cheap
 *     (2 mana or less) ramp and draw, rounded, never below 37. A double-faced
 *     card with a land on the back counts as 0.38 of a land.
 *   - Card draw: cards that leave you with more cards. Cantrips are not
 *     draw, and impulse draw (exile the top card, play it soon) is counted
 *     on its own, since it digs but does not refill a hand.
 *   - Interaction: removal, counterspells and board wipes as one count;
 *     removal that can be used again counts twice. Wipes keep a range of
 *     their own inside it, one more when the deck has few creatures.
 *   - Ramp: the commander counts when it ramps; ramp that costs as much as
 *     the flip turn or more counts half, since it arrives too late to get
 *     ahead. 12 at a flip turn of 4, one more or fewer per mana.
 *
 * Pure: roles come in already worked out (roles.ts, deck-roles.ts).
 */

import { primaryType } from './deckview';
import type { RoleCount, RoleGroup } from './roles';
import { oracleTextOf, type ScryfallCard } from './scryfall';

export interface How {
  /** The values that went in, each with where it came from. */
  inputs: string[];
  /** How they were put together, with the numbers. */
  steps: string[];
}

/** A job the plan has a range for. */
export interface Job {
  id: JobId;
  label: string;
  group: RoleGroup;
  /** Cards counted, with repeatable removal and slow ramp weighted (so it can be a half). */
  count: number;
  cards: string[];
  range: [number, number] | null;
  how: How;
}

export type JobId = 'ramp' | 'draw' | 'impulse' | 'interaction' | 'wipe' | 'protection' | 'finishers';

/** The ranges every deck starts from, before its flip turn, styles and owner move them. */
export const BASE_RANGES: Record<Exclude<JobId, 'impulse'>, [number, number]> = {
  ramp: [11, 13],
  draw: [10, 12],
  interaction: [10, 12],
  wipe: [1, 2],
  protection: [2, 3],
  finishers: [3, 5],
};

export const JOB_LABELS: Record<JobId, string> = {
  ramp: 'Ramp',
  draw: 'Card draw',
  impulse: 'Impulse draw',
  interaction: 'Interaction',
  wipe: 'Board wipes',
  protection: 'Protection',
  finishers: 'Ways to finish',
};

const JOB_GROUPS: Record<JobId, RoleGroup> = {
  ramp: 'mana', draw: 'cards', impulse: 'cards', interaction: 'interaction', wipe: 'interaction', protection: 'resilience', finishers: 'plan',
};

/** The built-in roles a job is made of, for finding cards to fill it. */
export const JOB_ROLES: Record<JobId, string[]> = {
  ramp: ['ramp'],
  draw: ['draw'],
  impulse: ['draw'],
  interaction: ['removal', 'counter', 'wipe'],
  wipe: ['wipe'],
  protection: ['protection'],
  finishers: ['wincon', 'finisher', 'extra-turn', 'extra-combat', 'overrun', 'drain'],
};

/** Jobs every deck needs, for "does two jobs": the deck's own plan pieces are not among them. */
export const REAL_JOBS = ['ramp', 'draw', 'interaction', 'protection', 'recursion', 'tutor', 'finishers'] as const;

const textOf = (c: ScryfallCard) => [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n').replace(/\([^)]*\)/g, '');
const typeOf = (c: ScryfallCard) => c.type_line ?? (c.card_faces ?? []).map((f) => f.type_line).join(' // ');
const isLand = (c: ScryfallCard) => primaryType(c) === 'Lands';

// Impulse draw: exile from the top and play it for a while.
const IMPULSE = /exile the top[^.]*\.[^.]*(you may (play|cast)|until (the end of )?(your next turn|turn))/i;
const DRAWS = /draws? (a|one|two|three|\w+) cards?/i;

/** "Exile the top card, you may play it": digs, but does not refill a hand. Cards that also draw outright are draw. */
export function isImpulse(card: ScryfallCard): boolean {
  const text = textOf(card);
  return IMPULSE.test(text) && !DRAWS.test(text);
}

const WORD_N: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const num = (w: string): number | null => (w in WORD_N ? WORD_N[w] : /^\d+$/.test(w) ? Number(w) : null);

/**
 * Whether a card's draw leaves you with more cards, or only swaps cards
 * ("selection"): looting and rummaging - discard one, draw one - and spells
 * that draw two for a discard leave your hand the same size, so they are
 * not card draw. Wheels and "discard your hand, then draw N" refill a hand
 * and count. Draws someone else makes (an opponent, "its controller") don't
 * count for you, and a card that only cycles is selection too.
 *
 * Reads each ability on its own: draws minus discards (and cards put back
 * from your hand), minus the spell itself for an instant or sorcery. 'draw'
 * when any ability leaves you up a card, 'selection' when every ability
 * that draws leaves you even or behind, null when the text has no draw of
 * its own to judge (the card's tags said card advantage for another reason:
 * returning cards from the graveyard, looking at cards and keeping two).
 */
export function drawKind(card: ScryfallCard): 'draw' | 'selection' | null {
  const front = (card.card_faces?.[0] ?? card) as { type_line?: string };
  const spell = /\b(Instant|Sorcery)\b/.test(front.type_line ?? typeOf(card).split('//')[0]);
  const text = textOf(card);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // An additional cost to cast it is paid once, for the whole spell.
  const extraCost = lines.filter((l) => /^as an additional cost to cast this spell,[^.]*\bdiscard (a|one|two) cards?/i.test(l))
    .reduce((n, l) => n + (num((l.match(/discard (a|one|two) cards?/i)?.[1] ?? 'a').toLowerCase()) ?? 1), 0);
  let any = false;
  let up = false;
  for (const raw of lines) {
    // One ability per line: "you may discard a card. If you do, draw a card" is one swap.
    {
      const line = raw.replace(/^•\s*/, '');
      if (!/\bdraws?\b/i.test(line)) continue;
      any = true;
      // Someone else's draw: "its controller draws", "target opponent draws", "that player draws".
      const mine = line.replace(/\b(its controller|their controller|that player|target opponent|each opponent|an opponent|target player)\s+(may\s+)?draws?\b[^.]*/gi, '');
      const draws = [...mine.matchAll(/\b(?:you |each player |players? )?(?:may )?draws? (a card for each|cards? for each|cards equal to|that many|a|an|one|two|three|four|five|six|seven|eight|\d+|x)\b(?: cards?)?( plus one)?/gi)];
      if (!draws.length) continue;
      let drawn = 0;
      let variable = false;
      let thatMany = false;
      for (const m of draws) {
        const w = m[1].toLowerCase();
        if (w === 'that many') { if (m[2]) variable = true; else thatMany = true; continue; }
        const n = num(w);
        if (n === null) variable = true; else drawn += n;
        if (m[2]) drawn += 1;
      }
      // Discarding a whole hand, then drawing a fixed number or more: a refill.
      const hand = /\bdiscards? (your|their|all the cards in (your|their)) hands?|discard all the cards in your hand|discard your hand/i.test(line);
      if (hand && (variable || drawn >= 3)) { up = true; continue; }
      if (variable && !thatMany) { up = true; continue; }
      let discarded = extraCost;
      for (const m of line.matchAll(/\bdiscards? (a|an|one|two|three|\d+|x|up to (?:one|two|three)|any number of)\b(?: cards?)?/gi)) {
        const w = m[1].toLowerCase().replace(/^up to /, '');
        discarded += w === 'any number of' || w === 'x' ? 0 : num(w) ?? 1;
      }
      for (const m of line.matchAll(/\bput (a|one|two|three) cards? from your hand on (top|the bottom)/gi)) discarded += num(m[1].toLowerCase()) ?? 1;
      if (thatMany) continue; // "discard any number, then draw that many": even
      const net = drawn - discarded - (spell ? 1 : 0);
      if (net > 0) up = true;
    }
  }
  if (any) return up ? 'draw' : 'selection';
  // A Blood token is a rummage: discard a card, draw a card.
  if (/\bcreate[^.]*\bBlood tokens?\b/i.test(text)) return 'selection';
  if ((card.keywords ?? []).some((k) => /^(cycling|\w+cycling)$/i.test(k)) && !/\b(return|put)[^.]*\binto your hand\b/i.test(text)) return 'selection';
  if (spell && /\bput (one|a card) of them into your hand\b/i.test(text) && !/\bput (two|three)\b[^.]*into your hand/i.test(text)) return 'selection';
  return null;
}

/**
 * Removal that can be used again: a permanent with an activated ability
 * (cost, then a colon) or an every-turn trigger that destroys, exiles,
 * bounces or deals damage to a target.
 */
export function isRepeatableRemoval(card: ScryfallCard): boolean {
  if (/\b(Instant|Sorcery)\b/.test(typeOf(card).split('//')[0])) return false;
  const text = textOf(card);
  const hits = /(destroy|exile|return) (target|another target|up to one target)[^.]*(creature|permanent|artifact|enchantment|planeswalker|nonland)|deals? (\d+|x) damage to (any target|target (creature|planeswalker|player))/i;
  const self = new RegExp(`sacrifice (this|${(card.name.split(' // ')[0].split(',')[0]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
  return text.split('\n').some((line) => {
    const colon = line.indexOf(':');
    // "Sacrifice this creature: deal 6 damage" works once.
    if (colon > 0 && colon < 80 && self.test(line.slice(0, colon))) return false;
    if (colon > 0 && colon < 60 && hits.test(line.slice(colon))) return true;
    return /^(at the beginning of (your|each)|whenever)/i.test(line.trim()) && hits.test(line);
  });
}

/** A double-faced card with a land on the back: mostly a spell, partly a land. */
export function isLandBack(card: ScryfallCard): boolean {
  const faces = card.card_faces ?? [];
  return faces.length > 1 && !isLand(card) && faces.slice(1).some((f) => /\bLand\b/.test(f.type_line ?? ''));
}

/**
 * Lands for this curve, never below 37: 31.42 + 3.13 x the spells' average
 * mana value - 0.28 x the cheap ramp and draw spells.
 */
export function karstenLands(averageMv: number, cheapDrawAndRamp: number): number {
  return Math.max(37, Math.round(31.42 + 3.13 * averageMv - 0.28 * cheapDrawAndRamp));
}

/** 12 ramp at a flip turn of 4, one more or fewer per mana, never under 6. */
export function rampRange(flip: number): [number, number] {
  const f = Math.max(1, Math.min(10, Math.round(flip)));
  const mid = Math.max(6, 12 + (f - 4));
  return [mid - 1, mid + 1];
}

export interface LandNumber {
  /** Lands in the deck: double-faced cards with a land back count 0.38. */
  have: number;
  /** What the formula says for this curve. */
  want: number;
  /** The range in use: the owner's, else the formula's [want, want + 1]. */
  range: [number, number];
  mine: boolean;
  averageMv: number;
  cheap: number;
  how: How;
}

type Cards = Array<{ card: ScryfallCard; quantity: number }>;

const count = (list: Cards) => list.reduce((n, c) => n + c.quantity, 0);
const round = (n: number) => Math.round(n * 100) / 100;

/** The land number, from the cards and which of them are ramp or draw. */
export function landNumber(cards: Cards, rolesOf: (card: ScryfallCard) => string[], mine?: [number, number] | null, by: 'yours' | 'override' = 'yours'): LandNumber {
  const spells = cards.filter((c) => !isLand(c.card));
  const backs = spells.filter((c) => isLandBack(c.card));
  const spellCount = count(spells);
  const averageMv = spellCount ? spells.reduce((n, c) => n + (c.card.cmc ?? 0) * c.quantity, 0) / spellCount : 0;
  const cheapCards = spells.filter((c) => (c.card.cmc ?? 0) <= 2 && rolesOf(c.card).some((r) => r === 'ramp' || r === 'draw'));
  const cheap = count(cheapCards);
  const want = karstenLands(averageMv, cheap);
  const have = round(count(cards.filter((c) => isLand(c.card))) + 0.38 * count(backs));
  const raw = 31.42 + 3.13 * averageMv - 0.28 * cheap;
  return {
    have, want, averageMv: round(averageMv), cheap,
    range: mine ?? [want, want + 1],
    mine: !!mine,
    how: {
      inputs: [
        `Average mana value of the ${spellCount} spells: ${averageMv.toFixed(2)}`,
        `Cheap ramp and draw (2 mana or less): ${cheap}${cheapCards.length ? `, e.g. ${cheapCards.slice(0, 3).map((c) => c.card.name).join(', ')}` : ''}`,
        ...(backs.length ? [`Double-faced cards with a land on the back: ${count(backs)}, at 0.38 of a land each`] : []),
      ],
      steps: [
        `31.42 + 3.13 × ${averageMv.toFixed(2)} − 0.28 × ${cheap} = ${raw.toFixed(1)}`,
        `Rounded: ${Math.round(raw)}${Math.round(raw) < 37 ? ', raised to 37 (never fewer)' : ''}.`,
        ...(mine ? [by === 'override' ? `A change to the usual rules sets ${mine[0] === mine[1] ? mine[0] : `${mine[0]}–${mine[1]}`} instead.` : `Your own range, ${mine[0]}–${mine[1]}, is used instead.`] : []),
      ],
    },
  };
}

export interface JobInput {
  /** The main board, the commander left out. */
  cards: Cards;
  /** The deck's roles as counted from its tags, the owner's corrections in. */
  roles: RoleCount[];
  commander: ScryfallCard | null;
  /** The roles the commander itself fills. */
  commanderRoles: string[];
  /** The mana the deck needs to get going. */
  flip: number;
  /** Ranges in use: the style's and the owner's, by job id; missing ones use the base. */
  ranges?: Partial<Record<JobId, [number, number]>>;
  /** Where each range came from, in words ("your range", "a change to the usual rules: ..."). */
  rangeFrom?: Partial<Record<JobId, string>>;
}

/** Every job, counted the same way for every screen. */
export function jobs(input: JobInput): Job[] {
  const { cards, roles, commander, commanderRoles, flip } = input;
  const byName = new Map(cards.map((c) => [c.card.name, c]));
  const membersOf = (ids: string[]) => [...new Set(roles.filter((r) => ids.includes(r.id)).flatMap((r) => r.cards))].filter((n) => byName.has(n)).sort();
  const qty = (name: string) => byName.get(name)?.quantity ?? 1;
  const range = (id: Exclude<JobId, 'impulse'>, fallback: [number, number]) => input.ranges?.[id] ?? fallback;
  const out: Job[] = [];
  const job = (id: JobId, cardsIn: string[], n: number, r: [number, number] | null, how: How) =>
    out.push({ id, label: JOB_LABELS[id], group: JOB_GROUPS[id], count: round(n), cards: cardsIn, range: r, how });

  // Ramp: slow ramp counts half; a ramping commander counts one.
  const ramp = membersOf(['ramp']);
  const slow = ramp.filter((n) => (byName.get(n)!.card.cmc ?? 0) >= flip);
  const cmdRamps = !!commander && commanderRoles.includes('ramp');
  const rampCount = ramp.reduce((n, name) => n + qty(name) * (slow.includes(name) ? 0.5 : 1), 0) + (cmdRamps ? 1 : 0);
  const rampFrom = input.rangeFrom?.ramp ?? (input.ranges?.ramp ? 'your plan' : `a flip turn of ${flip}`);
  const fromStep = (id: JobId) => (input.rangeFrom?.[id] ? [`Range from ${input.rangeFrom[id]}.`] : []);
  job('ramp', ramp, rampCount, range('ramp', rampRange(flip)), {
    inputs: [`Ramp cards: ${ramp.length}`, `Costing ${flip} or more (the flip turn): ${slow.length}${slow.length ? ` (${slow.slice(0, 3).join(', ')})` : ''}`, ...(cmdRamps ? [`${commander!.name.split(',')[0]} ramps too`] : [])],
    steps: [`${ramp.length - slow.length} counted whole, ${slow.length} at half${cmdRamps ? ', +1 for the commander' : ''} = ${round(rampCount)}.`, `Range from ${rampFrom}: 12 at a flip turn of 4, one more or fewer per mana.`],
  });

  // Card draw, with impulse draw apart.
  const drawAll = membersOf(['draw']);
  const impulse = drawAll.filter((n) => isImpulse(byName.get(n)!.card));
  const selection = drawAll.filter((n) => !impulse.includes(n) && drawKind(byName.get(n)!.card) === 'selection');
  const draw = drawAll.filter((n) => !impulse.includes(n) && !selection.includes(n));
  const drawCount = draw.reduce((n, name) => n + qty(name), 0);
  job('draw', draw, drawCount, range('draw', BASE_RANGES.draw), {
    inputs: [
      `Cards Scryfall tags as card advantage, cantrips left out: ${drawAll.length}`,
      `Of those, impulse draw: ${impulse.length}`,
      `Of those, looting and rummaging (a card in for a card out): ${selection.length}${selection.length ? ` (${selection.slice(0, 3).join(', ')}${selection.length > 3 ? '…' : ''})` : ''}`,
    ],
    steps: [
      `${drawAll.length} − ${impulse.length} impulse − ${selection.length} looting = ${drawCount}.`,
      'Impulse draw is counted on its own: it digs, but what it exiles has to be played soon, so it does not refill your hand.',
      'Looting and rummaging swap a card for a card, so your hand stays the same size: they are not card draw. Wheels and refills are.',
      ...fromStep('draw'),
    ],
  });
  job('impulse', impulse, impulse.reduce((n, name) => n + qty(name), 0), null, {
    inputs: [`Card advantage that exiles cards to play them: ${impulse.length}`],
    steps: ['No range: shown so you can see it, never counted as card draw.'],
  });

  // Interaction: removal, counterspells and wipes; repeatable removal twice.
  const interaction = membersOf(JOB_ROLES.interaction);
  const repeatable = interaction.filter((n) => isRepeatableRemoval(byName.get(n)!.card));
  const interactionCount = interaction.reduce((n, name) => n + qty(name) * (repeatable.includes(name) ? 2 : 1), 0);
  const counters = membersOf(['counter']).length;
  job('interaction', interaction, interactionCount, range('interaction', BASE_RANGES.interaction), {
    inputs: [`Removal, counterspells and board wipes: ${interaction.length} (${counters} counterspell${counters === 1 ? '' : 's'})`, `Removal that can be used again: ${repeatable.length}${repeatable.length ? ` (${repeatable.slice(0, 3).join(', ')})` : ''}`],
    steps: [`${interaction.length} + ${repeatable.length} for repeatable removal = ${interactionCount}.`, ...fromStep('interaction')],
  });

  // Wipes: one more when there are few creatures to lose.
  const wipes = membersOf(['wipe']);
  const creatures = count(cards.filter((c) => primaryType(c.card) === 'Creatures'));
  const baseWipes = range('wipe', BASE_RANGES.wipe);
  const wipeRange: [number, number] = input.ranges?.wipe ? baseWipes : creatures < 15 ? [baseWipes[0], Math.min(4, baseWipes[1] + 1)] : baseWipes;
  job('wipe', wipes, wipes.reduce((n, name) => n + qty(name), 0), wipeRange, {
    inputs: [`Board wipes: ${wipes.length}`, `Creatures in the deck: ${creatures}`],
    steps: [creatures < 15 && !input.ranges?.wipe ? 'Under 15 creatures, so one more wipe hurts you less: the range goes up by one (never past 4).' : 'One or two, inside interaction.'],
  });

  const protection = membersOf(['protection']);
  job('protection', protection, protection.reduce((n, name) => n + qty(name), 0), range('protection', BASE_RANGES.protection), {
    inputs: [`Protection, fogs, silence effects and redirects: ${protection.length}`],
    steps: [input.rangeFrom?.protection ? `Range from ${input.rangeFrom.protection}: low 1–2, medium 2–3, high 3–5.` : input.ranges?.protection ? 'Range from your plan.' : 'Base range.'],
  });

  const finishers = membersOf(JOB_ROLES.finishers);
  job('finishers', finishers, finishers.reduce((n, name) => n + qty(name), 0), range('finishers', BASE_RANGES.finishers), {
    inputs: [`Cards that win or close a game: ${finishers.length}`],
    steps: ['Alternate wins, finishers from rules text, extra turns, extra combats, overruns and drain.', ...fromStep('finishers')],
  });
  return out;
}

/** The jobs as role rows, so pages that list roles show them beside the rest. Ranges move off the plain roles. */
export function withJobs(roles: RoleCount[], list: Job[]): RoleCount[] {
  const jobIds = new Set(list.map((j) => j.id as string));
  const plain = roles.filter((r) => !jobIds.has(r.id)).map((r) => ({ ...r, target: null }));
  const rows = list.map((j) => ({ id: j.id, label: j.label, group: j.group, target: j.range, count: j.count, cards: j.cards, how: j.how }));
  return [...rows, ...plain];
}

/** How many of the jobs every deck needs a card fills. */
export function jobsOf(name: string, list: Array<{ id: string; cards: string[] }>, roleIds: string[]): string[] {
  const out = new Set<string>();
  for (const j of list) if (['ramp', 'draw', 'interaction', 'protection', 'finishers'].includes(j.id) && j.cards.includes(name)) out.add(j.id);
  for (const r of ['recursion', 'tutor']) if (roleIds.includes(r)) out.add(r);
  return [...out];
}

// --- colour sources ----------------------------------------------------------

/**
 * How much a card that is not a land counts as a source of a colour for a
 * spell of this mana value: mana rocks 0.75 for spells of 3 or more, mana
 * creatures 0.5 for 2 or more, two-mana land ramp 0.75 for 3 or more,
 * three-mana ramp 0.5 for 5 or more, treasure makers 0.25 for 3 or more, a
 * land on the back of a double-faced card 0.8 (1 if mythic). Rituals don't
 * count: they are gone the turn you cast them.
 */
export function sourceWeight(card: ScryfallCard, forMv: number): number {
  if (isLandBack(card)) return card.rarity === 'mythic' ? 1 : 0.8;
  const type = typeOf(card).split('//')[0];
  const text = textOf(card);
  const mv = card.cmc ?? 0;
  if (/\b(Instant|Sorcery)\b/.test(type)) {
    if (/search your library for [^.]*land[^.]*onto the battlefield|put [^.]*land card[^.]* onto the battlefield/i.test(text)) {
      if (mv <= 2) return forMv >= 3 ? 0.75 : 0;
      if (mv === 3) return forMv >= 5 ? 0.5 : 0;
      return 0;
    }
    if (/\btreasure\b/i.test(text)) return forMv >= 3 ? 0.25 : 0;
    return 0;
  }
  if (/\bCreature\b/.test(type) && card.produced_mana?.length) return forMv >= 2 ? 0.5 : 0;
  if (card.produced_mana?.length) {
    if (mv >= 3 && mv < forMv) return 0.5;
    return forMv >= 3 ? 0.75 : 0;
  }
  if (/search your library for [^.]*land[^.]*onto the battlefield/i.test(text)) return mv <= 2 ? (forMv >= 3 ? 0.75 : 0) : forMv >= 5 ? 0.5 : 0;
  if (/\btreasure\b/i.test(text)) return forMv >= 3 ? 0.25 : 0;
  return 0;
}

export { oracleTextOf };
