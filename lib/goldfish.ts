/**
 * Goldfishing: playing a deck alone to see how it runs - what turn the
 * commander comes down, how often land drops are missed, how much mana
 * there is by turn three, four, five, and which cards get stuck in hand.
 * Every cutting video (docs/deckbuilding-reference.md, Cutting to 100)
 * says this is how to really judge a deck. No AI; pure and seeded, so it
 * runs in the browser and in tests alike.
 *
 * The autopilot is simple on purpose: play a land (an untapped one if the
 * mana is needed now), cast mana first, then the commander when it can,
 * then the most expensive spells it can afford. It does not draw extra
 * cards or copy spells; it measures how the mana and curve hold up.
 */

import type { ScryfallCard } from './scryfall';

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
type Color = (typeof COLORS)[number];

// --- reading the cards ----------------------------------------------------

export interface SimCard {
  name: string;
  /** Land, mana rock or dork, land-fetching ramp spell, or anything else. */
  kind: 'land' | 'rock' | 'dork' | 'landRamp' | 'spell';
  mv: number;
  /** Coloured pips by colour, and generic mana. */
  pips: Partial<Record<Color, number>>;
  generic: number;
  /** For mana makers: how much, and which colours ('C' for colourless). */
  makes: number;
  colors: string[];
  tapped: boolean;
  /** Land-fetching ramp: how many lands it puts onto the battlefield. */
  fetches: number;
}

const textOf = (c: ScryfallCard) => [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n');
const typeOf = (c: ScryfallCard) => (c.type_line ?? '').split('//')[0];

function parseCost(cost: string): { pips: Partial<Record<Color, number>>; generic: number } {
  const pips: Partial<Record<Color, number>> = {};
  let generic = 0;
  for (const [, sym] of cost.matchAll(/\{([^}]+)\}/g)) {
    if (/^\d+$/.test(sym)) generic += Number(sym);
    else if ((COLORS as readonly string[]).includes(sym)) pips[sym as Color] = (pips[sym as Color] ?? 0) + 1;
    else if (/^[WUBRG]\/[WUBRG]$/.test(sym) || /\/P$/.test(sym) || sym === 'C') generic += 1;
    // X counts as nothing: cast with X at 0 for the curve.
  }
  return { pips, generic };
}

/** The coloured mana a land or rock makes, from Scryfall's list or its text. */
function colorsMade(card: ScryfallCard): string[] {
  if (card.produced_mana?.length) return card.produced_mana;
  const text = textOf(card);
  if (/any colou?r/i.test(text)) return [...COLORS];
  const found = ['W', 'U', 'B', 'R', 'G', 'C'].filter((c) => new RegExp(`Add[^.]*\\{${c}\\}`).test(text));
  // Fetch lands make what they fetch.
  const fetched = COLORS.filter((c) => new RegExp(`\\b${({ W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' })[c]}\\b`).test(text) && /search your library/i.test(text));
  return [...new Set([...found, ...fetched])];
}

export function simCard(card: ScryfallCard): SimCard {
  const front = card.card_faces?.[0];
  const type = typeOf(card);
  const text = textOf(card);
  const { pips, generic } = parseCost(card.mana_cost ?? front?.mana_cost ?? '');
  const base = { name: card.name, mv: card.cmc ?? 0, pips, generic, makes: 0, colors: [] as string[], tapped: false, fetches: 0 };
  // A land, or a modal card whose back is a land: played as a land.
  const landBack = (card.card_faces ?? []).some((f) => /\bLand\b/.test(f.type_line ?? ''));
  if (/\bLand\b/.test(type) || landBack) {
    const tapped = /enters (the battlefield )?tapped/i.test(text) && !/unless|you may pay/i.test(text);
    return { ...base, kind: 'land', mv: 0, pips: {}, generic: 0, makes: 1, colors: colorsMade(card), tapped };
  }
  const tapsFor = text.match(/\{T\}[^:]*: Add ((?:\{[^}]+\})+)/);
  if (tapsFor && /\b(Artifact|Creature)\b/.test(type)) {
    // A Signet's {1} to activate comes back out of what it makes.
    const toActivate = Number(text.match(/\{(\d)\}, \{T\}[^:]*: Add/)?.[1] ?? 0);
    const amount = (tapsFor[1].match(/\{/g) ?? []).length - toActivate;
    const anyColor = /any colou?r|one mana of any/i.test(text);
    return {
      ...base, kind: /\bCreature\b/.test(type) ? 'dork' : 'rock', makes: anyColor ? 1 : Math.max(1, amount),
      colors: anyColor ? [...COLORS] : colorsMade(card),
    };
  }
  const putLands = /search your library for[^.]*\bland/i.test(text) && /onto the battlefield/i.test(text);
  if (putLands && /\b(Sorcery|Instant)\b/.test(type)) {
    const fetches = /two basic land|up to two/i.test(text) ? (/one onto the battlefield/i.test(text) ? 1 : 2) : 1;
    return { ...base, kind: 'landRamp', fetches, colors: [...COLORS] };
  }
  return { ...base, kind: 'spell' };
}

