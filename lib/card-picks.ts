/**
 * The cards each profile picked for its own words: "innaiz" is Inniaz, the Gale Force; "last chance" is just words
 * (NOT_A_CARD). Once picked, the same words aren't asked about again anywhere in the app (lib/card-names.ts,
 * `remembered`); the page says how it read them, with a way to forget the pick. Server only.
 */

import { database } from './db';

let made = false;
function db() {
  const d = database();
  if (!made) {
    d.run(`CREATE TABLE IF NOT EXISTS card_picks (
      profileId TEXT NOT NULL,
      phrase TEXT NOT NULL,
      name TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (profileId, phrase)
    )`);
    made = true;
  }
  return d;
}

/** The profile's picks: phrase (phraseKey) -> card name, or NOT_A_CARD. */
export function cardPicks(profile: string): Map<string, string> {
  const rows = db().all('SELECT phrase, name FROM card_picks WHERE profileId = ?', [profile]) as Array<{ phrase: string; name: string }>;
  return new Map(rows.map((r) => [r.phrase, r.name]));
}

/** Remember the phrases of one pick together, so forgetting one forgets them all. */
export function rememberPick(profile: string, phrases: string[], name: string): void {
  const at = new Date().toISOString();
  for (const phrase of phrases.filter((p) => p.trim())) {
    db().run(
      'INSERT INTO card_picks (profileId, phrase, name, at) VALUES (?, ?, ?, ?) ON CONFLICT(profileId, phrase) DO UPDATE SET name = excluded.name, at = excluded.at',
      [profile, phrase, name, at],
    );
  }
}

/** Forget a pick, and any other phrase picked for the same card at the same time ("innaiz" with "innaiz the gale force"). */
export function forgetPick(profile: string, phrase: string): void {
  const row = db().get('SELECT name, at FROM card_picks WHERE profileId = ? AND phrase = ?', [profile, phrase]) as { name: string; at: string } | null;
  if (!row) return;
  db().run('DELETE FROM card_picks WHERE profileId = ? AND name = ? AND at = ?', [profile, row.name, row.at]);
}
