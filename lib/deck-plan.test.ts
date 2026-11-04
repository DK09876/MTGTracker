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

    plan.changePlan(deck.id, { style: 'spells', style2: '', targets: { ramp: [8, 9], wipe: [5, 1] } });
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

  it('is confirmed by confirming, or by a brief written before plans existed', async () => {
    const db = await import('./db');
    const plan = await import('./deck-plan');
    db.addProfile('dk', 'DK');
    const old = db.createList('dk', 'Old', '', { kind: 'deck' });
    db.setTagBrief(old.id, 'Win with landfall.');
    const fresh = db.createList('dk', 'New', '', { kind: 'deck' });
    expect([plan.planConfirmed(old.id), plan.planConfirmed(fresh.id)]).toEqual([true, false]);
    plan.changePlan(fresh.id, { style: 'landfall' });
    expect(plan.planConfirmed(fresh.id)).toBe(false);
    plan.changePlan(fresh.id, { confirm: true });
    expect(plan.planConfirmed(fresh.id)).toBe(true);
  });

  it('drafts a first brief from the styles and how it wins', async () => {
    const plan = await import('./deck-plan');
    const styles = await import('./styles');
    expect(plan.draftFromCards(lands, styles.styleById('landfall')!, null, ['Craterhoof Behemoth']))
      .toBe('Omnath · Lands. Rewards land drops: extra lands, fetches and landfall payoffs. It wins with Craterhoof Behemoth.');
  });
});
