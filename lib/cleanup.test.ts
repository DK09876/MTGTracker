/**
 * The weekly clean-up removes old logs and nothing people keep.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-clean-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

const call = { profileId: 'dk', feature: 'rules', label: 'q', step: 'answer', model: 'claude-opus-5-5', answeredBy: '', inputTokens: 1, outputTokens: 1, cost: 0.05, outcome: 'ok', detail: '' };

describe('cleanUp', () => {
  it('drops AI requests and acknowledged errors over a week old, keeping the rest', async () => {
    const db = await import('./db');
    const { recordError, acknowledge, listErrors } = await import('./errors');
    const { addRead, setSaved, readsFor } = await import('./reads');
    const { cleanUp } = await import('./cleanup');
    const now = Date.parse('2026-11-08T12:00:00Z');
    const old = new Date(now - 9 * 86400_000).toISOString();
    db.recordAiCall(call, old);
    db.recordAiCall(call, new Date(now - 2 * 86400_000).toISOString());

    const seen = recordError({ source: 'x', message: 'seen' });
    acknowledge('dk', seen.id);
    db.database().run('UPDATE app_errors SET at = ?', [old]);
    recordError({ source: 'y', message: 'still needs a look' });
    db.database().run('UPDATE app_errors SET at = ? WHERE ackAt IS NULL', [old]);

    const kept = addRead({ listId: 'l1', profileId: 'dk', mode: 'quick', model: null, winConditions: [], missing: '', brief: '', cards: [] });
    setSaved('l1', kept.id, true);
    db.database().run('UPDATE deck_reads SET at = ?', [old]);

    const removed = cleanUp(now);
    expect(removed['AI requests']).toBe(1);
    expect(db.aiCalls('2000-01-01')).toHaveLength(1);
    expect(removed['acknowledged errors']).toBe(1);
    // An error nobody has seen stays, however old.
    expect(listErrors(3650).map((e) => e.message)).toEqual(['still needs a look']);
    // A saved read is the owner's: kept.
    expect(readsFor('l1').saved.map((r) => r.id)).toEqual([kept.id]);
  });
});
