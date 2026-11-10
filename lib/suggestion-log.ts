/**
 * The suggestion log: what the app showed, what the owner did with it, and
 * whether they regretted it. Replaces judging suggestions with Claude judges
 * by what owners actually do (deck flow plan, "Data collection").
 *
 *   suggestion_batches   the suggestions shown together (one Tune group, the
 *                        Plan's proposals), open until replaced or applied
 *   suggestion_events    one per suggestion shown: task, method, model,
 *                        prompt version, rank, the cards, the reason shown,
 *                        the deck's hash at the time
 *   suggestion_outcomes  accepted | refused | ignored, with an optional reason
 *   conversation_events  questions asked, answered or skipped; approaches
 *                        shown and corrected
 *
 * A batch is logged once per distinct content: showing the same group again
 * writes nothing. When a group is replaced, or the owner applies their
 * changes, its open batch closes and every suggestion left untouched is
 * marked ignored. Regret (a cut card back in the main board, or an added
 * card gone, within 14 days) is worked out on read from the deck's history.
 *
 * Privacy: everything stays in the app's database on the Pi. Nothing is
 * logged for a profile whose sharing is off (on for the profiles that
 * existed when the log began, off by default for anyone after). Free-text
 * reasons are never exported; the admin-only export drops profile and deck
 * names. Tables are made on first use. Server only.
 */

import { createHash, randomUUID } from 'node:crypto';

import { database, getSetting, setSetting } from './db';
import { REASON_CHIPS, REASON_LABELS, type ReasonChip } from './suggestion-shared';

export { REASON_CHIPS, REASON_LABELS, type ReasonChip };

export type Task = 'trim' | 'find' | 'tune' | 'build' | 'plan';
export type Method = 'code' | 'ai';
export type Outcome = 'accepted' | 'refused' | 'ignored';
export type ConversationKind = 'question_asked' | 'question_answered' | 'question_skipped' | 'approach_shown' | 'approach_corrected';

/** How long after accepting a change undoing it counts as regret. */
export const REGRET_DAYS = 14;

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS suggestion_batches (
      id TEXT PRIMARY KEY, listId TEXT NOT NULL, profileId TEXT NOT NULL, key TEXT NOT NULL, signature TEXT NOT NULL,
      openedAt TEXT NOT NULL, closedAt TEXT)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_suggestion_batches_open ON suggestion_batches (listId, key, closedAt)');
    d.run(`CREATE TABLE IF NOT EXISTS suggestion_events (
      id TEXT PRIMARY KEY, at TEXT NOT NULL, profileId TEXT NOT NULL, listId TEXT NOT NULL,
      task TEXT NOT NULL, method TEXT NOT NULL, model TEXT, promptVersion TEXT, planVersion TEXT,
      batchId TEXT NOT NULL, rank INTEGER NOT NULL, preselected INTEGER NOT NULL DEFAULT 0,
      cardOut TEXT, cardIn TEXT, cardOutName TEXT, cardInName TEXT, reasonShown TEXT NOT NULL DEFAULT '',
      deckHash TEXT NOT NULL DEFAULT '', itemKey TEXT NOT NULL)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_suggestion_events_item ON suggestion_events (listId, itemKey)');
    d.run('CREATE INDEX IF NOT EXISTS idx_suggestion_events_batch ON suggestion_events (batchId)');
    d.run(`CREATE TABLE IF NOT EXISTS suggestion_outcomes (
      eventId TEXT PRIMARY KEY, at TEXT NOT NULL, outcome TEXT NOT NULL, reasonChip TEXT, reasonText TEXT)`);
    d.run(`CREATE TABLE IF NOT EXISTS conversation_events (
      id TEXT PRIMARY KEY, at TEXT NOT NULL, profileId TEXT NOT NULL, listId TEXT NOT NULL, task TEXT NOT NULL,
      kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', promptVersion TEXT)`);
    // Sharing starts on for everyone already here (the friend group agreed); later profiles start off.
    if (getSetting('suggestions.seeded') !== '1') {
      for (const p of d.all(`SELECT id FROM profiles WHERE id != 'tour'`) as Array<{ id: string }>) {
        if (getSetting(shareKey(p.id)) === null) setSetting(shareKey(p.id), '1');
      }
      setSetting('suggestions.seeded', '1');
    }
    ready = true;
  }
  return d;
}

const now = () => new Date().toISOString();
const shareKey = (profileId: string) => `suggestions.share.${profileId}`;

/** Whether this profile's suggestions and choices are logged. */
export function shareOn(profileId: string): boolean {
  db();
  return getSetting(shareKey(profileId)) === '1';
}

export function setShare(profileId: string, on: boolean): void {
  db();
  setSetting(shareKey(profileId), on ? '1' : '0');
}

