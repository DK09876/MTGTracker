import { describe, expect, it } from 'vitest';

import { parseResearch, researchMessage } from './research';

describe('parseResearch', () => {
  it('keeps concepts as words, without rule numbers, and at most two questions', () => {
    const r = parseResearch({
      kind: 'first',
      concepts: ['legend rule 704.5j', 'legend rule', 'copy', 'x'],
      clarify: [{ question: 'Whose turn?', options: ['Mine', 'Theirs', 'a', 'b', 'c'] }, { question: 'Which first?', options: [] }, { question: 'Third?', options: [] }],
    }, false, false);
    expect(r.concepts).toEqual(['legend rule', 'copy']);
    expect(r.clarify).toHaveLength(2);
    expect(r.clarify[0].options).toHaveLength(4);
  });

  it('never asks twice, and holds the kind to whether it is a follow-up', () => {
    expect(parseResearch({ kind: 'about-earlier', concepts: [], clarify: [{ question: 'Whose turn?', options: [] }] }, false, true))
      .toEqual({ kind: 'first', concepts: [], clarify: [] });
    expect(parseResearch({ kind: 'first' }, true, false).kind).toBe('new-situation');
    expect(parseResearch({ kind: 'about-earlier' }, true, false).kind).toBe('about-earlier');
  });

  it('tells the helper what the player already said', () => {
    expect(researchMessage({ question: 'q', earlier: [], clarifications: [{ question: 'Whose turn?', answer: 'Mine' }], oracle: [] }))
      .toContain('THE PLAYER ALREADY SAID:\n- Whose turn? Mine');
  });
});
