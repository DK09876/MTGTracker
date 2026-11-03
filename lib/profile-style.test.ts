/**
 * Themes, and decks that stay private until shown.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { themeVars } from './themes';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-style-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.resetModules();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe('themes', () => {
  it('takes the accent from the favourite commander, and falls back to gold without one', () => {
    expect(themeVars('commander', ['U', 'R'])).toMatchObject({ '--accent': '#5aa8e6', '--c1': '#5aa8e6', '--c2': '#ef6d4f' });
    expect(themeVars('commander', null)['--accent']).toBe('#d6aa2e');
    expect(themeVars('plains', null)['--background']).toBe('#f6f1e6');
  });
});

describe('profile style', () => {
  it('keeps decks private until shown, and remembers a look', async () => {
    const db = await import('./db');
    const style = await import('./profile-style');
    db.addProfile('dk', 'DK');
    const deck = db.createList('dk', 'Azula', '', { kind: 'deck', commander: null });
    expect(style.isPublic(deck.id)).toBe(false);
    expect(style.publicIds('dk').size).toBe(0);
    style.setPublic(deck.id, true);
    expect([...style.publicIds('dk')]).toEqual([deck.id]);
    expect(style.ownerOf(deck.id)).toBe('dk');

    expect(style.getStyle('dk')).toMatchObject({ theme: 'gold', motion: true, commander: null });
    style.setStyle('dk', { theme: 'island', motion: false });
    expect(style.getStyle('dk')).toMatchObject({ theme: 'island', motion: false });
  });
});
