/**
 * Filtering a list with Scryfall-flavoured syntax.
 *
 * A useful subset, not the whole language: the operators people actually
 * reach for when looking through their own cards. It runs locally over the
 * stored payloads, so it is instant and works with Scryfall unreachable -
 * which is the whole reason a card's full data is kept when it is added.
 *
 * Unsupported operators are reported rather than ignored, because silently
 * returning everything for `layout:split` is worse than saying no.
 */

import type { ScryfallCard } from './scryfall';
import { priceOf, typeLineOf } from './scryfall';

type Comparator = '=' | '!=' | '>' | '<' | '>=' | '<=' | ':';

interface Term {
  key: string;
  op: Comparator;
  value: string;
  negated: boolean;
}

export interface ParsedQuery {
  terms: Term[];
  unsupported: string[];
}

const NUMERIC = new Set(['cmc', 'mv', 'usd', 'price', 'power', 'pow', 'toughness', 'tou']);
const KNOWN = new Set([
  'name', 'n', 'type', 't', 'oracle', 'o', 'text',
  'color', 'c', 'identity', 'id', 'ci',
  'rarity', 'r', 'set', 's', 'edition', 'e',
  'artist', 'a', 'keyword', 'kw', 'is',
  ...NUMERIC,
]);

/** Split on whitespace, but keep "quoted phrases" together. */
function tokenize(input: string): string[] {
  return Array.from(input.matchAll(/-?(?:[\w]+[:=<>!]+)?"[^"]*"|\S+/g), (m) => m[0]);
}

export function parseQuery(input: string): ParsedQuery {
  const terms: Term[] = [];
  const unsupported: string[] = [];

  for (const raw of tokenize(input)) {
    if (!raw) continue;
    let token = raw;
    const negated = token.startsWith('-');
    if (negated) token = token.slice(1);

    const match = token.match(/^([a-zA-Z]+)(>=|<=|!=|[:=<>])(.*)$/);
    if (!match) {
      // A bare word searches the name, which is what people expect.
      terms.push({ key: 'name', op: ':', value: strip(token), negated });
      continue;
    }

    const [, key, op, value] = match;
    const lower = key.toLowerCase();
    if (!KNOWN.has(lower)) {
      unsupported.push(`${key}${op}${value}`);
      continue;
    }
    terms.push({ key: lower, op: op as Comparator, value: strip(value), negated });
  }

  return { terms, unsupported };
}

const strip = (s: string) => s.replace(/^"|"$/g, '').trim();

function compare(actual: number | null, op: Comparator, expected: number): boolean {
  if (actual === null) return false;
  switch (op) {
    case '>': return actual > expected;
    case '<': return actual < expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '!=': return actual !== expected;
    default: return actual === expected;
  }
}

/** A card's colours, from either the card or its faces. */
function colorsOf(card: ScryfallCard, identity: boolean): Set<string> {
  if (identity) return new Set(card.color_identity ?? []);
  if (card.colors) return new Set(card.colors);
  return new Set((card.card_faces ?? []).flatMap(() => [] as string[]));
}

function oracleOf(card: ScryfallCard): string {
  return [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)]
    .filter(Boolean).join('\n').toLowerCase();
}

function numberFor(card: ScryfallCard, key: string): number | null {
  switch (key) {
    case 'cmc': case 'mv':
      return typeof card.cmc === 'number' ? card.cmc : null;
    case 'usd': case 'price':
      return priceOf(card);
    case 'power': case 'pow':
      return toNumber(card.power ?? card.card_faces?.[0]?.power);
    case 'toughness': case 'tou':
      return toNumber(card.toughness ?? card.card_faces?.[0]?.toughness);
    default:
      return null;
  }
}

const toNumber = (v?: string) => {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function matchesTerm(card: ScryfallCard, term: Term): boolean {
  const value = term.value.toLowerCase();
  if (!value) return true;

  if (NUMERIC.has(term.key)) {
    const expected = Number(value);
    if (!Number.isFinite(expected)) return false;
    return compare(numberFor(card, term.key), term.op === ':' ? '=' : term.op, expected);
  }

  switch (term.key) {
    case 'name': case 'n':
      return card.name.toLowerCase().includes(value);
    case 'type': case 't':
      return typeLineOf(card).toLowerCase().includes(value);
    case 'oracle': case 'o': case 'text':
      return oracleOf(card).includes(value);
    case 'rarity': case 'r':
      return (card.rarity ?? '').toLowerCase() === value
        || (card.rarity ?? '').toLowerCase().startsWith(value);
    case 'set': case 's': case 'edition': case 'e':
      return (card.set ?? '').toLowerCase() === value
        || (card.set_name ?? '').toLowerCase().includes(value);
    case 'artist': case 'a':
      return (card.artist ?? card.card_faces?.[0]?.artist ?? '').toLowerCase().includes(value);
    case 'keyword': case 'kw':
      return (card.keywords ?? []).some((k) => k.toLowerCase() === value);
    case 'color': case 'c': case 'identity': case 'id': case 'ci': {
      const identity = term.key !== 'color' && term.key !== 'c';
      const have = colorsOf(card, identity);
      if (value === 'c' || value === 'colorless') return have.size === 0;
      if (value === 'm' || value === 'multicolor') return have.size > 1;
      // "c:rg" means "contains red and green".
      const wanted = value.split('').filter((ch) => 'wubrg'.includes(ch)).map((ch) => ch.toUpperCase());
      if (!wanted.length) return false;
      return wanted.every((ch) => have.has(ch));
    }
    case 'is':
      if (value === 'creature') return typeLineOf(card).toLowerCase().includes('creature');
      if (value === 'land') return typeLineOf(card).toLowerCase().includes('land');
      if (value === 'dfc' || value === 'transform') return (card.card_faces?.length ?? 0) > 1;
      return false;
    default:
      return false;
  }
}

export function matchesQuery(card: ScryfallCard, parsed: ParsedQuery): boolean {
  // Every term must hold: Scryfall's default is AND, and so is what people
  // expect when they keep adding words to narrow something down.
  return parsed.terms.every((term) => {
    const hit = matchesTerm(card, term);
    return term.negated ? !hit : hit;
  });
}

export function filterCards<T extends { card: ScryfallCard }>(items: T[], query: string): {
  results: T[];
  unsupported: string[];
} {
  const trimmed = query.trim();
  if (!trimmed) return { results: items, unsupported: [] };
  const parsed = parseQuery(trimmed);
  return {
    results: items.filter((item) => matchesQuery(item.card, parsed)),
    unsupported: parsed.unsupported,
  };
}
