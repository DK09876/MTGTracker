/**
 * The model's job: read a request and say what kind of search it is.
 *
 * Called over REST rather than through Google's SDK - it is a single request
 * with a JSON schema, and the SDK would be the largest dependency here.
 *
 * The model only ever plans. It picks a route - cards, one card by name, or
 * combos - and writes the query; the server looks up the commander, runs the
 * searches and fetches every card shown. A model that misremembers a card
 * can produce a bad search, but never a card or a combo that does not exist.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// The same default pantry measured as fastest on this Pi. Translation is a
// short, well-defined job; a larger model buys little here and costs seconds.
const DEFAULT_MODEL = 'gemini-flash-lite-latest';

const TIMEOUT_MS = 15_000;

// When Gemini is overloaded it refuses with a 503 in a fraction of a second,
// so one quick retry is cheap. A slow request is not retried - it has
// already used up the time a retry would need.
const RETRY_STATUSES = new Set([429, 503]);
const RETRY_DELAY_MS = 500;

export type Kind = 'cards' | 'card' | 'combos';

export interface Translation {
  kind: Kind;
  /**
   * kind "card": the corrected name of the one card asked for.
   * kind "combos": the card to find combos with, when it is not the commander.
   *
   * Asked for as a name rather than as `!"Name"` syntax because both Flash
   * Lite models, told to write that, wrote its negation (`-"Name"`) instead.
   */
  cardName: string | null;
  /** The commander a deck is built around, as the request names it. Resolved by the caller. */
  commander: string | null;
  /**
   * kind "cards": Scryfall syntax, without the commander's colour identity.
   * kind "combos": extra Commander Spellbook terms, usually empty.
   */
  query: string;
  /**
   * Only the conditions the request itself states - "enchantments", "under
   * 5 mana" - without the synergy the model added to `query`. The EDHREC tab
   * filters by these: its list is already what works with the commander, and
   * re-filtering it by guessed rules text threw most of it away (12 of
   * Azula's 20 enchantments). Null when the model did not say.
   */
  constraints: string | null;
  /** One sentence restating what the search looks for, shown above the results. */
  explanation: string;
}

/** A search that has already run, which a follow-up refines. */
export interface Previous {
  /** What was asked, including earlier follow-ups: "green ramp for omnath › only instants". */
  request: string;
  kind: Kind;
  commander?: string;
  cardName?: string;
  query: string;
  constraints?: string;
}

/** What the model is told on top of the request. */
export interface Context {
  /** The search this request follows up on. */
  previous?: Previous;
  /** The resolved commander, so synergy is judged from its real rules text. */
  commander?: { name: string; manaCost: string; typeLine: string; text: string };
  /** Why the previous attempt failed. */
  feedback?: string;
}

export type Translator = (request: string, context?: Context) => Promise<Translation>;

export class GeminiError extends Error {}

/** A translator, or null when no API key is configured. */
export function geminiTranslator(): Translator | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  return (request, context) => translate(key, model, userMessage(request, context));
}

/** The request plus whatever the server has learned, as one message. */
export function userMessage(request: string, context: Context = {}, today = new Date()): string {
  const { commander, feedback, previous } = context;
  const lines = previous
    ? [
      'This is a follow-up to a search that already ran.',
      `Earlier request: ${previous.request}`,
      `Plan that ran: kind ${previous.kind}`
        + (previous.commander ? `; commander ${previous.commander}` : '')
        + (previous.cardName ? `; cardName ${previous.cardName}` : '')
        + `; query ${previous.query || '(empty)'}`
        + (previous.constraints !== undefined ? `; constraints ${previous.constraints || '(empty)'}` : ''),
      '',
      `Follow-up: ${request}`,
      '',
      'Return the whole plan with the follow-up applied. Keep everything the follow-up does not change -',
      'the commander, the kind, and the conditions already in the query - unless it replaces them.',
    ]
    : [`Request: ${request}`];
  lines.push('', `Today is ${today.toISOString().slice(0, 10)}.`);
  if (commander) {
    lines.push(
      '',
      `The commander is ${commander.name} ${commander.manaCost}, a ${commander.typeLine}. Its rules text:`,
      commander.text,
      '',
      'Write the query around what this commander actually rewards, as described in the rules.',
    );
  }
  if (feedback) lines.push('', `Your previous attempt did not work: ${feedback}`);
  return lines.join('\n');
}

