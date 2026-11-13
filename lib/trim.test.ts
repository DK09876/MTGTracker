/**
 * Trim with a stand-in model (no paid call): what the cut list keeps from an
 * answer, the guards code applies whatever the model says, the owner's
 * choices and reasons carried into a rerun and remembered for the deck,
 * apply and undo, and what reaches the suggestion log. Each test has its own
 * database.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsonModel, JsonRequest } from './ai';
import type { ScryfallCard } from './scryfall';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mtg-trim-'));
  vi.stubEnv('MTG_DB_PATH', join(dir, 'mtg.db'));
  vi.stubEnv('MTG_CARDS_DB_PATH', join(dir, 'cards.db'));
  // Scryfall and Commander Spellbook can't be reached: the facts still build.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const card = (name: string, over: Partial<ScryfallCard> = {}) =>
  ({ id: name, oracle_id: `o-${name}`, name, type_line: 'Instant', cmc: 2, oracle_text: `${name} does a thing.`, color_identity: [], legalities: { commander: 'legal' }, ...over }) as ScryfallCard;
const commander = card('Azula, Fire Lord', { type_line: 'Legendary Creature — Human Noble', cmc: 5, oracle_text: 'Whenever you cast a spell while Azula is attacking, copy it.' });
const island = card('Island', { type_line: 'Basic Land — Island', cmc: 0, oracle_text: '' });

/** A deck 8 over: the commander, 37 Islands and 70 spells. */
async function deck() {
  const db = await import('./db');
  db.addProfile('dk', 'DK');
  const list = db.createList('dk', 'Azula', '', { kind: 'deck', commander });
  db.addCardToList(list.id, island, 37);
  for (let i = 1; i <= 70; i++) db.addCardToList(list.id, card(`Spell ${i}`));
  const { ROLES_VERSION } = await import('./roles');
  const ids = (db.database().all('SELECT data FROM cards') as Array<{ data: string }>).map((r) => (JSON.parse(r.data) as ScryfallCard).oracle_id!).filter(Boolean);
  db.saveRoles(new Map([...new Set([...ids, commander.oracle_id!])].map((id) => [id, []] as [string, string[]])), ROLES_VERSION);
  return { db, list: db.getList(list.id, 'dk')! };
}

function fakeModel(answer: (req: JsonRequest) => unknown) {
  const asked: JsonRequest[] = [];
  const model: JsonModel = async (req) => { asked.push(req); return { data: answer(req), model: 'claude-opus-5-5' }; };
  return { model, asked };
}

const ranked = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ name: `Spell ${from + i}`, why: `Spell ${from + i} is surplus.`, with: i === 0 ? ['Spell 60', 'Not A Card'] : [] }));
/** 16 ranked (8 over, 8 closer calls), with a commander, an unknown name and a repeat mixed in. */
const ANSWER = {
  ranked: [{ name: 'Azula, Fire Lord', why: 'no', with: [] }, { name: 'Nope', why: 'no', with: [] }, ...ranked(1, 8), { name: 'spell 1', why: 'again', with: [] }, ...ranked(9, 8)],
  keep: [{ name: 'Spell 40', why: 'Half of the main loop.' }, { name: 'Spell 2', why: 'already listed' }],
  notes: 'Mostly surplus spells.',
};

