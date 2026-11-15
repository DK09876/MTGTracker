/**
 * Runs the CURRENT app code on one kit set and writes its outputs where the
 * scorers read them. Started by run.ts as its own process, one per kit set,
 * with MTG_DB_PATH / MTG_CARDS_DB_PATH pointing at throwaway copies of that
 * kit's databases (the app's database modules hold one file per process).
 *
 *   regen.ts <kit set> <kit dir> <out dir>
 *
 * Writes <out dir>/<run>/<id>.json in the frozen runs' shapes:
 *   real, primer, graded  A-sb (lib/cut-list deckCutList, as the Tune tab ranks cuts) and A3n (the pre-ranker)
 *   orphan                A3n on the with / without facts
 *   triage                <id>.json {flags}: the warnings the Check tab shows now (health + hard checks)
 *   swaps                 code/<id>.json {swaps}: what Tune's Swaps tab offers now (work.db, the owner's decks)
 * The kits' decks are already imported in the copied eval database (profile "eval", list "<set> <id>").
 * Nothing is fetched for the cut lists unless a card's roles were never looked up (then the app's
 * Scryfall client is used, as it would be in the app). No paid APIs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const [SET, DIR, OUT] = process.argv.slice(2);
if (!SET || !DIR || !OUT) throw new Error('usage: regen.ts <set> <kit dir> <out dir>');

const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const write = (p: string, o: unknown) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 1) + '\n'); };

type FCard = { name: string; type: string };
/** The owner's decks the swap kits were built from (swap-kits.ts), by list id in the owner's database. */
const SWAP_DECKS: Record<string, string> = {
  azula: 'cd55c0b7-3d24-4066-99bc-9e4529156892', zuko: '14cece25-eeb6-4f05-b3fd-66e7e57fdfb2', obyra: 'd73aaa02-846b-44a0-b159-9e13e35c5f6f',
  hearthhull: 'bf6295b1-03ef-4737-8fae-c02f35171d06', zimone: '79667789-e2a6-45da-9db0-e5778d320f12', denzilore: 'b88450af-f0e4-4088-98f1-7e72f338a4d4',
  ulalek: '98e4ee63-3ae1-4a95-85ea-94f751cfa84a', kratos: '9dbb401d-0662-4ba5-8801-f8a523f89971',
};
type KitFacts = { size: number; cards: FCard[] };

