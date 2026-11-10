/**
 * A deck's plan: what it is built to do. Every part - what the owner is
 * optimizing for, the bracket, budget and deck rule, the brief and style,
 * what the commander does, the themes, how it wins, the flip turn, lands
 * and ranges, the cards never cut - starts detected from the cards
 * (plan-detect.ts) or drafted by Claude, and is the owner's to change.
 *
 * Each part remembers who set it (detected, Claude, yours) and whether the
 * owner confirmed it. Detected values follow the deck as it changes; the
 * owner's never change on their own. Confirming every part - one at a time
 * or all at once - confirms the plan, which unlocks Tune, Chat and the paid
 * Claude steps.
 *
 * On top sit the deck's changes to the usual rules (overrides): a range, the
 * land count, a theme's size, a cut rule's weight or a rule switched off, or
 * a stated exception - each the owner's or Claude's (accepted by the owner),
 * each undoable. Precedence: yours, then confirmed overrides, then detected,
 * then the usual guidelines.
 *
 * A deck that already had a brief before plans existed counts as
 * confirmed. Server only.
 */

import { randomUUID } from 'crypto';

import { cleanSettings, CUT_RULES, NO_SETTINGS, type CutSettings } from './cut-rules';
import { cachedRoles, database } from './db';
import { BASE_RANGES, JOB_LABELS, landNumber, rampRange, type JobId, type LandNumber } from './deck-numbers';
import { cleanGoldfishSettings, DEFAULT_SETTINGS, startingChecks, type GoldfishSettings } from './goldfish';
import { COMMANDER_ROLES, PROTECTION_BY_LEAN, type CommanderRole, type DeckBuild, type Lean, type Stages } from './plan-detect';
import { fixRoles, ROLES_VERSION } from './roles';
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
    // Added later, all JSON: the flip turn, theme sizes and bracket (extra);
    // the owner's and Claude's values for the other parts (parts); which
    // parts are confirmed (confirmed); changes to the usual rules
    // (overrides); Claude's notes; what became of Claude's proposals; and
    // the last detection, so pages that cannot detect (the cut list, chat)
    // still read how much the deck leans on its commander.
    for (const [col, def] of [['extra', '{}'], ['parts', '{}'], ['confirmed', '{}'], ['overrides', '[]'], ['notes', '[]'], ['proposals', '{}'], ['detected', '{}']]) {
      try { d.run(`ALTER TABLE deck_plans ADD COLUMN ${col} TEXT NOT NULL DEFAULT '${def}'`); } catch { /* already there */ }
    }
    ready = true;
  }
  return d;
}

interface Row {
  style: string | null; style2: string | null; targets: string; draft: string; confirmedAt: string | null; extra: string;
  parts: string; confirmed: string; overrides: string; notes: string; proposals: string; detected: string;
}
interface Extra { flip?: number; packages?: Record<string, number>; bracket?: number }

function row(listId: string): Row | null {
  return db().get('SELECT style, style2, targets, draft, confirmedAt, extra, parts, confirmed, overrides, notes, proposals, detected FROM deck_plans WHERE listId = ?', [listId]) as Row | null;
}
const parse = <T>(text: string | undefined, empty: T): T => { try { return text ? JSON.parse(text) as T : empty; } catch { return empty; } };

/** The usual counts every deck starts from (deck-numbers.ts), by job. */
export const BASE_TARGETS: Record<string, [number, number]> = { ...BASE_RANGES };

// --- the parts ----------------------------------------------------------------

export type PartId = 'goal' | 'commanders' | 'bracket' | 'budget' | 'own' | 'rule' | 'brief' | 'style' | 'role' | 'build' | 'key' | 'themes'
  | 'stages' | 'routes' | 'lean' | 'flip' | 'lands' | 'ranges' | 'protected';
/** Every part the owner confirms, in the order the Plan tab shows them. The archetype is a reading, not confirmed. */
export const PARTS: PartId[] = ['goal', 'commanders', 'bracket', 'budget', 'own', 'rule', 'brief', 'style', 'role', 'build', 'key', 'themes', 'stages', 'routes', 'lean', 'flip', 'lands', 'ranges', 'protected'];

export type Source = 'detected' | 'claude' | 'yours' | 'unset';

/** What the owner is optimizing for: the chips the rules read, and their own words for Claude. */
export const GOALS = ['The usual guidelines', 'Win more often', 'Faster', 'More fun, keep my pets', 'Fit my table', 'Stay on theme', 'Spend less'] as const;
export interface Goal { chips: string[]; text: string }

