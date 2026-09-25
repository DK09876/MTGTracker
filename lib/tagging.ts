/**
 * The model's part in tagging a deck, in three steps:
 *
 *   propose - read the whole deck, the commander and the owner's brief, and
 *             suggest the tags this deck should be organised by, each with
 *             a precise test for what belongs. The owner edits and accepts.
 *   assign  - for a batch of cards, go through every accepted tag and apply
 *             each one the card meets, saying why from its rules text.
 *   audit   - for a few tags at a time, go through the whole deck again and
 *             find cards missed or wrongly included. Catches what a
 *             card-by-card pass misses: whether a card fits a tag is often
 *             only clear next to the other cards that carry it.
 *
 * Pure: building the messages and checking the answers. The route makes the
 * calls; everything here is tested without a network.
 *
 * Cards and tags are given short keys (c12, t3) rather than names. Asked to
 * echo a name back, a model will "correct" it; a key it cannot.
 */

import { oracleTextOf, typeLineOf, manaCostOf, type ScryfallCard } from './scryfall';
import { TAG_KINDS, type Tag, type TagKind } from './tags';

export interface DeckCard {
  key: string;
  card: ScryfallCard;
  quantity: number;
  commander?: boolean;
  /** Scryfall's roles for it, when known - ramp, draw... - as a hint, not a verdict. */
  roles?: string[];
}

export interface DeckContext {
  commander: ScryfallCard | null;
  cards: DeckCard[];
  brief: string;
}

/** A card's facts, as the model reads them. */
export function describeCard(c: DeckCard, ref: string): string {
  const { card } = c;
  const stats = [
    card.power !== undefined ? `${card.power}/${card.toughness}` : '',
    card.loyalty ? `loyalty ${card.loyalty}` : '',
  ].filter(Boolean).join(', ');
  const faces = card.card_faces?.some((f) => f.power !== undefined)
    ? card.card_faces.map((f) => (f.power !== undefined ? `${f.name} ${f.power}/${f.toughness}` : '')).filter(Boolean).join('; ')
    : '';
  const head = [
    `[${ref}]`,
    c.quantity > 1 ? `${c.quantity}x` : '',
    card.name,
    manaCostOf(card),
    `- ${typeLineOf(card)}`,
    stats || faces ? `(${stats || faces})` : '',
    c.commander ? '[COMMANDER]' : '',
  ].filter(Boolean).join(' ');
  const text = oracleTextOf(card).replace(/\n+/g, ' | ');
  const roles = c.roles?.length ? `\n  Scryfall roles: ${c.roles.join(', ')}` : '';
  return `${head}\n  ${text || '(no rules text)'}${roles}`;
}

function commanderBlock(commander: ScryfallCard | null): string {
  if (!commander) return 'The deck has no commander set.';
  return `Commander: ${commander.name} ${manaCostOf(commander)} - ${typeLineOf(commander)}\n${oracleTextOf(commander)}`;
}

function briefBlock(brief: string): string {
  return brief.trim()
    ? `The owner's brief - what they want this deck, or parts of it, to do. It outranks your own reading:\n"""\n${brief.trim()}\n"""`
    : 'The owner has not written a brief; read the plan from the cards.';
}

const tagLine = (t: Tag, ref: string) =>
  `[${ref}] ${t.name}${t.kind ? ` (${TAG_KINDS[t.kind]})` : ''}: ${t.description || '(no description - judge by the name)'}`;

// --- propose -------------------------------------------------------------

export interface ProposeInput extends DeckContext {
  /** Tags the owner already has - build around them, do not repeat them. */
  accepted: Tag[];
  /** Tags the owner turned down - do not suggest them again. */
  rejected: Tag[];
  /** This round's instructions: "split removal by what it hits", "more about the graveyard". */
  instructions: string;
}

export interface Proposal {
  name: string;
  description: string;
  kind: TagKind | null;
  examples: string[];
}

