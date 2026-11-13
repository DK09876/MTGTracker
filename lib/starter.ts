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

import { karstenLands, sourceWeight } from './deck-numbers';
import { allLocalCards } from './card-store';
import { sourcesNeeded } from './health';
import { database } from './db';
import { fitOf, fitProfile, quality } from './fit';
import { holdings } from './gap-cards';
import { fixRoles, ROLES } from './roles';
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

const LAND_TYPE: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

/**
 * The colours a land makes: Scryfall's list, or read from "Add {U} or {R}";
 * a fetch land counts for the basic types it can find.
 */
function makes(card: ScryfallCard): string[] {
  const text = card.oracle_text ?? '';
  const fetched = /search your library for an? [^.]*card/i.test(text)
    ? COLORS.filter((c) => new RegExp(`\\b${LAND_TYPE[c]}\\b`).test(text)) : [];
  if (card.produced_mana) return [...new Set([...card.produced_mana, ...fetched])];
  if (/any color/i.test(text)) return [...COLORS];
  return [...new Set([...COLORS.filter((c) => new RegExp(`Add[^.]*\\{${c}\\}`).test(text)), ...fetched])];
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
  // Spells that ask for three or more of one colour are hard to cast in a
  // deck of three or more colours (Karsten); a starter leaves them out.
  // So are two of a colour on a one- or two-drop.
  const pipsOf = (c: ScryfallCard, col: string) => (c.mana_cost ?? '').match(new RegExp(`\\{${col}\\}`, 'g'))?.length ?? 0;
  const hungry = (c: ScryfallCard) => identity.size >= 3
    && COLORS.some((col) => pipsOf(c, col) >= 3 || (pipsOf(c, col) >= 2 && (c.cmc ?? 0) <= 2));
  const legal = pool.filter((c) => c.legalities?.commander === 'legal' && !c.game_changer && !hungry(c)
    && c.name !== commander.name && (c.color_identity ?? []).every((x) => identity.has(x)));

  const rolesOf = new Map<string, string[]>();
  for (const r of database().all('SELECT oracleId, role FROM card_roles') as Array<{ oracleId: string; role: string }>) {
    rolesOf.set(r.oracleId, [...(rolesOf.get(r.oracleId) ?? []), r.role]);
  }
  // Roles read from text (finishers) are not saved with the others.
  const textRoles = ROLES.filter((r) => r.text);
  const textOf = (c: ScryfallCard) => [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n');
  const rolesFor = (c: ScryfallCard) => [...fixRoles(c, rolesOf.get(c.oracle_id ?? '') ?? []), ...textRoles.filter((r) => r.text!.test(textOf(c))).map((r) => r.id)];
  const ownedBonus = (c: ScryfallCard) => (owned.has(c.oracle_id ?? '') ? 0.25 : 0);
  // The plan's cards by fit; the role slots and lands by how good they are at the job.
  const score = (c: ScryfallCard) => fitOf(c, fit).score * 0.55 + quality(c, rolesFor(c)).score * 0.45 + ownedBonus(c);
  const staple = (c: ScryfallCard) => quality(c, rolesFor(c)).score * 0.75 + fitOf(c, fit).score * 0.25 + ownedBonus(c);
  const spells = legal.filter((c) => !isLand(c)).map((c) => ({ card: c, score: score(c), roles: rolesFor(c) }))
    .sort((a, b) => b.score - a.score);

  const chosen = new Map<string, ScryfallCard>();
  // The staples and role picks are kept whatever the land count turns out to be.
  const core = new Set<string>();
  for (const name of ALWAYS) {
    const c = legal.find((x) => x.name === name);
    if (c && !isLand(c)) { chosen.set(c.name, c); core.add(c.name); }
  }
  // Roles first, the best-fitting cards in each; cheap ramp before dear.
  for (const { role, count } of QUOTAS) {
    const have = [...chosen.values()].filter((c) => rolesFor(c).includes(role)).length;
    const pickFrom = spells.filter((s) => s.roles.includes(role) && !chosen.has(s.card.name)
      && (role !== 'ramp' || (s.card.cmc ?? 9) <= 3) && (role !== 'draw' || !s.roles.includes('cantrip') || s.roles.length > 1))
      .sort((a, b) => staple(b.card) - staple(a.card));
    for (const s of pickFrom.slice(0, Math.max(0, count - have))) { chosen.set(s.card.name, s.card); core.add(s.card.name); }
  }
  // Then the plan: what fits the commander best, until the spells are full -
  // but not more of a role already at its guideline (Treasure makers count as
  // ramp and draw, and would pile up).
  const quota = new Map(QUOTAS.map((q) => [q.role, q.count + 2]));
  const full = (roles: string[]) => roles.some((r) => quota.has(r)
    && [...chosen.values()].filter((c) => rolesFor(c).includes(r)).length >= quota.get(r)!);
  const fill = (target: number) => {
    for (const pass of [true, false]) {
      for (const s of spells) {
        if (chosen.size >= target) break;
        if (chosen.has(s.card.name) || full(s.roles)) continue;
        if (pass && fitOf(s.card, fit).score === 0) continue;
        chosen.set(s.card.name, s.card);
      }
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
    // Trim the plan's weakest; the core stays.
    const extra = list.filter((c) => !core.has(c.name)).sort((a, b) => score(a) - score(b));
    for (const c of extra.slice(0, chosen.size - spellCount)) chosen.delete(c.name);
  } else fill(spellCount);

  // Lands: Command Tower, lands making two or more of its colours, then basics.
  const colors = COLORS.filter((c) => identity.has(c));
  const lands: Array<[string, number]> = [];
  if (colors.length >= 2) {
    if (legal.some((c) => c.name === 'Command Tower')) lands.push(['Command Tower', 1]);
    const duals = legal.filter((c) => isLand(c) && !/\bBasic\b/.test(c.type_line ?? '') && c.name !== 'Command Tower'
      && makes(c).filter((m) => identity.has(m)).length >= 2)
      // Lands that make only its colours, untapped and making the most of them first.
      .filter((c) => makes(c).every((m) => identity.has(m) || m === 'C'))
      .sort((a, b) => staple(b) - staple(a))
      .slice(0, colors.length >= 4 ? 24 : colors.length === 3 ? 20 : colors.length * 4);
    for (const d of duals) lands.push([d.name, 1]);
  }
  const basicsNeeded = landCount - lands.length;
  if (!colors.length) lands.push(['Wastes', basicsNeeded]);
  else {
    // Basics go where sources are still most needed: each colour wants what
    // Karsten's table says for its hungriest spell, less what the other
    // lands (and, at part of a source each, the rocks and dorks) already make of it.
    const want: Record<string, number> = Object.fromEntries(colors.map((c) => [c, 0]));
    for (const card of chosen.values()) {
      const gold = colors.filter((c) => pipsOf(card, c) > 0).length > 1;
      for (const c of colors) if (pipsOf(card, c)) want[c] = Math.max(want[c], sourcesNeeded(pipsOf(card, c), card.cmc ?? 1, gold));
    }
    const have: Record<string, number> = Object.fromEntries(colors.map((c) => [c, 0]));
    for (const [name] of lands) {
      const land = name === 'Command Tower' ? colors : makes(legal.find((x) => x.name === name)!);
      for (const c of colors) if (land.includes(c)) have[c] += 1;
    }
    for (const card of chosen.values()) {
      const made = (card.produced_mana ?? []).filter((m) => identity.has(m));
      for (const c of made) have[c] += sourceWeight(card, 3);
    }
    const counts: Record<string, number> = Object.fromEntries(colors.map((c) => [c, 0]));
    for (let i = 0; i < basicsNeeded; i++) {
      const short = (c: string) => (want[c] || 1) - have[c] - counts[c];
      const next = colors.reduce((best, c) => (short(c) > short(best) ? c : best), colors[0]);
      counts[next] += 1;
    }
    for (const c of colors) if (counts[c]) lands.push([BASIC[c], counts[c]]);
  }

  return {
    lines: [...[...chosen.values()].map((c) => `1 ${c.name}`), ...lands.map(([name, n]) => `${n} ${name}`)],
    spells: chosen.size,
    lands: landCount,
  };
}
