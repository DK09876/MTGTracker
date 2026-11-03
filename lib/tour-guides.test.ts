/**
 * Every part of a page a tour step points at is marked in the code, so a
 * renamed or removed marker fails here rather than in someone's tour.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

import { GUIDES } from './tour-guides';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx$/.test(f) ? [readFileSync(p, 'utf8')] : [];
  });
}

describe('tour guides', () => {
  const code = [...sources(join(process.cwd(), 'app')), ...sources(join(process.cwd(), 'components'))].join('\n');
  it('points only at marked parts of pages', () => {
    const missing: string[] = [];
    for (const g of GUIDES) {
      for (const step of g.steps) {
        for (const t of step.target?.split('|') ?? []) {
          if (!code.includes(`data-tour="${t}"`) && !code.includes(`'${t}'`) && !code.includes(`tour="${t}"`)) missing.push(`${g.id}: ${t}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('has help for every page it guides, and a guide per main page', () => {
    for (const path of ['/', '/rules', '/decks', '/lists/x', '/collection', '/settings', '/people']) {
      expect(GUIDES.find((g) => g.match(path))?.help.length, path).toBeGreaterThan(0);
    }
  });
});
