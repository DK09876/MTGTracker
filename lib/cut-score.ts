/**
 * Which cards to look at first when a deck is over 100, each with its
 * reasons - no AI. Built from three videos on cutting (docs/deckbuilding-
 * reference.md, "Cutting"):
 *
 * - Rebell Lily (Commander Template): look first where the curve is overloaded, then trim
 *   utility - interaction first (keeping a wipe or two and flexible
 *   removal), then ramp if the commander is cheap or draw if it is dear.
 *   Never cut lands to make room. Favourites are never cut.
 * - 3/3 Elk: a card should be worth a card. Weigh its floor (how bad at its
 *   worst) against how hard its ceiling is to reach; slow, often-dead cards
 *   go. Keep cuts cost-neutral or cheaper. A card doing the commander's job
 *   again is weaker. Generic is fine away from the deck's focus, but do not
 *   trade the cards that are the fun for generic ones.
 * - Salubrious Snail: in a Type A deck (broad roles, one theme) cards are
 *   interchangeable - cut on quality. In a Type B deck (dense, layered or
 *   narrow-pool synergy) the theme cards carry the deck - cutting them
 *   breaks it. Belonging to a package is only a tiebreaker.
 *
 * Cards the owner's tags mark as a win condition, engine or payoff, and
 * cards they starred to keep, are never offered. Pure.
 */

import { fitOf, popularity, type FitProfile } from './fit';
import type { CardStats } from './edhrec';
import type { RoleCount } from './roles';
import type { ScryfallCard } from './scryfall';
import type { DeckTags } from './tags';

export interface CutCandidate {
  cardId: string;
  name: string;
  score: number;
  reasons: string[];
  /** The roles it fills, so cutting it can be shown against their counts. */
  roles: string[];
  cmc: number;
}

/** Type A: easy to change, cut on quality. Type B: the theme carries it, keep the theme. */
export interface DeckType {
  type: 'A' | 'B';
  why: string;
}

export interface CutInput {
  cards: Array<{ card: ScryfallCard; quantity: number }>;
  roles: RoleCount[];
  fit: FitProfile | null;
  commander: ScryfallCard | null;
  /** The roles the commander itself fills (it is in every game). */
  commanderRoles: string[];
  tags: DeckTags | null;
  /** Oracle ids the owner starred to keep. */
  keep: Set<string>;
  /** EDHREC's numbers for the commander, when it is on. */
  stats: Map<string, CardStats> | null;
  lands: { have: number; want: number };
}

