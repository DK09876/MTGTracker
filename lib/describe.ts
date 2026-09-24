/**
 * Scryfall queries read back in plain English, for "How this search ran".
 *
 * Deliberately not the model: this has to say what actually ran, and a
 * paraphrase from the thing that wrote the query would only repeat its
 * intentions. Anything not recognised is shown as written rather than
 * guessed at.
 */

const COLOURS: Record<string, string> = { w: 'white', u: 'blue', b: 'black', r: 'red', g: 'green', c: 'colourless' };

// Scryfall's names for common colour pairs and triples.
const GUILDS: Record<string, string> = {
  azorius: 'wu', dimir: 'ub', rakdos: 'br', gruul: 'rg', selesnya: 'gw', orzhov: 'wb',
  izzet: 'ur', golgari: 'bg', boros: 'rw', simic: 'gu', esper: 'wub', grixis: 'ubr',
  jund: 'brg', naya: 'rgw', bant: 'gwu', abzan: 'wbg', jeskai: 'urw', sultai: 'bgu',
  mardu: 'rwb', temur: 'gur',
};

const FORMATS: Record<string, string> = { edh: 'Commander', commander: 'Commander' };

const ORDERS: Record<string, string> = {
  edhrec: 'most played in Commander first',
  usd: 'by price', cmc: 'by mana value', name: 'by name', released: 'newest first',
  rarity: 'by rarity', power: 'by power', toughness: 'by toughness', color: 'by colour',
};

const NOUN_KEYS: Record<string, string> = {
  t: 'type', type: 'type',
  o: 'text', oracle: 'text', fo: 'text', text: 'text',
  c: 'colour', color: 'colour',
  id: 'identity', identity: 'identity', ci: 'identity',
  mv: 'mv', cmc: 'mv', manavalue: 'mv',
  pow: 'power', power: 'power', tou: 'toughness', toughness: 'toughness',
  usd: 'usd', eur: 'eur',
  otag: 'tag', oracletag: 'tag', function: 'tag',
  kw: 'keyword', keyword: 'keyword', k: 'keyword',
  r: 'rarity', rarity: 'rarity',
  s: 'set', set: 'set', e: 'set', edition: 'set',
  f: 'format', format: 'format', legal: 'format',
  a: 'artist', artist: 'artist',
  is: 'is', not: 'not', order: 'order', direction: 'direction',
  date: 'date', year: 'year', name: 'name', n: 'name',
};

// Keys that say nothing about what a card is or does: scoping and sorting.
const NON_FILTERING = new Set(['format', 'order', 'direction', 'identity', 'unique', 'prefer', 'game', 'lang']);

interface Token {
  negated: boolean;
  key: string | null;
  op: string;
  value: string;
  exact: boolean;
  raw: string;
}

/** Split into terms, `or`, and parentheses, keeping quoted phrases whole. */
function tokenize(query: string): Array<Token | 'or' | '(' | ')'> {
  const out: Array<Token | 'or' | '(' | ')'> = [];
  const pattern = /\(|\)|-?!?(?:[a-z]+(?:>=|<=|!=|[:=<>]))?(?:"[^"]*"|[^\s()]+)/gi;
  for (const [raw] of query.matchAll(pattern)) {
    if (raw === '(' || raw === ')') { out.push(raw); continue; }
    if (raw.toLowerCase() === 'or') { out.push('or'); continue; }
    if (raw.toLowerCase() === 'and') continue;

    let rest = raw;
    const negated = rest.startsWith('-');
    if (negated) rest = rest.slice(1);
    const exact = rest.startsWith('!');
    if (exact) rest = rest.slice(1);

    const match = rest.match(/^([a-z]+)(>=|<=|!=|[:=<>])(.*)$/i);
    const unquote = (s: string) => s.replace(/^"|"$/g, '');
    out.push(match && !exact
      ? { negated, exact, key: match[1].toLowerCase(), op: match[2], value: unquote(match[3]), raw }
      : { negated, exact, key: null, op: ':', value: unquote(rest), raw });
  }
  return out;
}

/** "UBR" -> "blue/black/red". Also takes guild names: "izzet" -> "blue/red". */
export function colours(value: string): string {
  const letters = GUILDS[value.toLowerCase()] ?? value.toLowerCase();
  if (letters === 'm' || letters === 'multicolor') return 'multicoloured';
  const names = [...letters].map((l) => COLOURS[l]).filter(Boolean);
  return names.length ? names.join('/') : value;
}

const COMPARE: Record<string, string> = {
  '<': 'under', '<=': 'at most', '>': 'over', '>=': 'at least', '=': 'exactly', ':': 'exactly', '!=': 'not',
};

