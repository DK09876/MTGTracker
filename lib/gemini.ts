/**
 * The one model call: plain English in, a Scryfall query out.
 *
 * Called over REST rather than through Google's SDK - it is a single request
 * with a JSON schema, and the SDK would be the largest dependency here.
 *
 * The model is only trusted to write a query. Every card shown still comes
 * back from Scryfall, so a model that misremembers a card can produce a bad
 * search but never a card that does not exist.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// The same default pantry measured as fastest on this Pi. Translation is a
// short, well-defined job; a larger model buys little here and costs seconds.
const DEFAULT_MODEL = 'gemini-flash-lite-latest';

const TIMEOUT_MS = 15_000;

export interface Translation {
  /** Scryfall syntax, without the commander's colour identity. */
  query: string;
  /** One sentence restating what the search looks for, shown above the results. */
  explanation: string;
  /** A commander named in the request, resolved against Scryfall by the caller. */
  commander: string | null;
}

export class GeminiError extends Error {}

/** A translator, or null when no API key is configured. */
export function geminiTranslator(): ((request: string, feedback?: string) => Promise<Translation>) | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  return (request, feedback) => translate(key, model, request, feedback);
}

async function translate(key: string, model: string, request: string, feedback?: string): Promise<Translation> {
  const user = feedback
    ? `${request}\n\nYour previous attempt did not work: ${feedback}`
    : request;

  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
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

  if (!response.ok) {
    let detail = '';
    try {
      detail = ((await response.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch { /* non-JSON error body */ }
    throw new GeminiError(`the model returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  return parseTranslation(await response.json());
}

/** Pull the translation out of a generateContent response, refusing anything malformed. */
export function parseTranslation(body: unknown): Translation {
  const text = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) throw new GeminiError('the model returned nothing');

  let parsed: Partial<Translation>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiError('the model returned something other than JSON');
  }

  const query = typeof parsed.query === 'string' ? parsed.query.trim() : '';
  if (!query) throw new GeminiError('the model returned an empty query');
  const commander = typeof parsed.commander === 'string' ? parsed.commander.trim() : '';
  return {
    query,
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '',
    commander: commander || null,
  };
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    query: { type: 'STRING' },
    explanation: { type: 'STRING' },
    commander: { type: 'STRING', nullable: true },
  },
  required: ['query', 'explanation', 'commander'],
  propertyOrdering: ['explanation', 'commander', 'query'],
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
You turn requests for Magic: The Gathering cards into a Scryfall search query.
Scryfall runs the query and the user sees whatever it returns, so the query
must be valid Scryfall syntax and must actually find the cards asked for.

Return JSON with:
- explanation: one short sentence saying what the search looks for, in plain
  words, e.g. "Green ramp that isn't a land, under $2".
- commander: if the request names a commander to build around ("for my Omnath
  deck", "good with Atraxa"), that card's name as best you know it. Otherwise
  null. When you set this, do NOT put a colour identity (id:) in the query -
  the real identity is looked up and added for you.
- query: the Scryfall query.

Syntax reminders:
- t: type line (t:creature t:goblin). o:"text" searches rules text; use ~ for
  the card's own name, e.g. o:"when ~ enters".
- c: card colours (c:g, c:rg means both, c:m multicolour, c:c colourless).
  id<= is colour identity, which is what deckbuilding cares about.
- mv (or cmc), pow, tou, usd with = < > <= >=. r: rarity. s: set code.
- f:commander, f:modern, f:standard, f:pauper etc. for format legality.
- is:commander finds cards that can be a commander.
- kw: keyword abilities (kw:flying, kw:trample).
- -term excludes. Terms are ANDed. (a or b) groups alternatives.
- order:edhrec sorts by how popular a card is in Commander decks. Use it when
  the request asks for good, best, popular or staple cards, or suggestions for
  a deck. Otherwise leave the order out.
- otag: is a curated tag for what a card does. It is often the best way to
  express a role, but ONLY these tags exist - any other otag matches nothing:
  ${ORACLE_TAGS.join(', ')}.
  For a role not in that list, use o:"..." with the words such cards print.

Rules:
- If the input is just a card name, possibly misspelled, return its correct
  exact name as !"Card Name".
- Plural creature types are a type search: "goblins" is t:goblin.
- Prefer a query that finds a few too many cards over one that finds none.
  Do not stack every possible condition.
- Never invent a keyword. If you are unsure a clause is valid, leave it out.

Examples:
"cheap green ramp that isn't a land" ->
  query: otag:ramp c:g -t:land usd<2
"lightnig bolt" -> query: !"Lightning Bolt"
"best board wipes for my Atraxa deck" ->
  commander: Atraxa, Praetors' Voice; query: otag:board-wipe f:commander order:edhrec
"red creatures that give other creatures haste" ->
  query: t:creature c:r otag:gives-haste
"blue two drops that draw a card when they enter" ->
  query: t:creature c:u mv=2 o:"when ~ enters" o:"draw"
`;