export interface DeckRule { text: string; filter: string }
export interface RouteChoices { dropped: string[]; main: string | null; extra: Record<string, string[]>; custom: Array<{ id: string; label: string; how: string; cards: string[] }> }
export interface ThemeChoices { dropped: string[]; kept: Record<string, string>; sizes: Record<string, number> }

/** The values the owner (or Claude, accepted) set, by part; anything missing is detected or not set. */
export interface StoredParts {
  goal?: { v: Goal; by: 'yours' | 'claude' };
  budget?: { v: number | null; by: 'yours' | 'claude' };
  own?: { v: boolean; by: 'yours' | 'claude' };
  rule?: { v: DeckRule; by: 'yours' | 'claude' };
  brief?: { by: 'yours' | 'claude' };
  style?: { by: 'yours' | 'claude'; own?: { label: string; ranges: Record<string, [number, number]> } };
  role?: { v: CommanderRole; by: 'yours' | 'claude' };
  build?: { v: DeckBuild; by: 'yours' | 'claude' };
  key?: { v: string[]; dismissed: string[]; by: 'yours' | 'claude' };
  themes?: ThemeChoices & { by?: 'yours' | 'claude' };
  stages?: { v: Stages; by: 'yours' | 'claude' };
  routes?: RouteChoices & { by?: 'yours' | 'claude' };
  lean?: { v: Lean; by: 'yours' | 'claude' };
  flip?: { by: 'yours' | 'claude' };
  bracket?: { by: 'yours' | 'claude' };
  ranges?: { by: 'yours' | 'claude' };
}

/** A change to the usual rules for this deck. */
export interface Override {
  id: string;
  /** range: a job's range (target = job id); lands; theme-size (target = theme id or tag id); rule-weight / rule-off (target = cut rule id); exception: said in words. */
  kind: 'range' | 'lands' | 'theme-size' | 'rule-weight' | 'rule-off' | 'exception';
  target: string;
  /** The new value: a range, a number, or nothing for rule-off and exception. */
  value: [number, number] | number | null;
  /** In words: "Lands 38 → 36". */
  what: string;
  why: string;
  /** What it changes: "Lands, Cuts, Fix a problem". */
  affects: string;
  by: 'yours' | 'claude';
  on: boolean;
  at: string;
}

/**
 * A note kept with the plan. `by` says whose words it is: the owner's, or
 * Claude's from an earlier read. Notes from before `by` existed all came
 * from Claude's reads. Only the owner's notes go to later AI calls: an AI
 * note ("the easiest cuts are...") read back as the owner's view steered
 * later answers.
 */
export interface Note { id: string; text: string; at: string; by?: 'owner' | 'ai' }

/** Whose words a note is; notes saved before `by` existed are Claude's. */
export const noteBy = (n: Note): 'owner' | 'ai' => n.by ?? 'ai';

/** The last detection, kept so pages that do not detect still read it. */
export interface DetectedSnapshot {
  lean?: Lean;
  role?: CommanderRole;
  build?: DeckBuild;
  keyCards?: string[];
  routeCards?: string[];
  bracketLooks?: number;
  stages?: Stages;
  themes?: Array<{ id: string; name: string; size: number; cards: string[] }>;
  archetype?: string;
  /** The flip turn as detected: a key card's mana value when it costs more than the commander. */
  flip?: number;
  routes?: Array<{ label: string; cards: string[]; needsCommander: boolean; main: boolean }>;
}

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
  /** Every job with a guideline: the range in use, the style's, whether the owner set it, and where it came from. */
  targets: Array<{ role: string; label: string; range: [number, number]; styleRange: [number, number]; mine: boolean; source: 'yours' | 'override' | 'detected'; from: string }>;
  /** The flip turn: the mana the deck needs before it starts doing its thing. */
  flip: { value: number; mine: boolean };
  /** How many lands: the owner's range, else an override's, else the formula's for this curve. */
  lands: [number, number];
  landsDefault: [number, number];
  /** The land number with how it was worked out. */
  landNumber: LandNumber;
  /** Who set the land range: the owner, a change to the usual rules (and whose), or the formula. */
  landsSource: 'yours' | 'claude' | 'detected';
  /** Theme package sizes by tag id: the owner's, else an override's (8 otherwise). */
  packages: Record<string, number>;
  /** The bracket the owner is aiming for, 1-5, or null until they say. */
  bracket: number | null;
  goal: Goal;
  budget: number | null;
  own: boolean;
  rule: DeckRule;
  /** How much the deck leans on its commander: the owner's, else the last detection, else Medium. */
  lean: Lean;
  stored: StoredParts;
  /** Which parts are confirmed. */
  confirmedParts: Record<PartId, boolean>;
  overrides: Override[];
  notes: Note[];
  /** What became of Claude's proposals, by key. */
  proposalStatus: Record<string, 'accepted' | 'skipped'>;
  snapshot: DetectedSnapshot;
}