const PROTECTING = new Set(['wincon', 'engine', 'payoff']);
const FINISHING = new Set(['wincon', 'finisher', 'extra-turn', 'extra-combat', 'overrun', 'drain']);
const isLand = (c: ScryfallCard) => /\bLand\b/.test((c.type_line ?? '').split('//')[0]);
const front = (name: string) => name.split(' // ')[0];
const textOf = (c: ScryfallCard) => [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n').replace(/\([^)]*\)/g, '');

/**
 * Snail's spectrum: a deck where much of the 99 does one specific thing the
 * commander cares about - a creature type, snow, curses - is Type B.
 */
export function deckType(cards: CutInput['cards'], fit: FitProfile | null): DeckType {
  if (!fit) return { type: 'A', why: 'No commander theme to protect: cards are judged on quality.' };
  const spells = cards.filter((c) => !isLand(c.card));
  const counts = new Map<string, number>();
  for (const { card } of spells) for (const m of fitOf(card, fit).matches) counts.set(m, (counts.get(m) ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  // A narrow theme (a creature type, snow, curses) is Type B from fewer cards than a broad one.
  const narrow = fit.types.includes(top) || /snow|curse/i.test(top);
  if (n >= (narrow ? 20 : 30)) {
    return { type: 'B', why: `${n} cards are ${top}: the theme carries the deck, so those cards are kept and the rest judged on quality.` };
  }
  return { type: 'A', why: `Roles are broad and the theme is not packed (${n || 'few'} cards are ${top || 'on theme'}): cards are judged on quality, the theme a tiebreaker.` };
}

/** Commander Template's rough curve for the 99's spells, by mana value. */
const CURVE_SHARE: Record<string, number> = { '0-1': 0.12, '2': 0.24, '3': 0.24, '4': 0.18, '5': 0.11, '6+': 0.11 };
const bucket = (mv: number) => (mv <= 1 ? '0-1' : mv >= 6 ? '6+' : String(mv));

/** 3/3 Elk's floor: cards that do little unless a hard condition is met, or nothing much on their own. */
function lowFloor(card: ScryfallCard): string | null {
  const text = textOf(card);
  if (/\b(seven|eight|nine|ten) or more\b|\bif you control (seven|eight|ten)|\bhellbent|\bthreshold|\bdelirium/i.test(text)) return 'Low floor: does little until a hard condition is met';
  const type = card.type_line ?? '';
  // A creature with only keywords (or none) and nothing else on it.
  if (/\bCreature\b/.test(type) && (card.cmc ?? 0) >= 3 && text.split('\n').every((l) => !l.trim() || /^[A-Z][a-z]+( [a-z]+)?(, [a-z]+( [a-z]+)?)*$/.test(l.trim()))) {
    return 'Low floor: a body with little else';
  }
  return null;
}

/** Removal that hits anything is worth keeping over removal that hits one kind of thing. */
const flexible = (card: ScryfallCard) => /\b(target|each) (nonland )?permanent\b|\bany target\b|\bchoose (one|two)\b/i.test(textOf(card));
/** Removal with a restriction that often leaves it dead: a power cap, a colour, one card type. */
const narrow = (card: ScryfallCard) => /\bwith (power|toughness|mana value) \d+ or (less|greater)\b|\bnon(black|white|blue|red|green|artifact|land) creature\b|\btarget (attacking|blocking|tapped|flying) creature\b|\bdestroy target (artifact|enchantment)\b/i.test(textOf(card));
/** Utility: the jobs any deck needs, where generic cards are fine (3/3 Elk). */
const UTILITY = new Set(['ramp', 'rock', 'dork', 'land-ramp', 'draw', 'engine', 'removal', 'wipe', 'counter', 'protection', 'recursion', 'tutor']);

export function cutCandidates(input: CutInput): { candidates: CutCandidate[]; protectedCards: string[]; type: DeckType; curve: string | null } {
  const { cards, roles, fit, commander, commanderRoles, tags, keep, stats, lands } = input;
  const keyTags = new Set((tags?.tags ?? []).filter((t) => t.status === 'accepted' && t.kind && PROTECTING.has(t.kind)).map((t) => t.id));
  const on = (tags?.cardTags ?? []).filter((ct) => ct.on);
  const keyCards = new Set(on.filter((ct) => keyTags.has(ct.tagId)).map((ct) => ct.key));
  const anyTag = new Set(on.map((ct) => ct.key));
  const rolesOf = new Map<string, RoleCount[]>();
  for (const r of roles) for (const name of r.cards) rolesOf.set(name, [...(rolesOf.get(name) ?? []), r]);
  const count = (id: string) => roles.find((r) => r.id === id)?.count ?? 0;
  const type = deckType(cards, fit);

  // Where the curve is overloaded (Commander Template: look there first).
  const spells = cards.filter((c) => !isLand(c.card));
  const total = spells.reduce((n, c) => n + c.quantity, 0);
  const perBucket = new Map<string, number>();
  for (const { card, quantity } of spells) perBucket.set(bucket(card.cmc ?? 0), (perBucket.get(bucket(card.cmc ?? 0)) ?? 0) + quantity);
  const heavy = new Set([...perBucket.entries()].filter(([b, n]) => n - CURVE_SHARE[b] * total >= 3).map(([b]) => b));
  const curve = heavy.size ? [...heavy].map((b) => `${perBucket.get(b)} cards at ${b} mana (about ${Math.round(CURVE_SHARE[b] * total)} is usual)`).join(', ') : null;

  // Which utility to trim after interaction: ramp if the commander is cheap, draw if it is dear.
  const cmdMv = commander?.cmc ?? 4;
  const secondary = cmdMv <= 3 ? 'ramp' : cmdMv >= 5 ? 'draw' : null;
  const wipesLeft = count('wipe');

  const candidates: CutCandidate[] = [];
  const protectedCards: string[] = [];
  for (const { card } of cards) {
    if (isLand(card)) continue;
    const key = card.oracle_id ?? card.id;
    if (keyCards.has(key) || keep.has(key)) { protectedCards.push(card.name); continue; }
    const mine = rolesOf.get(card.name) ?? [];
    const ids = mine.map((r) => r.id);
    const f = fitOf(card, fit);
    const finisher = ids.some((r) => FINISHING.has(r));
    const reasons: string[] = [];
    let score = 0;

    // Roles: over the guideline is a cut; short of it is a keep.
    for (const r of mine) {
      if (r.target && r.count > r.target[1]) { score += 1; reasons.push(`${r.label}: ${r.count}, more than ${r.target[0]}–${r.target[1]}`); }
      if (r.target && r.count <= r.target[0]) { score -= 1; reasons.push(`Needed: ${r.label.toLowerCase()} ${r.count} of ${r.target[0]}–${r.target[1]}`); }
    }

    // Utility, in Commander Template's order: interaction first...
    if (ids.includes('removal') && !ids.includes('wipe')) {
      if (count('removal') > 8 && narrow(card)) { score += 0.6; reasons.push('Narrow removal: interaction is the first utility to trim'); } else if (count('removal') > 10 && !flexible(card)) { score += 0.3; reasons.push('Interaction is the first utility to trim'); }
      if (flexible(card)) score -= 0.4;
    }
    // ...keeping a board wipe or two...
    if (ids.includes('wipe') && wipesLeft <= 2) score -= 1;
    // ...then ramp or draw, by the commander's cost.
    if (secondary && ids.includes(secondary) && count(secondary) > 10 && !f.matches.length) {
      score += 0.4;
      reasons.push(secondary === 'ramp' ? `${commander?.name.split(',')[0]} is cheap: ramp is the next to trim` : `${commander?.name.split(',')[0]} costs ${cmdMv}: draw is the next to trim`);
    }
    // The commander, in every game, already does this job.
    const repeats = ids.filter((r) => commanderRoles.includes(r) && ['ramp', 'draw', 'removal', 'protection'].includes(r));
    if (repeats.length) { score += 0.3; reasons.push(`Your commander already does this (${repeats.join(', ')})`); }

    // The theme: in a Type B deck it carries the deck; in a Type A, a tiebreaker.
    if (f.matches.length) {
      score -= type.type === 'B' ? 1.2 : 0.3;
      if (type.type === 'B') reasons.push(`Carries the theme (${f.matches.join(', ')}) - keep unless it is weak`);
    } else if (fit && !finisher && !ids.some((r) => UTILITY.has(r))) {
      // Off theme and not a job every deck needs: generic utility is fine away from the deck's focus.
      score += 0.6;
      reasons.push(`Nothing ${fit.commander} cares about`);
    }

    // A staple most Commander decks play has a high floor (Sol Ring, Swords).
    if (popularity(card) >= 0.8) { score -= 0.8; reasons.push('A staple most decks play'); }

    // Floor and ceiling.
    const floor = lowFloor(card);
    if (floor && !finisher) { score += 0.6; reasons.push(floor); }

    // The curve: cuts from an overloaded mana value, and dear ones before cheap ones.
    const b = bucket(card.cmc ?? 0);
    if (heavy.has(b)) { score += 0.5; reasons.push(`The curve is heavy at ${b} mana`); }
    if ((card.cmc ?? 0) >= 6 && !finisher) { score += 0.4; reasons.push(`Costs ${card.cmc} and does not end the game`); }

    // How much it is played: EDHREC for this commander when on, else Commander overall.
    const s = stats?.get(front(card.name)) ?? stats?.get(card.name);
    if (stats) {
      if (!s) { score += 0.4; reasons.push(`Not on EDHREC's list for ${fit?.commander ?? 'the commander'}`); } else if (s.inclusion < 0.05) { score += 0.6; reasons.push(`In ${Math.round(s.inclusion * 100)}% of ${fit?.commander ?? 'its'} decks`); }
    } else if (popularity(card) < 0.3) {
      score += 0.4;
      const rank = (card as { edhrec_rank?: number }).edhrec_rank;
      reasons.push(rank ? `Rarely played in Commander (#${rank.toLocaleString()})` : 'Rarely played in Commander');
    }

    if (ids.length === 1 && ids[0] === 'cantrip' && !f.matches.length) { score += 0.3; reasons.push('Only replaces itself'); }
    if (!ids.length && !anyTag.has(key) && !f.matches.length) { score += 0.5; reasons.push('No role and none of your tags'); }

    if (score > 0) candidates.push({ cardId: card.id, name: card.name, score: Math.round(score * 10) / 10, reasons, roles: ids, cmc: card.cmc ?? 0 });
  }

  // Lands only when over the formula: never cut lands to make room.
  if (lands.have > lands.want + 1) {
    const basics = cards.filter((c) => /\bBasic\b/.test(c.card.type_line ?? '')).sort((a, b) => b.quantity - a.quantity);
    if (basics[0]) {
      candidates.push({
        cardId: basics[0].card.id, name: basics[0].card.name, score: 1.5, roles: [], cmc: 0,
        reasons: [`Lands: ${lands.have}, the formula says ${lands.want}`],
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.cmc - a.cmc || a.name.localeCompare(b.name));
  return { candidates, protectedCards: protectedCards.sort(), type, curve };
}
