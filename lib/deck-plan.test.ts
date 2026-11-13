/**
 * A deck's plan: detected, then the owner's; confirmed before the AI steps.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-plan-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const lands = { name: 'Omnath', oracle_text: 'Landfall - Whenever a land you control enters, add {G}.' } as ScryfallCard;
const cards = Array.from({ length: 12 }, (_, i) => ({ card: { name: `Land ${i}`, oracle_text: 'Landfall - Whenever a land you control enters, you gain 1 life.' } as ScryfallCard, quantity: 1 }));

describe('the plan', () => {
  it('starts detected, and the owner\'s choices and ranges win', async () => {
    const db = await import('./db');
    const plan = await import('./deck-plan');
    db.addProfile('dk', 'DK');
    const deck = db.createList('dk', 'Omnath', '', { kind: 'deck' });
    let p = plan.planFor(deck.id, '', lands, cards);
    expect([p.style.id, p.confirmed, p.chosen.style]).toEqual(['landfall', false, false]);
    expect(p.targets.find((t) => t.role === 'ramp')).toMatchObject({ range: [12, 15], mine: false });

    plan.changePlan(deck.id, { style: 'spells' });
    // Picking the main style keeps the detected one as the second.
    expect(plan.planFor(deck.id, '', lands, cards).style2?.id).toBe('landfall');
    plan.changePlan(deck.id, { style2: '', targets: { ramp: [8, 9], wipe: [5, 1] } });
    p = plan.planFor(deck.id, '', lands, cards);
    expect([p.style.id, p.style2, p.chosen]).toEqual(['spells', null, { style: true, style2: true }]);
    expect(p.targets.find((t) => t.role === 'ramp')).toMatchObject({ range: [8, 9], styleRange: [8, 10], mine: true });
    // A backwards range is ignored.
    expect(p.targets.find((t) => t.role === 'wipe')?.mine).toBe(false);
    expect(plan.targetsFor(deck.id, lands, cards).draw).toEqual([12, 15]);

    plan.changePlan(deck.id, { style: null, targets: { ramp: null } });
    p = plan.planFor(deck.id, '', lands, cards);
    expect([p.style.id, p.targets.find((t) => t.role === 'ramp')?.mine]).toEqual(['landfall', false]);
  });

  it('is confirmed only when the owner confirms the plan (lib/plan-help.ts)', async () => {
    const db = await import('./db');
    const plan = await import('./deck-plan');
    const help = await import('./plan-help');
    db.addProfile('dk', 'DK');
    const old = db.createList('dk', 'Old', '', { kind: 'deck' });
    db.setTagBrief(old.id, 'Win with landfall.');
    const fresh = db.createList('dk', 'New', '', { kind: 'deck' });
    expect([plan.planConfirmed(old.id), plan.planConfirmed(fresh.id)]).toEqual([false, false]);
    // The old whole-plan confirm no longer counts.
    plan.changePlan(fresh.id, { confirm: true });
    expect(plan.planConfirmed(fresh.id)).toBe(false);
    await help.act({ id: fresh.id, commander: null }, 'dk', { action: 'confirm' });
    expect(plan.planConfirmed(fresh.id)).toBe(true);
  });

  it('drafts a first brief from the styles and how it wins', async () => {
    const plan = await import('./deck-plan');
    const styles = await import('./styles');
    expect(plan.draftFromCards(lands, styles.styleById('landfall')!, null, ['Craterhoof Behemoth']))
      .toBe('Omnath · Lands. Rewards land drops: extra lands, fetches and landfall payoffs. It wins with Craterhoof Behemoth.');
  });

  it('confirms part by part or all at once, and taking one back keeps the rest', async () => {
    const db = await import('./db');
    const plan = await import('./deck-plan');
    db.addProfile('dk', 'DK');
    const deck = db.createList('dk', 'Omnath', '', { kind: 'deck' });
    plan.changePlan(deck.id, { confirmPart: 'flip' });
    let p = plan.planFor(deck.id, '', lands, cards);
    expect([p.confirmed, p.confirmedParts.flip, p.confirmedParts.style]).toEqual([false, true, false]);
    // Changing a part makes it the owner's and confirms it.
    plan.changePlan(deck.id, { budget: 5 });
    p = plan.planFor(deck.id, '', lands, cards);
    expect([p.budget, p.stored.budget?.by, p.confirmedParts.budget]).toEqual([5, 'yours', true]);
    expect(plan.planProgress(deck.id)).toEqual({ done: 2, total: plan.PARTS.length });

    plan.changePlan(deck.id, { confirm: true });
    expect(plan.planFor(deck.id, '', lands, cards).confirmed).toBe(true);
    plan.changePlan(deck.id, { unconfirmPart: 'lands' });
    p = plan.planFor(deck.id, '', lands, cards);
    expect([p.confirmed, p.confirmedParts.lands, p.confirmedParts.style]).toEqual([false, false, true]);
    // Confirming the last part confirms the plan again.
    plan.changePlan(deck.id, { confirmPart: 'lands' });
    expect(plan.planFor(deck.id, '', lands, cards).confirmed).toBe(true);
  });

  it('treats a plan confirmed before parts existed as confirmed in every part', async () => {
    const db = await import('./db');
    db.addProfile('dk', 'DK');
    const deck = db.createList('dk', 'Old', '', { kind: 'deck' });
    // A row from before the new columns: only the old ones written.
    db.database().run(`CREATE TABLE IF NOT EXISTS deck_plans (listId TEXT PRIMARY KEY, style TEXT, style2 TEXT, targets TEXT NOT NULL DEFAULT '{}', draft TEXT NOT NULL DEFAULT '', confirmedAt TEXT, updatedAt TEXT NOT NULL)`);
    db.database().run(`INSERT INTO deck_plans (listId, style, style2, targets, draft, confirmedAt, updatedAt) VALUES (?, 'spells', NULL, '{"ramp":[9,10]}', '', '2026-11-01', '2026-11-01')`, [deck.id]);
    const plan = await import('./deck-plan');
    const p = plan.planFor(deck.id, 'Spells.', lands, cards);
    expect([p.confirmed, p.style.id, p.targets.find((t) => t.role === 'ramp')?.range]).toEqual([true, 'spells', [9, 10]]);
    expect(Object.values(p.confirmedParts).every(Boolean)).toBe(true);
  });

  it('layers changes to the usual rules: yours, then accepted overrides, then detected', async () => {
    const db = await import('./db');
    const plan = await import('./deck-plan');
    db.addProfile('dk', 'DK');
    const deck = db.createList('dk', 'Omnath', '', { kind: 'deck' });
    plan.changePlan(deck.id, { overrides: { add: { kind: 'range', target: 'draw', value: [6, 8], what: 'Card draw → 6–8', why: 'Draws off landfall.', affects: 'Cuts', by: 'claude' } } });
    plan.changePlan(deck.id, { overrides: { add: { kind: 'lands', target: 'lands', value: 40, what: 'Lands → 40', why: 'Landfall.', affects: 'Lands', by: 'claude' } } });
    plan.changePlan(deck.id, { overrides: { add: { kind: 'rule-off', target: 'curve', value: null, what: 'Curve off', why: 'Big deck.', affects: 'Cuts', by: 'claude' } } });
    let p = plan.planFor(deck.id, '', lands, cards);
    expect(p.targets.find((t) => t.role === 'draw')).toMatchObject({ range: [6, 8], source: 'override' });
    expect([p.lands, p.landsSource]).toEqual([[40, 40], 'claude']);
    expect(plan.effectiveCutSettings(deck.id).settings.rules.curve).toEqual({ on: false });
    // The owner's own range wins over the override.
    plan.changePlan(deck.id, { targets: { draw: [9, 9] } });
    p = plan.planFor(deck.id, '', lands, cards);
    expect(p.targets.find((t) => t.role === 'draw')).toMatchObject({ range: [9, 9], source: 'yours' });
    // Undo is switching it off.
    const id = p.overrides.find((o) => o.kind === 'lands')!.id;
    plan.changePlan(deck.id, { overrides: { toggle: { id, on: false } } });
    expect(plan.planFor(deck.id, '', lands, cards).landsSource).toBe('detected');
    // A bad override is ignored.
    plan.changePlan(deck.id, { overrides: { add: { kind: 'range', target: 'nonsense', value: [1, 2], what: '', why: '', affects: '', by: 'claude' } } });
    expect(plan.planFor(deck.id, '', lands, cards).overrides).toHaveLength(3);
  });

  it('moves protection with how much the deck leans on its commander', async () => {
    const db = await import('./db');
    const plan = await import('./deck-plan');
    db.addProfile('dk', 'DK');
    const deck = db.createList('dk', 'Omnath', '', { kind: 'deck' });
    expect(plan.planFor(deck.id, '', lands, cards).targets.find((t) => t.role === 'protection')?.range).toEqual([2, 3]);
    plan.saveSnapshot(deck.id, { lean: 'High' });
    expect(plan.planFor(deck.id, '', lands, cards).targets.find((t) => t.role === 'protection')?.range).toEqual([3, 5]);
    plan.changePlan(deck.id, { lean: 'Low' });
    expect(plan.planFor(deck.id, '', lands, cards).targets.find((t) => t.role === 'protection')?.range).toEqual([1, 2]);
  });
});