/**
 * Which of these cards are ramp or draw, from the roles already looked up -
 * enough for the land formula, which only needs the cheap ones.
 */
function knownRoles(cards: Array<{ card: ScryfallCard; quantity: number }>): (card: ScryfallCard) => string[] {
  const ids = [...new Set(cards.map((c) => c.card.oracle_id).filter((x): x is string => !!x))];
  const { roles } = cachedRoles(ids, '1970-01-01', ROLES_VERSION);
  return (card) => fixRoles(card, roles.get(card.oracle_id ?? '') ?? []);
}

/** The owner's own style: a name and the ranges they want. */
export function ownStyle(own: { label: string; ranges: Record<string, [number, number]> }): Style {
  return { id: 'own', label: own.label || 'My own', note: 'Your own style: the ranges you set.', test: /$^/, shift: own.ranges };
}

/** Whether each part is confirmed: explicitly, or by a whole-plan confirm before the part was unconfirmed. */
function confirmedMap(r: Row | null, legacy: boolean): Record<PartId, boolean> {
  const map = parse<Record<string, string | null>>(r?.confirmed, {});
  const whole = !!r?.confirmedAt || legacy;
  return Object.fromEntries(PARTS.map((id) => [id, map[id] === null ? false : !!map[id] || whole])) as Record<PartId, boolean>;
}

export function planFor(listId: string, brief: string, commander: ScryfallCard | null, cards: Array<{ card: ScryfallCard; quantity: number }>): Plan {
  const r = row(listId);
  const stored = parse<StoredParts>(r?.parts, {});
  const overrides = parse<Override[]>(r?.overrides, []);
  const on = overrides.filter((o) => o.on);
  const snapshot = parse<DetectedSnapshot>(r?.detected, {});
  const found: Detected = detectStyles(commander, cards);
  const style = r?.style === 'own' && stored.style?.own ? ownStyle(stored.style.own) : styleById(r?.style) ?? found.primary;
  // The detected second style stays when the owner picks the main one, unless they are the same.
  const auto2 = found.secondary && found.secondary.id !== style.id ? found.secondary : found.primary.id !== style.id ? found.primary : null;
  const style2 = r?.style2 === '' ? null : styleById(r?.style2) ?? auto2;
  const extra = parse<Extra>(r?.extra, {});
  const flip = extra.flip ?? snapshot.flip ?? Math.max(1, Math.min(10, commander?.cmc ?? 4));
  const lean: Lean = stored.lean?.v ?? snapshot.lean ?? 'Medium';
  const fromStyle = styleTargets({ ...BASE_TARGETS, ramp: rampRange(flip), protection: PROTECTION_BY_LEAN[lean] }, style, style2);
  const mine = parse<Record<string, [number, number]>>(r?.targets, {});
  const rangeOverride = (id: string) => on.find((o) => o.kind === 'range' && o.target === id && Array.isArray(o.value));
  const landOverride = on.find((o) => o.kind === 'lands' && o.value !== null);
  const landRange: [number, number] | null = mine.lands ?? (landOverride ? (Array.isArray(landOverride.value) ? landOverride.value : [landOverride.value as number, landOverride.value as number]) : null);
  const lands = landNumber(cards, knownRoles(cards), landRange, mine.lands ? 'yours' : landOverride ? 'override' : undefined);
  const legacy = !r && !!brief.trim();
  const packages = { ...Object.fromEntries(on.filter((o) => o.kind === 'theme-size' && typeof o.value === 'number').map((o) => [o.target, o.value as number])), ...(extra.packages ?? {}) };
  const styleWord = [style.label, style2?.label].filter(Boolean).join(' + ');
  return {
    brief,
    draft: r?.draft ?? '',
    confirmed: !!r?.confirmedAt || legacy,
    detected: { primary: found.primary.id, secondary: found.secondary?.id ?? null, support: found.support },
    style,
    style2,
    chosen: { style: !!r?.style, style2: r?.style2 !== null && r?.style2 !== undefined },
    targets: Object.keys(BASE_TARGETS).map((id) => {
      const o = rangeOverride(id);
      const range = mine[id] ?? (o?.value as [number, number] | undefined) ?? fromStyle[id];
      const from = mine[id] ? 'your range' : o ? `a change to the usual rules: ${o.why}` : id === 'ramp' ? `a flip turn of ${flip}` : id === 'protection' ? `the deck leaning ${lean.toLowerCase()} on its commander` : fromStyle[id] !== BASE_TARGETS[id] ? `the ${styleWord} style` : 'the usual range';
      return { role: id, label: JOB_LABELS[id as JobId], range, styleRange: fromStyle[id], mine: !!mine[id], source: mine[id] ? 'yours' : o ? 'override' : 'detected', from };
    }),
    flip: { value: flip, mine: extra.flip !== undefined },
    lands: lands.range,
    landsDefault: [lands.want, lands.want + 1],
    landNumber: lands,
    landsSource: mine.lands ? 'yours' : landOverride ? landOverride.by : 'detected',
    packages,
    bracket: extra.bracket ?? null,
    goal: stored.goal?.v ?? { chips: ['The usual guidelines'], text: '' },
    budget: stored.budget?.v ?? null,
    own: stored.own?.v ?? false,
    rule: stored.rule?.v ?? { text: '', filter: '' },
    lean,
    stored,
    confirmedParts: confirmedMap(r, legacy),
    overrides,
    notes: parse<Note[]>(r?.notes, []),
    proposalStatus: parse<Record<string, 'accepted' | 'skipped'>>(r?.proposals, {}),
    snapshot,
  };
}

