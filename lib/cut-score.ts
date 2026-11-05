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

import { fitOf, type FitProfile } from './fit';
import { jobsOf } from './deck-numbers';
import { CUT_RULES, customApplies, describeCustom, NO_SETTINGS, ruleOn, weightOf, type CutSettings } from './cut-rules';
import type { RoleCount } from './roles';
import type { ScryfallCard } from './scryfall';
import { isJobTag, type DeckTags } from './tags';

export interface CutCandidate {
  cardId: string;
  name: string;
  score: number;
  reasons: string[];
  /** The roles it fills, so cutting it can be shown against their counts. */
  roles: string[];
  cmc: number;
  /** Every reason, with the rule behind it and how much it moved the score. */
  why: CutReason[];
}

export interface CutReason {
  /** A rule id from cut-rules.ts, 'custom' for the owner's own, or 'lands'. */
  rule: string;
  delta: number;
  text: string;
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
  /** Lands in the deck, and the plan's range for them. */
  lands: { have: number; range: [number, number] };
  /** Theme package sizes by tag id (8 when not set). */
  packages?: Record<string, number>;
  /** The deck's own rule settings (cut-rules.ts). */
  settings?: CutSettings;
  /** The plan's styles: cards that do what they are about are kept. */
  styles?: Array<{ label: string; test: RegExp }>;
  /** The plan's "how the deck is built": broad cuts on quality, dense keeps its theme cards. Read from the cards when missing. */
  build?: 'Broad' | 'Dense';
  /** The plan's detected themes (not yet kept as tags), each with its size and cards. */
  themes?: Array<{ name: string; size: number; cards: string[] }>;
  /** What the owner is optimizing for (the plan's chips): moves some rules' weights. */
  goal?: string[];
  /** When lands are over the range: the basic to offer (the colour the deck needs least). */
  landCut?: string | null;
}

/** How the plan's chips move the rules: faster decks cut the top of the curve harder, fun decks keep their theme. */
export function goalWeights(goal: string[] = []): Record<string, number> {
  const out: Record<string, number> = {};
  const times = (ids: string[], by: number) => { for (const id of ids) out[id] = (out[id] ?? 1) * by; };
  if (goal.some((g) => /faster|win more/i.test(g))) times(['curve', 'costly', 'highcurve', 'slowramp'], 1.4);
  if (goal.some((g) => /win more/i.test(g))) times(['floor'], 1.3);
  if (goal.some((g) => /more fun|pets/i.test(g))) times(['theme', 'style', 'package-short'], 1.4);
  if (goal.some((g) => /stay on theme/i.test(g))) { times(['offtheme'], 1.4); times(['theme'], 1.2); }
  return out;
}

