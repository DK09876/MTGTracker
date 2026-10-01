/**
 * The model's part in a rules answer: it is given the question (and the
 * conversation so far), the cards' Oracle text, their official rulings, the
 * Comprehensive Rules that bear on it and any wiki pages, each with an id -
 * and answers from those alone, citing them. Claims it cannot cite are the
 * model's own reasoning, and it says how sure it is.
 *
 * It works the question out in written steps first - read the question,
 * gather the objects, break down their abilities, find the rule for each
 * concept, walk the game event by event, check the count a second way - and
 * that "working" is kept and shown (collapsed) under a short answer. It also
 * says what it assumed.
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

/**
 * The game's automatic checks (state-based actions), gone through after every
 * event. A fixed list the answer must fill in, each yes or no: asked to
 * "check for state-based actions", GPT-OSS left the line empty and missed the
 * legend rule on Syr Konrad's token copies, and a player at 0 life between
 * two triggers on Falkenrath Noble (2026-09-30).
 */
export const AUTO_CHECKS = [
  { key: 'zeroLife', label: 'A player at 0 or less life loses' },
  { key: 'emptyLibrary', label: 'A player who drew from an empty library loses' },
  { key: 'poisonOrCommanderDamage', label: 'A player with 10 poison counters, or 21 combat damage from one commander, loses' },
  { key: 'zeroToughness', label: 'A creature with 0 or less toughness goes to the graveyard' },
  { key: 'lethalDamage', label: 'A creature with lethal damage, or any damage from deathtouch, is destroyed' },
  { key: 'zeroLoyaltyOrDefense', label: 'A planeswalker with 0 loyalty, or a battle with 0 defense, goes to the graveyard' },
  { key: 'legendRule', label: 'Legend rule: a player with two or more legendary permanents of the same name keeps one' },
  { key: 'illegalAttachment', label: 'An Aura or Equipment attached illegally falls off or goes to the graveyard' },
  { key: 'countersCancel', label: '+1/+1 and -1/-1 counters on one permanent cancel out' },
  { key: 'outOfPlace', label: 'A token or a copy of a spell where it cannot be ceases to exist; a finished Saga is sacrificed' },
] as const;

export interface AutoCheck { label: string; applies: boolean; note: string }

/** A trigger check: one object, one ability, at one event. */
export interface TriggerCheck { object: string; ability: string; triggers: boolean; times: number; why: string }

/** The worked steps behind an answer (see ANSWER_SYSTEM's method). */
export interface Working {
  /** Step 1: what is asked, and the setup taken. */
  asked: string;
  setup: string;
  /** Step 2: every object, including tokens and copies that will exist. */
  objects: Array<{ name: string; what: string; abilities: string }>;
  /** Step 3: each ability taken apart. */
  abilities: Array<{ object: string; ability: string; breakdown: string }>;
  /** Step 4: each rules concept and the source that governs it ("C3", or "" for none). */
  concepts: Array<{ concept: string; source: string; says: string }>;
  /** Step 5: the starting state. */
  start: string;
  /** Step 6: the game, one event at a time. */
  /** checks: the automatic checks, each yes or no (older answers: a line of text). */
  events: Array<{ what: string; board: string; checks: AutoCheck[] | string; triggers: TriggerCheck[]; notes: string }>;
  /** Step 7: the count, and the second way of checking it. */
  count: string;
}

/** Answers saved before the working existed. */
export interface WorksheetEntry { event: string; checks: TriggerCheck[] }

export interface RulesAnswer {
  working?: Working;
  /** Older answers: the trigger worksheet that came before the working. */
  worksheet?: WorksheetEntry[];
  /** One or two sentences that answer the question directly. */
  verdict: string;
  /** Two or three plain sentences: the reason, for a player. */
  summary?: string;
  /** Older answers: the numbered walk-through. */
  explanation?: string;
  /** What the answer took for granted that the question did not say. */
  assumptions?: string[];
  confidence: Confidence;
  /** The sources cited, most important first: the key ones, then official
   * rulings and rules before card text and the wiki. */
  citations: Citation[];
  /** Questions worth asking next. */
  followUps: string[];
  /** Gaps the app spotted in the working, shown as warnings. */
  looseEnds?: string[];
}

