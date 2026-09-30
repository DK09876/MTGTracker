/**
 * The model's part in a rules answer: it is given the question (and the
 * conversation so far), the cards' Oracle text, their official rulings, the
 * Comprehensive Rules that bear on it and any wiki pages, each with an id -
 * and answers from those alone, citing them. Claims it cannot cite are the
 * model's own reasoning, and it says how sure it is.
 *
 * Pure: the prompt, the schema, and checking the answer - every citation
 * must be to a source it was given; others are dropped.
 */

export type SourceKind = 'oracle' | 'ruling' | 'rule' | 'glossary' | 'wiki';

export interface Source {
  /** "O1", "R3", "C2", "G1", "W1" - what the model cites. */
  id: string;
  kind: SourceKind;
  /** "Blade of Selves", "CR 603.10a", "Glossary: Dies", "MTG Wiki: Myriad". */
  label: string;
  url?: string;
  text: string;
  /** For a ruling: when Wizards published it. */
  date?: string;
}

export type Confidence = 'certain' | 'likely' | 'unsure';

export interface Citation {
  id: string;
  /** 'key': settles the answer; 'supporting': backs a step. */
  role: 'key' | 'supporting';
  why: string;
}

export interface WorksheetEntry {
  event: string;
  checks: Array<{ object: string; ability: string; triggers: boolean; times: number; why: string }>;
}

export interface RulesAnswer {
  /** The model's check of each event and object, done before answering. */
  worksheet?: WorksheetEntry[];
  /** One or two sentences that answer the question directly. */
  verdict: string;
  /** How it works, step by step, citing sources as [C1], [R2]. */
  explanation: string;
  confidence: Confidence;
  /** The sources cited, most important first: the key ones, then official
   * rulings and rules before card text and the wiki. */
  citations: Citation[];
  /** Questions worth asking next. */
  followUps: string[];
  /** Gaps the app spotted in the worksheet, shown as warnings. */
  looseEnds?: string[];
}

export interface Turn {
  question: string;
  answer: RulesAnswer;
  sources: Source[];
  /** The cards this turn was about, by name. */
  cards: string[];
  model: string;
  /** The second check, if it was asked for: what it changed, or why it could not run. */
  check?: { changes: string; model: string } | { failed: string };
  /** The Comprehensive Rules edition drawn on: "September 25, 2026". */
  rulesEdition?: string;
  at: string;
}

export const ANSWER_SYSTEM = `\
You are a Magic: The Gathering rules expert - answer like a Level 2 judge
explaining a ruling to a player at a Commander table.

You are given the question, and SOURCES, each with an id:
- O#: a card's Oracle text (its official current wording)
- R#: an official ruling on a card, published by Wizards of the Coast
- C#: a rule from the Comprehensive Rules ("[Included because: ...]" says
  why it was picked for these cards - such rules usually matter)
- G#: a Comprehensive Rules glossary entry
- W#: an excerpt from the MTG Wiki (a fan wiki: good for explaining, not authoritative)

Work it out like a judge before answering:
A. Walk through the game in order: each event (casting, attacking, a trigger
   resolving, tokens entering, state-based actions, creatures dying).
B. After EVERY event, check EVERY object for abilities that trigger or
   apply - the cards named, token copies (a copy has the original's
   abilities, rule 707.2), and objects leaving the battlefield in that same
   event (leaves-the-battlefield and "dies" abilities look back in time, rule
   603.10a, so a creature dying alongside others sees them all die). One
   event with several deaths triggers once per death (603.2c).
C. Write this down in "worksheet" before anything else: one entry per event,
   and in it one check per object that could trigger or apply - naming each
   object separately ("Kratos (original)", "Kratos token 1", "Kratos token 2",
   never just "Kratos"), with its ability, whether it triggers, how many
   times, and why. Include objects that leave the battlefield in that event.
D. Only then count from the worksheet, and write the verdict. Recount.

Rules for answering:
1. Answer from the SOURCES. Every rules claim cites the source it rests on,
   as [C2] or [R1][C4], right after the claim. Prefer official rulings (R)
   and the Comprehensive Rules (C, G) over the wiki (W).
2. Never cite an id that is not in SOURCES, and never quote rule numbers that
   are not in SOURCES.
3. confidence:
   - "certain" only when a key official ruling or rule states the conclusion
     itself.
   - "likely" when it follows from the sources by steps - any answer built
     by counting or chaining several rules is at most "likely".
   - "unsure" when the sources do not settle it: say what is missing and
     give your best reading as reasoning.
4. verdict: the direct answer in one or two sentences. For a yes-or-no
   question start "Yes:", "No:" or "It depends:"; for "how does X work with
   Y", say what happens; for "how many", give the number. No hedging filler.
5. explanation: the walk-through from A-C as short numbered steps, in game
   order, naming the cards and saying for each step what triggers and why;
   about 3-8 steps. Plain words.
6. citations: every source cited, most decisive first. role "key" for the
   one to three sources that settle the answer; "supporting" for the rest.
7. If the question is ambiguous (which ability, whose turn, how many
   opponents), answer the usual case - a four-player Commander game - and say
   what changes otherwise.
8. followUps: up to three short, natural follow-up questions a player might
   ask next about these cards.`;

