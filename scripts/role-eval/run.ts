/**
 * Runs the app's roles and no-AI win guess over the four answer-key decks
 * and writes ours.json for score.py. No AI, and no local app: the decks come
 * from Archidekt's public API, the roles from Scryfall, combos from Commander
 * Spellbook.
 *
 *   npx jiti scripts/role-eval/run.ts && (cd scripts/role-eval && python3 score.py)
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { countRoles } from '../../lib/roles';
import { cardsNamed } from '../../lib/scryfall';
import { combosInDeck } from '../../lib/spellbook';
import { guessWinRoutes } from '../../lib/wincons';

const here = join(process.cwd(), 'scripts/role-eval');
const truth = JSON.parse(readFileSync(join(here, 'truth.json'), 'utf8')) as Record<string, { archidekt: string }>;

// Decks and Scryfall answers kept between runs (not committed), so a
// re-score only asks for what changed and stays under Scryfall's limits.
const CACHE = join(here, '.cache.json');
const cache: { decks: Record<string, unknown>; searches: Record<string, unknown> } = existsSync(CACHE)
  ? JSON.parse(readFileSync(CACHE, 'utf8')) : { decks: {}, searches: {} };
const search = async (q: string) => {
  if (!cache.searches[q]) {
    const { searchCards } = await import('../../lib/scryfall');
    const r = await searchCards(q);
    cache.searches[q] = { cards: r.cards.map((c) => ({ name: c.name })) };
  }
  return cache.searches[q] as Awaited<ReturnType<typeof import('../../lib/scryfall').searchCards>>;
};

interface ArchidektCard { categories: string[] | null; quantity: number; card: { oracleCard: { name: string } } }

async function main() {
  const out: Record<string, unknown> = {};
  for (const [name, deck] of Object.entries(truth)) {
    const id = deck.archidekt.split('/').pop();
    cache.decks[id!] ??= await (await fetch(`https://archidekt.com/api/decks/${id}/`, { headers: { 'User-Agent': 'MTGTracker role eval' } })).json();
    const body = cache.decks[id!] as { cards: ArchidektCard[] };
    const rows = body.cards.filter((c) => !(c.categories ?? []).some((cat) => /maybeboard|sideboard/i.test(cat)));
    const commanders = rows.filter((c) => (c.categories ?? []).includes('Commander')).map((c) => c.card.oracleCard.name);
    const names = rows.map((c) => c.card.oracleCard.name);
    const key = `cards:${id}`;
    cache.searches[key] ??= await cardsNamed(names);
    const found = cache.searches[key] as Awaited<ReturnType<typeof cardsNamed>>;
    const qty = new Map(rows.map((c) => [c.card.oracleCard.name.split(' // ')[0], c.quantity]));
    const cards = found.map((card) => ({ card, quantity: qty.get(card.name.split(' // ')[0]) ?? 1 }));
    const main = cards.filter((c) => !commanders.includes(c.card.name));

    const roles = await countRoles(main, { search, cached: () => ({ roles: new Map(), checked: new Set() }), save: () => {} });
    const combos = await combosInDeck({ commanders, main: main.map((c) => ({ name: c.card.name, quantity: c.quantity })) }).catch(() => null);
    out[name] = { roles, wincons: guessWinRoutes({ cards, roles, combos: combos?.included ?? null }) };
    console.log(`${name}: ${cards.length} cards, routes: ${(out[name] as { wincons: { routes: Array<{ label: string }> } }).wincons.routes.map((r) => r.label).join(', ') || 'none'}`);
  }
  writeFileSync(join(here, 'ours.json'), JSON.stringify(out, null, 1));
}

process.on('exit', () => writeFileSync(CACHE, JSON.stringify(cache)));

main();