// --- playing a game -------------------------------------------------------

/** A small, seeded random generator, so a run can be repeated. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Source { colors: string[]; makes: number; ready: boolean }

/**
 * Can these sources pay for this card? Coloured pips first, then generic
 * from what is left. Returns the indexes of the sources it taps.
 */
export function canPay(card: SimCard, sources: Source[]): number[] | null {
  const free = sources.map((s) => ({ ...s, left: s.ready ? s.makes : 0 }));
  const used = new Set<number>();
  // Colours with the fewest sources first, so a dual is not spent where a basic would do.
  const need = (Object.entries(card.pips) as Array<[Color, number]>).sort((a, b) =>
    free.filter((s) => s.colors.includes(a[0])).length - free.filter((s) => s.colors.includes(b[0])).length);
  for (const [color, n] of need) {
    for (let k = 0; k < n; k++) {
      const options = free.map((s, i) => ({ s, i })).filter(({ s }) => s.left > 0 && s.colors.includes(color))
        .sort((a, b) => a.s.colors.length - b.s.colors.length);
      if (!options.length) return null;
      options[0].s.left -= 1;
      used.add(options[0].i);
    }
  }
  let generic = card.generic;
  for (const [i, s] of free.entries()) {
    while (generic > 0 && s.left > 0) { s.left -= 1; generic -= 1; used.add(i); }
  }
  if (generic > 0) return null;
  // Whole sources are tapped: leftover mana does not carry between spells here.
  return [...used];
}

export interface GameLog {
  /** Turn the commander was cast, or null if not by the last turn played. */
  commanderTurn: number | null;
  /** Lands on the battlefield after each turn. */
  lands: number[];
  /** Mana available at the start of each turn's main phase. */
  mana: number[];
  /** Mana value cast each turn. */
  spent: number[];
  /** Cards still in hand at the end, and whether they could ever have been cast by then. */
  stuck: string[];
  mulligans: number;
  /** What the opening hand was, by name. */
  hand: string[];
  /** Every card seen: the opening hand and each draw. */
  drawn: string[];
}

export interface GameOptions {
  turns: number;
  /** London mulligan: keep 2-5 lands, else mulligan, at most twice. */
  mulligan: boolean;
  /** Play first (no draw on turn one)? In multiplayer most people draw. */
  drawFirst: boolean;
  /** A fixed opening hand to play from (best-hand search). */
  hand?: SimCard[];
}

const keepable = (hand: SimCard[]) => {
  const lands = hand.filter((c) => c.kind === 'land').length;
  return lands >= 2 && lands <= 5;
};