export const PROPOSE_SYSTEM = `\
You are an expert Magic: The Gathering Commander (EDH) deckbuilder. You are
organising one player's deck into tags: named categories, each with a precise
test for which cards belong. A card may carry several tags. The owner will
review your tags, edit them, and then every card will be tagged by them - by
you, reading your own descriptions - so a vague description produces bad
tagging.

Work carefully:
1. Read the commander's rules text and work out what it rewards.
2. Read every card in the deck, all of its text, every mode and every face.
   Note what each does in THIS deck with THIS commander, not in general.
3. Work out the deck's plan: how it develops, what it does in the midgame,
   and how it actually wins. Note the packages that work together.
4. Design the tags.

The tag set should:
- Cover the functional roles every Commander deck is judged by, as the deck
  actually uses them: ramp, card advantage, targeted removal, board wipes,
  protection, recursion, tutors, and lands that do more than make mana.
  Split a role when the deck has enough of it for the split to matter
  (e.g. creature removal vs. removal of artifacts and enchantments; mana
  rocks vs. land ramp) or when the owner asks.
- Name the deck's own plan and synergies, in this deck's terms: the enablers
  and the payoffs of each engine ("Sacrifice outlets", "Death-trigger
  payoffs", "Token makers", "Spells-cast triggers"), and the win conditions.
- Follow the owner's brief and instructions above all. When they name a part
  of the deck they want to work a certain way, give that part its own tags.
- Leave nothing out: every nonland card should fit at least one tag. A
  card that fits none is a sign a tag is missing.
- Avoid tags that would hold one card, unless it is a win condition or the
  owner asked for it, and avoid tags so broad they hold most of the deck.
- Aim for roughly 12 to 25 tags. More is fine for a complex deck.
- Not repeat a tag the owner already has, or suggest again one they turned
  down, under the same or a different name.

For each tag give:
- name: short, 1-4 words, Title Case.
- description: the test for membership, 1-3 sentences. Say what a card must
  do to belong, and name the edge cases: what does NOT count ("one-shot
  sacrifices from an enters trigger do not count - only repeatable outlets").
- kind: role (a job every deck needs), plan (how this deck develops and
  wins), synergy (an engine's enablers or payoffs), wincon (a way the game
  ends), or utility (lands and anything else).
- examples: the names of cards in this deck that belong, exactly as listed.
  Up to 8, the clearest ones first.

Also return overview: two to four sentences on what the deck does and how it
wins, as you read it, for the owner to check.`;

export function proposeMessage(input: ProposeInput): string {
  const lines = [
    commanderBlock(input.commander),
    '',
    briefBlock(input.brief),
  ];
  if (input.instructions.trim()) {
    lines.push('', `Instructions for this round of suggestions:\n"""\n${input.instructions.trim()}\n"""`);
  }
  if (input.accepted.length) {
    lines.push('', 'Tags the owner already has (keep building around these; do not repeat them):',
      ...input.accepted.map((t, i) => tagLine(t, `have${i + 1}`)));
  }
  if (input.rejected.length) {
    lines.push('', 'Tags the owner turned down (do not suggest these again):',
      ...input.rejected.map((t) => `- ${t.name}: ${t.description}`));
  }
  lines.push('', `The deck - ${input.cards.reduce((n, c) => n + c.quantity, 0)} cards:`,
    ...input.cards.map((c) => describeCard(c, c.key)));
  return lines.join('\n');
}

export const PROPOSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    overview: { type: 'STRING' },
    tags: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          description: { type: 'STRING' },
          kind: { type: 'STRING', enum: Object.keys(TAG_KINDS) },
          examples: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['name', 'description', 'kind', 'examples'],
        propertyOrdering: ['name', 'description', 'kind', 'examples'],
      },
    },
  },
  required: ['overview', 'tags'],
  propertyOrdering: ['overview', 'tags'],
};

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The usable proposals: named, not a repeat of a tag the owner has or
 * turned down, or of each other; examples kept only if they are in the deck.
 */
export function parseProposals(body: unknown, deck: DeckCard[], existing: Tag[]): { overview: string; tags: Proposal[] } {
  const raw = body as { overview?: unknown; tags?: unknown };
  const names = new Map<string, string>();
  for (const { card } of deck) {
    names.set(norm(card.name), card.name);
    names.set(norm(card.name.split(' // ')[0]), card.name);
  }
  const taken = new Set(existing.map((t) => norm(t.name)));
  const tags: Proposal[] = [];
  for (const item of Array.isArray(raw?.tags) ? raw.tags : []) {
    const t = item as Record<string, unknown>;
    const name = typeof t.name === 'string' ? t.name.trim().slice(0, 60) : '';
    if (!name || taken.has(norm(name))) continue;
    taken.add(norm(name));
    const kind = typeof t.kind === 'string' && t.kind in TAG_KINDS ? (t.kind as TagKind) : null;
    const examples = (Array.isArray(t.examples) ? t.examples : [])
      .map((e) => (typeof e === 'string' ? names.get(norm(e)) : undefined))
      .filter((e): e is string => !!e);
    tags.push({
      name,
      description: typeof t.description === 'string' ? t.description.trim().slice(0, 600) : '',
      kind,
      examples: [...new Set(examples)].slice(0, 8),
    });
  }
  return { overview: typeof raw?.overview === 'string' ? raw.overview.trim() : '', tags };
}

