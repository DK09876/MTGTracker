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

export interface RulesAnswer {
  /** One or two sentences that answer the question directly. */
  verdict: string;
  /** How it works, step by step, citing sources as [C1], [R2]. */
  explanation: string;
  confidence: Confidence;
  /** The sources cited, with what each shows. */
  citations: Array<{ id: string; why: string }>;
  /** Questions worth asking next. */
  followUps: string[];
}

export interface Turn {
  question: string;
  answer: RulesAnswer;
  sources: Source[];
  /** The cards this turn was about, by name. */
  cards: string[];
  model: string;
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
- C#: a rule from the Comprehensive Rules
- G#: a Comprehensive Rules glossary entry
- W#: an excerpt from the MTG Wiki (a fan wiki: good for explaining, not authoritative)

Rules for answering:
1. Answer from the SOURCES. Every rules claim cites the source it rests on,
   as [C2] or [R1][C4], right after the claim. Prefer official rulings (R)
   and the Comprehensive Rules (C, G) over the wiki (W).
2. Never cite an id that is not in SOURCES, and never quote rule numbers that
   are not in SOURCES.
3. If the sources do not settle the question, say what is missing, give
   your best reading as reasoning (uncited), and set confidence "unsure".
   Set "certain" only when an official ruling or rule says it outright,
   "likely" when it follows from them by clear steps.
4. verdict: the direct answer in one or two sentences. For a yes-or-no
   question start "Yes:", "No:" or "It depends:"; for "how does X work with
   Y", say what happens. No hedging filler.
5. explanation: short numbered steps of how the game handles it, in order,
   naming the cards; about 2-6 steps. Plain words; keep rules jargon to what
   the sources use.
6. If the question is ambiguous (which ability, whose turn), answer the
   usual case and say what changes otherwise.
7. followUps: up to three short, natural follow-up questions a player might
   ask next about these cards.`;

export const ANSWER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING' },
    explanation: { type: 'STRING' },
    confidence: { type: 'STRING', enum: ['certain', 'likely', 'unsure'] },
    citations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, why: { type: 'STRING' } },
        required: ['id', 'why'],
        propertyOrdering: ['id', 'why'],
      },
    },
    followUps: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['verdict', 'explanation', 'confidence', 'citations', 'followUps'],
  propertyOrdering: ['verdict', 'explanation', 'confidence', 'citations', 'followUps'],
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
  const citations = (Array.isArray(d.citations) ? d.citations : [])
    .map((c) => ({ id: str((c as { id?: unknown }).id), why: str((c as { why?: unknown }).why) }))
    .filter((c) => known.has(c.id));
  for (const id of cited) if (!citations.some((c) => c.id === id)) citations.push({ id, why: '' });
  let confidence = CONFIDENCE.has(d.confidence as Confidence) ? d.confidence as Confidence : 'unsure';
  if (!citations.length && confidence !== 'unsure') confidence = 'unsure';
  const followUps = (Array.isArray(d.followUps) ? d.followUps : []).map(str).filter(Boolean).slice(0, 3);
  return { verdict, explanation, confidence, citations, followUps };
}
