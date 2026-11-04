/**
 * A deck's plan: what it is built to do. The brief (in words, kept with the
 * deck's tags as before), its main and second style, and the usual role
 * counts as the owner tuned them. Everything starts detected or drafted and
 * can be overridden; confirming it unlocks the AI steps, which read it.
 *
 * A deck that already had a brief before plans existed counts as
 * confirmed. Server only.
 */

import { cleanSettings, NO_SETTINGS, type CutSettings } from './cut-rules';
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
    // Added later: the flip turn and theme package sizes, as JSON.
    try { d.run(`ALTER TABLE deck_plans ADD COLUMN extra TEXT NOT NULL DEFAULT '{}'`); } catch { /* already there */ }
    ready = true;
  }
  return d;
}

interface Row { style: string | null; style2: string | null; targets: string; draft: string; confirmedAt: string | null; extra: string }
interface Extra { flip?: number; packages?: Record<string, number> }

function row(listId: string): Row | null {
  return db().get('SELECT style, style2, targets, draft, confirmedAt, extra FROM deck_plans WHERE listId = ?', [listId]) as Row | null;
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
  /** The flip turn: the mana the deck needs before it starts doing its thing. */
  flip: { value: number; mine: boolean };
  /** How many lands: the owner's range, else the flip turn's. */
  lands: [number, number];
  landsDefault: [number, number];
  /** Theme package sizes the owner set, by tag id (8 otherwise). */
  packages: Record<string, number>;
}

/**
 * The usual counts for a deck that needs `flip` mana to get going: 12 ramp
 * and 36 lands at 4, about one more ramp card per mana above that and one
 * fewer below, and a land per two mana.
 */
export function flipTargets(flip: number): { ramp: [number, number]; lands: [number, number] } {
  const f = Math.max(1, Math.min(10, Math.round(flip)));
  const ramp = Math.max(6, 12 + (f - 4));
  const lands = 36 + Math.round((f - 4) / 2);
  return { ramp: [ramp - 1, ramp + 1], lands: [lands - 1, lands + 1] };
}

export function planFor(listId: string, brief: string, commander: ScryfallCard | null, cards: Array<{ card: ScryfallCard; quantity: number }>): Plan {
  const r = row(listId);
  const found: Detected = detectStyles(commander, cards);
  const style = styleById(r?.style) ?? found.primary;
  // The detected second style stays when the owner picks the main one, unless they are the same.
  const auto2 = found.secondary && found.secondary.id !== style.id ? found.secondary : found.primary.id !== style.id ? found.primary : null;
  const style2 = r?.style2 === '' ? null : styleById(r?.style2) ?? auto2;
  const extra = JSON.parse(r?.extra ?? '{}') as Extra;
  const flip = extra.flip ?? Math.max(1, Math.min(10, commander?.cmc ?? 4));
  const fromFlip = flipTargets(flip);
  const fromStyle = styleTargets({ ...BASE_TARGETS, ramp: fromFlip.ramp }, style, style2);
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
    flip: { value: flip, mine: extra.flip !== undefined },
    lands: mine.lands ?? fromFlip.lands,
    landsDefault: fromFlip.lands,
    packages: extra.packages ?? {},
  };
}

/** The ranges every count uses for this deck: the style's, then the owner's. */
export function targetsFor(listId: string, commander: ScryfallCard | null, cards: Array<{ card: ScryfallCard; quantity: number }>): Record<string, [number, number]> {
  return Object.fromEntries(planFor(listId, '', commander, cards).targets.map((t) => [t.role, t.range]));
}

