/**
 * Which of the owner's cards Finish may offer (handoff 8, Part A), worked out
 * by code once per run, and the lands it adds on a full fill (Part D).
 *
 * A copy is either in a box (collection_cards: a spare copy, free to use) or
 * held by a deck (its list). "Only spare copies" offers a card only when a
 * box holds a copy; a card that sits in another deck with a second copy in a
 * box is on offer. "Take from other decks too" offers every card the owner
 * holds, and a card only another deck holds names that deck. Cards waiting in
 * this deck's own sections (the Maybeboard) are on offer under both.
 *
 * Then Tune's own checks (addable in lib/tune.ts): the colours, Commander
 * legal, not in the deck, the budget, the deck rule and the bracket. Claude
 * never sees a card it may not pick. Server only.
 */

import { database } from './db';
import { addable, gcRoomOf, type Context } from './tune';
import { imageOf, manaCostOf, oracleTextOf, typeLineOf, type ScryfallCard } from './scryfall';
import type { Copies, PoolLine, Source } from './finish-shared';
import { localCards } from './card-store';
import { sectionsOf } from './sections';

const keyOf = (c: ScryfallCard) => c.oracle_id ?? c.id;
const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
export const isLand = (c: ScryfallCard) => /\bLand\b/.test((c.type_line ?? '').split('//')[0]);
const isBasic = (c: ScryfallCard) => /\bBasic\b/.test(c.type_line ?? '');
const NOT_PROXY = `(',' || cc.variant || ',') NOT LIKE '%,proxy,%'`;

export interface Held {
  card: ScryfallCard;
  /** Copies in the owner's boxes. */
  boxes: number;
  /** The other decks that list it. */
  decks: string[];
  /** In this deck's own sections (Maybeboard and the like). */
  here: boolean;
  /** Which of this deck's sections, by name. */
  sections: string[];
}

/** Everything the owner holds, by card: copies in boxes, the other decks that list it, and this deck's sections. */
export function heldCards(profileId: string, listId: string): Map<string, Held> {
  const d = database();
  const out = new Map<string, Held>();
  const at = (card: ScryfallCard) => {
    const k = keyOf(card);
    let h = out.get(k);
    if (!h) { h = { card, boxes: 0, decks: [], here: false, sections: [] }; out.set(k, h); }
    return h;
  };
  for (const r of d.all(`SELECT c.data, SUM(cc.quantity) AS n FROM collection_cards cc JOIN cards c ON c.id = cc.cardId
    WHERE cc.profileId = ? AND cc.quantity > 0 AND ${NOT_PROXY} GROUP BY cc.cardId`, [profileId]) as Array<{ data: string; n: number }>) {
    at(JSON.parse(r.data) as ScryfallCard).boxes += r.n;
  }
  // Another deck's main board and its commander hold a copy; its sections are only ideas.
  for (const r of d.all(`SELECT c.data, l.name FROM list_cards lc JOIN lists l ON l.id = lc.listId JOIN cards c ON c.id = lc.cardId
    WHERE l.profileId = ? AND l.kind = 'deck' AND l.id != ? AND lc.board = 'main'
    UNION ALL SELECT c.data, l.name FROM lists l JOIN cards c ON c.id = l.commanderId WHERE l.profileId = ? AND l.kind = 'deck' AND l.id != ?`,
  [profileId, listId, profileId, listId]) as Array<{ data: string; name: string }>) {
    const h = at(JSON.parse(r.data) as ScryfallCard);
    if (!h.decks.includes(r.name)) h.decks.push(r.name);
  }
  const own = sectionsOf(listId);
  for (const r of d.all(`SELECT c.data, lc.board FROM list_cards lc JOIN cards c ON c.id = lc.cardId WHERE lc.listId = ? AND lc.board != 'main'`, [listId]) as Array<{ data: string; board: string }>) {
    const h = at(JSON.parse(r.data) as ScryfallCard);
    h.here = true;
    const name = own.find((x) => x.id === r.board)?.name ?? (r.board === 'side' ? 'Sideboard' : 'Maybeboard');
    if (!h.sections.includes(name)) h.sections.push(name);
  }
  return out;
}

