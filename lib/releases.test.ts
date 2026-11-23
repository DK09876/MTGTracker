/**
 * The release notes (lib/release-notes.ts) keep their shape, so the banner and the Releases page can trust them;
 * what each profile has seen; and the deploy history.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_VERSION, compareVersions, CURRENT, isNextVersion, RELEASES, releaseDate, toAnnounce, UNRELEASED, unseen, type Release, type ReleaseItem } from './releases';

function checkItem(item: ReleaseItem, where: string) {
  expect(item.title.length, `${where}: "${item.title}"`).toBeLessThanOrEqual(70);
  expect(item.title, `${where}: "${item.title}"`).not.toMatch(/\.$/);
  expect(item.details.trim().length, `${where}: "${item.title}"`).toBeGreaterThan(0);
  expect(item.details.length, `${where}: "${item.title}"`).toBeLessThanOrEqual(400);
}

describe('the release notes', () => {
  it('are newest first, each version once, each a step up from the one before', () => {
    const versions = RELEASES.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let i = 1; i < RELEASES.length; i++) {
      expect(isNextVersion(RELEASES[i].version, RELEASES[i - 1].version), `${RELEASES[i - 1].version} is not one step up from ${RELEASES[i].version}`).toBe(true);
      expect(RELEASES[i - 1].date >= RELEASES[i].date, `${RELEASES[i - 1].version} is dated before ${RELEASES[i].version}`).toBe(true);
    }
    expect(APP_VERSION).toBe(CURRENT.version);
    expect(RELEASES.at(-1)?.version).toBe('1.0.0');
  });

  it('have the shape the banner and the page need', () => {
    for (const r of RELEASES) {
      const where = `v${r.version}`;
      expect(r.version, where).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date, where).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(r.date)), where).toBe(false);
      expect(r.title.trim().length, where).toBeGreaterThan(0);
      expect(r.title, where).not.toMatch(/\.$/);
      expect(r.items.length, where).toBeGreaterThanOrEqual(1);
      expect(r.items.length, where).toBeLessThanOrEqual(8);
      for (const item of r.items) checkItem(item, where);
    }
  });

  it('have unreleased notes in the same shape, oldest first, each new or a fix', () => {
    for (let i = 0; i < UNRELEASED.length; i++) {
      const item = UNRELEASED[i];
      const where = `unreleased: "${item.title}"`;
      expect(['new', 'fix'], where).toContain(item.kind);
      expect(item.date, where).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.date >= CURRENT.date, `${where} is dated before v${CURRENT.version}`).toBe(true);
      if (i > 0) expect(item.date >= UNRELEASED[i - 1].date, `${where} is out of order: oldest first`).toBe(true);
      checkItem(item, where);
    }
  });

  it('speak to the person using the app, not to developers', () => {
    const words = /\b(PR|pull request|handoff|refactor|endpoint|migration|tool loop|lib\/|components\/|\.tsx?)\b|!/i;
    for (const r of RELEASES) {
      for (const text of [r.title, ...r.items.flatMap((i) => [i.title, i.details])]) expect(text, `v${r.version}`).not.toMatch(words);
    }
    for (const i of UNRELEASED) for (const text of [i.title, i.details]) expect(text, 'unreleased').not.toMatch(words);
  });
});

describe('compareVersions', () => {
  it('compares each part as a number', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
  });
});

describe('isNextVersion', () => {
  it('is a fix, something new, or a new major: one step, nothing skipped', () => {
    expect(isNextVersion('1.4.0', '1.4.1')).toBe(true);
    expect(isNextVersion('1.4.2', '1.5.0')).toBe(true);
    expect(isNextVersion('1.4.2', '2.0.0')).toBe(true);
    expect(isNextVersion('1.4.0', '1.6.0')).toBe(false);
    expect(isNextVersion('1.4.2', '1.5.2')).toBe(false);
    expect(isNextVersion('1.4.0', '1.4.0')).toBe(false);
  });
});

describe('unseen and toAnnounce', () => {
  const r = (version: string): Release => ({ version, date: '2026-01-01', title: version, items: [{ title: 'x', details: 'y' }] });
  const list = [r('1.3.1'), r('1.3.0'), r('1.2.1'), r('1.2.0'), r('1.1.0')];
  const v = (rs: Release[]) => rs.map((x) => x.version);

  it('is every release newer than the one seen, newest first', () => {
    expect(v(unseen('1.2.0', list))).toEqual(['1.3.1', '1.3.0', '1.2.1']);
    expect(unseen('1.3.1', list)).toEqual([]);
  });
  it('is only up to the newest new thing when nothing has been seen: not the whole history', () => {
    expect(v(unseen(null, list))).toEqual(['1.3.1', '1.3.0']);
  });
  it('announces what is new, with the fixes beside it', () => {
    expect(v(toAnnounce('1.2.0', list).news)).toEqual(['1.3.0']);
    expect(v(toAnnounce('1.2.0', list).fixes)).toEqual(['1.3.1', '1.2.1']);
  });
  it('announces nothing when only fixes are unseen: they are quiet', () => {
    expect(toAnnounce('1.3.0', list).news).toEqual([]);
    expect(v(toAnnounce('1.3.0', list).fixes)).toEqual(['1.3.1']);
  });
});

describe('releaseDate', () => {
  it('reads the same wherever it is opened', () => {
    expect(releaseDate('2026-11-18')).toBe('18 Nov 2026');
    expect(releaseDate('2026-01-02')).toBe('2 Jan 2026');
  });
});

describe('on the server', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-releases-'));
    vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('remembers what each profile has seen, and never goes backwards', async () => {
    const s = await import('./releases-server');
    const [newest, older] = RELEASES;
    expect(s.seenVersion('dk')).toBeNull();
    expect(s.markSeen('dk', older.version)).toBe(older.version);
    expect(s.markSeen('dk', newest.version)).toBe(newest.version);
    expect(s.markSeen('dk', older.version)).toBe(newest.version);
    expect(s.seenVersion('kevin')).toBeNull();
    // A version this build doesn't know counts as this build's.
    expect(s.markSeen('kevin', '99.0.0')).toBe(APP_VERSION);
  });

  it('writes a deploy down once per build, a rollback included, and never for development', async () => {
    const s = await import('./releases-server');
    expect(s.recordDeploy('dev', '1.0.0')).toBe(false);
    expect(s.recordDeploy('aaa', '1.1.0', new Date('2026-11-01T10:00:00Z'))).toBe(true);
    expect(s.recordDeploy('aaa', '1.1.0')).toBe(false);
    expect(s.recordDeploy('bbb', '1.2.0', new Date('2026-11-02T10:00:00Z'))).toBe(true);
    expect(s.recordDeploy('aaa', '1.1.0', new Date('2026-11-03T10:00:00Z'))).toBe(true);
    expect(s.deploys().map((d) => d.build)).toEqual(['aaa', 'bbb', 'aaa']);
    expect(s.deploys()[1]).toEqual({ build: 'bbb', version: '1.2.0', at: '2026-11-02T10:00:00.000Z' });
  });
});
