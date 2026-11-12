/**
 * A deck's roles: Scryfall's tags (roles.ts), with the owner's corrections
 * for this deck on top - "Spellskite is protection here", "this is not
 * ramp". Every page that counts a deck's roles reads them from here, so a
 * correction shows everywhere: Health, Build, cuts, suggestions, chat.
 * Server only.
 */

import { jobChanges } from './categories';
import { cachedRoles, cardsInList, database, saveRoles, type ListedCard } from './db';
import { jobs, withJobs, type JobId } from './deck-numbers';
import { planFor } from './deck-plan';
import { countRoles, ROLES, type RoleCount } from './roles';
import { searchCards, type ScryfallCard } from './scryfall';

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    // Cards the owner starred to keep: never offered as a cut.
    d.run(`CREATE TABLE IF NOT EXISTS deck_keeps (listId TEXT NOT NULL, oracleId TEXT NOT NULL, PRIMARY KEY (listId, oracleId))`);
    d.run(`CREATE TABLE IF NOT EXISTS deck_role_overrides (
      listId TEXT NOT NULL, oracleId TEXT NOT NULL, role TEXT NOT NULL, has INTEGER NOT NULL,
      PRIMARY KEY (listId, oracleId, role))`);
    ready = true;
  }
  return d;
}

/** Carry a deck's role corrections and keep-stars over to its copy. */
export function copyDeckRoles(fromId: string, toId: string): void {
  db().run('INSERT OR IGNORE INTO deck_role_overrides (listId, oracleId, role, has) SELECT ?, oracleId, role, has FROM deck_role_overrides WHERE listId = ?', [toId, fromId]);
  db().run('INSERT OR IGNORE INTO deck_keeps (listId, oracleId) SELECT ?, oracleId FROM deck_keeps WHERE listId = ?', [toId, fromId]);
}

export interface RoleOverride { oracleId: string; role: string; has: boolean }

export function overrides(listId: string): RoleOverride[] {
  return (db().all('SELECT oracleId, role, has FROM deck_role_overrides WHERE listId = ?', [listId]) as Array<{ oracleId: string; role: string; has: number }>)
    .map((r) => ({ ...r, has: !!r.has }));
}

/** Say a card does (or does not) fill a role in this deck; null goes back to what Scryfall says. */
export function setOverride(listId: string, oracleId: string, role: string, has: boolean | null): void {
  if (!ROLES.some((r) => r.id === role)) throw new Error(`No such role: ${role}`);
  if (has === null) db().run('DELETE FROM deck_role_overrides WHERE listId = ? AND oracleId = ? AND role = ?', [listId, oracleId, role]);
  else db().run(`INSERT INTO deck_role_overrides (listId, oracleId, role, has) VALUES (?, ?, ?, ?)
    ON CONFLICT(listId, oracleId, role) DO UPDATE SET has = excluded.has`, [listId, oracleId, role, has ? 1 : 0]);
}

/** Role counts with the owner's corrections applied. Pure. */
export function withOverrides(roles: RoleCount[], cards: Array<{ card: ScryfallCard; quantity: number }>, changes: RoleOverride[]): RoleCount[] {
  if (!changes.length) return roles;
  const byOracle = new Map(cards.map((c) => [c.card.oracle_id ?? c.card.id, c]));
  return roles.map((r) => {
    const mine = changes.filter((o) => o.role === r.id);
    if (!mine.length) return r;
    const names = new Set(r.cards);
    for (const o of mine) {
      const c = byOracle.get(o.oracleId);
      if (!c) continue;
      if (o.has) names.add(c.card.name); else names.delete(c.card.name);
    }
    const cardsIn = [...names].sort();
    const count = cardsIn.reduce((n, name) => n + (cards.find((c) => c.card.name === name)?.quantity ?? 0), 0);
    return { ...r, cards: cardsIn, count };
  });
}

/** The roles the commander itself fills: it is in every game. */
export async function commanderRoles(commander: ScryfallCard | null): Promise<string[]> {
  if (!commander) return [];
  return (await countRoles([{ card: commander, quantity: 1 }], { search: (q) => searchCards(q), cached: cachedRoles, save: saveRoles }))
    .filter((r) => r.count > 0).map((r) => r.id);
}

/**
 * A deck's main-board roles, corrections included, with the jobs the plan
 * has ranges for (deck-numbers.ts) first: ramp, card draw, impulse draw,
 * interaction, board wipes, protection and ways to finish, each counted the
 * same way on every page, with the plan's ranges.
 */
