/**
 * A deck's history: every change recorded with the deck as it was just
 * before, so any change can be undone exactly, and named snapshots that
 * can be compared with the deck now and restored.
 *
 * The deck's state is small - which cards are in it (rows of list_cards),
 * its commander, its sections and its tags on cards - so each change keeps
 * a whole copy of the state before it. Undoing the last change puts that
 * state back; "restore to before" an older change does the same, which also
 * undoes everything after it, and says so. A change made in a batch (moving
 * twelve selected cards) undoes as one. Server only.
 */

import { randomUUID } from 'node:crypto';

import { settle } from './collection';
import { database } from './db';

/** How long changes by the same person count as one sitting, in the history view. */
export const SESSION_GAP_MS = 30 * 60_000;
/** Changes kept with their state per deck; older ones keep only their summary. */
const KEEP_STATE = 300;

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run(`CREATE TABLE IF NOT EXISTS deck_changes (
      id TEXT PRIMARY KEY, listId TEXT NOT NULL, profileId TEXT, at TEXT NOT NULL, batch TEXT,
      kind TEXT NOT NULL, label TEXT NOT NULL, diff TEXT NOT NULL, before TEXT, undone INTEGER NOT NULL DEFAULT 0)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_deck_changes_list ON deck_changes (listId, at)');
    d.run(`CREATE TABLE IF NOT EXISTS deck_snapshots (
      id TEXT PRIMARY KEY, listId TEXT NOT NULL, profileId TEXT, at TEXT NOT NULL, name TEXT NOT NULL,
      auto INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL)`);
    d.run('CREATE INDEX IF NOT EXISTS idx_deck_snapshots_list ON deck_snapshots (listId, at)');
    ready = true;
  }
  return d;
}

type Row = Record<string, string | number | null>;

/** Everything a change can touch, as stored rows. */
export interface DeckState {
  commander: { id: string | null; finish: string | null };
  cards: Row[];
  cardTags: Row[];
  tags: Row[];
  sections: Row[];
}

const hasTable = (name: string) => !!database().get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);

export function captureState(listId: string): DeckState {
  const d = db();
  const list = d.get('SELECT commanderId, commanderFinish FROM lists WHERE id = ?', [listId]) as { commanderId: string | null; commanderFinish: string | null } | null;
  return {
    commander: { id: list?.commanderId ?? null, finish: list?.commanderFinish ?? null },
    cards: d.all('SELECT * FROM list_cards WHERE listId = ? ORDER BY cardId', [listId]) as Row[],
    cardTags: hasTable('deck_card_tags') ? d.all('SELECT * FROM deck_card_tags WHERE listId = ? ORDER BY cardKey, tagId', [listId]) as Row[] : [],
    tags: hasTable('deck_tags') ? d.all('SELECT * FROM deck_tags WHERE listId = ? ORDER BY id', [listId]) as Row[] : [],
    sections: hasTable('deck_sections') ? d.all('SELECT * FROM deck_sections WHERE listId = ? ORDER BY id', [listId]) as Row[] : [],
  };
}

function insertRows(table: string, rows: Row[]): void {
  const d = db();
  for (const row of rows) {
    const cols = Object.keys(row);
    d.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]));
  }
}

/** Put a deck back exactly as a state recorded it. */
export function restoreState(listId: string, state: DeckState): void {
  const d = db();
  d.run('BEGIN');
  try {
    d.run('UPDATE lists SET commanderId = ?, commanderFinish = ?, updatedAt = ? WHERE id = ?',
      [state.commander.id, state.commander.finish ?? 'nonfoil', new Date().toISOString(), listId]);
    d.run('DELETE FROM list_cards WHERE listId = ?', [listId]);
    insertRows('list_cards', state.cards);
    if (hasTable('deck_card_tags')) { d.run('DELETE FROM deck_card_tags WHERE listId = ?', [listId]); insertRows('deck_card_tags', state.cardTags); }
    if (hasTable('deck_tags')) { d.run('DELETE FROM deck_tags WHERE listId = ?', [listId]); insertRows('deck_tags', state.tags); }
    if (hasTable('deck_sections')) { d.run('DELETE FROM deck_sections WHERE listId = ?', [listId]); insertRows('deck_sections', state.sections); }
    d.run('COMMIT');
  } catch (error) {
    d.run('ROLLBACK');
    throw error;
  }
  // Copies taken from the collection follow the cards back.
  settle(listId);
}

// --- What changed, in words ------------------------------------------------

export interface CardChange { cardId: string; name: string; from: string | null; to: string | null }
export interface Diff {
  added: CardChange[];
  removed: CardChange[];
  /** Same card, another board or section. */
  moved: CardChange[];
  /** Same card and board: quantity, finish or printing. */
  changed: CardChange[];
  /** Tags put on or taken off, by card. */
  tagged: CardChange[];
  commander: CardChange | null;
}

const nameOf = (cardId: string | null): string => {
  if (!cardId) return '';
  const r = database().get('SELECT name FROM cards WHERE id = ?', [cardId]) as { name: string } | null;
  return r?.name ?? cardId;
};
// A printing's oracle id never changes, so it is read once.
const oracles = new Map<string, string>();
const oracleOf = (cardId: string): string => {
  const known = oracles.get(cardId);
  if (known) return known;
  const r = database().get("SELECT json_extract(data, '$.oracle_id') AS o FROM cards WHERE id = ?", [cardId]) as { o: string | null } | null;
  const o = r?.o ?? cardId;
  oracles.set(cardId, o);
  return o;
};
const where = (r: Row) => `${r.quantity}× ${r.board ?? 'main'}${r.finish && r.finish !== 'nonfoil' ? ` ${r.finish}` : ''}`;

/** Card rows matched by oracle id, so a new printing reads as a change, not a remove and an add. */
export function diffStates(before: DeckState, after: DeckState): Diff {
  const key = (r: Row) => oracleOf(String(r.cardId));
  const a = new Map(before.cards.map((r) => [key(r), r]));
  const b = new Map(after.cards.map((r) => [key(r), r]));
  const out: Diff = { added: [], removed: [], moved: [], changed: [], tagged: [], commander: null };
  for (const [k, r] of b) {
    const old = a.get(k);
    const name = nameOf(String(r.cardId));
    if (!old) out.added.push({ cardId: String(r.cardId), name, from: null, to: where(r) });
    else if (old.board !== r.board) out.moved.push({ cardId: String(r.cardId), name, from: String(old.board), to: String(r.board) });
    else if (old.quantity !== r.quantity || old.finish !== r.finish || old.cardId !== r.cardId || old.slot !== r.slot) {
      out.changed.push({ cardId: String(r.cardId), name, from: where(old), to: where(r) });
    }
  }
  for (const [k, r] of a) if (!b.has(k)) out.removed.push({ cardId: String(r.cardId), name: nameOf(String(r.cardId)), from: where(r), to: null });
  const tagKey = (r: Row) => `${r.cardKey}|${r.tagId}|${r.isOn}`;
  const ta = new Set(before.cardTags.map(tagKey));
  const tb = new Set(after.cardTags.map(tagKey));
  const tagName = new Map([...before.tags, ...after.tags].map((t) => [String(t.id), String(t.name)]));
  const cardByKey = new Map([...before.cards, ...after.cards].map((r) => [key(r), String(r.cardId)]));
  for (const r of after.cardTags) if (!ta.has(tagKey(r)) && r.isOn === 1) {
    const cardId = cardByKey.get(String(r.cardKey)) ?? before.commander.id ?? '';
    out.tagged.push({ cardId, name: nameOf(cardId) || String(r.cardKey), from: null, to: tagName.get(String(r.tagId)) ?? '' });
  }
  for (const r of before.cardTags) if (!tb.has(tagKey(r)) && r.isOn === 1) {
    const cardId = cardByKey.get(String(r.cardKey)) ?? before.commander.id ?? '';
    out.tagged.push({ cardId, name: nameOf(cardId) || String(r.cardKey), from: tagName.get(String(r.tagId)) ?? '', to: null });
  }
  if (before.commander.id !== after.commander.id || before.commander.finish !== after.commander.finish) {
    out.commander = { cardId: after.commander.id ?? '', name: nameOf(after.commander.id), from: nameOf(before.commander.id) || null, to: nameOf(after.commander.id) || null };
  }
  return out;
}

export const isEmpty = (d: Diff) => !d.added.length && !d.removed.length && !d.moved.length && !d.changed.length && !d.tagged.length && !d.commander;

/** "+4 −3, 2 moved" */
export function countLine(d: Diff): string {
  const parts = [
    d.added.length ? `+${d.added.length}` : '',
    d.removed.length ? `−${d.removed.length}` : '',
    d.moved.length ? `${d.moved.length} moved` : '',
    d.changed.length ? `${d.changed.length} changed` : '',
    d.tagged.length ? `${d.tagged.length} tag${d.tagged.length === 1 ? '' : 's'}` : '',
    d.commander ? 'new commander' : '',
  ].filter(Boolean);
  return parts.join(', ') || 'no changes';
}

// --- Recording ----------------------------------------------------------------

export interface Change {
  id: string;
  at: string;
  profileId: string | null;
  batch: string | null;
  kind: string;
  label: string;
  diff: Diff;
  undone: boolean;
  /** Whether it can still be restored to before (its state is kept). */
  restorable: boolean;
}

/**
 * Run a change to a deck and record it, with the deck as it was before.
 * Nothing is recorded when nothing changed. Returns what `fn` returns.
 */
export async function recorded<T>(
  listId: string, who: { profile: string | null; batch?: string | null }, kind: string, label: string, fn: () => T | Promise<T>,
): Promise<{ result: T; change: Change | null }> {
  const before = captureState(listId);
  const result = await fn();
  const after = captureState(listId);
  const diff = diffStates(before, after);
  if (isEmpty(diff)) return { result, change: null };
  const change: Change = {
    id: randomUUID(), at: new Date().toISOString(), profileId: who.profile, batch: who.batch ?? null,
    kind, label: label || describe(diff), diff, undone: false, restorable: true,
  };
  const d = db();
  d.run('INSERT INTO deck_changes (id, listId, profileId, at, batch, kind, label, diff, before) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [change.id, listId, change.profileId, change.at, change.batch, kind, change.label, JSON.stringify(diff), JSON.stringify(before)]);
  // Only the newest changes keep their whole state.
  d.run(`UPDATE deck_changes SET before = NULL WHERE listId = ? AND before IS NOT NULL AND id NOT IN
    (SELECT id FROM deck_changes WHERE listId = ? ORDER BY at DESC LIMIT ${KEEP_STATE})`, [listId, listId]);
  return { result, change };
}

/** A change in plain words, when the caller did not name it. */
export function describe(d: Diff): string {
  const one = (xs: CardChange[]) => (xs.length === 1 ? xs[0].name : `${xs.length} cards`);
  if (d.commander && !d.added.length && !d.removed.length) return `Commander: ${d.commander.to ?? 'none'}`;
  if (d.added.length && !d.removed.length && !d.moved.length) return `Added ${one(d.added)}`;
  if (d.removed.length && !d.added.length && !d.moved.length) return `Removed ${one(d.removed)}`;
  if (d.moved.length && !d.added.length && !d.removed.length) return `Moved ${one(d.moved)}`;
  if (d.tagged.length && !d.added.length && !d.removed.length && !d.moved.length && !d.changed.length) {
    const t = d.tagged[0];
    return d.tagged.length === 1 ? `${t.to ? 'Tagged' : 'Untagged'} ${t.name} ${t.to ?? t.from}` : `${d.tagged.length} tags changed`;
  }
  if (d.changed.length && !d.added.length && !d.removed.length && !d.moved.length) {
    const c = d.changed[0];
    // Only the count changed: say so, "Consider 1 → 2".
    const [qa, ...ra] = (c.from ?? '').split('× '), [qb, ...rb] = (c.to ?? '').split('× ');
    return d.changed.length === 1 && ra.join() === rb.join() && qa !== qb ? `${c.name} ${qa} → ${qb}` : `Changed ${one(d.changed)}`;
  }
  return countLine(d);
}

interface ChangeRow { id: string; profileId: string | null; at: string; batch: string | null; kind: string; label: string; diff: string; before: string | null; undone: number }
const toChange = (r: ChangeRow): Change => ({
  id: r.id, at: r.at, profileId: r.profileId, batch: r.batch, kind: r.kind, label: r.label,
  diff: JSON.parse(r.diff) as Diff, undone: r.undone === 1, restorable: r.before !== null,
});

export function changes(listId: string, limit = 200): Change[] {
  return (db().all('SELECT id, profileId, at, batch, kind, label, diff, before IS NOT NULL AS before, undone FROM deck_changes WHERE listId = ? ORDER BY at DESC LIMIT ?', [listId, limit]) as unknown as Array<ChangeRow & { before: number }>)
    .map((r) => toChange({ ...r, before: r.before ? '' : null }));
}

/**
 * Undo the newest change still standing (a batch undoes as one): the deck
 * goes back to how it was before it, and the undo is itself a change, so
 * it can be undone too.
 */
export async function undoLast(listId: string, who: { profile: string | null }): Promise<Change | null> {
  const d = db();
  const last = d.get("SELECT id, batch FROM deck_changes WHERE listId = ? AND undone = 0 AND before IS NOT NULL AND kind != 'undo' ORDER BY at DESC LIMIT 1", [listId]) as { id: string; batch: string | null } | null;
  if (!last) return null;
  const group = last.batch
    ? d.all('SELECT id, before, label, at FROM deck_changes WHERE listId = ? AND batch = ? AND undone = 0 ORDER BY at ASC', [listId, last.batch]) as Array<{ id: string; before: string | null; label: string; at: string }>
    : d.all('SELECT id, before, label, at FROM deck_changes WHERE id = ?', [last.id]) as Array<{ id: string; before: string | null; label: string; at: string }>;
  const first = group[0];
  if (!first?.before) return null;
  const state = JSON.parse(first.before) as DeckState;
  const label = group.length === 1 ? `Undid: ${first.label}` : `Undid ${group.length} changes`;
  const { change } = await recorded(listId, who, 'undo', label, () => restoreState(listId, state));
  for (const g of group) d.run('UPDATE deck_changes SET undone = 1 WHERE id = ?', [g.id]);
  return change;
}

/** Put the deck back to how it was before an older change; everything after it is undone too. */
export async function restoreBefore(listId: string, changeId: string, who: { profile: string | null }): Promise<Change | null> {
  const d = db();
  const row = d.get('SELECT before, label, at FROM deck_changes WHERE listId = ? AND id = ?', [listId, changeId]) as { before: string | null; label: string; at: string } | null;
  if (!row?.before) return null;
  const state = JSON.parse(row.before) as DeckState;
  const { change } = await recorded(listId, who, 'undo', `Went back to before: ${row.label}`, () => restoreState(listId, state));
  d.run('UPDATE deck_changes SET undone = 1 WHERE listId = ? AND at >= ? AND undone = 0 AND kind != ?', [listId, row.at, 'undo']);
  if (change) d.run('UPDATE deck_changes SET undone = 0 WHERE id = ?', [change.id]);
  return change;
}

// --- Snapshots ------------------------------------------------------------------

export interface Snapshot { id: string; at: string; name: string; auto: boolean; profileId: string | null; size: number }

export function takeSnapshot(listId: string, name: string, who: { profile: string | null }, auto = false): Snapshot {
  const state = captureState(listId);
  const snap: Snapshot = {
    id: randomUUID(), at: new Date().toISOString(), name: name.trim().slice(0, 80) || 'Snapshot', auto, profileId: who.profile,
    size: state.cards.filter((r) => (r.board ?? 'main') === 'main').reduce((n, r) => n + Number(r.quantity ?? 0), 0) + (state.commander.id ? 1 : 0),
  };
  db().run('INSERT INTO deck_snapshots (id, listId, profileId, at, name, auto, state) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [snap.id, listId, snap.profileId, snap.at, snap.name, auto ? 1 : 0, JSON.stringify(state)]);
  // Automatic snapshots are a safety net: the newest 20 are enough.
  db().run(`DELETE FROM deck_snapshots WHERE listId = ? AND auto = 1 AND id NOT IN
    (SELECT id FROM deck_snapshots WHERE listId = ? AND auto = 1 ORDER BY at DESC LIMIT 20)`, [listId, listId]);
  return snap;
}

export function snapshots(listId: string): Snapshot[] {
  return (db().all('SELECT id, at, name, auto, profileId, state FROM deck_snapshots WHERE listId = ? ORDER BY at DESC', [listId]) as Array<{ id: string; at: string; name: string; auto: number; profileId: string | null; state: string }>)
    .map((r) => {
      const s = JSON.parse(r.state) as DeckState;
      const size = s.cards.filter((c) => (c.board ?? 'main') === 'main').reduce((n, c) => n + Number(c.quantity ?? 0), 0) + (s.commander.id ? 1 : 0);
      return { id: r.id, at: r.at, name: r.name, auto: r.auto === 1, profileId: r.profileId, size };
    });
}

function snapshotState(listId: string, id: string): DeckState | null {
  const r = db().get('SELECT state FROM deck_snapshots WHERE listId = ? AND id = ?', [listId, id]) as { state: string } | null;
  return r ? JSON.parse(r.state) as DeckState : null;
}

/** A snapshot against the deck now: what is new since, what is gone, what moved. */
export function compareSnapshot(listId: string, id: string): Diff | null {
  const state = snapshotState(listId, id);
  return state ? diffStates(state, captureState(listId)) : null;
}

export async function restoreSnapshot(listId: string, id: string, who: { profile: string | null }): Promise<Change | null> {
  const state = snapshotState(listId, id);
  if (!state) return null;
  const name = (db().get('SELECT name FROM deck_snapshots WHERE id = ?', [id]) as { name: string } | null)?.name ?? 'a snapshot';
  return (await recorded(listId, who, 'restore', `Restored “${name}”`, () => restoreState(listId, state))).change;
}

export function renameSnapshot(listId: string, id: string, name: string): boolean {
  const n = name.trim().slice(0, 80);
  if (!n) return false;
  db().run('UPDATE deck_snapshots SET name = ?, auto = 0 WHERE listId = ? AND id = ?', [n, listId, id]);
  return true;
}

export function deleteSnapshot(listId: string, id: string): void {
  db().run('DELETE FROM deck_snapshots WHERE listId = ? AND id = ?', [listId, id]);
}

/** A deck deleted: its history goes with it. */
export function forgetHistory(listId: string): void {
  db().run('DELETE FROM deck_changes WHERE listId = ?', [listId]);
  db().run('DELETE FROM deck_snapshots WHERE listId = ?', [listId]);
}

/** The batch a request's change belongs to: the page sends one id for a bulk action, so it undoes as one. */
export const batchOf = (request: Request): string | null => request.headers.get('x-change-batch')?.slice(0, 64) || null;