async function main() {
  const db = await import('../../lib/db');
  const pre = await import('./prerank-lib');
  const lists = db.listLists('eval');
  // The newest list of that name (a kit rebuilt once leaves an older copy behind).
  const listOf = (name: string) => [...lists].filter((l) => l.name === name).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  const ranksPath = join(DIR, 'ranks.json');
  const ranks: Record<string, number | null> = existsSync(ranksPath) ? json(ranksPath) : {};
  const a3n = (f: unknown) => pre.preRank(f as Parameters<typeof pre.preRank>[0], new Set(), ranks, pre.A3N).map((x) => ({ name: x.name, why: x.signals.join('; ') || 'no signal' }));

  if (SET === 'real' || SET === 'primer' || SET === 'graded') {
    const { deckCutList } = await import('../../lib/cut-list');
    const ids = (await import('fs')).readdirSync(join(DIR, 'answers')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    let n = 0;
    for (const id of ids) {
      const factsPath = join(DIR, 'kits', id, 'facts.json');
      if (!existsSync(factsPath)) continue;
      const facts = json<KitFacts>(factsPath);
      const over = facts.size - 100;
      const lands = new Set(facts.cards.filter((c) => /\bLand\b/.test(c.type.split('//')[0])).map((c) => c.name));
      const spells = facts.cards.filter((c) => !lands.has(c.name)).map((c) => c.name);
      const out = (run: string, ranked: Array<{ name: string; why: string }>) => write(join(OUT, run, `${id}.json`), { cuts: ranked.slice(0, over), ranked });
      const list = listOf(`${SET} ${id}`);
      if (list) {
        const result = await deckCutList(list);
        const seen = new Set(result.candidates.map((c) => c.name));
        out('A-sb', [...result.candidates.map((c) => ({ name: c.name, why: c.reasons.join('; ') })), ...spells.filter((s) => !seen.has(s)).map((s) => ({ name: s, why: 'not a cut candidate (appended in name order)' }))]);
      } else console.warn(`  ${id}: no list "${SET} ${id}" in the eval database; A-sb skipped`);
      out('A3n', a3n(facts));
      n++;
    }
    console.log(`  ${SET}: ${n} kits regenerated`);
    return;
  }

  if (SET === 'orphan') {
    const real = join(DIR, '..', 'real');
    const realRanks: Record<string, number | null> = existsSync(join(real, 'ranks.json')) ? json(join(real, 'ranks.json')) : {};
    const labels = json<Record<string, { kits: { with: string; without: string } }>>(join(DIR, 'labels.json'));
    for (const [deck, l] of Object.entries(labels)) {
      for (const [kit, path] of [[l.kits.with, join(real, 'kits', deck, 'facts.json')], [l.kits.without, join(DIR, 'kits', `${deck}-without`, 'facts.json')]] as const) {
        write(join(OUT, 'A3n', `${kit}.json`), { ranked: pre.preRank(json(path), new Set(), realRanks, pre.A3N).map((x) => x.name) });
      }
    }
    console.log(`  orphan: ${Object.keys(labels).length} decks regenerated`);
    return;
  }

  if (SET === 'triage') {
    const { analyse } = await import('../../lib/health');
    const { hardWarnings } = await import('../../lib/hard-checks');
    const { planFor } = await import('../../lib/deck-plan');
    const { deckRolesKnown } = await import('../../lib/deck-roles');
    const labels = json<Record<string, { id: string }>>(join(DIR, 'labels.json'));
    for (const id of Object.keys(labels)) {
      const list = listOf(`triage ${id}`);
      if (!list) { console.warn(`  ${id}: no list "triage ${id}"`); continue; }
      // The Check tab's warnings, as app/api/lists/[id]/health/route.ts builds them.
      const main = db.cardsInList(list.id).filter((c) => c.board === 'main');
      const plan = planFor(list.id, '', list.commander, main);
      const health = analyse({ commander: list.commander, cards: main });
      const draw = await deckRolesKnown(list.id, main).then((r) => r.find((x) => x.id === 'draw')?.count ?? null).catch(() => null);
      const warnings = [...health.warnings, ...hardWarnings({ lands: { have: plan.landNumber.have, range: plan.lands }, draw, nearlyBuilt: health.size >= 90 })];
      write(join(OUT, `${id}.json`), { flags: warnings.map((w) => w.title), lands: { have: plan.landNumber.have, range: plan.lands }, draw });
    }
    console.log(`  triage: ${Object.keys(labels).length} kits regenerated`);
    return;
  }

  if (SET === 'swaps') {
    // Tune's Swaps tab on the owner's eight decks (profile dk in work.db, maybe and side boards removed when the kits were built).
    const { tuneState } = await import('../../lib/tune');
    let n = 0;
    for (const [id, listId] of Object.entries(SWAP_DECKS)) {
      const list = db.getList(listId, 'dk');
      if (!list) { write(join(OUT, 'code', `${id}.json`), { swaps: [], notes: 'deck not found in work.db' }); continue; }
      // Swaps left Tune in handoff 10; its lookup lives on in Upgrades' free list (its Maybeboard pairs).
      (await import('../../lib/tune-store')).updateTune(listId, (x) => { x.upgradesShowFree = true; });
      const s = await tuneState(list, 'dk', { intent: 'upgrades' });
      const swaps = s.groups.filter((g) => g.source === 'rules' && g.key.startsWith('free:maybe')).flatMap((g) => g.items).filter((i) => i.add && i.cut).map((i) => ({ out: i.cut!.name, in: i.add!.name, why: i.why }));
      write(join(OUT, 'code', `${id}.json`), { swaps, notes: `Tune → Swaps, rules groups: ${swaps.length} same-job pairs` });
      n++;
    }
    console.log(`  swaps: ${n} decks regenerated`);
    return;
  }
  throw new Error(`unknown kit set: ${SET}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
