/**
 * What a chat's proposals do when the owner presses Apply, and how Undo
 * takes each back. Chat can propose anything the other deck pages can do to
 * one card or one part of the plan: cut, add, swap, move to a section, put a
 * card in a group or take it out, mark it never cut, add a note, a way to
 * win or a key card. Claude never applies anything itself.
 *
 * Changes to the cards go through the deck's history (recorded), so they
 * show in History like any other edit. Server only.
 */

import { addCategory, categories, keyCategoryId, removeCategory, setCategoryCard } from './categories';
import { localCards } from './card-store';
import { addCardToList, cardsInList, database, setQuantity, updateListCard, type List } from './db';
import { recorded } from './deck-history';
import { changePlan, planFor } from './deck-plan';
import { jobCards, keeps, setKeep } from './deck-roles';
import type { Board } from './decklist';
import type { Change } from './deck-chat';
import { cutBoard } from './sections-shared';
import { sectionsOf } from './sections';
import type { ScryfallCard } from './scryfall';
import { applyCuts, undoApply, type UndoMoves } from './tune';

export class ChatActionRefused extends Error {}

const front = (n: string) => n.split(' // ')[0].trim().toLowerCase();
const keyOf = (c: ScryfallCard) => c.oracle_id ?? c.id;

/** What Undo needs, kept on the change once applied. */
export type Undo =
  | { kind: 'cut'; moves: UndoMoves }
  | { kind: 'add'; cardId: string }
  | { kind: 'swap'; moves: UndoMoves; cardId: string }
  | { kind: 'move'; cardId: string; from: Board; to: Board }
  | { kind: 'group'; catId: string; key: string; name: string; on: boolean; made: boolean }
  | { kind: 'never'; key: string; was: boolean }
  | { kind: 'note'; ids: string[] }
  | { kind: 'win'; catId: string }
  | { kind: 'key'; key: string; name: string };

function inMain(listId: string, name: string) {
  return cardsInList(listId).find((c) => c.board === 'main' && front(c.card.name) === front(name));
}
function anywhere(listId: string, name: string) {
  return cardsInList(listId).find((c) => front(c.card.name) === front(name));
}

/** A section by what Claude called it: its id, its name, or "maybeboard" / "sideboard". */
function boardOf(listId: string, to: string | undefined): Board {
  const t = (to ?? '').trim().toLowerCase();
  if (!t || t === 'main' || t === 'deck' || t === 'main deck') return 'main';
  const sections = sectionsOf(listId);
  const hit = sections.find((s) => s.id.toLowerCase() === t || s.name.toLowerCase() === t || s.name.toLowerCase().startsWith(t.replace(/board$/, '')));
  if (hit) return hit.id;
  if (/maybe/.test(t)) return 'maybe';
  if (/side/.test(t)) return 'side';
  throw new ChatActionRefused(`There is no section called ${to} on this deck`);
}

/** The printing Claude's proposal named (stored with the deck's cards when it was looked up), else the card by name. */
const cardFor = (name: string, cardId: string | null): ScryfallCard => {
  if (cardId) {
    const r = database().get('SELECT data FROM cards WHERE id = ?', [cardId]) as { data: string } | null;
    if (r) return JSON.parse(r.data) as ScryfallCard;
  }
  const c = localCards([name]).find((x) => front(x.name) === front(name));
  if (!c) throw new ChatActionRefused(`${name} isn't a card the app knows`);
  return c;
};

/** One copy of each card in a Commander deck, but basics and "any number of" cards. */
const anyNumber = (c: ScryfallCard) => /\bBasic\b/.test(c.type_line ?? '') || /any number of cards named/i.test(c.oracle_text ?? '');
function oneCopy(listId: string, card: ScryfallCard): void {
  if (anyNumber(card)) return;
  const there = inMain(listId, card.name);
  if (there) throw new ChatActionRefused(`${there.card.name} is already in the deck`);
}

