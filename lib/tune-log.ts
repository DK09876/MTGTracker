/**
 * Tune's suggestions as the suggestion log records them (lib/suggestion-log.ts):
 * each group shown is a batch, each item an event with its rank in the group.
 * Server only.
 */

import { localCards } from './card-store';
import { cardsInList, database, type List } from './db';
import { deckHash } from './deck-hash';
import { logShown, type CardSide, type ShownBatch, type Task } from './suggestion-log';
import type { CardRef, Intent, SuggestionGroup } from './tune-shared';

/** Which task in the deck flow each Tune intent is. */
export const TASK_OF: Record<Intent, Task> = { cuts: 'trim', find: 'find', finish: 'build', swaps: 'tune', fix: 'tune', lands: 'tune' };

/** A card as the log keeps it: its oracle id (from the stored printing, else the card copy) and name. */
function side(ref: CardRef | undefined, oracleOf: Map<string, string>): CardSide | null {
  if (!ref) return null;
  return { oracleId: oracleOf.get(ref.id) ?? localCards([ref.name])[0]?.oracle_id ?? null, name: ref.name };
}

export function tuneBatches(intent: Intent, groups: SuggestionGroup[], hash: string): ShownBatch[] {
  const ids = [...new Set(groups.flatMap((g) => g.items.flatMap((i) => [i.add?.id, i.cut?.id]).filter((x): x is string => !!x)))];
  const oracleOf = new Map<string, string>();
  for (let n = 0; n < ids.length; n += 500) {
    const part = ids.slice(n, n + 500);
    for (const r of database().all(`SELECT id, json_extract(data, '$.oracle_id') AS o FROM cards WHERE id IN (${part.map(() => '?').join(',')})`, part) as Array<{ id: string; o: string | null }>) {
      if (r.o) oracleOf.set(r.id, r.o);
    }
  }
  return groups.map((g) => ({
    key: `tune:${intent}:${g.key}`,
    task: TASK_OF[intent],
    method: g.source === 'claude' ? 'ai' : 'code',
    model: g.source === 'claude' ? g.model ?? null : null,
    promptVersion: g.source === 'claude' ? g.promptVersion ?? null : null,
    planVersion: null,
    deckHash: hash,
    items: g.items.map((i) => ({
      key: i.key,
      cardOut: i.keep ? null : side(i.cut, oracleOf),
      // A "keep this" names the card it keeps, as the card going in.
      cardIn: i.keep ? side(i.cut, oracleOf) : side(i.add, oracleOf),
      reasonShown: [i.why, i.warn].filter(Boolean).join(' · '),
    })),
  }));
}

/** Log what Tune showed for one intent. Never fails the page: logging is best-effort. */
export function logTuneView(list: List, profileId: string, intent: Intent, groups: SuggestionGroup[]): void {
  try {
    const main = cardsInList(list.id).filter((c) => c.board === 'main');
    logShown(profileId, list.id, `tune:${intent}:`, tuneBatches(intent, groups, deckHash(list.commander, main)));
  } catch (e) {
    console.error('[suggestion-log] tune view not logged', e);
  }
}
