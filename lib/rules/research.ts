/**
 * Before a rules question is answered, a quick look at what it needs: the
 * rules concepts a judge would look up, whether a follow-up changes the
 * situation or only asks about the last answer, and whether the question
 * leaves open something the answer turns on - to ask the player rather than
 * guess.
 *
 * The concepts are words, not rule numbers: the app finds the rules for each
 * in the Comprehensive Rules (ask.ts). So what gets looked up follows from the
 * situation - copies of a legendary creature bring the legend rule - rather
 * than from a hand-written table of cards.
 *
 * Pure: the prompt, the schema and reading the reply.
 */

export type FollowUpKind = 'first' | 'about-earlier' | 'new-situation';

export interface Clarify {
  question: string;
  /** Short answers to pick from; the player may also write their own. */
  options: string[];
}

export interface Research {
  kind: FollowUpKind;
  concepts: string[];
  clarify: Clarify[];
}

export const RESEARCH_SYSTEM = `\
You prepare a Magic: The Gathering rules question for a judge who will
answer it. You get the question, the conversation so far (if any), any
answers the player already gave to clarifying questions, and the cards'
Oracle text. Return:

kind:
  "first" - there is no conversation yet.
  "about-earlier" - a follow-up about the previous answer that does not
    change the situation: why, which rule or ruling says so, explain a step.
  "new-situation" - a follow-up that changes or adds something (another
    card, a different board, more players) or asks something new.

concepts: 3 to 8 rules concepts a judge would look up to answer, in the
  words the Comprehensive Rules and its glossary use - "token", "copy of a
  permanent", "legend rule", "leaves-the-battlefield abilities",
  "simultaneous events", "put onto the battlefield attacking", "replacement
  effect", "layers", "timestamp", "intervening if clause", "commander tax".
  Think about what the situation CAUSES, not only what the cards say: copies
  of a legendary permanent meet the legend rule; creatures dying together
  raise what each one sees; a copied spell raises whether it was cast. No
  rule numbers. For "about-earlier", only concepts the earlier answer lacked.

clarify: questions for the player, ONLY when the question can be read two
  plausible ways that give DIFFERENT final answers, and nothing in it says
  which. Test each one: if every reading gives the same answer, do not ask.
  Never ask about - assume instead: how many players or opponents (a
  four-player Commander game); which opponent is attacked or defending;
  who controls the cards named (the player asking); choices the player
  makes (the best ones for them, and say so); details that do not change
  the answer.
  Worth asking: which of two permanents entered first when timestamps
  decide it; where a card was moved when that changes the result (hand or
  command zone); whose turn it is when the order of triggers decides who
  wins. At most two questions, each with two to four short answers to pick
  from. Never ask again what the player already answered. Usually this is
  empty.`;

export const RESEARCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['first', 'about-earlier', 'new-situation'] },
    concepts: { type: 'ARRAY', items: { type: 'STRING' } },
    clarify: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { question: { type: 'STRING' }, options: { type: 'ARRAY', items: { type: 'STRING' } } },
        required: ['question', 'options'],
        propertyOrdering: ['question', 'options'],
      },
    },
  },
  required: ['kind', 'concepts', 'clarify'],
  propertyOrdering: ['kind', 'concepts', 'clarify'],
};

export interface ResearchInput {
  question: string;
  /** Earlier turns, briefly: the question and the answer given. */
  earlier: Array<{ question: string; verdict: string }>;
  /** What the player already said when asked. */
  clarifications: Array<{ question: string; answer: string }>;
  /** Each card's name, type line and rules text. */
  oracle: string[];
}

export function researchMessage({ question, earlier, clarifications, oracle }: ResearchInput): string {
  const parts: string[] = [];
  if (earlier.length) parts.push(`CONVERSATION SO FAR:\n${earlier.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.verdict}`).join('\n')}`);
  parts.push(`QUESTION: ${question}`);
  if (clarifications.length) parts.push(`THE PLAYER ALREADY SAID:\n${clarifications.map((c) => `- ${c.question} ${c.answer}`).join('\n')}`);
  parts.push(`CARDS:\n${oracle.join('\n\n') || '(none named)'}`);
  return parts.join('\n\n');
}

const KINDS = new Set<FollowUpKind>(['first', 'about-earlier', 'new-situation']);

/**
 * Questions never worth asking, whatever the helper says: the answer assumes
 * these and says so. Told not to, the small model still asked "Which
 * opponent is the defending player?" and "Do you choose to create the
 * tokens?" about Syr Konrad, and "How many opponents?" about Teysa
 * (2026-09-30).
 */
const NEVER_ASK = [
  /\bhow many (players|opponents)\b/i,
  /\bnumber of (players|opponents)\b/i,
  /\b(which|what) (opponent|player)\b.*\b(defend|attack|target)/i,
  /\bdefending player\b/i,
  /\b(do|does|did|will|would) (you|i|the (controller|player|owner))\b.*\b(choose|want|decide|elect|opt)\b/i,
  /\b(you|i) (choose|decide) (to|whether)\b/i,
  /\bwho controls\b/i,
];

/** The reply, held to its limits; a follow-up is never "first", and a first question never a follow-up. */
export function parseResearch(data: unknown, isFollowUp: boolean, alreadyAsked: boolean): Research {
  const d = (data ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  let kind = KINDS.has(d.kind as FollowUpKind) ? d.kind as FollowUpKind : isFollowUp ? 'new-situation' : 'first';
  if (!isFollowUp) kind = 'first';
  else if (kind === 'first') kind = 'new-situation';
  const concepts = [...new Set((Array.isArray(d.concepts) ? d.concepts : []).map(str).map((c) => c.replace(/\b\d{3}(\.\d+[a-z]?)?\b/g, '').trim()).filter((c) => c.length > 2))].slice(0, 8);
  // Asked once already: answer now, with what was said and stated assumptions.
  const clarify = alreadyAsked ? [] : (Array.isArray(d.clarify) ? d.clarify : []).slice(0, 2).map((c) => {
    const x = (c ?? {}) as Record<string, unknown>;
    return { question: str(x.question), options: (Array.isArray(x.options) ? x.options : []).map(str).filter(Boolean).slice(0, 4) };
  }).filter((c) => c.question && !NEVER_ASK.some((r) => r.test(c.question)));
  return { kind, concepts, clarify };
}