// --- assign --------------------------------------------------------------

export interface AssignInput extends DeckContext {
  tags: Tag[];
  /** The keys of the cards to tag this call; the rest of the deck is context. */
  batch: string[];
}

export interface Assignment {
  key: string;
  tagId: string;
  reason: string;
}

export const ASSIGN_SYSTEM = `\
You are an expert Magic: The Gathering Commander (EDH) deckbuilder, tagging
the cards of one player's deck by the tags the owner has chosen. Each tag has
a description that is the test for membership; apply it as written, and
where it names what does not count, respect that.

You are shown the commander, the owner's brief, the tags and the whole deck
for context, then asked to tag only some of the cards. For EACH of those
cards, be thorough:
- Read all of its rules text: every ability, every mode of a modal spell,
  both faces of a double-faced card, and any adventure, kicker or alternative
  cost. A card does everything it can do, not just its headline.
- Go through the tags ONE BY ONE and decide for each whether this card meets
  it. Most cards meet more than one: a creature that ramps and draws is both;
  a removal spell that also makes a token may feed a sacrifice engine.
- Judge by what the card does in this deck, with this commander and these
  other cards. A token maker is sacrifice fodder in a sacrifice deck; a
  land is a land, and only gets a role tag if it truly performs the role.
- Do not tag on a stretch. If a connection needs several unlikely steps, or
  the card only technically does something it will almost never do, leave it.
- It is fine for a card to fit no tag. Say so in note.

For each tag you apply, give a reason: one short sentence pointing at the
text that earns it ("Sacrifices a creature as a cost, repeatably").

Return every card you were asked to tag, by its key, even with no tags.`;

export function assignMessage(input: AssignInput): string {
  const refs = tagRefs(input.tags);
  const batch = new Set(input.batch);
  return [
    commanderBlock(input.commander),
    '',
    briefBlock(input.brief),
    '',
    'The tags:',
    ...input.tags.map((t) => tagLine(t, refs.get(t.id)!)),
    '',
    'The whole deck, for context:',
    ...input.cards.map((c) => `[${c.key}] ${c.card.name} - ${typeLineOf(c.card)}`),
    '',
    `Tag these ${batch.size} cards:`,
    ...input.cards.filter((c) => batch.has(c.key)).map((c) => describeCard(c, c.key)),
  ].join('\n');
}

export const ASSIGN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    cards: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          card: { type: 'STRING' },
          tags: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { tag: { type: 'STRING' }, reason: { type: 'STRING' } },
              required: ['tag', 'reason'],
              propertyOrdering: ['tag', 'reason'],
            },
          },
          note: { type: 'STRING' },
        },
        required: ['card', 'tags'],
        propertyOrdering: ['card', 'tags', 'note'],
      },
    },
  },
  required: ['cards'],
};

/** Tags are referred to as t1, t2... in the order given. */
export function tagRefs(tags: Tag[]): Map<string, string> {
  return new Map(tags.map((t, i) => [t.id, `t${i + 1}`]));
}

const byRef = (tags: Tag[]) => {
  const refs = tagRefs(tags);
  return new Map([...refs].map(([id, ref]) => [ref, id]));
};

/** Only assignments to a card in the batch and a tag that exists, each once. */
export function parseAssignments(body: unknown, tags: Tag[], batch: string[]): { assignments: Assignment[]; answered: string[] } {
  const tagOf = byRef(tags);
  const allowed = new Set(batch);
  const seen = new Set<string>();
  const answered = new Set<string>();
  const assignments: Assignment[] = [];
  for (const item of Array.isArray((body as { cards?: unknown })?.cards) ? (body as { cards: unknown[] }).cards : []) {
    const c = item as { card?: unknown; tags?: unknown };
    const key = typeof c.card === 'string' ? c.card.trim().replace(/^\[|\]$/g, '') : '';
    if (!allowed.has(key)) continue;
    answered.add(key);
    for (const t of Array.isArray(c.tags) ? c.tags : []) {
      const ref = typeof (t as { tag?: unknown }).tag === 'string' ? (t as { tag: string }).tag.trim().replace(/^\[|\]$/g, '') : '';
      const tagId = tagOf.get(ref);
      if (!tagId || seen.has(`${key}:${tagId}`)) continue;
      seen.add(`${key}:${tagId}`);
      const reason = (t as { reason?: unknown }).reason;
      assignments.push({ key, tagId, reason: typeof reason === 'string' ? reason.trim().slice(0, 300) : '' });
    }
  }
  return { assignments, answered: [...answered] };
}

