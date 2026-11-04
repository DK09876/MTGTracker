/**
 * Which cards to look at first when a deck is over 100, each with its
 * reasons - no AI. A card scores for being in a role the deck runs too many
 * of, for fitting nothing the commander cares about, for being rarely
 * played, for costing a lot without ending the game, and for having no role
 * or tag at all; it scores against for being in a role the deck is short
 * on. Cards the owner tagged as a win condition, engine or payoff are
 * protected and never offered. Pure.
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
}

export interface CutInput {
  cards: Array<{ card: ScryfallCard; quantity: number }>;
  roles: RoleCount[];
  fit: FitProfile | null;
  tags: DeckTags | null;
  /** EDHREC's numbers for the commander, when it is on. */
  stats: Map<string, CardStats> | null;
  lands: { have: number; want: number };
}

const PROTECTING = new Set(['wincon', 'engine', 'payoff']);
const FINISHING = new Set(['wincon', 'finisher', 'extra-turn', 'extra-combat', 'overrun', 'drain']);
const isLand = (c: ScryfallCard) => /\bLand\b/.test((c.type_line ?? '').split('//')[0]);
const front = (name: string) => name.split(' // ')[0];

export function cutCandidates(input: CutInput): { candidates: CutCandidate[]; protectedCards: string[] } {
  const { cards, roles, fit, tags, stats, lands } = input;
  // Cards the owner's own tags say carry the plan.
  const keyTags = new Set((tags?.tags ?? []).filter((t) => t.status === 'accepted' && t.kind && PROTECTING.has(t.kind)).map((t) => t.id));
  const on = (tags?.cardTags ?? []).filter((ct) => ct.on);
  const keyCards = new Set(on.filter((ct) => keyTags.has(ct.tagId)).map((ct) => ct.key));
  const anyTag = new Set(on.map((ct) => ct.key));
  const rolesOf = new Map<string, RoleCount[]>();
  for (const r of roles) for (const name of r.cards) rolesOf.set(name, [...(rolesOf.get(name) ?? []), r]);

  const candidates: CutCandidate[] = [];
  const protectedCards: string[] = [];
  for (const { card } of cards) {
    if (isLand(card)) continue;
    const key = card.oracle_id ?? card.id;
    if (keyCards.has(key)) { protectedCards.push(card.name); continue; }
    const mine = rolesOf.get(card.name) ?? [];
    const reasons: string[] = [];
    let score = 0;

    for (const r of mine) {
      if (r.target && r.count > r.target[1]) { score += 1; reasons.push(`${r.label}: ${r.count}, more than ${r.target[0]}–${r.target[1]}`); }
      if (r.target && r.count <= r.target[0]) { score -= 1; reasons.push(`Needed: ${r.label.toLowerCase()} ${r.count} of ${r.target[0]}–${r.target[1]}`); }
    }
    const f = fitOf(card, fit);
    if (fit && !f.matches.length && !mine.some((r) => FINISHING.has(r.id))) { score += 0.8; reasons.push(`Nothing ${fit.commander} cares about`); }
    if (f.score >= 1) score -= 0.5;

    const s = stats?.get(front(card.name)) ?? stats?.get(card.name);
    if (stats) {
      if (!s) { score += 0.4; reasons.push(`Not on EDHREC's list for ${fit?.commander ?? 'the commander'}`); } else if (s.inclusion < 0.05) { score += 0.6; reasons.push(`In ${Math.round(s.inclusion * 100)}% of ${fit?.commander ?? 'its'} decks`); }
    } else if (popularity(card) < 0.3) {
      score += 0.5;
      const rank = (card as { edhrec_rank?: number }).edhrec_rank;
      reasons.push(rank ? `Rarely played in Commander (#${rank.toLocaleString()})` : 'Rarely played in Commander');
    }

    if ((card.cmc ?? 0) >= 6 && !mine.some((r) => FINISHING.has(r.id))) { score += 0.4; reasons.push(`Costs ${card.cmc} and does not end the game`); }
    if (mine.length === 1 && mine[0].id === 'cantrip' && !f.matches.length) { score += 0.3; reasons.push('Only replaces itself'); }
    if (!mine.length && !anyTag.has(key)) { score += 0.5; reasons.push('No role and none of your tags'); }

    if (score > 0) candidates.push({ cardId: card.id, name: card.name, score: Math.round(score * 10) / 10, reasons, roles: mine.map((r) => r.id) });
  }

  // Over on lands: a basic or two can go first.
  if (lands.have > lands.want + 1) {
    const basics = cards.filter((c) => /\bBasic\b/.test(c.card.type_line ?? '')).sort((a, b) => b.quantity - a.quantity);
    if (basics[0]) {
      candidates.push({
        cardId: basics[0].card.id, name: basics[0].card.name, score: 1.5, roles: [],
        reasons: [`Lands: ${lands.have}, the formula says ${lands.want}`],
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { candidates, protectedCards: protectedCards.sort() };
}