/** Where the copy a pick uses comes from, under a setting; null when the setting doesn't offer it. */
export function sourceOf(h: Held, copies: Copies): { src: Source; deck?: string; section?: string } | null {
  if (h.boxes > 0) return { src: 'spare' };
  if (h.here) return { src: 'maybe', section: h.sections[0] ?? 'Maybeboard' };
  if (copies === 'any' && h.decks.length) return { src: 'other', deck: h.decks[0] };
  return null;
}

const COLOUR_WORD: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colourless' };
/**
 * What a land makes and how it enters, as words a search can match (Part E): "makes-blue, makes-red, untapped".
 * Worked out in code from the card's mana and rules text, so Claude needn't read every land to find them.
 */
export function landWords(c: ScryfallCard, identity?: Set<string>): string {
  const makes = [...'WUBRGC'].filter((m) => (c.produced_mana ?? []).includes(m) && (!identity || m === 'C' || identity.has(m))).map((m) => `makes-${COLOUR_WORD[m]}`);
  const text = oracleTextOf(c);
  const tapped = /enters (the battlefield )?tapped/i.test(text) ? (/unless|if you (control|don't)|you may pay/i.test(text) ? 'sometimes-tapped' : 'enters-tapped') : 'untapped';
  return [...makes, tapped].join(', ');
}

/**
 * One card as a search answers it. Finish's lines end "(in <deck>)" only for a card another deck holds (its
 * prompt and tests rely on that); Chat's (`where`) say where every copy is: a spare copy, this deck's section,
 * or the other deck.
 */
export function poolLine(card: ScryfallCard, src: Source, deck?: string, opts: { section?: string; where?: boolean } = {}): PoolLine {
  const text = oracleTextOf(card).replace(/\n+/g, ' / ');
  const end = opts.where
    ? (src === 'other' && deck ? ` (in ${deck})` : src === 'maybe' ? ` (in this deck's ${opts.section ?? 'Maybeboard'})` : ' (spare copy)')
    : (src === 'other' && deck ? ` (in ${deck})` : '');
  return {
    name: card.name,
    line: `${card.name} ${manaCostOf(card)} - ${typeLineOf(card)} - ${text || '(no rules text)'}${end}`,
    cmc: card.cmc ?? 0, typeLine: typeLineOf(card), src, ...(deck ? { deck } : {}), ...(opts.section ? { section: opts.section } : {}),
    id: card.id, image: imageOf(card, 'normal'),
  };
}

export interface Pool {
  lines: PoolLine[];
  cards: Map<string, ScryfallCard>;
  /**
   * Finish only (Part E): the owner's nonbasic lands that may go in (colours, legal, the copies setting, not in
   * the deck, Tune's checks), searched only when Claude asks for t:land, so they never crowd the spell picks.
   */
  lands: { lines: PoolLine[]; cards: Map<string, ScryfallCard> };
  counts: { held: number; fit: number; spare: number; any: number; otherOnly: number };
  held: Map<string, Held>;
}

/**
 * The pool under a setting: not a land (Finish: the app picks those), then
 * Tune's checks (one pass of addable). A Game Changer is held back only when
 * the bracket has no room left; how many go in is checked on the picks.
 * Chat's search (`chat`) lets lands in and writes where each copy is.
 */
export function finishPool(ctx: Context, copies: Copies, held = heldCards(ctx.profileId, ctx.list.id), opts: { chat?: boolean; leaveOut?: Set<string> } = {}): Pool {
  const all = [...held.values()];
  const fit = all.filter((h) => (h.card.color_identity ?? []).every((x) => ctx.identity.has(x)) && h.card.legalities?.commander === 'legal');
  const room = gcRoomOf(ctx);
  // Cards skipped on this deck before (Part D 14) are never on offer again.
  const out = (h: Held) => !!opts.leaveOut?.has(front(h.card.name));
  const ok = new Set(addable(ctx, fit.filter((h) => (opts.chat || !isLand(h.card)) && !out(h)).map((h) => h.card), room === 0 ? 0 : null).map(keyOf));
  // Chat: a basic is never "already in the deck" (any number may go in), so the owner's basics stay searchable.
  if (opts.chat) for (const h of fit) if (isBasic(h.card) && !out(h)) ok.add(keyOf(h.card));
  const offered = (c: Copies) => fit.filter((h) => ok.has(keyOf(h.card)) && sourceOf(h, c));
  const spare = offered('spare');
  const any = offered('any');
  const mine = copies === 'spare' ? spare : any;
  const lines = mine.map((h) => { const s = sourceOf(h, copies)!; return poolLine(h.card, s.src, s.deck, { section: s.section, where: opts.chat }); }).sort((a, b) => a.name.localeCompare(b.name));
  const cards = new Map<string, ScryfallCard>();
  for (const h of mine) { cards.set(h.card.name.toLowerCase(), h.card); cards.set(front(h.card.name), h.card); }
  const landOk = opts.chat ? [] : addable(ctx, fit.filter((h) => isLand(h.card) && !isBasic(h.card) && !out(h) && sourceOf(h, copies)).map((h) => h.card), null);
  const landLines = landOk.map((c) => {
    const s = sourceOf(held.get(keyOf(c))!, copies)!;
    const l = poolLine(c, s.src, s.deck, { section: s.section });
    return { ...l, line: `${l.line} [${landWords(c, ctx.identity)}]` };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const landCards = new Map<string, ScryfallCard>();
  for (const c of landOk) { landCards.set(c.name.toLowerCase(), c); landCards.set(front(c.name), c); }
  return { lines, cards, held, lands: { lines: landLines, cards: landCards }, counts: { held: all.length, fit: fit.length, spare: spare.length, any: any.length, otherOnly: any.length - spare.length } };
}

// --- lands on a full fill ---------------------------------------------------------------

export const BASIC: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

/** Colour symbols in a list of costs, by colour ({W/U} counts for both, {2/W} for W). */
export function pips(costs: string[], identity: Set<string>): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries([...identity].map((c) => [c, 0]));
  for (const cost of costs) for (const sym of cost.match(/\{[^}]+\}/g) ?? []) for (const c of sym.slice(1, -1).split('/')) if (c in out) out[c] += 1;
  return out;
}

/** n basics split by the colour symbols: largest share first, the remainders by size. */
export function splitBasics(n: number, pip: Record<string, number>): Record<string, number> {
  const colors = Object.keys(pip);
  if (!colors.length || n <= 0) return {};
  const total = Object.values(pip).reduce((a, b) => a + b, 0);
  const share = (c: string) => (total ? pip[c] / total : 1 / colors.length) * n;
  const out: Record<string, number> = Object.fromEntries(colors.map((c) => [c, Math.floor(share(c))]));
  let left = n - Object.values(out).reduce((a, b) => a + b, 0);
  for (const c of [...colors].sort((a, b) => (share(b) - Math.floor(share(b))) - (share(a) - Math.floor(share(a))) || pip[b] - pip[a])) {
    if (left <= 0) break;
    out[c] += 1; left -= 1;
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v > 0));
}

export interface LandPick { card: ScryfallCard; n: number; src: Source; deck?: string; why?: string }

/**
 * How many nonbasic lands Claude may choose (Part E, the owner's numbers, 2026-11-13): up to a third of the
 * land total on a one-colour deck, up to half on more, less the nonbasic lands already in the deck.
 */
export function nonbasicLimit(ctx: Context, target: number): number {
  const have = ctx.main.filter((c) => isLand(c.card) && !isBasic(c.card)).reduce((n, c) => n + c.quantity, 0);
  return Math.max(0, Math.floor(target * (ctx.identity.size <= 1 ? 1 / 3 : 1 / 2)) - have);
}

/**
 * Basics for the slots the nonbasic lands leave: each colour's share of the colour symbols (the deck and the
 * picks) sets how many sources it wants out of all n lands; what the chosen lands already make counts toward
 * it, and the basics go where it is still short. A land that makes no coloured mana takes a basic's place;
 * a colour left short of its share is reported, for the owner to decide.
 */
export function basicsFor(ctx: Context, n: number, nonbasics: ScryfallCard[], pickCosts: string[]): { split: Record<string, number>; short: Array<{ colour: string; have: number; want: number }> } {
  if (!ctx.identity.size || n <= 0) return { split: {}, short: [] };
  const costs = [...ctx.main.map((c) => manaCostOf(c.card)), ...ctx.commanders.map(manaCostOf), ...pickCosts];
  const pip = pips(costs, ctx.identity);
  const total = Object.values(pip).reduce((a, b) => a + b, 0);
  const colours = [...ctx.identity];
  const share = (c: string) => (total ? pip[c] / total : 1 / colours.length);
  const makes = (c: string) => nonbasics.filter((l) => (l.produced_mana ?? []).includes(c)).length;
  const room = Math.max(0, n - nonbasics.length);
  const need = Object.fromEntries(colours.map((c) => [c, Math.max(0, share(c) * n - makes(c))]));
  const weights = Object.values(need).some((v) => v > 0) ? need : Object.fromEntries(colours.map((c) => [c, share(c)]));
  const split = splitBasics(room, weights);
  const short = colours.map((c) => ({ colour: c, have: (split[c] ?? 0) + makes(c), want: Math.round(share(c) * n) })).filter((x) => x.have < x.want);
  return { split, short };
}

/**
 * A run from before Part E (no land picks from Claude): the owner's lands that make two or more of the deck's
 * colours, the most colours first, up to half of what is short. A one-colour deck gets none.
 */
export function dualCandidates(ctx: Context, held: Map<string, Held>, copies: Copies, n: number): LandPick[] {
  if (n <= 0 || ctx.identity.size < 2) return [];
  const inDeck = new Set(ctx.main.map((c) => front(c.card.name)));
  return addable(ctx, [...held.values()].filter((h) => isLand(h.card) && !isBasic(h.card) && sourceOf(h, copies) && !inDeck.has(front(h.card.name))
    && (h.card.produced_mana ?? []).filter((m) => ctx.identity.has(m)).length >= 2).map((h) => h.card), null)
    .sort((a, b) => (b.produced_mana ?? []).filter((m) => ctx.identity.has(m)).length - (a.produced_mana ?? []).filter((m) => ctx.identity.has(m)).length || a.name.localeCompare(b.name))
    .slice(0, Math.floor(n / 2))
    .map((card) => { const s = sourceOf(held.get(keyOf(card))!, copies)!; return { card, n: 1, ...s }; });
}

/**
 * The lands for a full fill: the nonbasic lands (Claude's picks, Part E; or, for an older run, the colour-fixing
 * candidates), then basics for the rest by basicsFor, so the land number never changes. A colour left short of
 * its share is returned for the Lands box to say.
 */
export function finishLands(ctx: Context, held: Map<string, Held>, copies: Copies, n: number, pickCosts: string[], nonbasics?: LandPick[]): { lands: LandPick[]; short: Array<{ colour: string; have: number; want: number }> } {
  if (n <= 0 || !ctx.identity.size) return { lands: [], short: [] };
  const nb = (nonbasics ?? dualCandidates(ctx, held, copies, n)).slice(0, n);
  const { split, short } = basicsFor(ctx, n, nb.map((l) => l.card), pickCosts);
  const out: LandPick[] = [...nb];
  const basics = localCards(Object.keys(split).map((c) => BASIC[c]));
  const basicOf = (c: string) => ctx.main.find((x) => x.card.name === BASIC[c])?.card ?? basics.find((b) => b.name === BASIC[c]);
  // A basic the card data lacks gives its count to the colour with the most: the deck still reaches the number.
  const have = Object.entries(split).filter(([c]) => basicOf(c)).sort((a, b) => b[1] - a[1]);
  const lost = Object.entries(split).filter(([c]) => !basicOf(c)).reduce((k, [, v]) => k + v, 0);
  if (have.length) have[0][1] += lost;
  for (const [c, k] of have) out.push({ card: basicOf(c)!, n: k, src: 'spare' });
  return { lands: out, short };
}