// --- audit ---------------------------------------------------------------

export interface AuditInput extends DeckContext {
  /** Every accepted tag, so the model knows what else a card is already covered by. */
  tags: Tag[];
  /** The tags to check this call. */
  checking: string[];
  /** Who carries each tag now, and whether the owner set it by hand. */
  members: Map<string, Array<{ key: string; manual: boolean }>>;
}

export interface AuditChange {
  key: string;
  tagId: string;
  action: 'add' | 'remove';
  reason: string;
}

export const AUDIT_SYSTEM = `\
You are an expert Magic: The Gathering Commander (EDH) deckbuilder, checking
the tagging of one player's deck. Each tag has a description that is the test
for membership. You are shown the whole deck with every card's full text, and
for some of the tags, the cards that carry them now.

For EACH tag you are asked to check, go through the WHOLE deck card by card
and compare against the tag's description:
- A card that meets the test but is not tagged: add it.
- A card that is tagged but does not meet the test: remove it. Cards the
  owner tagged by hand are marked (owner) - never remove those.
Read each card's full text, every mode and face, and judge it in this deck
with this commander. Do not add on a stretch.

Return only the changes, each with a one-sentence reason from the card's
text. No changes is a fine answer when the tagging is right.`;

export function auditMessage(input: AuditInput): string {
  const refs = tagRefs(input.tags);
  const checking = input.tags.filter((t) => input.checking.includes(t.id));
  const names = new Map(input.cards.map((c) => [c.key, c.card.name]));
  return [
    commanderBlock(input.commander),
    '',
    briefBlock(input.brief),
    '',
    'All the tags (for context):',
    ...input.tags.map((t) => tagLine(t, refs.get(t.id)!)),
    '',
    'The whole deck:',
    ...input.cards.map((c) => describeCard(c, c.key)),
    '',
    'Check these tags. Carried by now:',
    ...checking.flatMap((t) => {
      const members = input.members.get(t.id) ?? [];
      return [
        tagLine(t, refs.get(t.id)!),
        members.length
          ? `  ${members.map((m) => `[${m.key}] ${names.get(m.key) ?? ''}${m.manual ? ' (owner)' : ''}`).join('; ')}`
          : '  (no cards yet)',
      ];
    }),
  ].join('\n');
}

export const AUDIT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    changes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tag: { type: 'STRING' },
          card: { type: 'STRING' },
          action: { type: 'STRING', enum: ['add', 'remove'] },
          reason: { type: 'STRING' },
        },
        required: ['tag', 'card', 'action', 'reason'],
        propertyOrdering: ['tag', 'card', 'action', 'reason'],
      },
    },
  },
  required: ['changes'],
};

/** Only changes to a tag being checked and a card in the deck; never removing an owner's tag. */
export function parseAudit(body: unknown, input: AuditInput): AuditChange[] {
  const tagOf = byRef(input.tags);
  const checking = new Set(input.checking);
  const keys = new Set(input.cards.map((c) => c.key));
  const out: AuditChange[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray((body as { changes?: unknown })?.changes) ? (body as { changes: unknown[] }).changes : []) {
    const c = item as Record<string, unknown>;
    const strip = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/^\[|\]$/g, '') : '');
    const tagId = tagOf.get(strip(c.tag));
    const key = strip(c.card);
    const action = c.action === 'add' || c.action === 'remove' ? c.action : null;
    if (!tagId || !checking.has(tagId) || !keys.has(key) || !action || seen.has(`${key}:${tagId}`)) continue;
    const member = input.members.get(tagId)?.find((m) => m.key === key);
    if (action === 'add' && member) continue;
    if (action === 'remove' && (!member || member.manual)) continue;
    seen.add(`${key}:${tagId}`);
    out.push({ key, tagId, action, reason: typeof c.reason === 'string' ? c.reason.trim().slice(0, 300) : '' });
  }
  return out;
}