async function translate(key: string, model: string, user: string): Promise<Translation> {
  const started = Date.now();
  let response = await call(key, model, user);
  if (RETRY_STATUSES.has(response.status) && Date.now() - started < TIMEOUT_MS / 2) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    response = await call(key, model, user);
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = ((await response.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch { /* non-JSON error body */ }
    throw new GeminiError(`the model returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  return parseTranslation(await response.json());
}

async function call(key: string, model: string, user: string): Promise<Response> {
  try {
    return await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          // Low but not zero: a retry after a failed query should be able
          // to try something different.
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new GeminiError(timedOut ? 'the model took too long' : 'could not reach the model');
  }
}

const KINDS = new Set<Kind>(['cards', 'card', 'combos']);

/** Pull the translation out of a generateContent response, refusing anything unusable. */
export function parseTranslation(body: unknown): Translation {
  const text = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) throw new GeminiError('the model returned nothing');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiError('the model returned something other than JSON');
  }

  const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const cardName = clean(parsed.cardName) || null;
  const commander = clean(parsed.commander) || null;
  let query = clean(parsed.query);
  let kind = KINDS.has(parsed.kind as Kind) ? (parsed.kind as Kind) : 'cards';

  // Hold each route to what it needs, rather than running half a plan.
  if (kind === 'card') {
    if (!cardName) throw new GeminiError('the model named no card');
    query = '';
  }
  if (kind === 'combos' && !cardName && !commander && !query) {
    throw new GeminiError('the model asked for combos without saying which');
  }
  if (kind === 'cards' && !query && !commander) {
    // A bare name filed under "cards" is still a name.
    if (cardName) kind = 'card';
    else throw new GeminiError('the model returned an empty query');
  }

  const constraints = typeof parsed.constraints === 'string' ? parsed.constraints.trim() : null;
  return { kind, cardName, commander, query, constraints, explanation: clean(parsed.explanation) };
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['cards', 'card', 'combos'] },
    cardName: { type: 'STRING', nullable: true },
    commander: { type: 'STRING', nullable: true },
    explanation: { type: 'STRING' },
    query: { type: 'STRING' },
    constraints: { type: 'STRING' },
  },
  required: ['kind', 'cardName', 'commander', 'explanation', 'query', 'constraints'],
  propertyOrdering: ['kind', 'cardName', 'commander', 'explanation', 'query', 'constraints'],
};

// Tags checked against Scryfall on 2026-09-24. An unknown otag does not
// error, it silently matches nothing, so only verified slugs are offered.
const ORACLE_TAGS = [
  'ramp', 'land-ramp', 'mana-rock', 'mana-dork', 'ritual', 'cost-reducer',
  'removal', 'spot-removal', 'creature-removal', 'removal-exile',
  'artifact-removal', 'enchantment-removal', 'board-wipe', 'counterspell',
  'burn', 'draw', 'cantrip', 'card-advantage', 'rummage', 'tutor', 'wheel',
  'mill', 'self-mill', 'reanimate', 'recursion', 'graveyard-hate',
  'sacrifice-outlet', 'death-trigger', 'lifegain', 'discard', 'anthem', 'lord',
  'evasion', 'gives-flying', 'gives-haste', 'protection', 'combat-trick',
  'blink', 'copy', 'clone', 'untapper', 'mana-sink', 'extra-turn', 'hatebear',
];

export const SYSTEM_PROMPT = `\
You plan searches for Magic: The Gathering cards. You do not search yourself:
you say what kind of search a request is and write the query, and the server
runs it. Most requests come from someone building a Commander deck.

Return JSON with:
- kind: one of
    "card"   - the request is just the name of one card, possibly misspelled
               or partial ("lightnig bolt", "sol ring").
    "combos" - the request asks for combos, infinite loops or "cards that go
               infinite with" something.
    "cards"  - everything else: cards matching a description, optionally for
               a commander's deck.
- cardName: for "card", the card's correct full name. For "combos", the card
  to find combos with when it is not the commander ("combos with Doubling
  Season"). Otherwise null.
- commander: the commander the request is building around, as named ("for
  my Azula deck", "good with Atraxa", "combos for vivi"). A short or partial
  name is fine - it is looked up for you. Otherwise null.
- explanation: one short sentence saying what the search looks for, in plain
  words, e.g. "Green ramp that isn't a land, under $2".
- query:
    For "cards": a Scryfall query for what the cards must be or do.
    For "card": empty.
    For "combos": usually empty. Only add Commander Spellbook terms when the
    request narrows the combos: result:"infinite mana", cards<=2 (at most two
    pieces), price<50, coloridentity<=UR (only when no commander is given).
- constraints: for "cards", the part of the query the request itself states,
  in Scryfall syntax - card types, mana value, price, colours, rarity, a role
  the user named ("ramp", "card draw", "removal"). Leave out anything you
  added to judge synergy with the commander. Empty when the request states
  nothing ("good cards for Azula"). For "card" and "combos", empty.

When a commander is given, the server adds its colour identity, Commander
legality, and removes the commander itself. So never write id:, f:commander
or the commander's name into the query. If the request says only "cards for
X" with no other condition, the query may be empty.

When you are shown the commander's rules text, build the query around what
it actually rewards, and keep every constraint the request states (type,
cost, price, colour). Express the synergy as one or two alternatives joined
with or, so the search is not so narrow that it finds nothing. For example,
a commander that copies spells you cast and asks for enchantments:
  t:enchantment (o:copy or o:"whenever you cast")

Scryfall syntax:
- t: type line (t:creature t:goblin). o:"text" searches rules text; use ~ for
  the card's own name, e.g. o:"when ~ enters". Always quote text of more than
  one word: o:"whenever you cast", never o:whenever you cast - unquoted, the
  extra words search card names instead.
- c: card colours (c:g, c:rg means both, c:m multicolour, c:c colourless).
  id<= is colour identity.
- mv (or cmc), pow, tou, usd with = < > <= >=. r: rarity. s: set code.
- date>=YYYY-MM-DD for recently released cards. Use today's date to work out
  "new", "this year" or "recent".
- f:commander, f:modern, f:standard, f:pauper etc. for format legality.
- is:commander finds cards that can be a commander.
- kw: keyword abilities (kw:flying, kw:trample).
- -term excludes. Terms are ANDed. (a or b) groups alternatives.
- order: sets the sort. Only add one when the request asks for an order:
  order:edhrec for "best", "most popular" or "staples"; order:released for
  "new" or "latest"; order:usd direction:asc for "cheapest". Otherwise leave
  it out - the user picks the order from a menu.
- otag: is a curated tag for what a card does. It is often the best way to
  express a role, but ONLY these tags exist - any other otag matches nothing:
  ${ORACLE_TAGS.join(', ')}.
  For a role not in that list, use o:"..." with the words such cards print.
- Plural creature types are a type search: "goblins" is t:goblin.

Prefer a query that finds a few too many cards over one that finds none, and
never invent a keyword - if you are unsure a clause is valid, leave it out.

Examples:
"cheap green ramp that isn't a land" ->
  kind: cards; query: otag:ramp c:g -t:land usd<2; constraints: otag:ramp c:g -t:land usd<2
"lightnig bolt" -> kind: card; cardName: Lightning Bolt
"enchantments that work well for fire lord azula" ->
  kind: cards; commander: Fire Lord Azula; query: t:enchantment; constraints: t:enchantment
  (once shown Azula's rules text: query: t:enchantment (o:copy or o:"whenever you cast"); constraints: t:enchantment)
"a card under 5 cmc for azula that helps me draw cards" ->
  kind: cards; commander: Azula; query: (otag:draw or otag:card-advantage) mv<5;
  constraints: (otag:draw or otag:card-advantage) mv<5
"combo cards for vivi" -> kind: combos; commander: Vivi
"what goes infinite with doubling season" -> kind: combos; cardName: Doubling Season
"two card infinite mana combos in izzet" ->
  kind: combos; query: coloridentity<=UR result:"infinite mana" cards<=2
"best commanders for a goblin deck" ->
  kind: cards; query: is:commander (t:goblin or o:goblin) order:edhrec
"new red cards from this year" -> kind: cards; query: c:r year>=YYYY order:released, with YYYY the current year
"blue two drops that draw a card when they enter" ->
  kind: cards; query: t:creature c:u mv=2 o:"when ~ enters" o:"draw"
`;
