/**
 * The combos the owner holds every piece of, for one commander (handoff 8,
 * Part C): the combo site's find-my-combos lookup, sent the commander and the
 * owner's cards on offer plus the deck's own. It takes at most 600 cards a
 * request, so the cards go in 290-card chunks, every pair of chunks one
 * request (chunkPairs), and a combo one card short in a request counts when
 * the owner holds that card too. The requests are spaced out, and the answer
 * is kept per profile and commander until the cards sent change, so it does
 * not run on every Finish. Server only.
 */

import { createHash } from 'node:crypto';

import { database } from './db';
import { chunkPairs, type OwnedCombo } from './finish-shared';
import { combosInDeck, type DeckList } from './spellbook';

const SPACING_MS = 400;

let ready = false;
function db() {
  const d = database();
  if (!ready) {
    d.run('CREATE TABLE IF NOT EXISTS finish_combos (profileId TEXT NOT NULL, commander TEXT NOT NULL, hash TEXT NOT NULL, at TEXT NOT NULL, combos TEXT NOT NULL, PRIMARY KEY (profileId, commander))');
    ready = true;
  }
  return d;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Found = { id: string; cards: string[]; produces: string[] };

/**
 * Every combo complete among the commander and these names. `ask` is the
 * lookup (combosInDeck; tests give their own). Throws when a request fails:
 * the caller runs Finish without the list and says so.
 */
export async function ownedCombos(profileId: string, commander: string, names: string[], ask: (deck: DeckList) => Promise<{ included: Found[]; almost?: Array<Found & { missing: string[] }> }> = combosInDeck, spacing = SPACING_MS): Promise<OwnedCombo[]> {
  const sorted = [...new Set(names.map((n) => n.split(' // ')[0].trim()))].filter(Boolean).sort();
  const hash = createHash('sha1').update(sorted.join('\n')).digest('hex');
  const kept = db().get('SELECT hash, combos FROM finish_combos WHERE profileId = ? AND commander = ?', [profileId, commander]) as { hash: string; combos: string } | null;
  if (kept?.hash === hash) return JSON.parse(kept.combos) as OwnedCombo[];
  const found = new Map<string, OwnedCombo>();
  const all = new Set([commander, ...sorted].map((n) => n.toLowerCase()));
  const requests = chunkPairs(sorted);
  for (let i = 0; i < requests.length; i++) {
    if (i > 0 && spacing) await wait(spacing);
    const { included, almost = [] } = await ask({ commanders: [commander], main: requests[i].map((name) => ({ name, quantity: 1 })) });
    // A combo one card short in this request whose missing card the owner also holds (in another chunk) is complete:
    // that finds a three-card combo whose pieces sit in three chunks.
    const whole = [...included, ...almost.filter((c) => c.missing.every((m) => all.has(m.split(' // ')[0].trim().toLowerCase())))];
    for (const c of whole) if (!found.has(c.id)) found.set(c.id, { id: c.id, cards: c.cards, produces: c.produces.slice(0, 4) });
  }
  const combos = [...found.values()];
  db().run('INSERT OR REPLACE INTO finish_combos (profileId, commander, hash, at, combos) VALUES (?, ?, ?, ?, ?)', [profileId, commander, hash, new Date().toISOString(), JSON.stringify(combos)]);
  return combos;
}
