/**
 * Queries read back in English.
 *
 * The describer has to say what ran, not what was meant, so unknown terms
 * come back as written rather than being guessed at.
 */

import { describe, expect, it } from 'vitest';

import { colours, describeQuery, isUnfiltered } from './describe';

describe('describeQuery', () => {
  it.each([
    ['otag:ramp c:g -t:land usd<2', 'tagged ramp · green · not a land · under $2'],
    ['t:enchantment id<=ubr f:commander', 'type enchantment · fits a blue/black/red deck · legal in Commander'],
    ['(otag:draw or otag:card-advantage) mv<5 order:edhrec',
      'tagged draw or tagged card advantage · mana value under 5 · most played in Commander first'],
    ['!"Lightning Bolt"', 'named exactly “Lightning Bolt”'],
    ['-!"Fire Lord Azula"', 'not named exactly “Fire Lord Azula”'],
    ['t:creature c:u mv=2 o:"when ~ enters"', 'type creature · blue · mana value exactly 2 · text says “when ~ enters”'],
    ['is:commander t:goblin', 'can be a commander · type goblin'],
    ['date>=2026-01-01 c:izzet', 'released since 2026-01-01 · blue/red'],
    ['dragon', 'name contains “dragon”'],
    ['weird:thing', 'weird:thing'],
    // A /pattern/ is one term, spaces and brackets included.
    ['o:/sacrifice an? [^.:]*:/ id<=brg', 'text matches /sacrifice an? [^.:]*:/ · fits a black/red/green deck'],
    ['(o:/(land|creature)[^.]*:/ or otag:sacrifice-outlet) t:permanent',
      'text matches /(land|creature)[^.]*:/ or tagged sacrifice outlet · type permanent'],
    ['t:enchantment (o:copy or o:"whenever you cast") id<=ubr',
      'type enchantment · text says “copy” or text says “whenever you cast” · fits a blue/black/red deck'],
    ['((otag:draw or otag:card-advantage) mv<5) id<=ubr',
      'tagged draw or tagged card advantage · mana value under 5 · fits a blue/black/red deck'],
    ['(t:elf mv<2) or (t:goblin mv<2)', '(type elf and mana value under 2) or (type goblin and mana value under 2)'],
    ['t:instant or t:sorcery', 'type instant or type sorcery'],
  ])('%s', (query, expected) => {
    expect(describeQuery(query)).toBe(expected);
  });
});

describe('isUnfiltered', () => {
  it.each(['f:commander order:edhrec', 'id<=ubr f:commander', ''])('%s filters nothing', (q) => {
    expect(isUnfiltered(q)).toBe(true);
  });

  it.each(['otag:ramp f:commander', 't:elf', 'dragon', 'is:commander'])('%s filters', (q) => {
    expect(isUnfiltered(q)).toBe(false);
  });
});

describe('colours', () => {
  it('names letters and guilds', () => {
    expect(colours('UBR')).toBe('blue/black/red');
    expect(colours('izzet')).toBe('blue/red');
  });
});