export function playGame(deck: SimCard[], commander: SimCard | null, rand: () => number, opts: GameOptions): GameLog {
  let library: SimCard[];
  let hand: SimCard[];
  let mulligans = 0;
  if (opts.hand) {
    const rest = [...deck];
    for (const c of opts.hand) rest.splice(rest.indexOf(c), 1);
    library = shuffle(rest, rand);
    hand = [...opts.hand];
  } else {
    library = shuffle(deck, rand);
    hand = library.splice(0, 7);
    // London mulligan, at most twice; the first is free in multiplayer Commander.
    while (opts.mulligan && !keepable(hand) && mulligans < 2) {
      mulligans += 1;
      library = shuffle([...library, ...hand], rand);
      hand = library.splice(0, 7);
      const bottom = Math.max(0, mulligans - 1);
      // Put back what helps least: the most expensive non-lands, or extra lands.
      const lands = hand.filter((c) => c.kind === 'land').length;
      const order = [...hand].sort((a, b) => (lands > 4 ? Number(b.kind === 'land') - Number(a.kind === 'land') : b.mv - a.mv));
      for (const c of order.slice(0, bottom)) { hand.splice(hand.indexOf(c), 1); library.push(c); }
    }
  }

  const sources: Source[] = [];
  const log: GameLog = { commanderTurn: null, lands: [], mana: [], spent: [], stuck: [], mulligans, hand: hand.map((c) => c.name), drawn: hand.map((c) => c.name) };
  let commanderCast = !commander;
  let lands = 0;

  for (let turn = 1; turn <= opts.turns; turn++) {
    if (turn > 1 || opts.drawFirst) { const d = library.shift(); if (d) { hand.push(d); log.drawn.push(d.name); } }
    for (const s of sources) s.ready = true;
    let spent = 0;

    // Land: an untapped one if it lets something be cast now, else a tapped one first.
    const handLands = hand.filter((c) => c.kind === 'land');
    if (handLands.length) {
      const tapped = handLands.find((c) => c.tapped);
      const untapped = handLands.find((c) => !c.tapped);
      const mana = sources.filter((s) => s.ready).reduce((n, s) => n + s.makes, 0);
      const wantsNow = hand.some((c) => c.kind !== 'land' && c.mv === mana + 1);
      const land = (wantsNow && untapped) || tapped || untapped!;
      hand.splice(hand.indexOf(land), 1);
      sources.push({ colors: land.colors.length ? land.colors : ['C'], makes: 1, ready: !land.tapped });
      lands += 1;
    }
    log.mana.push(sources.filter((s) => s.ready).reduce((n, s) => n + s.makes, 0));

    // Cast: mana first, then the commander, then the biggest spells that fit.
    for (;;) {
      const castable = [
        ...hand.filter((c) => c.kind !== 'land').map((c) => ({ c, fromHand: true })),
        ...(!commanderCast && commander ? [{ c: commander, fromHand: false }] : []),
      ].filter(({ c }) => canPay(c, sources));
      if (!castable.length) break;
      const rank = ({ c, fromHand }: { c: SimCard; fromHand: boolean }) =>
        (c.kind === 'rock' || c.kind === 'dork' || c.kind === 'landRamp' ? 1000 : 0) + (!fromHand ? 500 : 0) + c.mv;
      const pick = castable.sort((a, b) => rank(b) - rank(a))[0];
      const paid = canPay(pick.c, sources)!;
      for (const i of paid) sources[i].ready = false;
      if (pick.fromHand) hand.splice(hand.indexOf(pick.c), 1); else { commanderCast = true; log.commanderTurn = turn; }
      spent += pick.c.mv;
      if (pick.c.kind === 'rock') sources.push({ colors: pick.c.colors.length ? pick.c.colors : ['C'], makes: pick.c.makes, ready: true });
      if (pick.c.kind === 'dork') sources.push({ colors: pick.c.colors.length ? pick.c.colors : ['C'], makes: pick.c.makes, ready: false });
      if (pick.c.kind === 'landRamp') {
        for (let k = 0; k < pick.c.fetches; k++) sources.push({ colors: [...COLORS], makes: 1, ready: false });
        lands += pick.c.fetches;
      }
    }
    log.lands.push(lands);
    log.spent.push(spent);
  }
  log.stuck = hand.filter((c) => c.kind !== 'land').map((c) => c.name);
  return log;
}

// --- many games -----------------------------------------------------------

export interface GoldfishReport {
  games: number;
  /** Share of games the commander was cast by each turn (index 0 = turn 1). */
  commanderBy: number[];
  /** Average turn the commander came down, in games where it did. */
  commanderAverage: number | null;
  /** Share of games with a land drop missed by turn 3, 4 and 5. */
  missedLandBy: { 3: number; 4: number; 5: number };
  /** Average mana available on turns 1-8. */
  manaByTurn: number[];
  /** Average mana value cast by the end of turn 4 and turn 6. */
  spentBy: { 4: number; 6: number };
  mulliganRate: number;
  /** Cards most often still in hand at the end, as a share of the games they were drawn in. */
  stuck: Array<{ name: string; share: number }>;
}

export function goldfish(deck: SimCard[], commander: SimCard | null, games = 2000, seed = 1, turns = 8): GoldfishReport {
  const rand = rng(seed);
  const logs: GameLog[] = [];
  for (let g = 0; g < games; g++) logs.push(playGame(deck, commander, rand, { turns, mulligan: true, drawFirst: true }));
  const share = (f: (l: GameLog) => boolean) => logs.filter(f).length / games;
  const cmdTurns = logs.map((l) => l.commanderTurn).filter((t): t is number => t !== null);
  const stuckCount = new Map<string, number>();
  const drawnCount = new Map<string, number>();
  for (const l of logs) {
    for (const n of new Set(l.stuck)) stuckCount.set(n, (stuckCount.get(n) ?? 0) + 1);
    for (const n of new Set(l.drawn)) drawnCount.set(n, (drawnCount.get(n) ?? 0) + 1);
  }
  return {
    games,
    commanderBy: Array.from({ length: turns }, (_, t) => share((l) => l.commanderTurn !== null && l.commanderTurn <= t + 1)),
    commanderAverage: cmdTurns.length ? cmdTurns.reduce((a, b) => a + b, 0) / cmdTurns.length : null,
    missedLandBy: {
      3: share((l) => l.lands[2] < 3), 4: share((l) => l.lands[3] < 4), 5: share((l) => l.lands[4] < 5),
    },
    manaByTurn: Array.from({ length: turns }, (_, t) => logs.reduce((n, l) => n + l.mana[t], 0) / games),
    spentBy: {
      4: logs.reduce((n, l) => n + l.spent.slice(0, 4).reduce((a, b) => a + b, 0), 0) / games,
      6: logs.reduce((n, l) => n + l.spent.slice(0, 6).reduce((a, b) => a + b, 0), 0) / games,
    },
    mulliganRate: share((l) => l.mulligans > 0),
    stuck: [...stuckCount.entries()]
      // Only cards drawn often enough to say.
      .filter(([name]) => (drawnCount.get(name) ?? 0) >= games * 0.05)
      .map(([name, n]) => ({ name, share: n / drawnCount.get(name)! }))
      .filter((s) => s.share >= 0.25)
      .sort((a, b) => b.share - a.share)
      .slice(0, 8),
  };
}

