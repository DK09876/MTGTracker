/** Arrow keys and Enter in a pick-one list. */

import { describe, expect, it } from 'vitest';

import { enterPick, moveHighlight } from './picker-keys';

describe('moveHighlight', () => {
  it('starts at the top, moves and wraps', () => {
    expect(moveHighlight('ArrowDown', -1, 3)).toBe(0);
    expect(moveHighlight('ArrowDown', 2, 3)).toBe(0);
    expect(moveHighlight('ArrowUp', 0, 3)).toBe(2);
    expect(moveHighlight('ArrowUp', -1, 3)).toBe(2);
    expect(moveHighlight('End', 0, 3)).toBe(2);
  });
  it('has nothing to highlight in an empty list', () => {
    expect(moveHighlight('ArrowDown', 0, 0)).toBe(-1);
  });
});

describe('enterPick', () => {
  it('picks the highlighted row, or the top one', () => {
    expect(enterPick('azula', 'azula', 2, 4)).toBe(2);
    expect(enterPick('azula', 'azula', -1, 4)).toBe(0);
  });
  it('waits when the results are for an older search', () => {
    expect(enterPick('azula fi', 'azula', 0, 4)).toBeNull();
    expect(enterPick('azula', 'azula', 0, 0)).toBeNull();
  });
});