// Filled in first, so the model reasons object by object before it concludes:
// asked about Kratos with Blade of Selves, it counted one Kratos where there
// were three (the original and two token copies), until it had to list them.
const WORKSHEET = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      event: { type: 'STRING' },
      checks: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            object: { type: 'STRING' },
            ability: { type: 'STRING' },
            triggers: { type: 'BOOLEAN' },
            times: { type: 'INTEGER' },
            why: { type: 'STRING' },
          },
          required: ['object', 'ability', 'triggers', 'times', 'why'],
          propertyOrdering: ['object', 'ability', 'triggers', 'times', 'why'],
        },
      },
    },
    required: ['event', 'checks'],
    propertyOrdering: ['event', 'checks'],
  },
};

export const ANSWER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    worksheet: WORKSHEET,
    verdict: { type: 'STRING' },
    explanation: { type: 'STRING' },
    confidence: { type: 'STRING', enum: ['certain', 'likely', 'unsure'] },
    citations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, role: { type: 'STRING', enum: ['key', 'supporting'] }, why: { type: 'STRING' } },
        required: ['id', 'role', 'why'],
        propertyOrdering: ['id', 'role', 'why'],
      },
    },
    followUps: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['worksheet', 'verdict', 'explanation', 'confidence', 'citations', 'followUps'],
  propertyOrdering: ['worksheet', 'verdict', 'explanation', 'confidence', 'citations', 'followUps'],
};

/** The message: the conversation so far, the question, then the sources. */
export function answerMessage(question: string, earlier: Array<{ question: string; verdict: string }>, sources: Source[]): string {
  const history = earlier.length
    ? `CONVERSATION SO FAR:\n${earlier.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.verdict}`).join('\n')}\n\n`
    : '';
  const body = sources.map((s) => `[${s.id}] ${s.label}${s.date ? ` (${s.date})` : ''}\n${s.text}`).join('\n\n');
  return `${history}QUESTION: ${question}\n\nSOURCES:\n${body}`;
}

const CONFIDENCE = new Set<Confidence>(['certain', 'likely', 'unsure']);

// Among equals, official word first: rulings and rules, then card text, then the wiki.
const KIND_RANK: Record<SourceKind, number> = { ruling: 0, rule: 1, glossary: 2, oracle: 3, wiki: 4 };

/** Key sources first, then by kind, keeping the model's order within each. */
export function rankCitations(citations: Citation[], kindOf: Map<string, SourceKind>): Citation[] {
  return citations
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(b.c.role === 'key') - Number(a.c.role === 'key')
      || KIND_RANK[kindOf.get(a.c.id) ?? 'wiki'] - KIND_RANK[kindOf.get(b.c.id) ?? 'wiki']
      || a.i - b.i)
    .map((x) => x.c);
}

/**
 * The model's answer, checked: citations only to sources given (ids in the
 * text to unknown sources are removed), and no "certain" without a citation.
 */
export function parseAnswer(data: unknown, sources: Source[]): RulesAnswer {
  const d = (data ?? {}) as Record<string, unknown>;
  const known = new Set(sources.map((s) => s.id));
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const clean = (text: string) => text.replace(/\[([A-Z]\d+)\]/g, (m, id: string) => (known.has(id) ? m : '')).replace(/[ \t]{2,}/g, ' ');
  const verdict = clean(str(d.verdict));
  const explanation = clean(str(d.explanation));
  if (!verdict) throw new Error('The model gave no answer');
  const cited = new Set([...`${verdict} ${explanation}`.matchAll(/\[([A-Z]\d+)\]/g)].map((m) => m[1]));
  const kindOf = new Map(sources.map((x) => [x.id, x.kind]));
  const listed: Citation[] = [];
  for (const c of Array.isArray(d.citations) ? d.citations : []) {
    const id = str((c as { id?: unknown }).id);
    if (!known.has(id) || listed.some((x) => x.id === id)) continue;
    listed.push({ id, role: (c as { role?: unknown }).role === 'key' ? 'key' : 'supporting', why: str((c as { why?: unknown }).why) });
  }
  for (const id of cited) if (!listed.some((c) => c.id === id)) listed.push({ id, role: 'supporting', why: '' });
  const citations = rankCitations(listed, kindOf);
  let confidence = CONFIDENCE.has(d.confidence as Confidence) ? d.confidence as Confidence : 'unsure';
  // Certain only on the word of an official ruling or rule that settles it.
  const settled = citations.some((c) => c.role === 'key' && ['ruling', 'rule', 'glossary'].includes(kindOf.get(c.id) ?? ''));
  if (!citations.length) confidence = 'unsure';
  else if (confidence === 'certain' && !settled) confidence = 'likely';
  const followUps = (Array.isArray(d.followUps) ? d.followUps : []).map(str).filter(Boolean).slice(0, 3);
  const worksheet = (Array.isArray(d.worksheet) ? d.worksheet : []).slice(0, 12).map((e) => {
    const entry = e as { event?: unknown; checks?: unknown };
    return {
      event: str(entry.event),
      checks: (Array.isArray(entry.checks) ? entry.checks : []).slice(0, 12).map((c) => {
        const x = c as Record<string, unknown>;
        return { object: str(x.object), ability: str(x.ability), triggers: x.triggers === true, times: Math.max(0, Math.trunc(Number(x.times) || 0)), why: str(x.why) };
      }),
    };
  }).filter((e) => e.event);
  const looseEnds = findLooseEnds(worksheet);
  if (looseEnds.length) confidence = 'unsure';
  return { ...(worksheet.length ? { worksheet } : {}), verdict, explanation, confidence, citations, followUps, ...(looseEnds.length ? { looseEnds } : {}) };
}

// --- the second check ------------------------------------------------------------

export const CHECK_SYSTEM = `\
You are a Level 3 Magic: The Gathering judge reviewing another judge's
answer before it is given to a player. You get the question, the SOURCES
(same ids as the answer cites), and the DRAFT answer.