// --- the best opening hand --------------------------------------------------

/** How good a start is: the commander early, mana spent by turn four, no land drops missed. */
function startScore(logs: GameLog[]): number {
  let score = 0;
  for (const l of logs) {
    const spent = l.spent.slice(0, 4).reduce((a, b) => a + b, 0);
    score += spent + (l.commanderTurn ? Math.max(0, 6 - l.commanderTurn) * 2 : 0) - (l.lands[3] < 4 ? 3 : 0);
  }
  return score / logs.length;
}

export interface BestHand {
  cards: string[];
  /** In games from this hand: the commander's average turn, and mana spent by turn four. */
  commanderAverage: number | null;
  spentBy4: number;
}

/**
 * The strongest opening seven this deck can draw: built a card at a time,
 * keeping the few best partial hands at each step (a beam search), each
 * judged by playing it out against many shuffled libraries.
 */
export function bestHand(deck: SimCard[], commander: SimCard | null, opts: { beam?: number; trials?: number; seed?: number } = {}): BestHand {
  const beamWidth = opts.beam ?? 5;
  const trials = opts.trials ?? 40;
  const rand = rng(opts.seed ?? 7);
  // One of each card is enough to choose from.
  const unique = [...new Map(deck.map((c) => [c.name, c])).values()];
  const judge = (hand: SimCard[]) => {
    // Fill a partial hand's empty places from the library, as draws would.
    const logs: GameLog[] = [];
    for (let t = 0; t < trials; t++) {
      const rest = shuffle(deck.filter((c) => !hand.includes(c)), rand);
      const full = [...hand, ...rest.slice(0, 7 - hand.length)];
      logs.push(playGame(deck, commander, rand, { turns: 5, mulligan: false, drawFirst: true, hand: full }));
    }
    return startScore(logs);
  };
  let beam: Array<{ hand: SimCard[]; score: number }> = [{ hand: [], score: 0 }];
  for (let size = 1; size <= 7; size++) {
    const next: Array<{ hand: SimCard[]; score: number }> = [];
    const tried = new Set<string>();
    for (const { hand } of beam) {
      for (const c of unique) {
        const copies = deck.filter((x) => x.name === c.name).length;
        if (hand.filter((x) => x.name === c.name).length >= copies) continue;
        const pick = deck.find((x) => x.name === c.name && !hand.includes(x))!;
        const h = [...hand, pick];
        const key = h.map((x) => x.name).sort().join('|');
        if (tried.has(key)) continue;
        tried.add(key);
        next.push({ hand: h, score: judge(h) });
      }
    }
    beam = next.sort((a, b) => b.score - a.score).slice(0, beamWidth);
  }
  const best = beam[0].hand;
  const logs = Array.from({ length: 300 }, () => playGame(deck, commander, rand, { turns: 6, mulligan: false, drawFirst: true, hand: best }));
  const cmd = logs.map((l) => l.commanderTurn).filter((t): t is number => t !== null);
  return {
    cards: best.map((c) => c.name),
    commanderAverage: cmd.length ? cmd.reduce((a, b) => a + b, 0) / cmd.length : null,
    spentBy4: logs.reduce((n, l) => n + l.spent.slice(0, 4).reduce((a, b) => a + b, 0), 0) / logs.length,
  };
}

/** A deck's cards as the simulator sees them, one entry per copy. */
export function simDeck(cards: Array<{ card: ScryfallCard; quantity: number }>): SimCard[] {
  return cards.flatMap(({ card, quantity }) => Array.from({ length: quantity }, () => simCard(card)));
}