describe('trim', { timeout: 60_000 }, () => {
  it('keeps the ranked list to cards in the deck: the first N are the cuts, the rest closer calls', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    const { model, asked } = fakeModel(() => ANSWER);
    await trim.setApproach(list, 'dk', { text: 'Cut the weakest spells first.\nKeep Spell 70.' });
    await trim.runTrim(model, list, 'dk', { model: 'opus' });
    const v = await trim.trimView(list, 'dk');
    expect(v.size).toBe(108);
    expect(v.over).toBe(8);
    expect(v.run!.items.filter((i) => i.tier === 'cut').map((i) => i.name)).toEqual(ranked(1, 8).map((r) => r.name));
    expect(v.run!.items.filter((i) => i.tier === 'maybe')).toHaveLength(8);
    // A card Claude left in on purpose; one it also ranked is not repeated there.
    expect(v.run!.items.filter((i) => i.tier === 'kept').map((i) => i.name)).toEqual(['Spell 40']);
    expect(v.run!.items[0].with).toEqual(['Spell 60']);
    // The cuts are chosen from the start, and the numbers follow them.
    expect(v.impact.size).toEqual({ before: 108, after: 100 });
    // One call, with the count (one card more than wanted) and the box; the big answer is read leniently.
    expect(asked).toHaveLength(1);
    expect(asked[0].promptOnly).toBe(true);
    expect(asked[0].user).toContain('It is 8 over');
    expect(asked[0].user).toContain('Rank exactly 17 cards');
    expect(asked[0].user).toContain("## What matters for these cuts (the owner's own words)");
    expect(asked[0].user).toContain('Cut the weakest spells first.\nKeep Spell 70.');
    expect(asked[0].user).not.toContain('This cut session so far');
    // The first list has notes, and the session has begun with the box.
    expect(v.run!.notes).toBe('Mostly surplus spells.');
    expect(v.turns.map((t) => t.kind)).toEqual(['owner-start', 'claude-list']);
    expect(asked[0].user).toContain('**Spell 1**');
  });

  it('fails a list too short to make the cuts, and stores nothing', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await expect(trim.runTrim(fakeModel(() => ({ ranked: ranked(1, 5), keep: [], notes: '' })).model, list, 'dk', { model: 'opus' })).rejects.toThrow(/5 usable cards for 8 cuts/);
    expect((await trim.trimView(list, 'dk')).run).toBeNull();
  });

  it('never lists a ★ card, whatever the model says', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    (await import('./deck-roles')).setKeep(list.id, 'o-Spell 1', true);
    const { asked, model } = fakeModel(() => ANSWER);
    await trim.runTrim(model, list, 'dk', { model: 'opus' });
    const v = await trim.trimView(list, 'dk');
    expect(v.run!.items.some((i) => i.name === 'Spell 1')).toBe(false);
    expect(v.run!.items.filter((i) => i.tier === 'cut')).toHaveLength(8);
    expect(asked[0].user).toContain('Spell 1 (★ never cut)');
  });

  it('a rerun takes the owner’s choices as settled, keeps the approach, and remembers the reasons', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await trim.setApproach(list, 'dk', { text: 'My approach.' });
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus' });
    // Keep one of the cuts as a pet card, and cut one of the closer calls with a reason.
    trim.setChoices(list.id, { 'Spell 3': { choice: 'keep', chip: 'pet_card' }, 'Spell 12': { choice: 'cut', text: 'never cast it' }, 'Not Listed': { choice: 'cut' } });
    let v = await trim.trimView(list, 'dk');
    expect(Object.keys(v.choices).sort()).toEqual(['Spell 12', 'Spell 3']);
    expect(v.impact.size.after).toBe(100);
    // The model lists the kept card again anyway: code leaves it out.
    const { model, asked } = fakeModel(() => ANSWER);
    await trim.runTrim(model, list, 'dk', { model: 'opus', rerun: true });
    expect(asked[0].user).toContain('Owner: kept Spell 3 ("a pet card"); confirmed cuts: Spell 12 ("never cast it")');
    expect(asked[0].user).toContain('Owner, at the start: "My approach."');
    v = await trim.trimView(list, 'dk');
    expect(v.approach!.text).toBe('My approach.');
    expect(v.run!.round).toBe(2);
    const cuts = v.run!.items.filter((i) => i.tier === 'cut').map((i) => i.name);
    expect(cuts[0]).toBe('Spell 12');
    expect(cuts).not.toContain('Spell 3');
    expect(cuts).toHaveLength(8);
    expect(v.run!.items.find((i) => i.name === 'Spell 3')!.tier).toBe('yours');
    // The cut the owner chose keeps its reason; the kept card is remembered and ★ kept as a pet card.
    expect(v.choices['Spell 12']).toMatchObject({ choice: 'cut', text: 'never cast it' });
    expect(trim.trimStore(list.id).said['Spell 3']).toMatchObject({ choice: 'keep', chip: 'pet_card' });
    expect((await import('./deck-roles')).keeps(list.id).has('o-Spell 3')).toBe(true);
    // A later fresh list is told what was kept before.
    const later = fakeModel(() => ({ ...ANSWER, ranked: ranked(20, 16) }));
    await trim.runTrim(later.model, list, 'dk', { model: 'opus' });
    expect(later.asked[0].user).toContain('Kept so far (the owner can take one back):');
    expect(later.asked[0].user).toContain('- Spell 3 ("a pet card")');
  });

  it('applies the chosen cuts to exactly 100, with a done screen that can be undone', async () => {
    const { db, list } = await deck();
    const trim = await import('./trim');
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus' });
    // Two closer calls chosen on top of the eight: ten is past 100, so only eight go.
    trim.setChoices(list.id, { 'Spell 9': { choice: 'cut' }, 'Spell 10': { choice: 'cut' } });
    const done = await trim.applyTrim(list, 'dk');
    expect(done.cut).toBe(8);
    expect(done.size).toBe(100);
    const main = () => db.cardsInList(list.id).filter((c) => c.board === 'main');
    expect(main().some((c) => c.card.name === 'Spell 1')).toBe(false);
    expect(db.cardsInList(list.id).find((c) => c.card.name === 'Spell 1')!.board).not.toBe('main');
    let v = await trim.trimView(db.getList(list.id, 'dk')!, 'dk');
    expect(v.over).toBe(0);
    expect(v.done!.logged).toMatchObject({ accepted: 8, refused: 0 });
    // What was shown, and what became of it.
    const events = db.database().all(`SELECT e.itemKey, e.preselected, e.task, e.method, o.outcome FROM suggestion_events e LEFT JOIN suggestion_outcomes o ON o.eventId = e.id`) as Array<{ itemKey: string; preselected: number; task: string; method: string; outcome: string | null }>;
    expect(events).toHaveLength(16);
    expect(events.every((e) => e.task === 'trim' && e.method === 'ai')).toBe(true);
    expect(events.filter((e) => e.preselected)).toHaveLength(8);
    expect(events.filter((e) => e.outcome === 'accepted')).toHaveLength(8);
    expect(events.filter((e) => e.outcome === 'ignored')).toHaveLength(8);
    trim.undoTrim(db.getList(list.id, 'dk')!);
    expect(main().some((c) => c.card.name === 'Spell 1')).toBe(true);
    v = await trim.trimView(db.getList(list.id, 'dk')!, 'dk');
    expect(v.over).toBe(8);
    expect(v.done).toBeNull();
    expect(v.run!.items.filter((i) => i.tier === 'cut')).toHaveLength(8);
  });

  it('drafts an approach from the deck’s numbers without a model', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await trim.setApproach(list, 'dk', { draft: true });
    const v = await trim.trimView(list, 'dk');
    expect(v.approach!.by).toBe('code');
    expect(v.approach!.text).toContain('- Cut 8 to reach 100.');
    expect(v.approach!.text).toContain('Lands: 37');
    expect(v.approach!.text).toContain('Never offered: the commander');
    // Editing it makes it the owner's.
    await trim.setApproach(list, 'dk', { text: 'Mine now.' });
    expect((await trim.trimView(list, 'dk')).approach).toMatchObject({ by: 'owner', text: 'Mine now.' });
  });

  it('writes Claude’s approach as bullets', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    const { model, asked } = fakeModel(() => ({ bullets: ['Trim the surplus spells.', '- Keep the loop.'] }));
    const a = await trim.writeApproach(model, list, 'dk');
    expect(a).toMatchObject({ by: 'claude', text: '- Trim the surplus spells.\n- Keep the loop.' });
    expect(asked[0].user).toContain('8 to cut');
    await expect(trim.writeApproach(fakeModel(() => ({ bullets: [] })).model, list, 'dk')).rejects.toThrow(/empty/);
  });

  it('sends the whole session in order: the start, list 1, the owner’s keeps with reasons and message, list 2', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await trim.setApproach(list, 'dk', { text: 'Keep my mana dorks.' });
    let n = 0;
    const replies = [
      { ...ANSWER, notes: 'Cut surplus spells.' },
      { ranked: ranked(1, 2).concat(ranked(5, 15)), keep: [], reply: 'I kept Spell 3 and Spell 4, and treated Spell 5 the same way.', ask: 'Is Spell 9 part of the combo?' },
      { ranked: ranked(1, 17), keep: [], reply: 'Nothing new.', ask: '' },
    ];
    const { model, asked } = fakeModel(() => replies[n++]);
    await trim.runTrim(model, list, 'dk', { model: 'opus' });
    trim.setChoices(list.id, { 'Spell 3': { choice: 'keep', chip: 'part_of_plan', text: 'I need it on turn 3' }, 'Spell 4': { choice: 'keep' } });
    await trim.runTrim(model, list, 'dk', { model: 'opus', rerun: true, message: 'Why is Spell 1 first?' });
    const second = asked[1].user;
    const at = (s: string) => { const i = second.indexOf(s); expect([s, i >= 0]).toEqual([s, true]); return i; };
    const order = [
      at('## This cut session so far'),
      at('Owner, at the start: "Keep my mana dorks."'),
      at(`You, list 1: cuts: ${ranked(1, 8).map((r) => r.name).join('; ')} | closer calls: ${ranked(9, 8).map((r) => r.name).join('; ')} | you said: "Cut surplus spells."`),
      at('Owner: kept Spell 3 ("part of my plan: I need it on turn 3"); kept Spell 4; said: "Why is Spell 1 first?"'),
      at('This is list 2.'),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The box is read once, as the session's first line.
    expect(second).not.toContain('## What matters for these cuts');
    expect(asked[1].schema).toMatchObject({ required: ['ranked', 'keep', 'reply'] });
    // The reply and the question are kept and shown.
    let v = await trim.trimView(list, 'dk');
    expect(v.run!.reply).toBe('I kept Spell 3 and Spell 4, and treated Spell 5 the same way.');
    expect(v.run!.ask).toBe('Is Spell 9 part of the combo?');
    expect(v.turns.map((t) => t.kind)).toEqual(['owner-start', 'claude-list', 'owner-reply', 'claude-list']);
    // A third list is sent list 2 as well, with Claude's question.
    await trim.runTrim(model, list, 'dk', { model: 'opus', rerun: true, message: 'Yes, it is.' });
    expect(asked[2].user).toContain('You, list 2: cuts: Spell 1; Spell 2; Spell 5');
    expect(asked[2].user).toContain('you asked: "Is Spell 9 part of the combo?"');
    expect(asked[2].user).toContain('Owner: said: "Yes, it is."');
    v = await trim.trimView(list, 'dk');
    expect(v.run!.ask).toBeNull();
    expect(v.messages.map((m) => m.text)).toEqual(['Keep my mana dorks.', 'Why is Spell 1 first?', 'Yes, it is.']);
  });

  it('a re-run with nothing marked or typed still sends the last list', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    const { model, asked } = fakeModel(() => ANSWER);
    await trim.runTrim(model, list, 'dk', { model: 'opus' });
    await trim.runTrim(model, list, 'dk', { model: 'opus', rerun: true });
    expect(asked[1].user).toContain(`You, list 1: cuts: ${ranked(1, 8).map((r) => r.name).join('; ')}`);
    expect(asked[1].user).toContain('Owner, at the start: said nothing');
    expect(asked[1].user).toContain('Owner: changed nothing and asked for the list again');
  });

  it('asks for one card more and keeps the wanted number; an answer one short is still full', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    // Asked for 17, gave 16: the list is whole.
    await trim.runTrim(fakeModel(() => ({ ranked: ranked(1, 16), keep: [], notes: '' })).model, list, 'dk', { model: 'opus' });
    let v = await trim.trimView(list, 'dk');
    expect(v.run!.items.filter((i) => i.tier === 'cut' || i.tier === 'maybe')).toHaveLength(16);
    // Gave 17: trimmed to 16.
    await trim.runTrim(fakeModel(() => ({ ranked: ranked(1, 17), keep: [], notes: '' })).model, list, 'dk', { model: 'opus' });
    v = await trim.trimView(list, 'dk');
    expect(v.run!.items.filter((i) => i.tier === 'cut' || i.tier === 'maybe').map((i) => i.name)).toEqual(ranked(1, 16).map((r) => r.name));
  });

  it('marks each cut on a later list as yours, the same, or new, and lists what dropped off unnamed', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus' });
    // List 1 cuts: Spells 1-8. Keep 2, confirm 3 with a reason, cut closer call 9.
    trim.setChoices(list.id, { 'Spell 2': { choice: 'keep', chip: 'pet_card' }, 'Spell 3': { choice: 'cut', chip: 'too_slow' }, 'Spell 9': { choice: 'cut' } });
    // List 2 ranks 1, 4, 5 and new cards 30-34 first; 6-8 drop off without the owner naming them.
    const second = { ranked: [...['Spell 1', 'Spell 4', 'Spell 5'].map((name) => ({ name, why: 'x', with: [] })), ...ranked(30, 14)], keep: [], reply: 'Moved things.' };
    await trim.runTrim(fakeModel(() => second).model, list, 'dk', { model: 'opus', rerun: true });
    const v = await trim.trimView(list, 'dk');
    const cuts = v.run!.items.filter((i) => i.tier === 'cut').map((i) => i.name);
    expect(cuts).toEqual(['Spell 3', 'Spell 9', 'Spell 1', 'Spell 4', 'Spell 5', 'Spell 30', 'Spell 31', 'Spell 32']);
    expect(v.run!.marks).toEqual({
      'Spell 3': 'yours', 'Spell 9': 'yours', 'Spell 1': 'same', 'Spell 4': 'same', 'Spell 5': 'same', 'Spell 30': 'new', 'Spell 31': 'new', 'Spell 32': 'new',
    });
    expect(v.run!.changed).toEqual({ kept: ['Spell 2'], dropped: ['Spell 6', 'Spell 7', 'Spell 8'], yours: 2, same: 3, fresh: 3 });
    // The confirmed cuts carry over; they were already said, so they aren't new marks for the next send.
    expect(Object.keys(v.carried).sort()).toEqual(['Spell 3', 'Spell 9']);
    const { model, asked } = fakeModel(() => second);
    await trim.runTrim(model, list, 'dk', { model: 'opus', rerun: true });
    expect(asked[0].user).toContain('Owner: changed nothing and asked for the list again');
  });

  it('"Have Claude add to it" is sent the box and keeps it first, word for word', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    const { model, asked } = fakeModel(() => ({ bullets: ['Cut the slowest ramp first.', 'No lands.'] }));
    const a = await trim.writeApproach(model, list, 'dk', 'I want more ramp, not less.\nCut removal first.');
    expect(asked[0].user).toContain('I want more ramp, not less.\nCut removal first.');
    expect(a.by).toBe('both');
    expect(a.text).toBe('I want more ramp, not less.\nCut removal first.\n- Cut the slowest ramp first.\n- No lands.');
    expect((await trim.trimView(list, 'dk')).approach!.text.startsWith('I want more ramp, not less.')).toBe(true);
  });

  it('apply ends the session, keeps what was said about cards, and saves only the ticked lines to notes', async () => {
    const { db, list } = await deck();
    const trim = await import('./trim');
    await trim.setApproach(list, 'dk', { text: 'Keep my dorks.' });
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus' });
    trim.setChoices(list.id, { 'Spell 3': { choice: 'keep', text: 'my favourite' }, 'Spell 9': { choice: 'cut' } });
    await trim.runTrim(fakeModel(() => ({ ...ANSWER, reply: 'ok' })).model, list, 'dk', { model: 'opus', rerun: true, message: 'Weigh speed more.' });
    let v = await trim.trimView(list, 'dk');
    expect(v.messages.map((m) => m.text)).toEqual(['Keep my dorks.', 'Weigh speed more.']);
    const tick = v.messages.find((m) => m.text === 'Weigh speed more.')!.id;
    await trim.applyTrim(list, 'dk', undefined, [tick]);
    const s = trim.trimStore(list.id);
    expect(s.turns).toEqual([]);
    expect(s.said['Spell 3']).toMatchObject({ choice: 'keep', text: 'my favourite' });
    const notes = (await (await import('./plan-help')).planState(db.getList(list.id, 'dk')!)).notes.map((x) => x.text);
    expect(notes).toEqual(['Weigh speed more.']);
    v = await trim.trimView(db.getList(list.id, 'dk')!, 'dk');
    expect(v.done!.notes).toBe(1);
    // Undo brings the session back with the cards.
    trim.undoTrim(db.getList(list.id, 'dk')!);
    expect(trim.trimStore(list.id).turns.map((t) => t.kind)).toEqual(['owner-start', 'claude-list', 'owner-reply', 'claude-list']);
  });

  it('sends nothing from one deck’s session or remembered choices for another deck', async () => {
    const { db, list } = await deck();
    const trim = await import('./trim');
    await trim.setApproach(list, 'dk', { text: 'Secret plan for Azula.' });
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus' });
    trim.setChoices(list.id, { 'Spell 3': { choice: 'keep', text: 'only on Azula' } });
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus', rerun: true, message: 'Azula message.' });
    const other = db.createList('dk', 'Other', '', { kind: 'deck', commander });
    db.addCardToList(other.id, island, 37);
    for (let i = 1; i <= 70; i++) db.addCardToList(other.id, card(`Spell ${i}`));
    const { model, asked } = fakeModel(() => ANSWER);
    await trim.runTrim(model, db.getList(other.id, 'dk')!, 'dk', { model: 'opus' });
    for (const s of ['Secret plan for Azula.', 'only on Azula', 'Azula message.', 'This cut session so far', 'What the owner decided on earlier cut lists']) expect(asked[0].user).not.toContain(s);
    await trim.runTrim(model, db.getList(other.id, 'dk')!, 'dk', { model: 'opus', rerun: true });
    for (const s of ['Secret plan for Azula.', 'only on Azula', 'Azula message.']) expect(asked[1].user).not.toContain(s);
  });

  it('shows a usual range only for a job counted on the deck', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    const range = async () => Object.fromEntries((await trim.trimView(list, 'dk')).impact.rows.map((r) => [r.id, r.range]));
    let r = await range();
    expect([r.ramp, r.draw, r.interaction]).toEqual([null, null, null]);
    expect(r.lands).not.toBeNull();
    (await import('./categories')).addCategory(list.id, { kind: 'job', name: 'Ramp', by: 'cards', jobId: 'ramp' });
    r = await range();
    expect(r.ramp).not.toBeNull();
    expect(r.draw).toBeNull();
  });

  it('a reason typed on a row reaches the Owner line and what is remembered, with no chip; an old stored chip still prints', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus' });
    trim.setChoices(list.id, { 'Spell 2': { choice: 'keep', text: 'I need it on turn 3' }, 'Spell 4': { choice: 'keep', chip: 'pet_card' } });
    const { model, asked } = fakeModel(() => ANSWER);
    await trim.runTrim(model, list, 'dk', { model: 'opus', rerun: true });
    expect(asked[0].user).toContain('Owner: kept Spell 2 ("I need it on turn 3"); kept Spell 4 ("a pet card")');
    expect(trim.trimStore(list.id).said['Spell 2']).toMatchObject({ choice: 'keep', chip: null, text: 'I need it on turn 3' });
    // The next list reads both from what is remembered: the typed reason, and the old chip in words.
    await trim.runTrim(model, list, 'dk', { model: 'opus', rerun: true });
    expect(asked[1].user).toContain('- Spell 2 ("I need it on turn 3")');
    expect(asked[1].user).toContain('- Spell 4 ("a pet card")');
  });

  it('a keep taken back under "Kept by you" leaves what is remembered, and the card can be listed again', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus' });
    trim.setChoices(list.id, { 'Spell 2': { choice: 'keep', text: 'mine' } });
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus', rerun: true });
    let v = await trim.trimView(list, 'dk');
    // Kept by you, with the owner's reason in place of Claude's.
    expect(v.run!.items.find((i) => i.name === 'Spell 2')).toMatchObject({ tier: 'yours', mine: 'mine', why: '' });
    expect(v.run!.items.some((i) => i.name === 'Spell 2' && i.tier === 'cut')).toBe(false);
    // Press Cut on it: a confirmed cut, at the top of the next list.
    trim.setChoices(list.id, { ...v.choices, 'Spell 2': { choice: 'cut', text: '' } });
    v = await trim.trimView(list, 'dk');
    expect(v.impact.size.after).toBe(99);
    const { model, asked } = fakeModel(() => ANSWER);
    await trim.runTrim(model, list, 'dk', { model: 'opus', rerun: true });
    expect(asked[0].user).toContain('confirmed cuts: Spell 2');
    expect(trim.trimStore(list.id).said['Spell 2']?.choice).toBe('cut');
    v = await trim.trimView(list, 'dk');
    expect(v.run!.items.find((i) => i.name === 'Spell 2')!.tier).toBe('cut');
    expect(v.run!.items.some((i) => i.tier === 'yours' && i.name === 'Spell 2')).toBe(false);
  });

  it('a kept card the model lists comes back only when the owner’s latest message names it', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus' });
    trim.setChoices(list.id, { 'Spell 2': { choice: 'keep' } });
    // Claude lists the kept card anyway, unasked: code strips it.
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus', rerun: true, message: 'Weigh speed more.' });
    let v = await trim.trimView(list, 'dk');
    expect(v.run!.items.find((i) => i.name === 'Spell 2')!.tier).toBe('yours');
    // The owner asks for it to go after all: Claude lists it, and the keep is taken back.
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus', rerun: true, message: 'Actually cut spell 2 after all.' });
    v = await trim.trimView(list, 'dk');
    expect(v.run!.items.find((i) => i.name === 'Spell 2')!.tier).toBe('cut');
    expect(trim.trimStore(list.id).said['Spell 2']).toBeUndefined();
    // A message that names nothing kept leaves the strip in place on the next list.
    trim.setChoices(list.id, { 'Spell 3': { choice: 'keep' } });
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus', rerun: true, message: 'Cut spell 2 please.' });
    v = await trim.trimView(list, 'dk');
    expect(v.run!.items.find((i) => i.name === 'Spell 3')!.tier).toBe('yours');
  });

  it('joins card names with "; " in every list sent to the model', async () => {
    const { db, list } = await deck();
    const comma = card('War Machine, Avenging Arsenal');
    db.addCardToList(list.id, comma);
    db.saveRoles(new Map([['o-War Machine, Avenging Arsenal', []]]), (await import('./roles')).ROLES_VERSION);
    (await import('./deck-roles')).setKeep(list.id, 'o-War Machine, Avenging Arsenal', true);
    const c = await import('./categories');
    const win = c.addCategory(list.id, { kind: 'win', name: 'Beats', by: 'owner' });
    c.setCategoryCard(list.id, win, { key: 'o-Spell 9', name: 'Spell 9' }, true);
    c.setCategoryCard(list.id, win, { key: 'o-Spell 10', name: 'Spell 10' }, true);
    const trim = await import('./trim');
    const l = db.getList(list.id, 'dk')!;
    await trim.runTrim(fakeModel(() => ANSWER).model, l, 'dk', { model: 'opus' });
    trim.setChoices(list.id, { 'Spell 1': { choice: 'cut', text: 'slow' }, 'Spell 12': { choice: 'cut' } });
    const { model, asked } = fakeModel(() => ANSWER);
    await trim.runTrim(model, l, 'dk', { model: 'opus', rerun: true });
    const u = asked[0].user;
    expect(u).toContain('confirmed cuts: Spell 1 ("slow"); Spell 12');
    expect(u).toContain('War Machine, Avenging Arsenal (★ never cut)');
    expect(u).toMatch(/Spell 9; Spell 10|Spell 10; Spell 9/);
    expect(u).toContain(`You, list 1: cuts: ${ranked(1, 9).map((r) => r.name).join('; ')} | closer calls: Spell 10; `);
  });

  it('after "Have Claude add to it", only the owner’s lines are theirs: in the session and for notes', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    await trim.writeApproach(fakeModel(() => ({ bullets: ['Cut slow ramp.'] })).model, list, 'dk', 'Keep my dorks.');
    const { model, asked } = fakeModel(() => ANSWER);
    await trim.runTrim(model, list, 'dk', { model: 'opus' });
    let v = await trim.trimView(list, 'dk');
    expect(v.turns[0]).toMatchObject({ kind: 'owner-start', text: 'Keep my dorks.', added: '- Cut slow ramp.' });
    expect(v.messages.map((m) => m.text)).toEqual(['Keep my dorks.']);
    await trim.runTrim(model, list, 'dk', { model: 'opus', rerun: true });
    expect(asked[1].user).toContain('Owner, at the start: "Keep my dorks."');
    expect(asked[1].user).toContain('Bullets you added to it before the first list, kept by the owner: "- Cut slow ramp."');
    // Claude alone: nothing of the owner's to keep.
    await trim.resetTrim(list.id);
    await trim.writeApproach(fakeModel(() => ({ bullets: ['Cut slow ramp.'] })).model, list, 'dk', '');
    await trim.runTrim(model, list, 'dk', { model: 'opus' });
    v = await trim.trimView(list, 'dk');
    expect(v.messages).toEqual([]);
  });

  it('undo takes off the notes the apply saved', async () => {
    const { db, list } = await deck();
    const trim = await import('./trim');
    await trim.setApproach(list, 'dk', { text: 'Keep my dorks.' });
    await trim.runTrim(fakeModel(() => ANSWER).model, list, 'dk', { model: 'opus' });
    const v = await trim.trimView(list, 'dk');
    await trim.applyTrim(list, 'dk', undefined, [v.messages[0].id]);
    const notes = async () => (await (await import('./plan-help')).planState(db.getList(list.id, 'dk')!)).notes.map((x) => x.text);
    expect(await notes()).toEqual(['Keep my dorks.']);
    trim.undoTrim(db.getList(list.id, 'dk')!);
    expect(await notes()).toEqual([]);
  });

  it('sends a usual range only for a job counted on the deck', async () => {
    const { list } = await deck();
    const trim = await import('./trim');
    let { user } = await trim.trimMessage(list, 'dk');
    expect(user).toMatch(/^- Ramp: [\d.]+$/m);
    (await import('./categories')).addCategory(list.id, { kind: 'job', name: 'Ramp', by: 'cards', jobId: 'ramp' });
    ({ user } = await trim.trimMessage(list, 'dk'));
    expect(user).toMatch(/^- Ramp: [\d.]+ \(usual range \d+–\d+/m);
    expect(user).toMatch(/^- Card draw: [\d.]+$/m);
  });

  it('keeps the card lists of the last six rounds and only the words of older ones', async () => {
    const { sessionLines } = await import('./trim');
    const turns = [{ kind: 'owner-start' as const, text: 'Start.', at: '' }, ...Array.from({ length: 8 }, (_, k) => [
      { kind: 'claude-list' as const, round: k + 1, cuts: [`Cut ${k + 1}`], maybes: [], reply: `Reply ${k + 1}.`, ask: null, at: '' },
      { kind: 'owner-reply' as const, marks: [], message: `Message ${k + 1}.`, at: '' },
    ]).flat()];
    const out = sessionLines(turns).join('\n');
    expect(out).toContain('You, list 1: (its cards are left out here) | you said: "Reply 1."');
    expect(out).toContain('You, list 2: (its cards are left out here)');
    expect(out).toContain('You, list 3: cuts: Cut 3');
    expect(out).toContain('Owner: said: "Message 1."');
    expect(out).not.toContain('Cut 1,');
  });
});
