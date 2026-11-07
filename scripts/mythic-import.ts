/**
 * Bring a Mythic Tools collection and its decks into one profile, and print
 * a reconciliation report: every copy in the file is in a box or a deck.
 *
 *   npx jiti scripts/mythic-import.ts --profile dk --mode replace \
 *     --collection collection.csv --decks decks.json [--dry-run] [--again]
 *
 * --collection  Mythic Tools' collection CSV.
 * --decks       JSON: a list (or an object of) {name, list, linked?, commanders?}
 *               - each deck's list export and its collection-linked export.
 *               A deck whose name the profile has already is updated in place.
 * --mode        replace: the collection becomes exactly the file (what decks
 *               held is unlinked, then linked again from the decks).
 *               add: the file goes on top of what is there.
 * --dry-run     run on a copy of the database and throw it away: the report
 *               without writing anything.
 * --again       run even though this exact file was imported before.
 *
 * The app must be stopped: it holds the database open and would not see the
 * import (and could write over it). The database is copied aside first.
 * MTG_DB_PATH picks the database (default data/mtg.db).
 */

import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (message: string): never => {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
};

const profile = value('profile') ?? fail('--profile is required (the profile id, e.g. dk)');
const mode = value('mode');
if (mode !== 'replace' && mode !== 'add') fail('--mode replace or --mode add is required: replace makes the collection exactly the file');
const csvPath = value('collection') ?? fail('--collection <csv> is required');
const decksPath = value('decks');
const dryRun = flag('dry-run');
const again = flag('again');

const dbPath = resolve(process.env.MTG_DB_PATH || join(process.cwd(), 'data/mtg.db'));
if (!existsSync(dbPath)) fail(`No database at ${dbPath}`);
const csv = readFileSync(csvPath, 'utf8');
type DeckIn = { name: string; list: string; linked?: string; commanders?: number; cmd?: number | string };
const decksRaw = decksPath ? JSON.parse(readFileSync(decksPath, 'utf8')) as DeckIn[] | Record<string, DeckIn> : [];
const decks = (Array.isArray(decksRaw) ? decksRaw : Object.values(decksRaw))
  .map((d) => ({ ...d, commanders: Number(d.commanders ?? d.cmd ?? 1) || 1 }));

