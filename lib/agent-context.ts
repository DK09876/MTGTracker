/**
 * What every AI agent the app calls is told, first (AGENTS.md, "The agent context"): the conventions that hold in
 * every feature, so no prompt repeats them and none forgets them. Put first in each call's system prompt at the
 * three places every call passes (lib/ai.ts modelById and claudeCall, lib/gemini.ts call): byte-identical on every
 * call, so it sits inside each feature's cached prefix. Nothing per-profile, per-deck or dated goes in here.
 *
 * Ask the owner before adding to it: every feature's answers change with it (bump PROMPT_VERSIONS too).
 *
 * Also here, done at the same three places: the cards the owner named with [[ ]] are looked up exactly
 * (lib/cards.ts) and given to the model; and a card name the model wrapped in [[ ]] where only a name belongs
 * (a "name" field) has its brackets taken off before any code reads it.
 */

import { findCards } from './cards';
import { manaCostOf, oracleTextOf, typeLineOf } from './scryfall';

export const AGENT_CONTEXT = `# Writing for MTG Tracker

You work inside MTG Tracker, an app for one playgroup's Magic: The Gathering decks, collections and games. Your words are shown to the owner in the app.

## Card names
- In anything written as sentences (reasons, replies, explanations, answers, notes), write every Magic card's name as [[Card Name]]: the card's exact English name as printed, front face only for a double-faced card ([[Delver of Secrets]]). The app shows each as a link with the card's picture and details.
- Mark only real card names. Never mark a mechanic, keyword, card type, token you describe, deck, theme or person.
- Where a field holds a card's name by itself (a "name" field, a list of card names, a "replaces" or "out" field), write the plain name with no brackets.

## The owner's words
- The owner may write [[Card Name]] too. That names exactly that card, never another card with a similar name. Those cards' details are given to you under "Cards the owner named".
- A card name the owner wrote without [[ ]] is not confirmed: don't assume which card it is; if it matters, say what you took it to mean.`;

/** Card names marked [[like this]] in a text, once each, as written. */
export function markedNames(text: string): string[] {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/\[\[+([^[\]]{1,120})\]\]+/g)) {
    const n = m[1].trim();
    if (n && !out.has(n.toLowerCase())) out.set(n.toLowerCase(), n);
  }
  return [...out.values()];
}

/**
 * The cards the owner named with [[ ]] in what goes to the model, looked up exactly (the app's cards, then
 * Scryfall), as a block to add to the user's message; '' when none are named. A name with no card says so, so the
 * model doesn't guess at a similar one.
 */
export async function ownerCardsBlock(texts: string[]): Promise<string> {
  const names = markedNames(texts.join('\n')).slice(0, 40);
  if (!names.length) return '';
  const found = await findCards(names).catch(() => null);
  const lines = names.map((n) => {
    const c = found?.get(n);
    if (!c) return `- ${n}: no card has this exact name. Say so; don't guess a similar card.`;
    const text = oracleTextOf(c).replace(/\s*\n+\s*/g, ' | ');
    return `- ${c.name} ${manaCostOf(c)} - ${typeLineOf(c)}${text ? ` - ${text}` : ''}`;
  });
  return `\n\n## Cards the owner named\n${lines.join('\n')}`;
}

/** Fields that hold a card's name by itself: their [[brackets]] are taken off. */
const NAME_FIELDS = /^(name|names|card|cards|cardName|commander|out|outName|replaces|picks|lands)$/i;
const plain = (s: string) => s.replace(/\[\[+|\]\]+/g, '').trim();

/** A model's answer with [[ ]] taken off card names where only a name belongs (see NAME_FIELDS); everything else as given. */
export function plainNames<T>(value: T, inName = false): T {
  if (typeof value === 'string') return (inName ? plain(value) : value) as T;
  if (Array.isArray(value)) return value.map((v) => plainNames(v, inName)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, plainNames(v, NAME_FIELDS.test(k))])) as T;
  }
  return value;
}
