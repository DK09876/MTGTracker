/**
 * Roles worked out from Scryfall's tag file, the way its search would.
 */

import { describe, expect, it } from 'vitest';

import { rolesFromTags } from './card-store';
import { tagSets } from './roles';

async function* rows(tags: Array<Record<string, unknown>>) { for (const t of tags) yield t; }
const tag = (id: string, slug: string, cards: string[], extra: Record<string, unknown> = {}) =>
  ({ id, slug, aliases: [], child_ids: [], taggings: cards.map((oracle_id) => ({ oracle_id })), ...extra });

describe('tagSets', () => {
  it('reads a role search as tags to have and tags to lack', () => {
    expect(tagSets('otag:card-advantage -otag:cantrip -t:land')).toEqual({ any: ['card-advantage'], none: ['cantrip'] });
    expect(tagSets('(otag:protection or otag:fog) -t:land')).toEqual({ any: ['protection', 'fog'], none: [] });
  });
});

describe('rolesFromTags', () => {
  it('follows child tags and aliases, and leaves out excluded tags', async () => {
    const roles = await rolesFromTags(rows([
      tag('p', 'protection', [], { child_ids: ['h'] }),
      tag('h', 'hexproof-granter', ['boots']),
      tag('s', 'sweeper', ['wrath'], { aliases: ['boardwipe'] }),
      tag('ca', 'card-advantage', ['rhystic', 'opt']),
      tag('c', 'cantrip', ['opt']),
    ]));
    expect(roles.get('boots')).toContain('protection');
    expect(roles.get('wrath')).toContain('wipe');
    expect(roles.get('rhystic')).toContain('draw');
    // A cantrip is not card advantage.
    expect(roles.get('opt')).toEqual(['cantrip']);
  });
});
