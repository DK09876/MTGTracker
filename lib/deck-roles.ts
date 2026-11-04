/**
 * A deck's roles: Scryfall's tags (roles.ts), with the owner's corrections
 * for this deck on top - "Spellskite is protection here", "this is not
 * ramp". Every page that counts a deck's roles reads them from here, so a
 * correction shows everywhere: Health, Build, cuts, suggestions, chat.
 * Server only.
 */

import { cachedRoles, cardsInList, database, saveRoles, type ListedCard } from './db';
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

/** A deck's main-board roles, corrections included. */
export async function deckRoles(listId: string, main: ListedCard[] = cardsInList(listId).filter((c) => c.board === 'main')): Promise<RoleCount[]> {
  const roles = await countRoles(main, { search: (q) => searchCards(q), cached: cachedRoles, save: saveRoles });
  return withOverrides(roles, main, overrides(listId));
}

export function keeps(listId: string): Set<string> {
  return new Set((db().all('SELECT oracleId FROM deck_keeps WHERE listId = ?', [listId]) as Array<{ oracleId: string }>).map((r) => r.oracleId));
}

export function setKeep(listId: string, oracleId: string, keep: boolean): void {
  if (keep) db().run('INSERT OR IGNORE INTO deck_keeps (listId, oracleId) VALUES (?, ?)', [listId, oracleId]);
  else db().run('DELETE FROM deck_keeps WHERE listId = ? AND oracleId = ?', [listId, oracleId]);
}