/** The ranges every count uses for this deck: the style's, then overrides, then the owner's. */
export function targetsFor(listId: string, commander: ScryfallCard | null, cards: Array<{ card: ScryfallCard; quantity: number }>): Record<string, [number, number]> {
  return Object.fromEntries(planFor(listId, '', commander, cards).targets.map((t) => [t.role, t.range]));
}

function upsert(listId: string, change: Partial<Row>): void {
  const now = new Date().toISOString();
  const r = row(listId);
  const next: Row = {
    style: null, style2: null, targets: '{}', draft: '', confirmedAt: null, extra: '{}', parts: '{}', confirmed: '{}', overrides: '[]', notes: '[]', proposals: '{}', detected: '{}',
    ...r, ...change,
  };
  db().run(
    `INSERT INTO deck_plans (listId, style, style2, targets, draft, confirmedAt, extra, parts, confirmed, overrides, notes, proposals, detected, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(listId) DO UPDATE SET style = excluded.style, style2 = excluded.style2, targets = excluded.targets,
       draft = excluded.draft, confirmedAt = excluded.confirmedAt, extra = excluded.extra, parts = excluded.parts, confirmed = excluded.confirmed,
       overrides = excluded.overrides, notes = excluded.notes, proposals = excluded.proposals, detected = excluded.detected, updatedAt = excluded.updatedAt`,
    [listId, next.style, next.style2, next.targets, next.draft, next.confirmedAt, next.extra, next.parts, next.confirmed, next.overrides, next.notes, next.proposals, next.detected, now],
  );
}

export interface PlanChange {
  /** A style id, 'own' for the owner's own (with styleOwn), or null to go back to the detected one. */
  style?: string | null;
  /** A style id, '' for none, or null for the detected one. */
  style2?: string | null;
  /** The owner's own style: a name and ranges. */
  styleOwn?: { label: string; ranges: Record<string, [number, number]> } | null;
  /** A role's range, or null to go back to the style's. */
  targets?: Record<string, [number, number] | null>;
  draft?: string;
  /** Confirm the whole plan. */
  confirm?: boolean;
  /** Confirm, or take back the confirming of, one part. */
  confirmPart?: PartId;
  unconfirmPart?: PartId;
  /** The flip turn, or null to go back to the commander's mana value. */
  flip?: number | null;
  /** A theme package's size by tag id, or null for the default 8. */
  packages?: Record<string, number | null>;
  /** The bracket aimed for, 1-5, or null for not set. */
  bracket?: number | null;
  goal?: Goal | null;
  budget?: number | null;
  /** null: back to not set. */
  own?: boolean | null;
  rule?: DeckRule | null;
  role?: CommanderRole | null;
  build?: DeckBuild | null;
  lean?: Lean | null;
  stages?: Stages | null;
  key?: { add?: string; remove?: string; dismiss?: string };
  themes?: { drop?: string; undrop?: string; size?: Record<string, number>; kept?: { id: string; tagId: string }; unkeep?: string };
  routes?: { drop?: string; undrop?: string; main?: string | null; addCard?: { route: string; card: string }; custom?: { label: string; how: string; cards: string[] } };
  /** Mark the brief as Claude's (accepted) or the owner's. */
  briefBy?: 'yours' | 'claude';
  /** Who made this change: the owner, or Claude with the owner accepting it. */
  by?: 'yours' | 'claude';
  overrides?: { add?: Omit<Override, 'id' | 'at' | 'on'>; toggle?: { id: string; on: boolean }; remove?: string };
  notes?: { add?: string[]; remove?: string; by?: 'owner' | 'ai'; edit?: { id: string; text: string } };
  proposal?: { key: string; status: 'accepted' | 'skipped' };
}