// Payoffs are not protected outright: a deck can have too many (the 'payoffs' rule).
const PROTECTING = new Set(['wincon', 'engine']);
// A tag for the cards that are the fun of the deck (3/3 Elk: do not cut those for generic ones).
const PET = /^(pets?|pet cards?|fun|favou?rites?)$/i;
const JOB_ROLE_IDS = new Set(['ramp', 'draw', 'removal', 'counter', 'wipe', 'protection', 'recursion', 'tutor', 'interaction']);
const FINISHING = new Set(['wincon', 'finisher', 'extra-turn', 'extra-combat', 'overrun', 'drain']);
const isLand = (c: ScryfallCard) => /\bLand\b/.test((c.type_line ?? '').split('//')[0]);
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
  const { cards, roles, fit, commander, commanderRoles, tags, keep, lands } = input;
  const settings = input.settings ?? NO_SETTINGS;
  const byGoal = goalWeights(input.goal);
  const w = (id: string) => weightOf(settings, id) * (byGoal[id] ?? 1);
  const accepted = (tags?.tags ?? []).filter((t) => t.status === 'accepted');
  const keyTags = new Set(accepted.filter((t) => t.kind && PROTECTING.has(t.kind)).map((t) => t.id));
  const petTags = new Set(accepted.filter((t) => PET.test(t.name)).map((t) => t.id));
  const tagName = new Map(accepted.map((t) => [t.id, t.name]));
  const on = (tags?.cardTags ?? []).filter((ct) => ct.on);
  const keyCards = new Set(on.filter((ct) => keyTags.has(ct.tagId)).map((ct) => ct.key));
  const petCards = new Set(on.filter((ct) => petTags.has(ct.tagId)).map((ct) => ct.key));
  const tagsOf = new Map<string, string[]>();
  for (const ct of on) tagsOf.set(ct.key, [...(tagsOf.get(ct.key) ?? []), tagName.get(ct.tagId) ?? '']);
  const anyTag = new Set(on.map((ct) => ct.key));
  const rolesOf = new Map<string, RoleCount[]>();
  for (const r of roles) for (const name of r.cards) rolesOf.set(name, [...(rolesOf.get(name) ?? []), r]);
  const type: DeckType = input.build
    ? { type: input.build === 'Dense' ? 'B' : 'A', why: input.build === 'Dense' ? 'The plan says the deck is dense: its theme cards carry it, so they are kept.' : 'The plan says the deck is broad: cards are judged on quality, the theme a tiebreaker.' }
    : deckType(cards, fit);

  // Theme packages: each of the owner's theme tags, its size and how full it is.
  const inMain = new Set(cards.map((c) => c.card.oracle_id ?? c.card.id));
  const nameByKey = new Map(cards.map((c) => [c.card.oracle_id ?? c.card.id, c.card.name]));
  // Job tags (Ramp, Draw, Removal...) are counted by the built-in jobs, not as theme packages.
  const jobLists = roles.filter((r) => JOB_ROLE_IDS.has(r.id));
  const namesOfTag = (tagId: string) => on.filter((ct) => ct.tagId === tagId).map((ct) => nameByKey.get(ct.key)).filter((n): n is string => !!n);
  const themeTags = accepted.filter((t) => t.kind !== 'wincon' && !PET.test(t.name) && !isJobTag(t.name, namesOfTag(t.id), jobLists));
  const members = new Map(themeTags.map((t) => [t.id, on.filter((ct) => ct.tagId === t.id && inMain.has(ct.key)).length]));
  const sizeOf = (tagId: string) => input.packages?.[tagId] ?? 8;
  const enablerTags = new Set(accepted.filter((t) => t.kind === 'enabler').map((t) => t.id));
  const payoffTags = new Set(accepted.filter((t) => t.kind === 'payoff').map((t) => t.id));
  const keysWith = (ids: Set<string>) => new Set(on.filter((ct) => ids.has(ct.tagId) && inMain.has(ct.key)).map((ct) => ct.key));
  const enablers = keysWith(enablerTags);
  const payoffs = keysWith(payoffTags);
  // Card draw already leaves impulse draw out (deck-numbers.ts), so every count is the role's own.
  const countOf = (r: RoleCount) => r.count;
  const count = (id: string) => roles.find((x) => x.id === id)?.count ?? 0;
  const rangeOf = (id: string) => roles.find((x) => x.id === id)?.target ?? null;

  // Where the curve is overloaded (Commander Template: look there first).
  const spells = cards.filter((c) => !isLand(c.card));
  const total = spells.reduce((n, c) => n + c.quantity, 0);
  const perBucket = new Map<string, number>();
  for (const { card, quantity } of spells) perBucket.set(bucket(card.cmc ?? 0), (perBucket.get(bucket(card.cmc ?? 0)) ?? 0) + quantity);
  const heavy = new Set([...perBucket.entries()].filter(([b, n]) => n - CURVE_SHARE[b] * total >= 3).map(([b]) => b));
  const curve = heavy.size ? [...heavy].map((b) => `${perBucket.get(b)} cards at ${b} mana (about ${Math.round(CURVE_SHARE[b] * total)} is usual)`).join(', ') : null;
  const averageMv = total ? spells.reduce((n, c) => n + (c.card.cmc ?? 0) * c.quantity, 0) / total : 0;

  // Which utility to trim after interaction: ramp if the commander is cheap, draw if it is dear.
  const cmdMv = commander?.cmc ?? 4;
  const secondary = cmdMv <= 3 ? 'ramp' : cmdMv >= 5 ? 'draw' : null;
  const wipesLeft = count('wipe');
  const overFull = (r: RoleCount) => !!r.target && countOf(r) > r.target[1];

  const candidates: CutCandidate[] = [];
  const protectedCards: string[] = [];
  for (const { card } of cards) {
    if (isLand(card)) continue;
    const key = card.oracle_id ?? card.id;
    const mine = rolesOf.get(card.name) ?? [];
    const ids = mine.map((r) => r.id);
    const cardTags = tagsOf.get(key) ?? [];
    const custom = settings.custom.filter((c) => customApplies(c, { name: card.name, cmc: card.cmc ?? 0, roles: ids, tags: cardTags }));
    if ((ruleOn(settings, 'key') && keyCards.has(key)) || keep.has(key) || (ruleOn(settings, 'pet') && petCards.has(key)) || custom.some((c) => c.then === 'protect')) {
      protectedCards.push(card.name);
      continue;
    }
    const f = fitOf(card, fit);
    const text = textOf(card);
    const finisher = ids.some((r) => FINISHING.has(r));
    const why: CutReason[] = [];
    const add = (rule: string, delta: number, text: string) => { if (delta) why.push({ rule, delta: Math.round(delta * 100) / 100, text }); };
    const sign = (rule: string) => (CUT_RULES.find((r) => r.id === rule)?.toward === 'keep' ? -1 : 1);
    const rule = (id: string, text: string, part = 1) => add(id, sign(id) * w(id) * part, text);

    // Jobs: over the range is a cut, from the one job it is most over in -
    // a card doing two jobs is not cut twice for it; short of a range is a keep.
    const over = mine.filter(overFull).sort((a, b) => (countOf(b) - b.target![1]) - (countOf(a) - a.target![1]))[0];
    if (over) rule('over', `${over.label}: ${countOf(over)}, more than ${over.target![0]}–${over.target![1]}`);
    for (const r of mine) if (r.target && countOf(r) <= r.target[0]) rule('needed', `Needed: ${r.label.toLowerCase()} ${countOf(r)} of ${r.target[0]}–${r.target[1]}`);
    // Two or more of the jobs every deck needs in one card: the best value there is.
    const jobs = jobsOf(card.name, roles, ids);
    if (jobs.length >= 2) rule('multi', `Does ${jobs.length} jobs: ${jobs.map((j) => roles.find((r) => r.id === j)?.label.toLowerCase() ?? j).join(', ')}`, jobs.length - 1);

    // Theme packages: over its size the extras go first; at or under it, keep.
    const packs = (tagsOf.get(key) ?? []).map((name) => themeTags.find((t) => t.name === name)).filter((t): t is NonNullable<typeof t> => !!t);
    const overPack = packs.find((t) => (members.get(t.id) ?? 0) > sizeOf(t.id));
    const shortPack = packs.find((t) => (members.get(t.id) ?? 0) <= sizeOf(t.id));
    // The plan's detected themes count like tags, for cards no tag package covers.
    const themeHit = !packs.length ? (input.themes ?? []).filter((t) => t.cards.includes(card.name)) : [];
    const themeShort = themeHit.find((t) => t.cards.length <= t.size);
    const themeOver = themeHit.find((t) => t.cards.length > t.size);
    if (shortPack) rule('package-short', `${shortPack.name}: ${members.get(shortPack.id)} of ${sizeOf(shortPack.id)} - the package needs it`);
    else if (overPack) rule('package-over', `${overPack.name}: ${members.get(overPack.id)}, more than its ${sizeOf(overPack.id)}`);
    else if (themeShort) rule('package-short', `${themeShort.name}: ${themeShort.cards.length} of ${themeShort.size} - the theme needs it`);
    else if (themeOver) rule('package-over', `${themeOver.name}: ${themeOver.cards.length}, more than its ${themeOver.size}`);
    // Engines: enablers are the backbone; payoffs should be about half as many.
    if (enablers.has(key) && enablers.size < 12) rule('enablers', `An enabler, and the deck has ${enablers.size} of about 12`);
    if (payoffs.has(key) && !enablers.has(key) && payoffs.size > enablers.size / 2) {
      rule('payoffs', `${payoffs.size} payoffs for ${enablers.size} enablers: too many to fire`, Math.min(1.5, Math.max(0.5, (card.cmc ?? 3) / 4)));
    }

    // Utility, in this order: interaction first...
    if (ids.includes('removal') && !ids.includes('wipe')) {
      const most = rangeOf('interaction')?.[1] ?? 12;
      if (count('interaction') > most - 2 && narrow(card)) rule('interaction', 'Narrow removal: interaction is the first utility to trim');
      else if (count('interaction') > most && !flexible(card)) rule('interaction', 'Interaction is the first utility to trim', 0.5);
      if (flexible(card)) rule('flexible', 'Removal that hits anything');
    }
    // ...keeping a board wipe or two...
    if (ids.includes('wipe') && wipesLeft <= 2) rule('wipes', 'One of the last board wipes');
    if (ids.includes('removal') && !ids.includes('wipe') && /\bSorcery\b/.test(card.type_line ?? '') && !/\beach\b|\ball\b/i.test(text)) rule('sorcery', 'Single-target removal at sorcery speed');
    // ...then ramp or draw, by the commander's cost.
    if (secondary && ids.includes(secondary) && count(secondary) > (rangeOf(secondary)?.[0] ?? 10) && !f.matches.length) {
      rule('cmdcost', secondary === 'ramp' ? `${commander?.name.split(',')[0]} is cheap: ramp is the next to trim` : `${commander?.name.split(',')[0]} costs ${cmdMv}: draw is the next to trim`);
    }
    // The commander, in every game, already does this job - which only matters where the role is full.
    const doesIt = (id: string) => commanderRoles.includes(id) || (id === 'interaction' && commanderRoles.some((x) => ['removal', 'counter', 'wipe'].includes(x)));
    const repeats = mine.filter((r) => doesIt(r.id) && ['ramp', 'draw', 'interaction', 'protection'].includes(r.id) && overFull(r)).map((r) => r.label.toLowerCase());
    if (repeats.length) rule('repeat', `Your commander already does this (${repeats.join(', ')})`);

    // The plan: a card that does what the deck's style is about is kept.
    const styleHit = (input.styles ?? []).find((s) => s.test.test(text));
    if (styleHit) rule('style', `Fits the plan: ${styleHit.label}`);
    // The commander's theme: in a Type B deck it carries the deck; in a Type A, a tiebreaker.
    if (f.matches.length) {
      rule('theme', type.type === 'B' ? `Carries the theme (${f.matches.join(', ')}) - keep unless it is weak` : `On theme (${f.matches.join(', ')})`, type.type === 'B' ? 1 : 0.25);
    } else if (fit && !styleHit && !themeHit.length && !finisher && !ids.some((r) => UTILITY.has(r))) {
      // Off theme and not a job every deck needs: generic utility is fine away from the deck's focus.
      rule('offtheme', `Nothing ${fit.commander} cares about`);
    }

    // Floor and ceiling.
    const floor = lowFloor(card);
    if (floor && !finisher) rule('floor', floor);

    // The curve: cuts from an overloaded mana value, and dear ones before cheap ones.
    const b = bucket(card.cmc ?? 0);
    if (heavy.has(b)) rule('curve', `The curve is heavy at ${b} mana`);
    if (ids.some((r) => ['ramp', 'rock', 'dork', 'land-ramp'].includes(r)) && (card.cmc ?? 0) >= 4) rule('slowramp', `Ramp costing ${card.cmc}: it arrives when you should be casting spells`);
    if ((card.cmc ?? 0) >= 6 && !finisher) rule('costly', `Costs ${card.cmc} and does not end the game`);
    else if ((card.cmc ?? 0) >= 5 && averageMv > 3.3 && !finisher) rule('highcurve', `The curve is high (average ${averageMv.toFixed(1)}): a 5-drop out brings it down`);

    if (ids.length === 1 && ids[0] === 'cantrip' && !f.matches.length) rule('cantrip', 'Only replaces itself');
    if (!ids.length && !anyTag.has(key) && !f.matches.length && !styleHit && !themeHit.length) rule('norole', 'No role and none of your tags');
    for (const c of custom) if (typeof c.then === 'number') add('custom', c.then, describeCustom(c));

    const score = why.reduce((n, r) => n + r.delta, 0);
    if (score > 0) {
      const shown = why.filter((r) => r.delta > 0 || ['needed', 'theme', 'style', 'multi', 'package-short', 'enablers'].includes(r.rule)).map((r) => r.text);
      candidates.push({ cardId: card.id, name: card.name, score: Math.round(score * 10) / 10, reasons: shown, why, roles: ids, cmc: card.cmc ?? 0 });
    }
  }

  // Lands only when over the plan's range: never cut lands to make room.
  if (lands.have > lands.range[1]) {
    const basics = cards.filter((c) => /\bBasic\b/.test(c.card.type_line ?? '')).sort((a, b) => Number(b.card.name === input.landCut) - Number(a.card.name === input.landCut) || b.quantity - a.quantity);
    if (basics[0]) {
      const text = `Lands: ${lands.have}, the plan wants ${lands.range[0]}–${lands.range[1]}`;
      candidates.push({ cardId: basics[0].card.id, name: basics[0].card.name, score: 1.5, roles: [], cmc: 0, reasons: [text], why: [{ rule: 'lands', delta: 1.5, text }] });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.cmc - a.cmc || a.name.localeCompare(b.name));
  return { candidates, protectedCards: protectedCards.sort(), type, curve };
}