export async function deckRoles(listId: string, main: ListedCard[] = cardsInList(listId).filter((c) => c.board === 'main')): Promise<RoleCount[]> {
  const roles = withOverrides(await countRoles(main, { search: (q) => searchCards(q), cached: cachedRoles, save: saveRoles }), main, overrides(listId));
  const commander = commanderOf(listId);
  const plan = planFor(listId, '', commander, main);
  const ranges = Object.fromEntries(plan.targets.map((t) => [t.role, t.range])) as Partial<Record<JobId, [number, number]>>;
  const rangeFrom = Object.fromEntries(plan.targets.map((t) => [t.role, t.from])) as Partial<Record<JobId, string>>;
  return withJobChanges(listId, main, withJobs(roles, jobs({ cards: main, roles, commander, commanderRoles: await commanderRoles(commander), flip: plan.flip.value, ranges, rangeFrom })));
}

/**
 * The owner's changes to the jobs on the deck (lib/categories.ts): a card
 * they added to a job counts in it, a card they took out does not.
 */
export function withJobChanges(listId: string, main: ListedCard[], roles: RoleCount[]): RoleCount[] {
  const changes = jobChanges(listId);
  if (!changes.size) return roles;
  const nameOf = new Map(main.map((c) => [c.card.oracle_id ?? c.card.id, c.card.name]));
  const qty = new Map(main.map((c) => [c.card.name, c.quantity]));
  return roles.map((r) => {
    const ch = changes.get(r.id);
    if (!ch) return r;
    const out = new Set([...ch.out].map((k) => nameOf.get(k)).filter((n): n is string => !!n));
    const add = ch.add.map((a) => nameOf.get(a.key)).filter((n): n is string => !!n && !r.cards.includes(n));
    const removed = r.cards.filter((n) => out.has(n));
    if (!add.length && !removed.length) return r;
    const count = Math.max(0, r.count + add.reduce((n, x) => n + (qty.get(x) ?? 1), 0) - removed.reduce((n, x) => n + (qty.get(x) ?? 1), 0));
    return { ...r, cards: [...r.cards.filter((n) => !out.has(n)), ...add].sort(), count };
  });
}

/** Each job's cards by name, with the owner's changes: what a job category on the Tags tab holds. */
export async function jobCards(listId: string, main: ListedCard[]): Promise<Map<string, string[]>> {
  return new Map((await deckRolesKnown(listId, main)).map((r) => [r.id, r.cards]));
}

/**
 * The same as deckRoles, from roles already looked up only - nothing is
 * searched. For text sent to Claude, where a missing role is better than a
 * slow or failing lookup (every card is looked up nightly anyway).
 */
export async function deckRolesKnown(listId: string, main: ListedCard[] = cardsInList(listId).filter((c) => c.board === 'main')): Promise<RoleCount[]> {
  const none = { search: async () => ({ cards: [], totalCards: 0, hasMore: false }), cached: cachedRoles, save: () => {} };
  const roles = withOverrides(await countRoles(main, none), main, overrides(listId));
  const commander = commanderOf(listId);
  const plan = planFor(listId, '', commander, main);
  const ranges = Object.fromEntries(plan.targets.map((t) => [t.role, t.range])) as Partial<Record<JobId, [number, number]>>;
  const rangeFrom = Object.fromEntries(plan.targets.map((t) => [t.role, t.from])) as Partial<Record<JobId, string>>;
  const cmdRoles = commander ? (await countRoles([{ card: commander, quantity: 1 }], none)).filter((r) => r.count > 0).map((r) => r.id) : [];
  return withJobChanges(listId, main, withJobs(roles, jobs({ cards: main, roles, commander, commanderRoles: cmdRoles, flip: plan.flip.value, ranges, rangeFrom })));
}

/** A deck's commander, by list id alone. */
function commanderOf(listId: string): ScryfallCard | null {
  const r = db().get('SELECT c.data FROM lists l JOIN cards c ON c.id = l.commanderId WHERE l.id = ?', [listId]) as { data: string } | null;
  return r ? JSON.parse(r.data) as ScryfallCard : null;
}

export function keeps(listId: string): Set<string> {
  return new Set((db().all('SELECT oracleId FROM deck_keeps WHERE listId = ?', [listId]) as Array<{ oracleId: string }>).map((r) => r.oracleId));
}

export function setKeep(listId: string, oracleId: string, keep: boolean): void {
  if (keep) db().run('INSERT OR IGNORE INTO deck_keeps (listId, oracleId) VALUES (?, ?)', [listId, oracleId]);
  else db().run('DELETE FROM deck_keeps WHERE listId = ? AND oracleId = ?', [listId, oracleId]);
}
