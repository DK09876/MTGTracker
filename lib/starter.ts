/**
 * A first list for a new deck, from its commander - no AI. The usual
 * Commander roles are filled first (ramp, card draw, removal, wipes,
 * protection, a few finishers), then the cards that best fit the commander,
 * then Karsten's land count: lands that make two or more of its colours,
 * and basics split by how much of each colour the spells ask for. Cards the
 * profile owns come first when asked; Game Changers are left out, so it
 * starts casual. A starting point to tune, not a finished deck.
 * Server only.
 */

import { karstenLands } from './build';
import { allLocalCards } from './card-store';
import { database } from './db';
import { fitOf, fitProfile, popularity } from './fit';
import { holdings } from './gap-cards';
import { ROLES } from './roles';
import type { ScryfallCard } from './scryfall';

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
const BASIC: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

/** How many of each role a starter runs, and the order they are filled in. */
const QUOTAS: Array<{ role: string; count: number }> = [
  { role: 'ramp', count: 10 },
  { role: 'draw', count: 10 },
  { role: 'removal', count: 8 },
  { role: 'wipe', count: 3 },
  { role: 'protection', count: 3 },
  { role: 'finisher', count: 2 },
];
const ALWAYS = ['Sol Ring', 'Arcane Signet', 'Command Tower'];

const isLand = (c: ScryfallCard) => /\bLand\b/.test((c.type_line ?? '').split('//')[0]);

/** The colours a land makes: Scryfall's list, or read from "Add {U} or {R}". */
function makes(card: ScryfallCard): string[] {
  if (card.produced_mana) return card.produced_mana;
  const text = card.oracle_text ?? '';
  if (/any color/i.test(text)) return [...COLORS];
  return COLORS.filter((c) => new RegExp(`Add[^.]*\\{${c}\\}`).test(text));
}

export interface Starter {
  /** Lines for the importer: "1 Sol Ring". */
  lines: string[];
  spells: number;
  lands: number;
}

export function starterList(commander: ScryfallCard, profileId: string, ownedFirst: boolean, pool: ScryfallCard[] = allLocalCards()): Starter {
  const identity = new Set(commander.color_identity ?? []);
  const fit = fitProfile(commander);
  const owned = ownedFirst ? holdings(profileId, null) : new Map<string, string>();
  const legal = pool.filter((c) => c.legalities?.commander === 'legal' && !c.game_changer
    && c.name !== commander.name && (c.color_identity ?? []).every((x) => identity.has(x)));

  const rolesOf = new Map<string, string[]>();
  for (const r of database().all('SELECT oracleId, role FROM card_roles') as Array<{ oracleId: string; role: string }>) {
    rolesOf.set(r.oracleId, [...(rolesOf.get(r.oracleId) ?? []), r.role]);
  }
  // Roles read from text (finishers) are not saved with the others.
  const textRoles = ROLES.filter((r) => r.text);
  const textOf = (c: ScryfallCard) => [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n');
  const rolesFor = (c: ScryfallCard) => [...(rolesOf.get(c.oracle_id ?? '') ?? []), ...textRoles.filter((r) => r.text!.test(textOf(c))).map((r) => r.id)];
  const score = (c: ScryfallCard) => fitOf(c, fit).score * 0.55 + popularity(c) * 0.45 + (owned.has(c.oracle_id ?? '') ? 0.25 : 0);
  const spells = legal.filter((c) => !isLand(c)).map((c) => ({ card: c, score: score(c), roles: rolesFor(c) }))
    .sort((a, b) => b.score - a.score);

  const chosen = new Map<string, ScryfallCard>();
  for (const name of ALWAYS) {
    const c = legal.find((x) => x.name === name);
    if (c && !isLand(c)) chosen.set(c.name, c);
  }
  // Roles first, the best-fitting cards in each; cheap ramp before dear.
  for (const { role, count } of QUOTAS) {
    const have = [...chosen.values()].filter((c) => rolesFor(c).includes(role)).length;
    const pickFrom = spells.filter((s) => s.roles.includes(role) && !chosen.has(s.card.name)
      && (role !== 'ramp' || (s.card.cmc ?? 9) <= 3) && (role !== 'draw' || !s.roles.includes('cantrip') || s.roles.length > 1));
    for (const s of pickFrom.slice(0, Math.max(0, count - have))) chosen.set(s.card.name, s.card);
  }
  // Then the plan: what fits the commander best, until the spells are full.
  const fill = (target: number) => {
    for (const s of spells) {
      if (chosen.size >= target) break;
      if (!chosen.has(s.card.name) && fitOf(s.card, fit).score > 0) chosen.set(s.card.name, s.card);
    }
    for (const s of spells) {
      if (chosen.size >= target) break;
      if (!chosen.has(s.card.name)) chosen.set(s.card.name, s.card);
    }
  };
  fill(99 - 37);
  // Karsten's lands for this curve, then the spells trimmed or topped up to fit.
  const list = [...chosen.values()];
  const mv = list.reduce((n, c) => n + (c.cmc ?? 0), 0) / Math.max(1, list.length);
  const cheap = list.filter((c) => (c.cmc ?? 0) <= 2 && (rolesOf.get(c.oracle_id ?? '') ?? []).some((r) => r === 'ramp' || r === 'draw')).length;
  const landCount = karstenLands(mv, cheap);
  const spellCount = 99 - landCount;
  if (chosen.size > spellCount) {
    const keep = new Set(list.sort((a, b) => score(b) - score(a)).slice(0, spellCount).map((c) => c.name));
    for (const name of [...chosen.keys()]) if (!keep.has(name)) chosen.delete(name);
  } else fill(spellCount);

  // Lands: Command Tower, lands making two or more of its colours, then basics.
  const colors = COLORS.filter((c) => identity.has(c));
  const lands: Array<[string, number]> = [];
  if (colors.length >= 2) {
    if (legal.some((c) => c.name === 'Command Tower')) lands.push(['Command Tower', 1]);
    const duals = legal.filter((c) => isLand(c) && !/\bBasic\b/.test(c.type_line ?? '') && c.name !== 'Command Tower'
      && makes(c).filter((m) => identity.has(m)).length >= 2)
      .sort((a, b) => score(b) - score(a))
      .slice(0, Math.min(colors.length * 3, 12));
    for (const d of duals) lands.push([d.name, 1]);
  }
  const basicsNeeded = landCount - lands.length;
  if (!colors.length) lands.push(['Wastes', basicsNeeded]);
  else {
    // Split by how many pips of each colour the spells have.
    const pips: Record<string, number> = {};
    for (const c of chosen.values()) for (const col of colors) pips[col] = (pips[col] ?? 0) + ((c.mana_cost ?? '').match(new RegExp(`\\{${col}\\}`, 'g'))?.length ?? 0) + 0.01;
    const total = colors.reduce((n, c) => n + pips[c], 0);
    let given = 0;
    colors.forEach((col, i) => {
      const n = i === colors.length - 1 ? basicsNeeded - given : Math.round((pips[col] / total) * basicsNeeded);
      given += n;
      if (n > 0) lands.push([BASIC[col], n]);
    });
  }

  return {
    lines: [...[...chosen.values()].map((c) => `1 ${c.name}`), ...lands.map(([name, n]) => `${n} ${name}`)],
    spells: chosen.size,
    lands: landCount,
  };
}
