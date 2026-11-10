/**
 * Card names as you type, for adding cards fast: exact name first, then
 * names starting with what was typed, then names with a word starting with
 * it, then names containing it; shorter names before longer ones. Pure, so
 * the order can be tested; the card copy supplies the candidates.
 */

export interface Named { name: string }

const key = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").trim();

/** How well a name matches what was typed: 0 is best, null is no match. */
export function nameRank(name: string, typed: string): number | null {
  const t = key(typed);
  if (!t) return null;
  const full = key(name);
  const front = key(name.split(' // ')[0]);
  if (front === t || full === t) return 0;
  if (front.startsWith(t) || full.startsWith(t)) return 1;
  if (full.split(/[\s,/-]+/).some((w) => w.startsWith(t))) return 2;
  if (full.includes(t)) return 3;
  // Every typed word starts a word of the name, in any order: "bolt light".
  const words = t.split(/\s+/).filter(Boolean);
  const nameWords = full.split(/[\s,/-]+/);
  if (words.length > 1 && words.every((w) => nameWords.some((n) => n.startsWith(w)))) return 4;
  return null;
}

export function rankNames<T extends Named>(cards: T[], typed: string, max = 8): T[] {
  return cards
    .map((c) => ({ c, r: nameRank(c.name, typed) }))
    .filter((x): x is { c: T; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || a.c.name.length - b.c.name.length || a.c.name.localeCompare(b.c.name))
    .slice(0, max)
    .map((x) => x.c);
}
