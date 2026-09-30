/**
 * The Comprehensive Rules: Wizards' full rulebook, published as plain text at
 * magic.wizards.com/en/rules and updated with most sets.
 *
 * Parsed into numbered rules ("603.10a") with their examples, section
 * headings ("603. Handling Triggered Abilities") and glossary entries, then
 * searched locally: a question's words and the rules concepts in it are
 * scored against every rule (BM25), so the answer is drawn from the rules
 * that bear on it - "look back in time" for creatures dying together, the
 * legend rule for copies of a legendary creature.
 *
 * Pure: parsing and searching. rules-source.ts fetches and caches the text.
 */

export interface Rule {
  /** "603.10a", "700.4", "603" for a section heading. */
  number: string;
  text: string;
}

export interface GlossaryEntry {
  term: string;
  text: string;
}

export interface RulesIndex {
  /** "September 25, 2026" */
  effective: string;
  rules: Map<string, Rule>;
  order: string[];
  glossary: Map<string, GlossaryEntry>;
  /** Search index: the tokens of each document, by rule number or "g:term". */
  docs: Map<string, string[]>;
  df: Map<string, number>;
  avgLength: number;
}

const RULE_LINE = /^(\d{3}(?:\.\d+[a-z]?)?)\.?\s+(.+)$/;

/** Parse the rules text. The table of contents at the top is skipped. */
export function parseRules(raw: string): RulesIndex {
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim());
  const effective = /effective as of ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(raw)?.[1] ?? '';
  // The body starts at the second "1. Game Concepts" (the first is the contents).
  const starts = lines.flatMap((l, i) => (/^1\.\s+Game Concepts$/.test(l) ? [i] : []));
  const bodyStart = starts[1] ?? starts[0] ?? 0;
  const glossaryStarts = lines.flatMap((l, i) => (l === 'Glossary' ? [i] : []));
  const glossaryStart = glossaryStarts.find((i) => i > bodyStart) ?? lines.length;
  const creditsStart = lines.findIndex((l, i) => i > glossaryStart && l === 'Credits');

  const rules = new Map<string, Rule>();
  const order: string[] = [];
  let last: Rule | null = null;
  for (const line of lines.slice(bodyStart, glossaryStart)) {
    if (!line) continue;
    const m = RULE_LINE.exec(line);
    if (m) {
      last = { number: m[1], text: m[2] };
      rules.set(last.number, last);
      order.push(last.number);
    } else if (last && /^Example:/.test(line)) {
      last.text += `\n${line}`;
    }
  }

  const glossary = new Map<string, GlossaryEntry>();
  const block = lines.slice(glossaryStart + 1, creditsStart > 0 ? creditsStart : undefined);
  for (let i = 0; i < block.length; i++) {
    if (!block[i] || (i > 0 && block[i - 1])) continue;
    const term = block[i];
    const text: string[] = [];
    for (let j = i + 1; j < block.length && block[j]; j++) text.push(block[j]);
    if (text.length) glossary.set(term.toLowerCase(), { term, text: text.join(' ') });
  }

  const docs = new Map<string, string[]>();
  for (const r of rules.values()) docs.set(r.number, tokens(r.text));
  for (const g of glossary.values()) docs.set(`g:${g.term.toLowerCase()}`, tokens(`${g.term} ${g.term} ${g.text}`));
  const df = new Map<string, number>();
  let total = 0;
  for (const t of docs.values()) {
    total += t.length;
    for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  }
  return { effective, rules, order, glossary, docs, df, avgLength: total / Math.max(1, docs.size) };
}

const STOP = new Set(('a an the of to in on for and or is are be it its if this that with as at by from any each other '
  + 'can may do does not no when whenever what how would will there their they them you your i my me we so than then '
  + 'into onto out up about also but get gets got has have had was were been being which who whose while all some').split(' '));