function describeTerm(token: Token): string {
  const not = token.negated ? 'not ' : '';
  const { value, op } = token;

  if (token.key === null) {
    return token.exact ? `${not}named exactly “${value}”` : `${not}name contains “${value}”`;
  }

  switch (NOUN_KEYS[token.key]) {
    case 'type': return token.negated ? `not a ${value}` : `type ${value}`;
    case 'text': return `${not}text says “${value}”`;
    case 'tag': return `${not}tagged ${value.replace(/-/g, ' ')}`;
    case 'keyword': return `${token.negated ? 'without' : 'has'} ${value}`;
    case 'colour': {
      const c = colours(value);
      if (op === '=') return `${not}exactly ${c}`;
      if (op === '<=' || op === '<') return `${not}at most ${c}`;
      return `${not}${c}`;
    }
    case 'identity':
      // For identity, Scryfall reads `id:` as "fits within", like `id<=`.
      return op === '='
        ? `${not}colour identity exactly ${colours(value)}`
        : `${not}fits a ${colours(value)} deck`;
    case 'mv': return `${not}mana value ${COMPARE[op] ?? op} ${value}`;
    case 'power': return `${not}power ${COMPARE[op] ?? op} ${value}`;
    case 'toughness': return `${not}toughness ${COMPARE[op] ?? op} ${value}`;
    case 'usd': return `${not}${COMPARE[op] ?? op} $${value}`;
    case 'eur': return `${not}${COMPARE[op] ?? op} €${value}`;
    case 'rarity': return `${not}${value}`;
    case 'set': return `${not}from set ${value.toUpperCase()}`;
    case 'format': return `${token.negated ? 'not legal' : 'legal'} in ${FORMATS[value.toLowerCase()] ?? value}`;
    case 'artist': return `${not}art by ${value}`;
    case 'is': return value.toLowerCase() === 'commander' ? `${token.negated ? 'cannot' : 'can'} be a commander` : `${not}is ${value}`;
    case 'not': return `not ${value}`;
    case 'order': return ORDERS[value.toLowerCase()] ?? `sorted by ${value}`;
    case 'direction': return value.toLowerCase() === 'desc' ? 'highest first' : 'lowest first';
    case 'date': return `${not}released ${COMPARE[op] === 'exactly' ? 'on' : (op.includes('>') ? 'since' : 'before')} ${value}`;
    case 'year': return `${not}released ${op.includes('>') ? 'since' : op.includes('<') ? 'before' : 'in'} ${value}`;
    case 'name': return `${not}name contains “${value}”`;
    default: return token.raw;
  }
}

type Node = string | { op: 'and' | 'or'; items: Node[] };

/**
 * One readable line for a Scryfall query.
 *
 * Parsed into and/or groups first, so a nested `or` keeps its brackets:
 * "type enchantment · text says “copy” or text says “whenever you cast”"
 * would leave it unclear what the `or` covers.
 */
export function describeQuery(query: string): string {
  const tokens = tokenize(query);
  let at = 0;

  // or binds loosest, then and (juxtaposition), then brackets.
  const parseOr = (): Node => {
    const items = [parseAnd()];
    while (tokens[at] === 'or') { at++; items.push(parseAnd()); }
    return items.length === 1 ? items[0] : { op: 'or', items };
  };
  const parseAnd = (): Node => {
    const items: Node[] = [];
    while (at < tokens.length && tokens[at] !== 'or' && tokens[at] !== ')') {
      const token = tokens[at++];
      if (token === '(') {
        items.push(parseOr());
        if (tokens[at] === ')') at++;
      } else if (typeof token === 'object') {
        items.push(describeTerm(token));
      }
    }
    // Flatten and-inside-and: brackets around a plain list add nothing.
    const flat = items.flatMap((i) => (typeof i === 'object' && i.op === 'and' ? i.items : [i]));
    return flat.length === 1 ? flat[0] : { op: 'and', items: flat };
  };

  const render = (node: Node, top: boolean): string => {
    if (typeof node === 'string') return node;
    if (node.op === 'or') return node.items.map((i) => bracketed(i, 'or')).join(' or ');
    return node.items.map((i) => (top ? render(i, false) : bracketed(i, 'and'))).join(top ? ' · ' : ' and ');
  };
  // A group inside a different kind of group needs its brackets.
  const bracketed = (node: Node, parent: 'and' | 'or'): string =>
    typeof node === 'object' && node.op !== parent ? `(${render(node, false)})` : render(node, false);

  let tree = parseOr();
  while (at < tokens.length) {
    // A stray closing bracket: skip it and read on.
    at++;
    tree = { op: 'and', items: [tree, parseOr()] };
  }
  return typeof tree === 'object' && tree.op === 'or' ? render(tree, false) : render(tree, true);
}

/**
 * True when a query says nothing about what a card is or does - only format,
 * sort order or colour identity - so it matches most of Magic.
 */
export function isUnfiltered(query: string): boolean {
  return !tokenize(query).some((t) =>
    typeof t === 'object' && !(t.key && NON_FILTERING.has(NOUN_KEYS[t.key] ?? t.key)));
}