Check the draft hard, especially for what first drafts miss:
- a triggered or static ability that was not considered - on token copies
  (a copy has the original's abilities, 707.2), or on permanents leaving the
  battlefield in the same event ("dies" and leaves-the-battlefield abilities
  look back in time, 603.10a, and see everything that died with them;
  several deaths in one event trigger once each, 603.2c);
- a wrong count, or a count that forgot the question's setup (players,
  opponents, who controls what);
- a claim the cited source does not support, or a better source not cited;
- confidence that is too high ("certain" needs a key official ruling or
  rule that states the conclusion itself).

Return the corrected answer in full, in the same form and with the same
rules for citing (ids only from SOURCES), and in "changes" say in one
sentence what you changed and why - or "No changes" if the draft stands.`;

export const CHECK_SCHEMA = {
  ...ANSWER_SCHEMA,
  properties: { ...ANSWER_SCHEMA.properties, changes: { type: 'STRING' } },
  required: [...ANSWER_SCHEMA.required, 'changes'],
  propertyOrdering: ['changes', ...ANSWER_SCHEMA.propertyOrdering],
};

export function checkMessage(question: string, earlier: Array<{ question: string; verdict: string }>, sources: Source[], draft: RulesAnswer): string {
  return `${answerMessage(question, earlier, sources)}\n\nDRAFT ANSWER:\n${JSON.stringify(draft, null, 1)}`;
}

/**
 * Gaps a worksheet shows: an event where tokens leave the battlefield (die,
 * go to the graveyard, the legend rule) but no token was checked for
 * abilities of its own. Dying objects look back in time and see each other
 * die (603.10a) - the step the model skipped on Kratos with Blade of Selves.
 */
export function findLooseEnds(worksheet: WorksheetEntry[]): string[] {
  const out: string[] = [];
  for (const e of worksheet) {
    const leaving = /\b(dies?|died|dying|graveyard|destroy(ed|s)?|legend rule|sacrific(e|ed)|exile[sd]?)\b/i.test(e.event);
    const tokens = /\btokens?\b|\bcop(y|ies)\b/i.test(e.event);
    const checkedTokens = e.checks.some((c) => /\btokens?\b|\bcop(y|ies)\b/i.test(c.object));
    if (leaving && tokens && !checkedTokens) {
      out.push(`"${e.event}": the tokens leaving the battlefield were not checked. Anything leaving at the same moment looks back in time and sees the others (and itself) leave - including token copies, which have the copied abilities (CR 603.10a, 707.2).`);
    }
  }
  return out;
}