function upsert(listId: string, change: Partial<Row>): void {
  const now = new Date().toISOString();
  const r = row(listId);
  const next = { style: null, style2: null, targets: '{}', draft: '', confirmedAt: null, extra: '{}', ...r, ...change };
  db().run(
    `INSERT INTO deck_plans (listId, style, style2, targets, draft, confirmedAt, extra, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(listId) DO UPDATE SET style = excluded.style, style2 = excluded.style2, targets = excluded.targets,
       draft = excluded.draft, confirmedAt = excluded.confirmedAt, extra = excluded.extra, updatedAt = excluded.updatedAt`,
    [listId, next.style, next.style2, next.targets, next.draft, next.confirmedAt, next.extra, now],
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
  /** The flip turn, or null to go back to the commander's mana value. */
  flip?: number | null;
  /** A theme package's size by tag id, or null for the default 8. */
  packages?: Record<string, number | null>;
}

export function changePlan(listId: string, change: PlanChange): void {
  const r = row(listId);
  const patch: Partial<Row> = {};
  if (change.style !== undefined) patch.style = change.style && styleById(change.style) ? change.style : null;
  if (change.style2 !== undefined) patch.style2 = change.style2 === '' ? '' : change.style2 && styleById(change.style2) ? change.style2 : null;
  if (change.targets) {
    const mine = JSON.parse(r?.targets ?? '{}') as Record<string, [number, number]>;
    for (const [role, range] of Object.entries(change.targets)) {
      if (!BASE_TARGETS[role] && role !== 'lands') continue;
      if (range === null) delete mine[role];
      else if (Array.isArray(range) && range.length === 2 && range.every((n) => Number.isInteger(n) && n >= 0 && n <= 99) && range[0] <= range[1]) mine[role] = range;
    }
    patch.targets = JSON.stringify(mine);
  }
  if (change.draft !== undefined) patch.draft = change.draft.slice(0, 4000);
  if (change.flip !== undefined || change.packages) {
    const extra = JSON.parse(r?.extra ?? '{}') as Extra;
    if (change.flip === null) delete extra.flip;
    else if (typeof change.flip === 'number' && Number.isInteger(change.flip) && change.flip >= 1 && change.flip <= 10) extra.flip = change.flip;
    for (const [tagId, size] of Object.entries(change.packages ?? {})) {
      extra.packages = extra.packages ?? {};
      if (size === null) delete extra.packages[tagId];
      else if (Number.isInteger(size) && size >= 1 && size <= 40) extra.packages[tagId] = size;
    }
    patch.extra = JSON.stringify(extra);
  }
  if (change.confirm) patch.confirmedAt = new Date().toISOString();
  upsert(listId, patch);
}

/** Copy a plan to a duplicated deck. */
export function copyPlan(fromId: string, toId: string): void {
  rulesDb().run('INSERT OR IGNORE INTO deck_cut_rules (listId, settings, updatedAt) SELECT ?, settings, updatedAt FROM deck_cut_rules WHERE listId = ?', [toId, fromId]);
  db().run(`INSERT OR IGNORE INTO deck_plans (listId, style, style2, targets, draft, confirmedAt, extra, updatedAt)
    SELECT ?, style, style2, targets, draft, confirmedAt, extra, updatedAt FROM deck_plans WHERE listId = ?`, [toId, fromId]);
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

// --- The cut list's rules, as this deck's owner set them ---------------------

let rulesReady = false;
function rulesDb() {
  const d = database();
  if (!rulesReady) {
    d.run('CREATE TABLE IF NOT EXISTS deck_cut_rules (listId TEXT PRIMARY KEY, settings TEXT NOT NULL, updatedAt TEXT NOT NULL)');
    rulesReady = true;
  }
  return d;
}

export function cutSettings(listId: string): CutSettings {
  const r = rulesDb().get('SELECT settings FROM deck_cut_rules WHERE listId = ?', [listId]) as { settings: string } | null;
  return r ? cleanSettings(JSON.parse(r.settings)) : NO_SETTINGS;
}

export function setCutSettings(listId: string, settings: CutSettings): CutSettings {
  const clean = cleanSettings(settings);
  rulesDb().run(
    `INSERT INTO deck_cut_rules (listId, settings, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(listId) DO UPDATE SET settings = excluded.settings, updatedAt = excluded.updatedAt`,
    [listId, JSON.stringify(clean), new Date().toISOString()],
  );
  return clean;
}

/** The plan's styles, as the cut list reads them. */
export function planStyles(listId: string, commander: ScryfallCard | null, cards: Array<{ card: ScryfallCard; quantity: number }>): Style[] {
  const p = planFor(listId, '', commander, cards);
  return [p.style, ...(p.style2 ? [p.style2] : [])].filter((s) => s.id !== 'value');
}