/** Do one proposal. Returns what Undo needs. */
export async function applyChange(list: List, profile: string, c: Change): Promise<Undo> {
  const id = list.id;
  const who = { profile };
  const guardCut = (name: string) => {
    const row = inMain(id, name);
    if (!row) throw new ChatActionRefused(`${name} isn't in the deck`);
    if (list.commander && front(list.commander.name) === front(name)) throw new ChatActionRefused('The commander is never cut');
    if (keeps(id).has(keyOf(row.card))) throw new ChatActionRefused(`${row.card.name} is marked never cut. Take it off the never-cut list first if you want it out.`);
    return row;
  };
  switch (c.kind) {
    case 'cut': {
      const row = guardCut(c.name);
      const to = c.to ? boardOf(id, c.to) : cutBoard(sectionsOf(id));
      const { result } = await recorded(id, who, 'chat', `From Chat: cut ${row.card.name}`, () => applyCuts(list, [{ name: row.card.name, why: c.why }], to === 'main' ? undefined : to));
      return { kind: 'cut', moves: result.undo };
    }
    case 'add': {
      const card = cardFor(c.name, c.cardId);
      const to = boardOf(id, c.to);
      if (to === 'main') oneCopy(id, card);
      await recorded(id, who, 'chat', `From Chat: add ${card.name}`, () => addCardToList(id, card, 1, 'nonfoil', to));
      return { kind: 'add', cardId: card.id };
    }
    case 'swap': {
      const out = guardCut(c.out?.name ?? '');
      const card = cardFor(c.name, c.cardId);
      oneCopy(id, card);
      const { result } = await recorded(id, who, 'chat', `From Chat: ${out.card.name} out, ${card.name} in`, async () => {
        const moved = await applyCuts(list, [{ name: out.card.name, why: c.why }]);
        addCardToList(id, card, 1, 'nonfoil', 'main');
        return moved;
      });
      return { kind: 'swap', moves: result.undo, cardId: card.id };
    }
    case 'move': {
      const row = anywhere(id, c.name);
      if (!row) throw new ChatActionRefused(`${c.name} isn't in this deck or its sections`);
      const to = boardOf(id, c.to);
      if (row.board === to) throw new ChatActionRefused(`${row.card.name} is already there`);
      if (to !== 'main' && row.board === 'main') guardCut(row.card.name);
      if (to === 'main') oneCopy(id, row.card);
      await recorded(id, who, 'chat', `From Chat: move ${row.card.name}`, () => updateListCard(id, row.card.id, { board: to }));
      return { kind: 'move', cardId: row.card.id, from: row.board as Board, to };
    }
    case 'group':
    case 'ungroup': {
      const row = anywhere(id, c.name);
      if (!row) throw new ChatActionRefused(`${c.name} isn't in this deck`);
      const groupName = (c.to ?? '').trim();
      if (!groupName) throw new ChatActionRefused('Which group?');
      let cat = (await categories(list, jobCards)).find((x) => x.name.toLowerCase() === groupName.toLowerCase());
      let made = false;
      if (!cat) {
        if (c.kind === 'ungroup') throw new ChatActionRefused(`There is no group called ${groupName}`);
        addCategory(id, { kind: 'own', name: groupName, by: 'ai', how: c.why });
        cat = (await categories(list, jobCards)).find((x) => x.name.toLowerCase() === groupName.toLowerCase());
        made = true;
      }
      if (!cat) throw new ChatActionRefused('That group could not be made');
      if (cat.kind === 'key') throw new ChatActionRefused('Key cards are set on the Plan tab');
      const on = c.kind === 'group';
      const there = cat.cards.some((x) => x.key === keyOf(row.card));
      if (on === there) throw new ChatActionRefused(`${row.card.name} is ${there ? 'already in' : 'not in'} ${cat.name}`);
      setCategoryCard(id, cat.id, { key: keyOf(row.card), name: row.card.name }, on, on ? 'ai' : 'owner');
      return { kind: 'group', catId: cat.id, key: keyOf(row.card), name: row.card.name, on, made };
    }
    case 'never': {
      const row = inMain(id, c.name);
      if (!row) throw new ChatActionRefused(`${c.name} isn't in the deck`);
      const was = keeps(id).has(keyOf(row.card));
      setKeep(id, keyOf(row.card), true);
      return { kind: 'never', key: keyOf(row.card), was };
    }
    case 'note': {
      const notes = () => new Set(planFor(id, '', list.commander, []).notes.map((n) => n.id));
      const had = notes();
      changePlan(id, { notes: { add: [c.name.slice(0, 600)], by: 'owner' } });
      return { kind: 'note', ids: [...notes()].filter((n) => !had.has(n)) };
    }
    case 'win': {
      const name = c.name.trim();
      if (!name) throw new ChatActionRefused('Name the way to win');
      if ((await categories(list, jobCards)).some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new ChatActionRefused(`${name} is already on this deck`);
      const catId = addCategory(id, { kind: 'win', name, by: 'ai', how: c.why });
      for (const n of c.cards ?? []) { const row = anywhere(id, n); if (row) setCategoryCard(id, catId, { key: keyOf(row.card), name: row.card.name }, true, 'ai'); }
      return { kind: 'win', catId };
    }
    case 'key': {
      const row = anywhere(id, c.name) ?? (list.commander && front(list.commander.name) === front(c.name) ? { card: list.commander } : undefined);
      if (!row) throw new ChatActionRefused(`${c.name} isn't in this deck`);
      setCategoryCard(id, keyCategoryId(id), { key: keyOf(row.card), name: row.card.name }, true, 'owner');
      return { kind: 'key', key: keyOf(row.card), name: row.card.name };
    }
  }
}

/** Take one applied proposal back. */
export async function undoChange(list: List, profile: string, u: Undo): Promise<void> {
  const id = list.id;
  const who = { profile };
  switch (u.kind) {
    case 'cut':
      await recorded(id, who, 'undo', 'Undid a change from Chat', () => undoApply(list, u.moves));
      return;
    case 'add':
      await recorded(id, who, 'undo', 'Undid a change from Chat', () => {
        const row = cardsInList(id).find((c) => c.card.id === u.cardId);
        if (row) setQuantity(id, row.card.id, row.quantity - 1);
      });
      return;
    case 'swap':
      await recorded(id, who, 'undo', 'Undid a swap from Chat', () => {
        const row = cardsInList(id).find((c) => c.card.id === u.cardId && c.board === 'main');
        if (row) setQuantity(id, row.card.id, row.quantity - 1);
        undoApply(list, u.moves);
      });
      return;
    case 'move':
      await recorded(id, who, 'undo', 'Undid a move from Chat', () => updateListCard(id, u.cardId, { board: u.from }));
      return;
    case 'group':
      if (u.made) removeCategory(id, u.catId);
      else setCategoryCard(id, u.catId, { key: u.key, name: u.name }, !u.on, 'owner');
      return;
    case 'never':
      if (!u.was) setKeep(id, u.key, false);
      return;
    case 'note':
      for (const n of u.ids) changePlan(id, { notes: { remove: n } });
      return;
    case 'win':
      removeCategory(id, u.catId);
      return;
    case 'key':
      setCategoryCard(id, keyCategoryId(id), { key: u.key, name: u.name }, false, 'owner');
      return;
  }
}
