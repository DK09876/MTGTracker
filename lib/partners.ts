/**
 * Two commanders that lead one deck together - Partner, "Partner with",
 * Partner variants like "Partner—Father & son", Friends forever, a
 * commander that can choose a Background and a Background, the Doctor and a
 * Doctor's companion.
 *
 * Search treats a pair as one commander: the colours of both, EDHREC's page
 * for the pair, and neither card in the results. "Kratos and Atreus" asked
 * for a commander called that, found none, and searched every colour without
 * EDHREC (2026-09-30).
 *
 * Pure.
 */

import type { ScryfallCard } from './scryfall';

/** A commander that is really two, merged for search; `pair` holds the two cards. */
export type Commander = ScryfallCard & { pair?: [ScryfallCard, ScryfallCard] };

/** "Kratos and Atreus", "Tymna + Thrasios", "Will & Rowan": the two names, or null. */
export function splitPair(mention: string): [string, string] | null {
  const parts = mention.split(/\s+(?:and|&|\+|with)\s+|\s*\/\/?\s*/i).map((s) => s.trim()).filter(Boolean);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

const textOf = (c: ScryfallCard) => `${c.oracle_text ?? ''}\n${c.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? ''}`;
const typeOf = (c: ScryfallCard) => `${c.type_line ?? ''} ${c.card_faces?.map((f) => f.type_line ?? '').join(' ') ?? ''}`;

/** How a card pairs up, read from its rules text: kind, and for "Partner with", whom. */
function pairing(c: ScryfallCard): { kind: string; with?: string } | null {
  const text = textOf(c);
  const withName = /\bPartner with ([^(\n]+?)\s*(?:\(|$)/m.exec(text);
  if (withName) return { kind: 'with', with: withName[1].trim() };
  const variant = /\bPartner\s*[—-]\s*([^(\n]+?)\s*(?:\(|$)/m.exec(text);
  if (variant) return { kind: `partner:${variant[1].trim().toLowerCase()}` };
  if (/^Partner\b(?! with)/m.test(text)) return { kind: 'partner' };
  if (/\bFriends forever\b/i.test(text)) return { kind: 'friends forever' };
  if (/\bChoose a Background\b/i.test(text)) return { kind: 'choose-background' };
  if (/\bBackground\b/.test(typeOf(c))) return { kind: 'background' };
  if (/\bDoctor's companion\b/i.test(text)) return { kind: 'companion' };
  if (/\bTime Lord Doctor\b/i.test(typeOf(c))) return { kind: 'doctor' };
  return null;
}

/** Whether two cards can be commanders together. */
export function canPartner(a: ScryfallCard, b: ScryfallCard): boolean {
  if (a.name === b.name) return false;
  const x = pairing(a);
  const y = pairing(b);
  if (!x || !y) return false;
  if (x.kind === 'with' || y.kind === 'with') return x.with === b.name && y.with === a.name;
  const kinds = new Set([x.kind, y.kind]);
  if (kinds.size === 1) return !['choose-background', 'background', 'doctor', 'companion'].includes(x.kind);
  return (kinds.has('choose-background') && kinds.has('background')) || (kinds.has('doctor') && kinds.has('companion'));
}

const WUBRG = 'WUBRG';

/**
 * The pair as one commander: both names in EDHREC's order (alphabetical, so
 * its page for the pair is found), both colour identities, both cards' text
 * for the model to read.
 */
export function mergePair(a: ScryfallCard, b: ScryfallCard): Commander {
  const [first, second] = [a, b].sort((x, y) => x.name.localeCompare(y.name));
  const identity = [...new Set([...(first.color_identity ?? []), ...(second.color_identity ?? [])])]
    .sort((x, y) => WUBRG.indexOf(x) - WUBRG.indexOf(y));
  return {
    ...first,
    name: `${first.name} + ${second.name}`,
    color_identity: identity,
    mana_cost: [first.mana_cost, second.mana_cost].filter(Boolean).join(' + '),
    type_line: `${first.type_line ?? ''} + ${second.type_line ?? ''}`,
    oracle_text: `${first.name}: ${textOf(first).trim()}\n${second.name}: ${textOf(second).trim()}`,
    card_faces: undefined,
    pair: [first, second],
  };
}