/** Words, lower-cased, lightly stemmed so "dies" finds "die" and "triggers" finds "trigger". */
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [])
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function stem(w: string): string {
  if (w.length <= 4) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ing') && w.length > 6) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 5) return w.slice(0, -2);
  if (w.endsWith('es') && /(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export interface Hit {
  id: string;
  score: number;
}

/**
 * The rules and glossary entries that best match these weighted terms.
 * `terms` maps a word or phrase to how much it matters: a phrase's words are
 * scored together and must all appear.
 */
export function searchRules(index: RulesIndex, terms: Map<string, number>, limit = 12, weigh: (id: string) => number = () => 1): Hit[] {
  const n = index.docs.size;
  const k1 = 1.2;
  const b = 0.75;
  const scores = new Map<string, number>();
  for (const [term, weight] of terms) {
    const words = tokens(term);
    if (!words.length) continue;
    for (const [id, doc] of index.docs) {
      if (!words.every((w) => doc.includes(w))) continue;
      let s = 0;
      for (const w of words) {
        const tf = doc.filter((x) => x === w).length;
        const idf = Math.log(1 + (n - (index.df.get(w) ?? 0) + 0.5) / ((index.df.get(w) ?? 0) + 0.5));
        s += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / index.avgLength)));
      }
      // Phrases that appear as written count for more.
      if (words.length > 1 && doc.join(' ').includes(words.join(' '))) s *= 1.5;
      scores.set(id, (scores.get(id) ?? 0) + s * weight);
    }
  }
  return [...scores].map(([id, score]) => ({ id, score: score * weigh(id) })).sort((x, y) => y.score - x.score).slice(0, limit);
}

/** The rule a subrule belongs to: "603.10" for "603.10a", "603" for "603.10". */
export function parentOf(number: string): string | null {
  if (/[a-z]$/.test(number)) return number.replace(/[a-z]$/, '');
  if (number.includes('.')) return number.split('.')[0];
  return null;
}

/** A rule as evidence: its parent's first sentence for context, then the rule. */
export function ruleWithContext(index: RulesIndex, number: string, max = 900): string | null {
  const rule = index.rules.get(number);
  if (!rule) return null;
  const parent = parentOf(number);
  const lead = parent && /[a-z]$/.test(number) ? index.rules.get(parent)?.text.split(/(?<=\.)\s/)[0] : undefined;
  const text = lead ? `(${parent}: ${lead}) ${rule.text}` : rule.text;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Rule numbers a text points to: "See rule 704.5j" and "rules 603.6c and 603.10". */
export function referencedRules(text: string): string[] {
  return [...new Set([...text.matchAll(/\b(\d{3}\.\d+[a-z]?)\b/g)].map((m) => m[1]))];
}

/** Every word the rules use, unstemmed: the game's ordinary language, for telling words from card names. */
export function vocabulary(index: RulesIndex): Set<string> {
  const out = new Set<string>();
  const add = (t: string) => { for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) out.add(w); };
  for (const r of index.rules.values()) add(r.text);
  for (const g of index.glossary.values()) add(`${g.term} ${g.text}`);
  return out;
}

/** Keyword abilities and actions by name ("myriad" -> "702.116"), from their section headings. */
export function keywordRules(index: RulesIndex): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of index.rules.values()) {
    if (/^70[12]\.\d+$/.test(r.number) && r.text.length < 40 && !/^(General|Keyword)/i.test(r.text)) out.set(r.text.toLowerCase(), r.number);
  }
  return out;
}

/**
 * How much a rule's place in the book should count: a keyword's rules only
 * when that keyword is in play, and the corners of the game - melded and
 * merged permanents, casual variants - much less than the core.
 */
export function placeWeight(number: string, keywordsInPlay: Set<string>): number {
  const kw = /^(70[12]\.\d+)/.exec(number)?.[1];
  if (kw) return keywordsInPlay.has(kw) ? 1.3 : 0.25;
  if (/^(712|730|73[1-9]|8\d\d|90[0-2]|90[4-9])/.test(number)) return 0.35;
  return 1;
}