export interface CardSide { oracleId: string | null; name: string }

export interface ShownItem {
  /** The suggestion's own key, which the page sends back when it is accepted or refused. */
  key: string;
  cardOut?: CardSide | null;
  cardIn?: CardSide | null;
  reasonShown: string;
  preselected?: boolean;
}

export interface ShownBatch {
  /** Stable for the place it is shown: "tune:cuts:cuts:claude", "plan:proposals". */
  key: string;
  task: Task;
  method: Method;
  model?: string | null;
  promptVersion?: string | null;
  planVersion?: string | null;
  deckHash: string;
  /** In the order shown: rank is the position, 1-based. */
  items: ShownItem[];
}

const signatureOf = (b: ShownBatch) => createHash('sha1').update(JSON.stringify([b.method, b.model ?? null, b.promptVersion ?? null, b.planVersion ?? null,
  b.items.map((i) => [i.key, i.cardOut?.name ?? null, i.cardIn?.name ?? null, i.reasonShown, !!i.preselected])])).digest('hex');

/** Close a batch: whatever in it was left untouched was ignored. */
function closeBatch(id: string, at = now()): void {
  const d = db();
  d.run('UPDATE suggestion_batches SET closedAt = ? WHERE id = ? AND closedAt IS NULL', [at, id]);
  d.run(`INSERT INTO suggestion_outcomes (eventId, at, outcome)
    SELECT e.id, ?, 'ignored' FROM suggestion_events e LEFT JOIN suggestion_outcomes o ON o.eventId = e.id
    WHERE e.batchId = ? AND o.eventId IS NULL`, [at, id]);
}

/**
 * Log what one place on a page showed. Several batches can be shown at once
 * (Tune's groups): pass them together with the place's prefix, and any open
 * batch under that prefix that is no longer shown closes. Showing the same
 * content again writes nothing. Returns the batch ids, by key.
 */