export interface Turn {
  question: string;
  /** What the player said when asked to clarify. */
  clarifications?: Array<{ question: string; answer: string }>;
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

You get the question, perhaps an EARLIER part of the conversation, and
SOURCES, each with an id: card Oracle text (O#), official rulings (R#),
Comprehensive Rules (C#), glossary entries (G#), MTG Wiki excerpts (W#, a fan
wiki: good for explaining, not authoritative). Every claim about the rules
must rest on a source, cited by id like [C3] or [R1][C4]. Your memory of the
rules is only a guide to what to look for in SOURCES.

HOW TO WORK IT OUT - write each step into "working":

Step 1 - Read the question (asked, setup).
  What is asked: yes/no, a number, "what happens", "which rule says".
  The setup: players (default four-player Commander), who controls what,
  whose turn. If something matters and is not said, take the usual case
  and add it to "assumptions".
  A follow-up that only asks ABOUT the earlier answer (why, which rule,
  explain a step): answer from the EARLIER working and sources; keep the
  working short (asked, concepts, count) and leave the rest empty.

Step 2 - Gather every object (objects).
  Each card named: its type line and its abilities, word for word. Then
  every object that WILL exist: tokens, copies, emblems - find in SOURCES
  what each one has; never assume what a copy or token inherits. A keyword
  is a rule of its own: read it, not your memory of it.

Step 3 - Take each ability apart (abilities).
  Triggered: the event; which objects it watches (any / yours / "another"
  never sees itself); once per event or once per object; the effect.
  Static: what it changes, for which objects.
  Replacement ("instead", "as ... enters", "skip"): which event it changes -
  it applies before the event, and does not trigger.
  Every copy has its own copy of each ability.

Step 4 - Find the rule for every concept in play (concepts).
  Each rules concept the situation touches, with the SOURCE id that governs
  it and what it says. No source: leave the id empty and lower confidence.
  Look hard at: things happening at the same moment (do they see each
  other?); automatic checks between events (state-based actions); things
  PUT somewhere rather than cast, declared or played; narrowing words
  ("another", "you control", "nontoken", "once each turn").

Step 5 - The starting state (start): each relevant permanent and controller.

Step 6 - Walk the game one event at a time (events). For EACH event:
  a. Before it: does a replacement effect change it?
  b. What happens, and the board right after (board). Objects leaving in
     this event are still checked if a source says they "look back".
  c. Automatic checks (checks): after EVERY event the game makes its
     automatic checks. Go through each one in "checks" - applies true or
     false, and if true what happens. One that applies is the next event,
     and everything leaving in it is checked for triggers like any other.
  d. Trigger scan (triggers): EVERY object on the battlefield or leaving
     now, against EVERY ability from Step 3. Write the "no"s too, with why.
  e. What a player might expect that does NOT happen, and why (notes).
  f. Several triggers at once: who controls each, and their order.
  g. Each trigger or spell resolving is its own event: go round again.
  Skip this step only when the question is just what a rule means.

Step 7 - Check it a second way (count). A number: add up from the events,
  then recount by multiplying (objects that saw it x times it happened).
  Yes/no: name the source that settles it. If they disagree, find out why.

WORKED EXAMPLE - the method, not an answer to reuse. (A real answer cites
each rule by its SOURCES id.)
Question: "Blade of Selves is on Kratos, Stoic Father and Kratos attacks in
a four-player game. How many experience counters do I get?"
1. Asked: a number of experience counters. Setup: four players - the
   defending player and two other opponents.
2. Objects: Kratos, Stoic Father - Legendary Creature - God Warrior -
   "Whenever you attack with one or more Gods and whenever a God dies, you
   get an experience counter." Blade of Selves - Equipment - equipped
   creature has myriad. Will exist: Kratos token 1 and token 2 (one per
   other opponent). The copy rule: each is a copy - legendary God, same
   ability.
3. Kratos's ability, on each of the three: A "you attack with one or more
   Gods" - once per attack, not per God. B "a God dies" - any God, itself
   included (no "another"), once per God that dies.
4. Concepts: copying (copy rule); myriad (its keyword rule); tokens put
   onto the battlefield attacking (never declared as attackers); the legend
   rule; leaves-the-battlefield abilities look back in time.
5. Start: Kratos (original), equipped.
6. Declare attackers - Kratos attacks. Triggers: Kratos (original) A x1;
   myriad x1. A resolves: 1 counter.
   Myriad resolves - board: Kratos (original), token 1, token 2, all
   attacking. Triggers: token 1 A no, token 2 A no (never declared as
   attackers). Checks: legend rule - true: three legendary permanents named
   Kratos, Stoic Father, one controller - keep one, so it is the next event;
   every other check false.
   Legend rule - keep one; the other two go to the graveyard together. Say
   both tokens die. Board after: Kratos (original); leaving, still checked:
   token 1, token 2. Triggers, B, two Gods died: Kratos (original) sees
   both - x2. Token 1 looks back, sees itself and token 2 - x2. Token 2
   likewise - x2. Notes: keeping a token instead changes nothing.
   The six resolve: 6 counters (they are on the player, not the creatures).
7. Count: 1 + 6 = 7. Check: A 1 attack x 1 = 1; B 3 Kratos x 2 deaths = 6.

ANSWERING:
1. verdict: the direct answer in one or two sentences. Yes-or-no: start
   "Yes:", "No:" or "It depends:". "How many": the number.
2. summary: two or three plain sentences a player can follow - the reason,
   citing the key sources.
3. assumptions: each thing you took for granted that the question did not
   say (player count, whose turn, a choice the player made). Empty if none.
4. Never cite an id that is not in SOURCES, and never quote rule numbers
   that are not in SOURCES.
5. confidence: "certain" only when a key official ruling or rule states the
   conclusion itself; "likely" when it follows by steps - any count built
   from several rules is at most "likely"; "unsure" when a needed source is
   missing - say what.
6. citations: every source cited, most decisive first; role "key" for the
   one to three that settle it, "supporting" for the rest.
7. followUps: up to three short, natural questions a player might ask next.`;

const TRIGGER_CHECK = {
  type: 'OBJECT',
  properties: {
    object: { type: 'STRING' }, ability: { type: 'STRING' }, triggers: { type: 'BOOLEAN' }, times: { type: 'INTEGER' }, why: { type: 'STRING' },
  },
  required: ['object', 'ability', 'triggers', 'times', 'why'],
  propertyOrdering: ['object', 'ability', 'triggers', 'times', 'why'],
};

const object = (props: Record<string, object>) => ({
  type: 'OBJECT', properties: props, required: Object.keys(props), propertyOrdering: Object.keys(props),
});
const text = { type: 'STRING' };

// Written first, so the model works it out before it concludes: asked about
// Kratos with Blade of Selves, it counted one Kratos where there were three,
// until it had to list them - and missed the dying tokens' own triggers
// until it had to scan every object at every event.
const WORKING = object({
  asked: text,
  setup: text,
  objects: { type: 'ARRAY', items: object({ name: text, what: text, abilities: text }) },
  abilities: { type: 'ARRAY', items: object({ object: text, ability: text, breakdown: text }) },
  concepts: { type: 'ARRAY', items: object({ concept: text, source: text, says: text }) },
  start: text,
  events: {
    type: 'ARRAY',
    items: object({
      what: text,
      board: text,
      checks: object(Object.fromEntries(AUTO_CHECKS.map((c) => [c.key, object({ applies: { type: 'BOOLEAN' }, note: text })]))),
      triggers: { type: 'ARRAY', items: TRIGGER_CHECK },
      notes: text,
    }),
  },
  count: text,
});

export const ANSWER_SCHEMA = object({
  working: WORKING,
  verdict: text,
  summary: text,
  assumptions: { type: 'ARRAY', items: text },
  confidence: { type: 'STRING', enum: ['certain', 'likely', 'unsure'] },
  citations: { type: 'ARRAY', items: object({ id: text, role: { type: 'STRING', enum: ['key', 'supporting'] }, why: text }) },
  followUps: { type: 'ARRAY', items: text },
});

/** What a follow-up carries from the conversation. */
export interface Earlier {
  /** Older turns, briefly: the question, the answer and its key sources. */
  older: Array<{ question: string; verdict: string; key: string[] }>;
  /** The last turn: its question, answer and working, compactly. */
  last: { question: string; verdict: string; working: string } | null;
}

/** The last answer's working, compact: enough to answer "why" and "which rule" without redoing it. */
export function compactWorking(answer: RulesAnswer, idToLabel: (id: string) => string): string {
  const w = answer.working;
  if (!w) return answer.explanation ?? answer.summary ?? '';
  const lines = [
    `Asked: ${w.asked} Setup: ${w.setup}`,
    w.objects.length ? `Objects: ${w.objects.map((o) => `${o.name} (${o.what})`).join('; ')}` : '',
    w.concepts.length ? `Rules used: ${w.concepts.map((c) => `${c.concept} - ${c.source ? idToLabel(c.source) : 'no source'}${c.says ? `: ${c.says}` : ''}`).join('; ')}` : '',
    ...w.events.map((e, i) => {
      const applied = typeof e.checks === 'string' ? e.checks : e.checks.filter((c) => c.applies).map((c) => c.note || c.label).join('; ');
      const fired = e.triggers.filter((t) => t.triggers).map((t) => `${t.object} x${t.times}`).join(', ');
      return `Event ${i + 1}: ${e.what}${applied ? ` - automatic: ${applied}` : ''}${fired ? ` - triggers: ${fired}` : ''}`;
    }),
    w.count ? `Count: ${w.count}` : '',
    answer.assumptions?.length ? `Assumed: ${answer.assumptions.join('; ')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/** The message: what the conversation carries, the question, what the player clarified, then the sources. */
export function answerMessage(
  question: string, earlier: Earlier | null, sources: Source[], clarifications: Array<{ question: string; answer: string }> = [],
): string {
  const parts: string[] = [];
  if (earlier?.older.length) {
    parts.push(`EARLIER IN THIS CONVERSATION:\n${earlier.older.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.verdict}${t.key.length ? ` (key sources: ${t.key.join(', ')})` : ''}`).join('\n')}`);
  }
  if (earlier?.last) {
    parts.push(`THE LAST QUESTION: ${earlier.last.question}\nITS ANSWER: ${earlier.last.verdict}\nITS WORKING:\n${earlier.last.working}`);
  }
  parts.push(`QUESTION: ${question}`);
  if (clarifications.length) parts.push(`THE PLAYER CLARIFIED:\n${clarifications.map((c) => `- ${c.question} ${c.answer}`).join('\n')}`);
  parts.push(`SOURCES:\n${sources.map((s) => `[${s.id}] ${s.label}${s.date ? ` (${s.date})` : ''}\n${s.text}`).join('\n\n')}`);
  return parts.join('\n\n');
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

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown, max: number) => (Array.isArray(v) ? v : []).slice(0, max) as unknown[];
const rec = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;

function parseWorking(v: unknown, clean: (t: string) => string): Working | undefined {
  const w = rec(v);
  const working: Working = {
    asked: clean(str(w.asked)),
    setup: clean(str(w.setup)),
    objects: list(w.objects, 12).map(rec).map((o) => ({ name: str(o.name), what: str(o.what), abilities: clean(str(o.abilities)) })).filter((o) => o.name),
    abilities: list(w.abilities, 16).map(rec).map((a) => ({ object: str(a.object), ability: str(a.ability), breakdown: clean(str(a.breakdown)) })).filter((a) => a.object || a.ability),
    concepts: list(w.concepts, 12).map(rec).map((c) => ({ concept: str(c.concept), source: str(c.source).replace(/[[\]]/g, ''), says: clean(str(c.says)) })).filter((c) => c.concept),
    start: clean(str(w.start)),
    events: list(w.events, 14).map(rec).map((e) => ({
      what: clean(str(e.what)),
      board: clean(str(e.board)),
      checks: typeof e.checks === 'string' ? clean(e.checks) : AUTO_CHECKS.map((c) => {
        const x = rec(rec(e.checks)[c.key]);
        return { label: c.label, applies: x.applies === true, note: clean(str(x.note)) };
      }),
      triggers: list(e.triggers, 14).map(rec).map((t) => ({
        object: str(t.object), ability: str(t.ability), triggers: t.triggers === true,
        times: Math.max(0, Math.trunc(Number(t.times) || 0)), why: clean(str(t.why)),
      })),
      notes: clean(str(e.notes)),
    })).filter((e) => e.what),
    count: clean(str(w.count)),
  };
  const empty = !working.asked && !working.objects.length && !working.events.length && !working.count;
  return empty ? undefined : working;
}

/**
 * The model's answer, checked: citations only to sources given (ids in the
 * text to unknown sources are removed), and no "certain" without a citation.
 */
export function parseAnswer(data: unknown, sources: Source[]): RulesAnswer {
  const d = rec(data);
  const known = new Set(sources.map((s) => s.id));
  const clean = (t: string) => t.replace(/\[([A-Z]\d+)\]/g, (m, id: string) => (known.has(id) ? m : '')).replace(/[ \t]{2,}/g, ' ');
  const verdict = clean(str(d.verdict));
  if (!verdict) throw new Error('The model gave no answer');
  const summary = clean(str(d.summary)) || clean(str(d.explanation));
  const working = parseWorking(d.working, clean);
  for (const c of working?.concepts ?? []) if (c.source && !known.has(c.source)) c.source = '';
  const everything = JSON.stringify({ verdict, summary, working });
  const cited = new Set([...everything.matchAll(/\[([A-Z]\d+)\]/g)].map((m) => m[1]));
  for (const c of working?.concepts ?? []) if (c.source) cited.add(c.source);
  const kindOf = new Map(sources.map((x) => [x.id, x.kind]));
  const listed: Citation[] = [];
  for (const c of list(d.citations, 20).map(rec)) {
    const id = str(c.id).replace(/[[\]]/g, '');
    if (!known.has(id) || listed.some((x) => x.id === id)) continue;
    listed.push({ id, role: c.role === 'key' ? 'key' : 'supporting', why: str(c.why) });
  }
  for (const id of cited) if (known.has(id) && !listed.some((c) => c.id === id)) listed.push({ id, role: 'supporting', why: '' });
  const citations = rankCitations(listed, kindOf);
  let confidence = CONFIDENCE.has(d.confidence as Confidence) ? d.confidence as Confidence : 'unsure';
  // Certain only on the word of an official ruling or rule that settles it.
  const settled = citations.some((c) => c.role === 'key' && ['ruling', 'rule', 'glossary'].includes(kindOf.get(c.id) ?? ''));
  if (!citations.length) confidence = 'unsure';
  else if (confidence === 'certain' && !settled) confidence = 'likely';
  const followUps = list(d.followUps, 3).map(str).filter(Boolean);
  const assumptions = list(d.assumptions, 6).map(str).filter(Boolean);
  const looseEnds = working ? findLooseEnds(working.events.map((e) => ({ event: `${e.what} ${e.board}`, checks: e.triggers }))) : [];
  if (looseEnds.length) confidence = 'unsure';
  return {
    ...(working ? { working } : {}),
    verdict, summary, confidence, citations, followUps,
    ...(assumptions.length ? { assumptions } : {}),
    ...(looseEnds.length ? { looseEnds } : {}),
  };
}

// --- the second check ------------------------------------------------------------

export const CHECK_SYSTEM = `\
You are a Level 3 Magic: The Gathering judge reviewing another judge's
answer before it is given to a player. You get the question, the SOURCES
(same ids as the answer cites), and the DRAFT answer with its working.

Check the working step by step, especially for what first drafts miss:
- an object not gathered (a token or copy), or what a copy has assumed
  rather than looked up;
- an event not walked - above all the automatic checks (state-based
  actions) between events;
- an object not scanned at an event - including objects leaving the
  battlefield in that same event, when a source says they look back;
- a wrong count, or a count that forgot the setup (players, who controls what);
- a claim the cited source does not support, or a better source not cited;
- an assumption not stated, or confidence too high ("certain" needs a key
  official ruling or rule that states the conclusion itself).

Return the corrected answer in full, in the same form and with the same
rules for citing (ids only from SOURCES), and in "changes" say in one
sentence what you changed and why - or "No changes" if the draft stands.`;

export const CHECK_SCHEMA = {
  ...ANSWER_SCHEMA,
  properties: { ...ANSWER_SCHEMA.properties, changes: { type: 'STRING' } },
  required: [...ANSWER_SCHEMA.required, 'changes'],
  propertyOrdering: ['changes', ...ANSWER_SCHEMA.propertyOrdering],
};

export function checkMessage(
  question: string, earlier: Earlier | null, sources: Source[], draft: RulesAnswer, clarifications: Array<{ question: string; answer: string }> = [],
): string {
  return `${answerMessage(question, earlier, sources, clarifications)}\n\nDRAFT ANSWER:\n${JSON.stringify(draft)}`;
}

/**
 * Gaps a working shows: an event where tokens leave the battlefield (die,
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
      out.push(`"${e.event.slice(0, 120)}": the tokens leaving the battlefield were not checked. Anything leaving at the same moment looks back in time and sees the others (and itself) leave - including token copies, which have the copied abilities (CR 603.10a, 707.2).`);
    }
  }
  return out;
}
