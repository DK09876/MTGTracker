/**
 * A stand-in for every AI call, for trying the app in a browser without spending anything (AGENTS.md, "Testing
 * with a stubbed Claude"). On when MTG_AI_STUB=1; never on the Pi. It answers at the same three places every call
 * passes, after the agent context and the owner's cards are added, and writes each request it was sent to
 * data/ai-stub.log (MTG_AI_STUB_LOG to move it), so a test can read exactly what Claude would have read.
 *
 * Its answers are well-formed and name real cards as [[Card Name]], but say nothing useful: built from the
 * request's schema or tools. A tool loop searches once, then answers with the cards the search returned.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

export const stubbed = () => process.env.MTG_AI_STUB === '1';

const FALLBACK_CARDS = ['Sol Ring', 'Arcane Signet', 'Cultivate', 'Swords to Plowshares', 'Rhystic Study'];

function logRequest(where: string, request: unknown): void {
  try {
    const file = process.env.MTG_AI_STUB_LOG || join(process.cwd(), 'data', 'ai-stub.log');
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), where, request })}\n`);
  } catch { /* the log is a convenience */ }
}

/** Card names in tool results ("Name {1}{U} - Instant - text" lines), else in the request's [[marks]], else common staples. */
function cardsIn(text: string): string[] {
  const fromLines = text.split(/\\n|\n/).map((l) => l.split(' - ')[0].replace(/(\s*\{[^}]*\})+\s*$/, '').replace(/^[-•\s]+/, '').trim())
    .filter((n) => /^[A-Z][\w ,'’-]{2,60}$/.test(n) && /[a-z]/.test(n) && !/:$/.test(n) && n.split(' ').length <= 8);
  const marked = [...text.matchAll(/\[\[([^[\]]{1,80})\]\]/g)].map((m) => m[1]);
  const all = [...new Set([...fromLines, ...marked])];
  return all.length ? all : FALLBACK_CARDS;
}

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; items?: Schema; enum?: unknown[]; required?: string[]; minItems?: number; maxItems?: number; anyOf?: Schema[] };

/** A value that fits the schema, naming the given cards. */
function fake(schema: Schema | undefined, cards: string[], key = '', i = 0): unknown {
  if (!schema) return null;
  if (schema.anyOf?.length) return fake(schema.anyOf.find((s) => s.type !== 'null') ?? schema.anyOf[0], cards, key, i);
  if (schema.enum?.length) return schema.enum[0];
  // A field that may be empty stays empty: a stub never invents a commander or a card the owner didn't name.
  if ((schema as { nullable?: boolean }).nullable) return null;
  const type = (Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type)?.toLowerCase();
  const card = cards[i % cards.length];
  if (type === 'object' || schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, s], j) => [k, fake(s, cards, k, i + j)]));
  }
  if (type === 'array') {
    const n = Math.max(schema.minItems ?? 0, Math.min(schema.maxItems ?? 3, /name|card|pick|out/i.test(key) ? 3 : 2));
    return Array.from({ length: /^out$/i.test(key) ? 0 : n }, (_, j) => fake(schema.items, cards, key, i + j));
  }
  if (type === 'integer' || type === 'number') return 1;
  if (type === 'boolean') return false;
  if (/^(name|card|cardName|commander)$/i.test(key)) return card;
  if (/query/i.test(key)) return 'draw';
  return `Stub answer (no AI was called): [[${card}]] works with [[${cards[(i + 1) % cards.length]}]].`;
}

/** A JSON-call answer (lib/ai.ts modelById), built from the request's schema. */
export function stubJson(request: { system: string; user: string; schema?: unknown; step?: string }): unknown {
  logRequest(`json:${request.step ?? ''}`, request);
  return fake(request.schema as Schema, cardsIn(request.user));
}

/** A tool-loop answer (lib/ai.ts claudeCall): search once if it can, then answer with the final tool, or with text. */
export function stubMessage(params: { system?: unknown; messages: Anthropic.Beta.BetaMessageParam[]; tools?: unknown[] }, step: string): Anthropic.Beta.BetaMessage {
  logRequest(`tools:${step}`, params);
  const tools = (params.tools ?? []) as Array<{ name: string; input_schema: Schema }>;
  const last = params.messages.at(-1);
  const results = Array.isArray(last?.content) ? (last!.content as Array<{ type: string; content?: unknown }>).filter((b) => b.type === 'tool_result') : [];
  const search = tools.find((t) => /search/.test(t.name));
  const final = tools.find((t) => /^(give|propose|answer)/.test(t.name));
  const message = (content: unknown[], stop: string) => ({
    id: `stub-${Date.now()}`, type: 'message', role: 'assistant', model: 'stub', content, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }) as unknown as Anthropic.Beta.BetaMessage;
  if (search && !results.length && params.messages.length === 1) {
    return message([{ type: 'tool_use', id: `stub-search-${Date.now()}`, name: search.name, input: { query: 'draw' } }], 'tool_use');
  }
  const cards = cardsIn(JSON.stringify(results.length ? results : params.messages));
  if (final && final.name !== 'propose_changes') {
    return message([{ type: 'tool_use', id: `stub-final-${Date.now()}`, name: final.name, input: fake(final.input_schema, cards) }], 'tool_use');
  }
  return message([{ type: 'text', text: `**Stub answer** (no AI was called).\n\n- [[${cards[0]}]] is a good fit here.\n- [[${cards[1 % cards.length]}]] backs it up.` }], 'end_turn');
}