const BRACKET_OK = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
const RANGE_OK = (r: unknown): r is [number, number] => Array.isArray(r) && r.length === 2 && r.every((n) => Number.isInteger(n) && n >= 0 && n <= 99) && r[0] <= r[1];
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Which part a change is about, so changing it makes it the owner's and confirms it. */
function partsTouched(c: PlanChange): PartId[] {
  const out: PartId[] = [];
  if (c.style !== undefined || c.style2 !== undefined || c.styleOwn !== undefined) out.push('style');
  if (c.targets) for (const k of Object.keys(c.targets)) out.push(k === 'lands' ? 'lands' : 'ranges');
  if (c.flip !== undefined) out.push('flip');
  if (c.packages || c.themes) out.push('themes');
  for (const id of ['bracket', 'goal', 'budget', 'own', 'rule', 'role', 'build', 'lean', 'stages', 'key', 'routes'] as const) if (c[id] !== undefined) out.push(id);
  if (c.briefBy) out.push('brief');
  return [...new Set(out)];
}

export function changePlan(listId: string, change: PlanChange): void {
  const r = row(listId);
  const patch: Partial<Row> = {};
  const by = change.by === 'claude' ? 'claude' : 'yours';
  const stored = parse<StoredParts>(r?.parts, {});
  if (change.style !== undefined) {
    patch.style = change.style === 'own' ? 'own' : change.style && styleById(change.style) ? change.style : null;
    stored.style = { ...stored.style, by };
  }
  if (change.styleOwn !== undefined) {
    if (change.styleOwn === null) delete stored.style?.own;
    else {
      const ranges = Object.fromEntries(Object.entries(change.styleOwn.ranges ?? {}).filter(([k, v]) => BASE_TARGETS[k] && RANGE_OK(v)));
      stored.style = { ...stored.style, by, own: { label: text(change.styleOwn.label, 40) || 'My own', ranges } };
      patch.style = 'own';
    }
  }
  if (change.style2 !== undefined) patch.style2 = change.style2 === '' ? '' : change.style2 && styleById(change.style2) ? change.style2 : null;
  if (change.targets) {
    const mine = parse<Record<string, [number, number]>>(r?.targets, {});
    for (const [role, range] of Object.entries(change.targets)) {
      if (!BASE_TARGETS[role] && role !== 'lands') continue;
      if (range === null) delete mine[role];
      else if (RANGE_OK(range)) mine[role] = range;
    }
    patch.targets = JSON.stringify(mine);
  }
  if (change.draft !== undefined) patch.draft = change.draft.slice(0, 4000);
  if (change.flip !== undefined || change.packages || change.bracket !== undefined) {
    const extra = parse<Extra>(r?.extra, {});
    if (change.flip === null) delete extra.flip;
    else if (typeof change.flip === 'number' && Number.isInteger(change.flip) && change.flip >= 1 && change.flip <= 10) extra.flip = change.flip;
    if (change.bracket === null) delete extra.bracket;
    else if (BRACKET_OK(change.bracket)) extra.bracket = change.bracket as number;
    for (const [tagId, size] of Object.entries(change.packages ?? {})) {
      extra.packages = extra.packages ?? {};
      if (size === null) delete extra.packages[tagId];
      else if (Number.isInteger(size) && size >= 1 && size <= 40) extra.packages[tagId] = size;
    }
    patch.extra = JSON.stringify(extra);
  }
  // The other parts, kept as JSON with who set them; null goes back to detected or not set.
  const set = <K extends keyof StoredParts>(k: K, v: StoredParts[K] | undefined) => { if (v === undefined) delete stored[k]; else stored[k] = v; };
  if (change.goal !== undefined) set('goal', change.goal && { v: { chips: (change.goal.chips ?? []).filter((g) => (GOALS as readonly string[]).includes(g)).slice(0, 7), text: text(change.goal.text, 500) }, by } || undefined);
  if (change.budget !== undefined) set('budget', change.budget === null ? undefined : Number.isFinite(change.budget) && change.budget > 0 ? { v: Math.round(change.budget * 100) / 100, by } : undefined);
  if (change.own !== undefined) set('own', change.own === null ? undefined : { v: !!change.own, by });
  if (change.rule !== undefined) set('rule', change.rule && (text(change.rule.text, 300) || text(change.rule.filter, 300)) ? { v: { text: text(change.rule.text, 300), filter: text(change.rule.filter, 300) }, by } : undefined);
  if (change.role !== undefined) set('role', change.role && COMMANDER_ROLES.includes(change.role) ? { v: change.role, by } : undefined);
  if (change.build !== undefined) set('build', change.build === 'Broad' || change.build === 'Dense' ? { v: change.build, by } : undefined);
  if (change.lean !== undefined) set('lean', change.lean === 'Low' || change.lean === 'Medium' || change.lean === 'High' ? { v: change.lean, by } : undefined);
  if (change.stages !== undefined) set('stages', change.stages ? { v: { early: text(change.stages.early, 200), mid: text(change.stages.mid, 200), close: text(change.stages.close, 200) }, by } : undefined);
  if (change.briefBy) stored.brief = { by: change.briefBy };
  if (change.bracket !== undefined) stored.bracket = { by };
  if (change.flip !== undefined) stored.flip = { by };
  if (change.key) {
    const key = stored.key ?? { v: [], dismissed: [], by };
    const add = text(change.key.add, 150);
    const remove = text(change.key.remove, 150);
    const dismiss = text(change.key.dismiss, 150);
    if (add && !key.v.includes(add)) key.v.push(add);
    if (remove) key.v = key.v.filter((n) => n !== remove);
    if (dismiss && !key.dismissed.includes(dismiss)) key.dismissed.push(dismiss);
    stored.key = { ...key, v: key.v.slice(0, 8), by };
  }
  if (change.themes) {
    const t: ThemeChoices & { by?: 'yours' | 'claude' } = { dropped: [], kept: {}, sizes: {}, ...stored.themes, by };
    if (change.themes.drop && !t.dropped.includes(change.themes.drop)) t.dropped.push(text(change.themes.drop, 80));
    if (change.themes.undrop) t.dropped = t.dropped.filter((x) => x !== change.themes!.undrop);
    for (const [id, n] of Object.entries(change.themes.size ?? {})) if (Number.isInteger(n) && n >= 1 && n <= 40) t.sizes[id] = n;
    if (change.themes.kept) { t.kept[change.themes.kept.id] = change.themes.kept.tagId; t.dropped = t.dropped.filter((x) => x !== change.themes!.kept!.id); }
    if (change.themes.unkeep) delete t.kept[change.themes.unkeep];
    stored.themes = t;
  }
  if (change.routes) {
    const rc: RouteChoices & { by?: 'yours' | 'claude' } = { dropped: [], main: null, extra: {}, custom: [], ...stored.routes, by };
    const c = change.routes;
    if (c.drop && !rc.dropped.includes(c.drop)) rc.dropped.push(text(c.drop, 80));
    if (c.undrop) rc.dropped = rc.dropped.filter((x) => x !== c.undrop);
    if (c.main !== undefined) rc.main = c.main ? text(c.main, 80) : null;
    if (c.addCard) rc.extra[c.addCard.route] = [...new Set([...(rc.extra[c.addCard.route] ?? []), text(c.addCard.card, 150)])].filter(Boolean);
    if (c.custom && text(c.custom.label, 60)) rc.custom.push({ id: `own-${randomUUID().slice(0, 8)}`, label: text(c.custom.label, 60), how: text(c.custom.how, 300), cards: (c.custom.cards ?? []).map((n) => text(n, 150)).filter(Boolean).slice(0, 12) });
    stored.routes = rc;
  }
  patch.parts = JSON.stringify(stored);

  if (change.overrides) {
    let list = parse<Override[]>(r?.overrides, []);
    const o = change.overrides;
    if (o.add && ['range', 'lands', 'theme-size', 'rule-weight', 'rule-off', 'exception'].includes(o.add.kind)) {
      const value = o.add.kind === 'range' || o.add.kind === 'lands' ? (RANGE_OK(o.add.value) ? o.add.value : typeof o.add.value === 'number' && Number.isInteger(o.add.value) ? o.add.value : null)
        : o.add.kind === 'theme-size' || o.add.kind === 'rule-weight' ? (typeof o.add.value === 'number' && Number.isFinite(o.add.value) ? o.add.value : null) : null;
      const valid = o.add.kind === 'exception' || o.add.kind === 'rule-off' ? true : value !== null;
      const ruleOk = !o.add.kind.startsWith('rule') || CUT_RULES.some((x) => x.id === o.add!.target);
      const rangeOk = o.add.kind !== 'range' || !!BASE_TARGETS[o.add.target];
      if (valid && ruleOk && rangeOk) {
        // One override per thing: a new one replaces an old one on the same target.
        list = list.filter((x) => !(x.kind === o.add!.kind && x.target === o.add!.target && x.kind !== 'exception'));
        list.push({ ...o.add, value, what: text(o.add.what, 120), why: text(o.add.why, 400), affects: text(o.add.affects, 120), id: randomUUID(), at: new Date().toISOString(), on: true });
      }
    }
    if (o.toggle) list = list.map((x) => (x.id === o.toggle!.id ? { ...x, on: o.toggle!.on } : x));
    if (o.remove) list = list.filter((x) => x.id !== o.remove);
    patch.overrides = JSON.stringify(list.slice(-40));
  }
  if (change.notes) {
    let notes = parse<Note[]>(r?.notes, []);
    for (const n of (change.notes.add ?? []).map((x) => text(x, 600)).filter(Boolean)) {
      if (!notes.some((x) => x.text === n)) notes.push({ id: randomUUID(), text: n, at: new Date().toISOString(), by: change.notes.by ?? 'ai' });
    }
    if (change.notes.remove) notes = notes.filter((x) => x.id !== change.notes!.remove);
    const edited = change.notes.edit;
    if (edited) {
      const t = text(edited.text, 600);
      notes = t ? notes.map((x) => (x.id === edited.id ? { ...x, text: t, at: new Date().toISOString() } : x)) : notes.filter((x) => x.id !== edited.id);
    }
    patch.notes = JSON.stringify(notes.slice(-30));
  }
  if (change.proposal) {
    const p = parse<Record<string, string>>(r?.proposals, {});
    p[text(change.proposal.key, 120)] = change.proposal.status === 'skipped' ? 'skipped' : 'accepted';
    patch.proposals = JSON.stringify(p);
  }

  // Confirming. Changing a part makes it the owner's and confirms it; a
  // whole-plan confirm confirms every part; taking one part back unconfirms
  // the plan, keeping the rest confirmed.
  const now = new Date().toISOString();
  const map = parse<Record<string, string | null>>(r?.confirmed, {});
  const whole = r?.confirmedAt ?? null;
  const touched = [...partsTouched(change), ...(change.confirmPart && PARTS.includes(change.confirmPart) ? [change.confirmPart] : [])];
  for (const id of touched) map[id] = now;
  let confirmedAt: string | null = whole;
  if (change.confirm) {
    for (const id of PARTS) map[id] = map[id] ?? now;
    confirmedAt = now;
  }
  if (change.unconfirmPart && PARTS.includes(change.unconfirmPart)) {
    // Everything confirmed by the whole-plan confirm stays confirmed, one by one.
    if (whole) for (const id of PARTS) if (map[id] === undefined) map[id] = whole;
    map[change.unconfirmPart] = null;
    confirmedAt = null;
  }
  if (!confirmedAt && PARTS.every((id) => !!map[id])) confirmedAt = now;
  if (touched.length || change.confirm || change.unconfirmPart) {
    patch.confirmed = JSON.stringify(map);
    patch.confirmedAt = confirmedAt;
  }
  upsert(listId, patch);
}