/** Processes holding the database open: the app, most likely. */
function holders(path: string): string[] {
  try {
    const out = execFileSync('lsof', ['-t', path], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map((s) => s.trim()).filter((pid) => pid && pid !== String(process.pid));
  } catch (error) {
    // lsof exits 1 when nothing has the file open.
    if ((error as { status?: number }).status === 1) return [];
    console.warn('! Could not check whether the app is running (lsof failed). Make sure it is stopped.');
    return [];
  }
}

async function main() {
  let target = dbPath;
  if (dryRun) {
    target = join(mkdtempSync(join(tmpdir(), 'mythic-dry-')), 'mtg.db');
    copyFileSync(dbPath, target);
    console.log(`Dry run: working on a copy (${target}); ${dbPath} is not touched.`);
  } else {
    const pids = holders(dbPath);
    if (pids.length) fail(`The database is open in process ${pids.join(', ')} - stop the app first (sudo systemctl stop mtg on the Pi).`);
    const aside = `${dbPath}.before-mythic-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(dbPath, aside);
    console.log(`Copied the database aside: ${aside}`);
  }
  process.env.MTG_DB_PATH = target;

  // Loaded only now, so they open the database chosen above.
  const { listProfiles } = await import('../lib/db');
  const { collectionState, ownership, locations } = await import('../lib/collection');
  const { fingerprint, previewRows, runCollectionImport } = await import('../lib/collection-import-run');
  const { importMythicDeck, importMythicDecks } = await import('../lib/mythic');
  const { collection, ScryfallError } = await import('../lib/scryfall');
  // A one-off run, not the app: when Scryfall asks to slow down, wait it out (twice at most) rather than stop halfway.
  const lookup: typeof collection = async (identifiers) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await collection(identifiers);
      } catch (error) {
        if (!(error instanceof ScryfallError) || error.status !== 429 || attempt >= 2) throw error;
        console.log('  Scryfall asked to slow down - waiting a minute…');
        await new Promise((done) => setTimeout(done, 61_000));
      }
    }
  };
  const { database } = await import('../lib/db');

  if (!listProfiles().some((p) => p.id === profile)) fail(`No profile "${profile}". Profiles: ${listProfiles().map((p) => p.id).join(', ')}`);

  const preview = previewRows(profile, csv);
  if (preview.before && !again) {
    fail(`This file was imported into ${profile} on ${preview.before.at} (${preview.before.copies} copies, ${preview.before.mode}). Run with --again to do it once more.`);
  }
  console.log(`\n== Collection file (${preview.format}) ==`);
  console.log(`${preview.rows} rows, ${preview.copies} copies - ${preview.proxies} proxies, ${preview.foil} foil, ${preview.etched} etched, ${preview.otherLanguage} not in English`);
  for (const l of preview.locations) console.log(`  ${l.kind.padEnd(6)} ${(l.name || 'Unsorted').padEnd(20)} ${l.copies}`);
  console.log(`Before: ${preview.current.copies} copies in boxes, ${preview.current.inDecks} held by decks. Mode: ${mode}.`);

  console.log('\nFinding every card on Scryfall…');
  const result = await runCollectionImport(profile, csv, { mode: mode as 'add' | 'replace', again: true, lookup });
  console.log(`Imported ${result.copies} copies (${result.unique} different cards).`);
  if (result.missing.length) console.log(`  Not found (${result.missing.length}):\n    ${result.missing.join('\n    ')}`);
  if (result.byName.length) console.log(`  Printing did not match the name, found by name (${result.byName.length}):\n    ${result.byName.join('\n    ')}`);
  if (result.unreadable.length) console.log(`  Unreadable (${result.unreadable.length}):\n    ${result.unreadable.join('\n    ')}`);

  const problems: string[] = [];
  const imported: Array<{ name: string; id: string }> = [];
  if (decks.length) console.log(`\n== Decks (${decks.length}) ==`);
  // In any order: a proxy line leaves a real copy to a later deck that claims it for real.
  await importMythicDecks(profile, decks, async (deck, reserved) => {
    let r: Awaited<ReturnType<typeof importMythicDeck>>;
    try {
      r = await importMythicDeck(profile, deck, reserved);
    } catch (error) {
      if (!(error instanceof ScryfallError) || error.status !== 429) throw error;
      console.log('  Scryfall asked to slow down - waiting a minute…');
      await new Promise((done) => setTimeout(done, 61_000));
      r = await importMythicDeck(profile, deck, reserved);
    }
    if (!r.imported.applied) {
      problems.push(`${deck.name}: not imported - ${[...r.imported.missing, ...r.imported.unreadable].join('; ')}`);
      console.log(`✗ ${deck.name}: lines not found, deck left as it was:\n    ${[...r.imported.missing, ...r.imported.unreadable].join('\n    ')}`);
      return r;
    }
    const boards = database().all(
      `SELECT board, SUM(quantity) AS n FROM list_cards WHERE listId = ? GROUP BY board`, [r.list.id],
    ) as Array<{ board: string; n: number }>;
    const on = (b: string) => boards.find((x) => x.board === b)?.n ?? 0;
    const link = r.link;
    console.log(`${r.created ? '+ new    ' : '~ updated'} ${deck.name}: ${on('main') + (r.list.commander ? 1 : 0)} in the deck (commander ${r.list.commander?.name ?? 'none'}), sideboard ${on('side')}, maybeboard ${on('maybe')}`);
    if (link) {
      console.log(`    linked ${link.linked} copies (${link.proxiesLinked} proxies); proxies marked ${link.proxiesMarked}; Mythic said available ${link.available}, to buy ${link.buy}`);
      if (link.otherBox.length) console.log(`    found in another box: ${link.otherBox.join('; ')}`);
      if (link.yielded.length) console.log(`    left for a later deck (marked as proxies here): ${link.yielded.join('; ')}`);
      if (link.notLinked.length) {
        console.log(`    no copy to link: ${link.notLinked.join('; ')}`);
        problems.push(`${deck.name}: ${link.notLinked.length} line(s) with no copy to link`);
      }
      if (link.returned) console.log(`    ${link.returned} copies went back (the deck did not want them)`);
      if (link.unreadable.length) console.log(`    unreadable linked lines: ${link.unreadable.join('; ')}`);
    } else if (r.proxiesMarked) console.log(`    proxies marked ${r.proxiesMarked}`);
    imported.push({ name: deck.name, id: r.list.id });
    return r;
  });
  // After every deck has taken its copies: one deck's free copy may be another's.
  if (imported.length) console.log('\n== Each deck and the collection, after all of them ==');
  for (const d of imported) {
    const o = ownership({ id: d.id }).summary;
    console.log(`  ${d.name}: ${o.inDeck} held, ${o.proxies} proxies, ${o.inBoxes} in a box, ${o.inOtherDecks} in other decks, ${o.missing} to buy${o.basics ? `, ${o.basics} basic lands not tracked` : ''}`);
  }

  const state = collectionState(profile);
  console.log('\n== Reconciliation ==');
  console.log(`In boxes ${state.totals.inBoxes} + held by decks ${state.totals.inDecks} = ${state.totals.copies} copies (file: ${preview.copies}${mode === 'add' ? ', plus what was there' : ''})`);
  for (const l of locations(profile)) {
    const fileCount = preview.locations.find((x) => x.name === l.name)?.copies;
    if (!l.count && !l.inDecks && fileCount === undefined) continue;
    console.log(`  ${l.kind.padEnd(6)} ${(l.name || 'Unsorted').padEnd(20)} ${String(l.count).padStart(5)} in it + ${String(l.inDecks).padStart(4)} in decks = ${l.count + l.inDecks}${fileCount !== undefined ? `   (file ${fileCount})` : ''}`);
  }
  const unmatched = preview.copies - result.copies;
  if (mode === 'replace' && state.totals.copies !== preview.copies) {
    problems.push(`totals differ: ${state.totals.copies} here, ${preview.copies} in the file (${unmatched} not found)`);
  }
  console.log(`Fingerprint ${fingerprint(csv)}${dryRun ? ' (dry run: not kept)' : ''}`);
  if (problems.length) console.log(`\n! To look at:\n  ${problems.join('\n  ')}`);
  else console.log('\n✓ Everything accounted for.');
  if (dryRun) console.log('\nDry run: nothing was written to the real database.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