export function logShown(profileId: string, listId: string, prefix: string, batches: ShownBatch[]): Record<string, string> {
  if (!shareOn(profileId)) return {};
  const d = db();
  const at = now();
  const ids: Record<string, string> = {};
  const open = d.all('SELECT id, key, signature FROM suggestion_batches WHERE listId = ? AND closedAt IS NULL AND key LIKE ?', [listId, `${prefix}%`]) as Array<{ id: string; key: string; signature: string }>;
  const shown = new Set(batches.filter((b) => b.items.length).map((b) => b.key));
  for (const o of open) if (!shown.has(o.key)) closeBatch(o.id, at);
  for (const b of batches) {
    if (!b.items.length) continue;
    const signature = signatureOf(b);
    const same = open.find((o) => o.key === b.key);
    if (same?.signature === signature) { ids[b.key] = same.id; continue; }
    if (same) closeBatch(same.id, at);
    const id = randomUUID();
    d.run('BEGIN');
    try {
      d.run('INSERT INTO suggestion_batches (id, listId, profileId, key, signature, openedAt) VALUES (?, ?, ?, ?, ?, ?)', [id, listId, profileId, b.key, signature, at]);
      b.items.forEach((i, n) => d.run(`INSERT INTO suggestion_events (id, at, profileId, listId, task, method, model, promptVersion, planVersion, batchId, rank, preselected,
        cardOut, cardIn, cardOutName, cardInName, reasonShown, deckHash, itemKey) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), at, profileId, listId, b.task, b.method, b.model ?? null, b.promptVersion ?? null, b.planVersion ?? null, id, n + 1, i.preselected ? 1 : 0,
        i.cardOut?.oracleId ?? null, i.cardIn?.oracleId ?? null, i.cardOut?.name ?? null, i.cardIn?.name ?? null, i.reasonShown.slice(0, 600), b.deckHash, i.key]));
      d.run('COMMIT');
    } catch (e) {
      d.run('ROLLBACK');
      throw e;
    }
    ids[b.key] = id;
  }
  return ids;
}

/** Close every open batch for a deck (its changes were applied): untouched suggestions were ignored. */
export function closeAll(listId: string, prefix = ''): void {
  for (const o of db().all('SELECT id FROM suggestion_batches WHERE listId = ? AND closedAt IS NULL AND key LIKE ?', [listId, `${prefix}%`]) as Array<{ id: string }>) closeBatch(o.id);
}

/** The latest event shown for a suggestion key on a deck. */
function latestEvent(listId: string, itemKey: string): string | null {
  const r = db().get('SELECT id FROM suggestion_events WHERE listId = ? AND itemKey = ? ORDER BY at DESC, rank LIMIT 1', [listId, itemKey]) as { id: string } | null;
  return r?.id ?? null;
}

/** Record what the owner did with suggestions, by their keys. The latest action wins. */
export function logOutcome(listId: string, itemKeys: string[], outcome: Outcome, reason?: { chip?: ReasonChip | null; text?: string | null }): number {
  const d = db();
  let n = 0;
  for (const key of itemKeys) {
    const id = latestEvent(listId, key);
    if (!id) continue;
    d.run(`INSERT INTO suggestion_outcomes (eventId, at, outcome, reasonChip, reasonText) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(eventId) DO UPDATE SET at = excluded.at, outcome = excluded.outcome, reasonChip = excluded.reasonChip, reasonText = excluded.reasonText`,
    [id, now(), outcome, reason?.chip ?? null, reason?.text?.trim().slice(0, 600) || null]);
    n += 1;
  }
  return n;
}

/** Add or change the reason on a refusal already recorded. */
export function logReason(listId: string, itemKey: string, chip: ReasonChip | null, text: string | null): boolean {
  const id = latestEvent(listId, itemKey);
  if (!id) return false;
  db().run('UPDATE suggestion_outcomes SET reasonChip = ?, reasonText = ? WHERE eventId = ?', [chip, text?.trim().slice(0, 600) || null, id]);
  return true;
}

/** Take back an outcome (unstaged, or brought back after a dismiss): the suggestion is open again. */
export function clearOutcome(listId: string, itemKeys: string[]): void {
  for (const key of itemKeys) {
    const id = latestEvent(listId, key);
    if (id) db().run('DELETE FROM suggestion_outcomes WHERE eventId = ? AND outcome != ?', [id, 'ignored']);
  }
}

/** Run a logging step without ever failing the request it rides on. */
export function quietly(step: () => unknown): void {
  try { step(); } catch (e) { console.error('[suggestion-log]', e); }
}

export function logConversation(profileId: string, listId: string, task: Task, kind: ConversationKind, text: string, promptVersion: string | null = null): void {
  if (!shareOn(profileId)) return;
  db().run('INSERT INTO conversation_events (id, at, profileId, listId, task, kind, text, promptVersion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), now(), profileId, listId, task, kind, text.slice(0, 2000), promptVersion]);
}

// --- reading: regret, rates, export ---------------------------------------------------

export interface EventRow {
  id: string; at: string; profileId: string; listId: string; task: Task; method: Method; model: string | null; promptVersion: string | null;
  planVersion: string | null; batchId: string; rank: number; preselected: number; cardOut: string | null; cardIn: string | null;
  cardOutName: string | null; cardInName: string | null; reasonShown: string; deckHash: string; itemKey: string;
  outcome: Outcome | null; outcomeAt: string | null; reasonChip: ReasonChip | null; reasonText: string | null;
}

function rows(): EventRow[] {
  return db().all(`SELECT e.*, o.outcome, o.at AS outcomeAt, o.reasonChip, o.reasonText
    FROM suggestion_events e LEFT JOIN suggestion_outcomes o ON o.eventId = e.id ORDER BY e.at, e.rank`) as unknown as EventRow[];
}

const front = (n: string) => n.split(' // ')[0].toLowerCase();

/**
 * Accepted suggestions the owner went back on within REGRET_DAYS: a card cut
 * that came back to the main board, or a card added that left it. Read from
 * the deck's change history (lib/deck-history.ts); a deck with no history has
 * no regrets to find.
 */
export function regretted(events: EventRow[] = rows()): Set<string> {
  const d = db();
  const has = d.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deck_changes'`);
  const out = new Set<string>();
  if (!has) return out;
  type Change = { name: string; from: string | null; to: string | null };
  const byList = new Map<string, Array<{ at: string; diff: { added?: Change[]; removed?: Change[]; moved?: Change[] } }>>();
  const changesOf = (listId: string) => {
    if (!byList.has(listId)) {
      byList.set(listId, (d.all('SELECT at, diff FROM deck_changes WHERE listId = ? AND undone = 0 ORDER BY at', [listId]) as Array<{ at: string; diff: string }>)
        .map((r) => ({ at: r.at, diff: (() => { try { return JSON.parse(r.diff); } catch { return {}; } })() })));
    }
    return byList.get(listId)!;
  };
  for (const e of events) {
    if (e.outcome !== 'accepted' || !e.outcomeAt) continue;
    const until = new Date(new Date(e.outcomeAt).getTime() + REGRET_DAYS * 86_400_000).toISOString();
    const later = changesOf(e.listId).filter((c) => c.at > e.outcomeAt! && c.at <= until);
    const into = (name: string) => later.some((c) => [...(c.diff.added ?? []), ...(c.diff.moved ?? [])].some((x) => front(x.name) === front(name) && x.to === 'main'));
    const outOf = (name: string) => later.some((c) => [...(c.diff.removed ?? []), ...(c.diff.moved ?? [])].some((x) => front(x.name) === front(name) && x.from === 'main'));
    // A swap is regretted if either half was undone.
    if ((e.cardOutName && into(e.cardOutName)) || (e.cardInName && outOf(e.cardInName))) out.add(e.id);
  }
  return out;
}

export interface RateRow { value: string; shown: number; accepted: number; refused: number; ignored: number; open: number; regretted: number; acceptRate: number | null }
export type Dimension = 'task' | 'method' | 'model' | 'promptVersion' | 'rank';

/** Accept rate by task, method, model, prompt version and rank shown. The rate is accepted over decided (accepted, refused or ignored). */
export function rates(events: EventRow[] = rows()): Record<Dimension, RateRow[]> {
  const regret = regretted(events);
  const valueOf = (e: EventRow, dim: Dimension) => (dim === 'rank' ? (e.rank >= 6 ? '6+' : String(e.rank)) : String(e[dim] ?? (dim === 'model' ? 'none (code)' : '—')));
  const out = {} as Record<Dimension, RateRow[]>;
  for (const dim of ['task', 'method', 'model', 'promptVersion', 'rank'] as Dimension[]) {
    const m = new Map<string, RateRow>();
    for (const e of events) {
      const v = valueOf(e, dim);
      const r = m.get(v) ?? { value: v, shown: 0, accepted: 0, refused: 0, ignored: 0, open: 0, regretted: 0, acceptRate: null };
      r.shown += 1;
      if (e.outcome === 'accepted') r.accepted += 1; else if (e.outcome === 'refused') r.refused += 1; else if (e.outcome === 'ignored') r.ignored += 1; else r.open += 1;
      if (regret.has(e.id)) r.regretted += 1;
      m.set(v, r);
    }
    out[dim] = [...m.values()].map((r) => ({ ...r, acceptRate: r.accepted + r.refused + r.ignored ? r.accepted / (r.accepted + r.refused + r.ignored) : null }))
      .sort((a, b) => (dim === 'rank' ? a.value.localeCompare(b.value, undefined, { numeric: true }) : b.shown - a.shown));
  }
  return out;
}

/** Why owners said no, by one-tap reason (typed reasons are counted, never shown here). */
export function reasons(events: EventRow[] = rows()): Array<{ chip: string; count: number; typed: number }> {
  const m = new Map<string, { chip: string; count: number; typed: number }>();
  for (const e of events.filter((x) => x.outcome === 'refused' && (x.reasonChip || x.reasonText))) {
    const k = e.reasonChip ?? 'typed only';
    const r = m.get(k) ?? { chip: k, count: 0, typed: 0 };
    r.count += 1;
    if (e.reasonText) r.typed += 1;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

/**
 * Every event and outcome, for evaluation off the Pi: profiles and decks as
 * opaque ids (no names), free-text reasons left out, regret worked out.
 */
export function exportLog(): { events: Array<Omit<EventRow, 'reasonText' | 'profileId' | 'listId'> & { profile: string; deck: string; regretted: boolean; typedReason: boolean }>; conversations: Array<{ at: string; profile: string; deck: string; task: string; kind: string; promptVersion: string | null; hasText: boolean }> } {
  const anon = (kind: string, id: string) => `${kind}-${createHash('sha1').update(`${kind}:${id}`).digest('hex').slice(0, 10)}`;
  const all = rows();
  const regret = regretted(all);
  const events = all.map(({ reasonText, profileId, listId, ...e }) => ({ ...e, profile: anon('p', profileId), deck: anon('d', listId), regretted: regret.has(e.id), typedReason: !!reasonText }));
  const conversations = (db().all('SELECT at, profileId, listId, task, kind, text, promptVersion FROM conversation_events ORDER BY at') as Array<{ at: string; profileId: string; listId: string; task: string; kind: string; text: string; promptVersion: string | null }>)
    // Owners' answers are free text: counted, never exported.
    .map((c) => ({ at: c.at, profile: anon('p', c.profileId), deck: anon('d', c.listId), task: c.task, kind: c.kind, promptVersion: c.promptVersion, hasText: !!c.text }));
  return { events, conversations };
}

/** Totals for the admin page's header. */
export function totals(): { events: number; batches: number; conversations: number; sharing: Array<{ id: string; name: string; on: boolean }> } {
  const d = db();
  const n = (sql: string) => (d.get(sql) as { n: number }).n;
  return {
    events: n('SELECT COUNT(*) AS n FROM suggestion_events'),
    batches: n('SELECT COUNT(*) AS n FROM suggestion_batches'),
    conversations: n('SELECT COUNT(*) AS n FROM conversation_events'),
    sharing: (d.all(`SELECT id, name FROM profiles WHERE id != 'tour' ORDER BY createdAt`) as Array<{ id: string; name: string }>).map((p) => ({ ...p, on: shareOn(p.id) })),
  };
}