/** Keep the last detection, for the pages that read the plan without detecting. */
export function saveSnapshot(listId: string, snapshot: DetectedSnapshot): void {
  const r = row(listId);
  if (r?.detected === JSON.stringify(snapshot)) return;
  upsert(listId, { detected: JSON.stringify(snapshot) });
}

/** Copy a plan to a duplicated deck. */
export function copyPlan(fromId: string, toId: string): void {
  playDb().run('INSERT OR IGNORE INTO deck_playtest (listId, settings, presets, updatedAt) SELECT ?, settings, presets, updatedAt FROM deck_playtest WHERE listId = ?', [toId, fromId]);
  rulesDb().run('INSERT OR IGNORE INTO deck_cut_rules (listId, settings, updatedAt) SELECT ?, settings, updatedAt FROM deck_cut_rules WHERE listId = ?', [toId, fromId]);
  db().run(`INSERT OR IGNORE INTO deck_plans (listId, style, style2, targets, draft, confirmedAt, extra, parts, confirmed, overrides, notes, proposals, detected, updatedAt)
    SELECT ?, style, style2, targets, draft, confirmedAt, extra, parts, confirmed, overrides, notes, proposals, detected, updatedAt FROM deck_plans WHERE listId = ?`, [toId, fromId]);
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

/** Whether Tune, Chat and the paid Claude steps may run for this deck: its plan is confirmed. */
export function planConfirmed(listId: string): boolean {
  const r = row(listId);
  if (r) return !!r.confirmedAt;
  const b = database().get('SELECT tagBrief FROM lists WHERE id = ?', [listId]) as { tagBrief: string } | null;
  return !!b?.tagBrief.trim();
}

/** How many parts are confirmed, from the stored plan alone (for a lock screen). */
export function planProgress(listId: string): { done: number; total: number } {
  const r = row(listId);
  const legacy = !r && planConfirmed(listId);
  const map = confirmedMap(r, legacy);
  return { done: PARTS.filter((id) => map[id]).length, total: PARTS.length };
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

/**
 * The cut rules the cut list scores with: the owner's settings, and where
 * the owner set nothing for a rule, the deck's changes to the usual rules
 * (a weight, or the rule switched off). The owner's own settings stay as
 * they are for the Rules screen.
 */
export function effectiveCutSettings(listId: string): { settings: CutSettings; changed: Record<string, Override> } {
  const mine = cutSettings(listId);
  const r = row(listId);
  const changed: Record<string, Override> = {};
  const rules = { ...mine.rules };
  for (const o of parse<Override[]>(r?.overrides, []).filter((x) => x.on && (x.kind === 'rule-off' || x.kind === 'rule-weight'))) {
    if (mine.rules[o.target]) continue;
    rules[o.target] = o.kind === 'rule-off' ? { on: false } : { weight: Math.max(0, Math.min(3, o.value as number)) };
    changed[o.target] = o;
  }
  return { settings: { ...mine, rules }, changed };
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

// --- Playtest settings and presets ---------------------------------------------

let playReady = false;
function playDb() {
  const d = database();
  if (!playReady) {
    d.run(`CREATE TABLE IF NOT EXISTS deck_playtest (listId TEXT PRIMARY KEY, settings TEXT NOT NULL, presets TEXT NOT NULL DEFAULT '[]', updatedAt TEXT NOT NULL)`);
    playReady = true;
  }
  return d;
}

export interface PlaytestPreset { name: string; settings: GoldfishSettings }

/** The deck's goldfish settings (its keep rule included), or a start from its plan. */
export function playtestFor(listId: string, commander: ScryfallCard | null, cards: Array<{ card: ScryfallCard; quantity: number }>): { settings: GoldfishSettings; presets: PlaytestPreset[]; saved: boolean } {
  const r = playDb().get('SELECT settings, presets FROM deck_playtest WHERE listId = ?', [listId]) as { settings: string; presets: string } | null;
  if (r) return { settings: cleanGoldfishSettings(JSON.parse(r.settings)), presets: (JSON.parse(r.presets) as PlaytestPreset[]).map((p) => ({ name: p.name, settings: cleanGoldfishSettings(p.settings) })), saved: true };
  const flip = planFor(listId, '', commander, cards).flip.value;
  return { settings: { ...DEFAULT_SETTINGS, checks: startingChecks(commander?.cmc ?? null, flip) }, presets: [], saved: false };
}

export function savePlaytest(listId: string, change: { settings?: unknown; presets?: unknown }, current: { settings: GoldfishSettings; presets: PlaytestPreset[] }): { settings: GoldfishSettings; presets: PlaytestPreset[] } {
  const settings = change.settings !== undefined ? cleanGoldfishSettings(change.settings) : current.settings;
  const presets = change.presets !== undefined
    ? (Array.isArray(change.presets) ? change.presets : []).filter((p): p is PlaytestPreset => !!p && typeof p.name === 'string' && p.name.trim() !== '')
      .slice(0, 12).map((p) => ({ name: p.name.trim().slice(0, 40), settings: cleanGoldfishSettings(p.settings) }))
    : current.presets;
  playDb().run(
    `INSERT INTO deck_playtest (listId, settings, presets, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(listId) DO UPDATE SET settings = excluded.settings, presets = excluded.presets, updatedAt = excluded.updatedAt`,
    [listId, JSON.stringify(settings), JSON.stringify(presets), new Date().toISOString()],
  );
  return { settings, presets };
}
