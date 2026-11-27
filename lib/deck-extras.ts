/**
 * What a deck needs on the table beyond its cards (components/DeckExtras.tsx): the tokens and emblems its cards
 * make, the reminder cards for its face-down creatures, and the pieces Scryfall files with them (The Monarch, The
 * Initiative, Day // Night, dungeons, meld results), from each card's related parts. Pure.
 *
 * Scryfall's links aren't enough on their own:
 * - It files reminder cards (Morph, Manifest, A Mysterious Creature for cloak and disguise, Cyberman) as "combo
 *   pieces" typed only "Creature", next to real cards it links the same way (Command Tower → Tower Winder). The
 *   server says which linked names are token or reminder cards (`pieces`); with no answer yet, a bare "Creature"
 *   type is taken as one, since a real creature always has a creature type.
 * - Some cards make face-down creatures with no link at all, and new cards can make tokens before Scryfall links
 *   them. Their rules text is read for both, so nothing a deck puts on the table goes missing.
 */

import type { ScryfallCard } from './scryfall';

type Part = { id: string; component: string; name: string; type_line?: string };
export type ExtraKind = 'token' | 'facedown' | 'emblem' | 'other';
type Kind = ExtraKind;
export interface Extra {
  id: string;
  name: string;
  typeLine: string;
  kind: Kind;
  from: string[];
  /** A token Scryfall has no card for: the words from the rules text that make it. No picture. */
  words?: string;
}

/** A related part that is a game piece rather than a card in its own right. */
const PIECE = /^(Card\b|Dungeon|Emblem|Token)/;

/** Scryfall's reminder cards for face-down creatures, one printing each (for the picture). */
export const FACE_DOWN = {
  morph: { id: 'cd0b42a0-5e08-406d-82b0-be5f72870c47', name: 'Morph' },
  manifest: { id: 'd4c95eac-9f21-408a-8f60-f5cba79b6a8f', name: 'Manifest' },
  mysterious: { id: '241b3b6d-a25f-4a43-b5d6-1d1079e7e498', name: 'A Mysterious Creature' },
} as const;
const FACE_DOWN_NAMES = new Set<string>(Object.values(FACE_DOWN).map((f) => f.name));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What a card's rules say it does: reminder text taken out (it explains a keyword, it never makes anything), and the
 * card's own name too ("except his name is Chameleon, Master of Disguise" isn't disguise).
 */
function textOf(c: ScryfallCard): string {
  const names = [c.name, ...c.name.split(' // '), ...(c.card_faces ?? []).map((f) => f.name ?? '')].filter(Boolean).sort((a, b) => b.length - a.length);
  let text = [c.oracle_text ?? '', ...(c.card_faces ?? []).map((f) => f.oracle_text ?? '')].join('\n').replace(/\([^)]*\)/g, '');
  for (const n of names) text = text.replace(new RegExp(escape(n), 'gi'), 'this card');
  return text;
}

/** The face-down creatures a card makes, from its rules text: which reminder card goes on each. */
function faceDownFromText(text: string): Array<keyof typeof FACE_DOWN> {
  const out = new Set<keyof typeof FACE_DOWN>();
  if (/\b(cloak|cloaks|cloaked|disguise)\b/i.test(text)) out.add('mysterious');
  if (/\bmanifest(s|ed)?\b/i.test(text)) out.add('manifest');
  if (/\b(megamorph|morph)\b/i.test(text)) out.add('morph');
  return [...out];
}

/**
 * The sentences of a card's text that make a token. What a card reacts to isn't what it makes: a leading condition
 * ("Whenever you create a token, …", "If an effect would create tokens, …") is read past, and a replacement
 * ("… creates twice that many … instead") makes none of its own.
 */
const makesToken = (sentence: string) => {
  const effect = sentence.replace(/^[^,]*\b(whenever|when|if|for each|as long as)\b[^,]*,/i, '');
  return /\bcreates?\b.*\btokens?\b/i.test(effect) && !/\binstead\b/i.test(effect);
};
const tokenWords = (text: string) => text.split(/(?<=\.)\s+|\n/).filter(makesToken).map((s) => s.trim());

/**
 * The extras a deck's cards make, grouped and named once each. `pieces` is the linked names the server knows to be
 * token or reminder cards (see the note at the top). Pure.
 */
export function extrasOf(cards: ScryfallCard[], pieces?: ReadonlySet<string>): Extra[] {
  const inDeck = new Set(cards.map((c) => c.name));
  const out = new Map<string, Extra>();
  const add = (e: Omit<Extra, 'from'>, from: string) => {
    const key = `${e.name}|${e.typeLine}`;
    const had = out.get(key);
    if (had) { if (!had.from.includes(from)) had.from.push(from); }
    else out.set(key, { ...e, from: [from] });
  };
  for (const c of cards) {
    const parts = (c as { all_parts?: Part[] }).all_parts ?? [];
    let tokens = 0;
    let faceDown = 0;
    for (const p of parts) {
      const type = p.type_line ?? '';
      if (p.name === c.name || inDeck.has(p.name)) continue;
      const piece = p.component === 'combo_piece' && (PIECE.test(type) || (pieces ? pieces.has(p.name) : type === 'Creature'));
      const kind: Kind | null = FACE_DOWN_NAMES.has(p.name) && (piece || p.component === 'token') ? 'facedown'
        : /Emblem/.test(type) ? 'emblem'
          : p.component === 'token' ? 'token'
            : p.component === 'meld_result' ? 'other'
              : piece ? (/^(Card|Dungeon)\b/.test(type) ? 'other' : 'token')
                : null;
      if (!kind) continue;
      if (kind === 'token') tokens++;
      if (kind === 'facedown') faceDown++;
      add({ id: p.id, name: p.name, typeLine: type, kind }, c.name);
    }
    const text = textOf(c);
    // Face-down creatures Scryfall didn't link a reminder card for.
    if (!faceDown) for (const f of faceDownFromText(text)) add({ ...FACE_DOWN[f], typeLine: 'Creature', kind: 'facedown' }, c.name);
    // A token Scryfall hasn't linked yet: the words that make it, so it still gets ready.
    if (!tokens) {
      const words = tokenWords(text);
      if (words.length) add({ id: '', name: c.name, typeLine: '', kind: 'token', words: words.join(' ') }, c.name);
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Linked names worth asking the server about: combo pieces whose type line alone doesn't say. */
export function piecesToAsk(cards: ScryfallCard[]): string[] {
  const out = new Set<string>();
  for (const c of cards) for (const p of ((c as { all_parts?: Part[] }).all_parts ?? [])) {
    if (p.component === 'combo_piece' && p.name !== c.name && !PIECE.test(p.type_line ?? '')) out.add(p.name);
  }
  return [...out].sort();
}
