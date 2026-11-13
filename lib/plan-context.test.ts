/**
 * The plan as later AI steps read it: the owner's notes go in, in their
 * words; notes Claude wrote in earlier reads stay out.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-plan-context-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe('notes in the plan text', () => {
  it('sends the owner’s notes and leaves Claude’s earlier notes out', async () => {
    const db = await import('./db');
    const plan = await import('./deck-plan');
    const { planText } = await import('./plan-context');
    const list = db.createList('dk', 'Deck', '', { kind: 'deck' });
    // As the reads route saves them, and as notes saved before `by` existed.
    plan.changePlan(list.id, { notes: { add: ['The easiest cuts are Divination and Opt.'], by: 'ai' } });
    plan.changePlan(list.id, { notes: { add: ['An old note with no author.'] } });
    plan.changePlan(list.id, { notes: { add: ['I never cut Hullbreaker Horror: it is my favourite.'], by: 'owner' } });
    const text = planText(plan.planFor(list.id, '', null, []), null);
    expect(text).toContain("The owner's notes on this deck, in their words:");
    expect(text).toContain('I never cut Hullbreaker Horror');
    expect(text).not.toContain('easiest cuts');
    expect(text).not.toContain('An old note');
  });

  it('treats a note with no author as Claude’s', async () => {
    const { noteBy } = await import('./deck-plan');
    expect(noteBy({ id: '1', text: 'x', at: '' })).toBe('ai');
    expect(noteBy({ id: '1', text: 'x', at: '', by: 'owner' })).toBe('owner');
  });
});
