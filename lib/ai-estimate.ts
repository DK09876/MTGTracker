/**
 * What an AI step on a deck page will cost, shown on its button before it
 * runs. Most of a call is the deck itself (every card with its rules text),
 * so the price follows the deck's size: measured with Claude Opus, Plan
 * suggestions cost 13¢ on a 120-card deck and 6¢ on a 16-card one.
 *
 * In order: this deck's own earlier runs of the step (the usage trail keeps
 * a week, labelled with the deck's name); else the step's runs on other decks,
 * scaled to this deck's size; else a per-step guess, scaled the same way.
 * Server only.
 */

import { cardsInList, database } from './db';

export interface CostEstimate { usd: number; measured: boolean }

/** What each step costs on a 100-card deck, from real runs (handoff 6 walkthrough), for before any run. */
export const PER_100: Record<string, number> = {
  'plan suggestions': 0.116,
  'refine tags': 0.152,
  'trim: write the approach': 0.027,
  'trim: rank the cuts (opus)': 0.18,
};

/** About 40% of a call is fixed (the instructions); the rest grows with the deck. */
export const scale = (cards: number) => 0.4 + 0.6 * (Math.max(1, cards) / 100);

const sizeOf = (listId: string): { cards: number; name: string } => {
  const d = database();
  const l = d.get('SELECT name, commanderId FROM lists WHERE id = ?', [listId]) as { name: string; commanderId: string | null } | null;
  const main = cardsInList(listId).filter((c) => c.board === 'main').reduce((n, c) => n + c.quantity, 0);
  return { cards: main + (l?.commanderId ? 1 : 0), name: l?.name ?? '' };
};

export function estimateCost(listId: string, step: string): CostEstimate {
  const { cards, name } = sizeOf(listId);
  const avg = (where: string, args: string[]) => {
    try {
      const r = database().get(`SELECT AVG(cost) AS usd, COUNT(*) AS n FROM ai_calls WHERE step = ? AND outcome = 'ok' AND cost > 0 ${where}`, [step, ...args]) as { usd: number | null; n: number } | null;
      return r?.n && r.usd ? r.usd : null;
    } catch { return null; } // no usage trail yet
  };
  const mine = name ? avg('AND label = ?', [name]) : null;
  if (mine !== null) return { usd: mine, measured: true };
  // Runs on other decks are taken as 100-card decks and scaled to this one.
  const others = avg('', []);
  return { usd: (others ?? PER_100[step] ?? 0.1) * scale(cards), measured: false };
}
