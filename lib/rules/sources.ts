/**
 * Where rules answers come from, fetched and kept:
 *
 *   - The Comprehensive Rules, from magic.wizards.com/en/rules - the current
 *     text file is found on that page, fetched at most weekly and kept on
 *     disk, so the Pi can answer if Wizards is unreachable.
 *   - Every card name, from Scryfall's catalog, daily - for finding cards in
 *     a question.
 *   - A card's official rulings, from Scryfall, for a week.
 *   - An MTG Wiki page (mtg.wiki - the active wiki; the Fandom copy is no
 *     longer kept up), for a week. Read as a page, as a browser would: the
 *     wiki asks automated tools to keep off its API (robots.txt), and its
 *     text is CC BY-NC-SA, so it is quoted briefly and linked.
 *
 * Server only.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { cardNameCatalog, rulingsFor, type Ruling, type ScryfallCard } from '../scryfall';
import { parseRules, vocabulary, type RulesIndex } from './cr';
import { nameIndex, type NameIndex } from './names';

const DIR = join(dirname(process.env.MTG_DB_PATH || `${process.cwd()}/data/mtg.db`), 'rules');
const DAY = 24 * 60 * 60 * 1000;
const UA = 'MTGTracker/0.1 (https://github.com/DK09876/MTGTracker)';

// Kept on globalThis: every route's bundle has its own copy of this module.
const store = globalThis as unknown as {
  __rules?: { index: RulesIndex; vocab: Set<string>; at: number };
  __names?: { index: NameIndex; at: number };
  __rulings?: Map<string, { at: number; rulings: Ruling[] }>;
  __wiki?: Map<string, { at: number; page: WikiPage | null }>;
};

function fresh(path: string, maxAge: number): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs < maxAge;
  } catch {
    return false;
  }
}

function keep(path: string, text: string): void {
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(path, text);
  } catch { /* kept in memory only */ }
}

function readKept(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** The Comprehensive Rules, parsed, and the words they use. */
export async function rulesIndex(): Promise<{ index: RulesIndex; vocab: Set<string> }> {
  const cached = store.__rules;
  if (cached && Date.now() - cached.at < 7 * DAY) return cached;
  const path = join(DIR, 'comprehensive-rules.txt');
  let text = fresh(path, 7 * DAY) ? readKept(path) : null;
  if (!text) {
    try {
      const page = await (await fetch('https://magic.wizards.com/en/rules', { headers: { 'User-Agent': UA } })).text();
      // The file name has a space in it: "MagicCompRules 20260925.txt".
      const url = /https:\/\/media\.wizards\.com\/[^"'<>]+?\.txt/.exec(page)?.[0];
      if (!url) throw new Error('No rules text linked from magic.wizards.com/en/rules');
      const res = await fetch(url.replace(/ /g, '%20'), { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`Rules text: ${res.status}`);
      text = await res.text();
      keep(path, text);
    } catch (error) {
      // An old copy beats none.
      text = readKept(path);
      if (!text) throw error;
    }
  }
  const index = parseRules(text);
  const entry = { index, vocab: vocabulary(index), at: Date.now() };
  store.__rules = entry;
  return entry;
}

/** Every card name, indexed for finding them in a question. */
export async function cardNames(): Promise<NameIndex> {
  const cached = store.__names;
  if (cached && Date.now() - cached.at < DAY) return cached.index;
  const path = join(DIR, 'card-names.json');
  let names: string[] | null = null;
  if (fresh(path, DAY)) names = JSON.parse(readKept(path) ?? 'null');
  if (!names) {
    try {
      names = await cardNameCatalog();
      keep(path, JSON.stringify(names));
    } catch (error) {
      names = JSON.parse(readKept(path) ?? 'null');
      if (!names) throw error;
    }
  }
  const index = nameIndex(names);
  store.__names = { index, at: Date.now() };
  return index;
}

/** A card's rulings, official ones first, newest first. */
export async function cardRulings(card: ScryfallCard): Promise<Ruling[]> {
  const cache = (store.__rulings ??= new Map());
  const key = card.oracle_id ?? card.id;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 7 * DAY) return hit.rulings;
  const rulings = (await rulingsFor(card.id))
    .sort((a, b) => Number(b.source === 'wotc') - Number(a.source === 'wotc') || b.published_at.localeCompare(a.published_at));
  cache.set(key, { at: Date.now(), rulings });
  return rulings;
}

export interface WikiPage {
  title: string;
  url: string;
  /** The opening, and the page's Rules and Rulings sections, as text. */
  text: string;
}

/** A page's readable parts: its opening paragraphs, and Rules and Rulings sections. */
export function wikiText(html: string, max = 1800): string {
  const start = html.indexOf('mw-parser-output');
  if (start < 0) return '';
  let body = html.slice(html.indexOf('>', start) + 1);
  body = body.replace(/<(script|style|table|sup)[^>]*>[\s\S]*?<\/\1>/g, ' ');
  // Keep headings as markers to pick sections by.
  body = body.replace(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g, (_, h: string) => `\n## ${h.replace(/<[^>]+>/g, '').replace(/\[edit\]/g, '').trim()}\n`);
  body = body.replace(/<\/(p|li|dd)>/g, '\n').replace(/<[^>]+>/g, ' ');
  const text = body.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
  const sections = text.split(/\n## /);
  const intro = sections[0].split('\n').map((l) => l.trim()).filter((l) => l.length > 40).slice(0, 3).join('\n');
  const wanted = sections.slice(1).filter((s) => /^(Rules|Rulings|Description)\b/i.test(s))
    .map((s) => s.replace(/^([^\n]+)\n/, '$1: ').trim());
  const out = [intro, ...wanted].join('\n').trim();
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** An MTG Wiki page by title (a keyword ability, a mechanic), or null. */
export async function wikiPage(title: string): Promise<WikiPage | null> {
  const cache = (store.__wiki ??= new Map());
  const hit = cache.get(title);
  if (hit && Date.now() - hit.at < 7 * DAY) return hit.page;
  const url = `https://mtg.wiki/page/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  let page: WikiPage | null = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const text = wikiText(await res.text());
      if (text) page = { title, url, text };
    }
  } catch { /* the wiki is extra; the answer goes on without it */ }
  cache.set(title, { at: Date.now(), page });
  return page;
}
