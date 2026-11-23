/**
 * The agent context (lib/agent-context.ts) at the places every AI call passes: first in the system prompt, the
 * cards the owner named with [[ ]] looked up exactly and given to the model, and [[ ]] taken off name fields.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markedNames, plainNames } from './agent-context';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-agent-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const monument = { id: 'fm', oracle_id: 'o-fm', name: 'Forsaken Monument', type_line: 'Legendary Artifact', mana_cost: '{5}', oracle_text: 'Colorless creatures you control get +2/+2.', cmc: 5 } as ScryfallCard;

describe('the owner’s [[marks]] and the model’s', () => {
  it('reads the names marked in a text, once each', () => {
    expect(markedNames('Is [[Forsaken Monument]] good with [[Sol Ring]]? [[forsaken monument]] again')).toEqual(['Forsaken Monument', 'Sol Ring']);
  });

  it('takes [[ ]] off fields that hold only a name, and leaves sentences as written', () => {
    expect(plainNames({ groups: [{ group: 'ramp', cards: [{ name: '[[Sol Ring]]', why: 'Pairs with [[Forsaken Monument]].' }] }], out: ['[[Opt]]'] }))
      .toEqual({ groups: [{ group: 'ramp', cards: [{ name: 'Sol Ring', why: 'Pairs with [[Forsaken Monument]].' }] }], out: ['Opt'] });
  });
});

describe('every Claude tool-loop call', () => {
  it('puts the agent context first and gives the cards the owner named, exactly, on every step', async () => {
    (await import('./db')).storeCard(monument);
    const { AGENT_CONTEXT } = await import('./agent-context');
    const sent: Array<{ system: Array<{ text: string }>; messages: Anthropic.Beta.BetaMessageParam[] }> = [];
    const client = () => ({ beta: { messages: { stream: (p: never) => { sent.push(structuredClone(p)); return { finalMessage: async () => ({ content: [{ type: 'tool_use', id: 't', name: 'give_picks', input: { groups: [{ cards: [{ name: '[[Sol Ring]]', why: 'w' }] }] } }], stop_reason: 'tool_use', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 } }) }; } } } });
    const { claudeCall } = await import('./ai');
    const call = claudeCall('claude-opus-5-5', { profile: null, feature: 'finish' }, client as never);
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: 'Is [[Forsaken Monument]] worth a slot? And [[Monumentt]]?' }];
    const answer = await call({ model: 'x', max_tokens: 10, system: [{ type: 'text', text: 'FEATURE PROMPT' }], messages } as never, 'finish: first list');
    expect(sent[0].system.map((b) => b.text)).toEqual([AGENT_CONTEXT, 'FEATURE PROMPT']);
    const first = String(sent[0].messages[0].content);
    expect(first).toContain('## Cards the owner named');
    expect(first).toContain('- Forsaken Monument {5} - Legendary Artifact - Colorless creatures you control get +2/+2.');
    expect(first).toContain("- Monumentt: no card has this exact name. Say so; don't guess a similar card.");
    // The caller's own messages are never changed, and a name field comes back plain.
    expect(messages[0].content).toBe('Is [[Forsaken Monument]] worth a slot? And [[Monumentt]]?');
    expect((answer.content[0] as { input: { groups: Array<{ cards: Array<{ name: string }> }> } }).input.groups[0].cards[0].name).toBe('Sol Ring');
  });

  it('with MTG_AI_STUB=1 answers without calling Claude, and logs what it would have sent', async () => {
    vi.stubEnv('MTG_AI_STUB', '1');
    vi.stubEnv('MTG_AI_STUB_LOG', join(dir, 'stub.log'));
    const { claudeCall } = await import('./ai');
    const client = () => { throw new Error('Claude must not be called'); };
    const call = claudeCall('claude-opus-5-5', { profile: null, feature: 'finish' }, client as never);
    const tools = [{ name: 'search', input_schema: { type: 'object', properties: { query: { type: 'string' } } } }, { name: 'give_picks', input_schema: { type: 'object', properties: { reply: { type: 'string' } } } }];
    const first = await call({ model: 'x', max_tokens: 10, system: [], tools, messages: [{ role: 'user', content: 'pick' }] } as never, 'finish: first list');
    expect(first.content[0]).toMatchObject({ type: 'tool_use', name: 'search' });
    const { readFileSync } = await import('fs');
    expect(readFileSync(join(dir, 'stub.log'), 'utf8')).toContain('Writing for MTG Tracker');
  });

  it('gives the closest card for a misspelt [[name]], or the closest names to ask between', async () => {
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(join(dir, 'rules'), { recursive: true });
    writeFileSync(join(dir, 'rules', 'card-names.json'), JSON.stringify(['Inniaz, the Gale Force', 'Gale Force', 'Kratos, God of War', 'Kratos, Stoic Father', 'Forsaken Monument']));
    delete (globalThis as { __cardNames?: unknown }).__cardNames;
    const inniaz = { id: 'in', oracle_id: 'o-in', name: 'Inniaz, the Gale Force', type_line: 'Legendary Creature — Djinn', mana_cost: '{3}{U}{U}', oracle_text: 'Flying', cmc: 5 } as ScryfallCard;
    (await import('./db')).storeCard(inniaz);
    const { ownerCardsBlock } = await import('./agent-context');
    const block = await ownerCardsBlock(['Can I redirect [[Innaiz, the Gale Force]]? And [[Forsaken Monumnet]], [[Zzyzx Qwop]]']);
    expect(block).toContain('- Innaiz, the Gale Force: no card has this exact name. The closest is Inniaz, the Gale Force {3}{U}{U} - Legendary Creature — Djinn - Flying. Say which card you took it for.');
    expect(block).toContain("- Zzyzx Qwop: no card has this exact name. Say so; don't guess a similar card.");
    delete (globalThis as { __cardNames?: unknown }).__cardNames;
  });
});
