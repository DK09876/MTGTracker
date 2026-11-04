/**
 * A deck's plan: what it is built to do. The brief (in words, kept with the
 * deck's tags as before), its main and second style, and the usual role
 * counts as the owner tuned them. Everything starts detected or drafted and
 * can be overridden; confirming it unlocks the AI steps, which read it.
 *
 * A deck that already had a brief before plans existed counts as
 * confirmed. Server only.
 */

import { database } from './db';
import { ROLES } from './roles';
import type { ScryfallCard } from './scryfall';
import { detectStyles, styleById, styleTargets, type Detected, type Style } from './styles';

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    // style/style2: null means "as detected"; style2 '' means "no second style".
    d.run(`CREATE TABLE IF NOT EXISTS deck_plans (
      listId TEXT PRIMARY KEY, style TEXT, style2 TEXT, targets TEXT NOT NULL DEFAULT '{}',
      draft TEXT NOT NULL DEFAULT '', confirmedAt TEXT, updatedAt TEXT NOT NULL)`);
    ready = true;
  }
  return d;
}

interface Row { style: string | null; style2: string | null; targets: string; draft: string; confirmedAt: string | null }

function row(listId: string): Row | null {
  return db().get('SELECT style, style2, targets, draft, confirmedAt FROM deck_plans WHERE listId = ?', [listId]) as Row | null;
}

/** The usual counts every deck starts from (roles.ts). */
export const BASE_TARGETS: Record<string, [number, number]> = Object.fromEntries(ROLES.filter((r) => r.target).map((r) => [r.id, r.target!]));

export interface Plan {
  brief: string;
  /** A brief drafted for the owner to read, before they confirm one. */
  draft: string;
  confirmed: boolean;
  detected: { primary: string; secondary: string | null; support: Record<string, number> };
  style: Style;
  style2: Style | null;
  /** Whether each style is the owner's choice rather than the detected one. */
  chosen: { style: boolean; style2: boolean };
  /** Every role with a guideline: the range in use, the style's, and whether the owner set it. */
  targets: Array<{ role: string; label: string; range: [number, number]; styleRange: [number, number]; mine: boolean }>;
}

export function planFor(listId: string, brief: string, commander: ScryfallCard | null, cards: Array<{ card: ScryfallCard; quantity: number }>): Plan {
  const r = row(listId);
  const found: Detected = detectStyles(commander, cards);
  const style = styleById(r?.style) ?? found.primary;
  // The detected second style stays when the owner picks the main one, unless they are the same.
  const auto2 = found.secondary && found.secondary.id !== style.id ? found.secondary : found.primary.id !== style.id ? found.primary : null;
  const style2 = r?.style2 === '' ? null : styleById(r?.style2) ?? auto2;
  const fromStyle = styleTargets(BASE_TARGETS, style, style2);
  const mine = JSON.parse(r?.targets ?? '{}') as Record<string, [number, number]>;
  return {
    brief,
    draft: r?.draft ?? '',
    confirmed: !!r?.confirmedAt || (!r && !!brief.trim()),
    detected: { primary: found.primary.id, secondary: found.secondary?.id ?? null, support: found.support },
    style,
    style2,
    chosen: { style: !!r?.style, style2: r?.style2 !== null && r?.style2 !== undefined },
    targets: ROLES.filter((x) => x.target).map((x) => ({
      role: x.id, label: x.label, range: mine[x.id] ?? fromStyle[x.id], styleRange: fromStyle[x.id], mine: !!mine[x.id],
    })),
  };
}

/** The ranges every count uses for this deck: the style's, then the owner's. */
export function targetsFor(listId: string, commander: ScryfallCard | null, cards: Array<{ card: ScryfallCard; quantity: number }>): Record<string, [number, number]> {
  return Object.fromEntries(planFor(listId, '', commander, cards).targets.map((t) => [t.role, t.range]));
}

function upsert(listId: string, change: Partial<Row>): void {
  const now = new Date().toISOString();
  const r = row(listId);
  const next = { style: null, style2: null, targets: '{}', draft: '', confirmedAt: null, ...r, ...change };
  db().run(
    `INSERT INTO deck_plans (listId, style, style2, targets, draft, confirmedAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(listId) DO UPDATE SET style = excluded.style, style2 = excluded.style2, targets = excluded.targets,
       draft = excluded.draft, confirmedAt = excluded.confirmedAt, updatedAt = excluded.updatedAt`,
    [listId, next.style, next.style2, next.targets, next.draft, next.confirmedAt, now],
  );
}

export interface PlanChange {
  /** A style id, or null to go back to the detected one. */
  style?: string | null;
  /** A style id, '' for none, or null for the detected one. */
  style2?: string | null;
  /** A role's range, or null to go back to the style's. */
  targets?: Record<string, [number, number] | null>;
  draft?: string;
  confirm?: boolean;
}

export function changePlan(listId: string, change: PlanChange): void {
  const r = row(listId);
  const patch: Partial<Row> = {};
  if (change.style !== undefined) patch.style = change.style && styleById(change.style) ? change.style : null;
  if (change.style2 !== undefined) patch.style2 = change.style2 === '' ? '' : change.style2 && styleById(change.style2) ? change.style2 : null;
  if (change.targets) {
    const mine = JSON.parse(r?.targets ?? '{}') as Record<string, [number, number]>;
    for (const [role, range] of Object.entries(change.targets)) {
      if (!BASE_TARGETS[role]) continue;
      if (range === null) delete mine[role];
      else if (Array.isArray(range) && range.length === 2 && range.every((n) => Number.isInteger(n) && n >= 0 && n <= 99) && range[0] <= range[1]) mine[role] = range;
    }
    patch.targets = JSON.stringify(mine);
  }
  if (change.draft !== undefined) patch.draft = change.draft.slice(0, 4000);
  if (change.confirm) patch.confirmedAt = new Date().toISOString();
  upsert(listId, patch);
}

/** Copy a plan to a duplicated deck. */
export function copyPlan(fromId: string, toId: string): void {
  db().run(`INSERT OR IGNORE INTO deck_plans (listId, style, style2, targets, draft, confirmedAt, updatedAt)
    SELECT ?, style, style2, targets, draft, confirmedAt, updatedAt FROM deck_plans WHERE listId = ?`, [toId, fromId]);
}

/**
 * A first brief from what the cards say, for the owner to correct: the
 * styles, and how it wins.
 */
export function draftFromCards(commander: ScryfallCard | null, style: Style, style2: Style | null, wincons: string[]): string {
  const who = commander ? commander.name.split(',')[0] : 'This deck';
  const how = style2 ? `${style.label} + ${style2.label}` : style.label;
  const wins = wincons.length ? ` It wins with ${wincons.slice(0, 3).join(', ')}${wincons.length > 3 ? ' and more' : ''}.` : ' How it wins is not clear yet.';
  return `${who} · ${how}. ${style.note}${wins}`;
}

/** Whether the AI steps may run for this deck: its plan is confirmed. */
export function planConfirmed(listId: string): boolean {
  const r = row(listId);
  if (r) return !!r.confirmedAt;
  const b = database().get('SELECT tagBrief FROM lists WHERE id = ?', [listId]) as { tagBrief: string } | null;
  return !!b?.tagBrief.trim();
}
