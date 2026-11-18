/**
 * What is on a deck's Tune page right now, written out for Chat's read_tune (lib/deck-chat.ts): the open Finish list,
 * Upgrades list and Trim list, each card with Claude's reason and the owner's mark and reason, and the changes staged
 * in Tune. Read only with the owner's leave: they asked about Tune in their message, or allowed it in this chat.
 * Plain lines, cards as [[Card Name]], kept short enough for one tool result. Server only.
 */

import { finishStore } from './finish';
import { trimStore } from './trim';
import { tuneStore } from './tune-store';
import { upgradesStore } from './upgrades';

export type TuneSection = 'all' | 'finish' | 'upgrades' | 'trim' | 'staged';
export const TUNE_SECTIONS: TuneSection[] = ['all', 'finish', 'upgrades', 'trim', 'staged'];

const MAX_CHARS = 14_000;
const said = (t?: string | null) => (t?.trim() ? ` "${t.trim().replace(/\s+/g, ' ')}"` : '');
const card = (n: string) => `[[${n}]]`;

function finishLines(listId: string): string[] {
  const s = finishStore(listId);
  if (!s.run) {
    return ['## Finish', s.done ? `No list open. The last one was applied ${s.done.at.slice(0, 10)}: ${s.done.added} cards and ${s.done.lands} lands added.` : 'No list open.'];
  }
  const r = s.run;
  const choice = (n: string) => s.choices[n]?.choice ?? 'add';
  const label: Record<string, string> = { add: 'Add', ask: 'Rethink', maybe: 'Maybe (to the Maybeboard)', skip: 'Skip' };
  const count = (c: string) => r.items.filter((i) => choice(i.name) === c).length;
  const lines = [
    '## Finish',
    `List ${r.round}: ${r.items.length} picks for ${r.want} slots${r.full ? ', a fill to 100' : ''}. Marked: ${count('add')} Add, ${count('ask')} Rethink, ${count('maybe')} Maybe, ${count('skip')} Skip.`,
    ...(r.reply ? [`Claude said: ${r.reply}`] : []),
  ];
  for (const g of [...new Set(r.items.map((i) => (i.group === 'theme' && i.theme ? `theme: ${i.theme}` : i.group)))]) {
    lines.push(`### ${g}`);
    for (const i of r.items.filter((x) => (x.group === 'theme' && x.theme ? `theme: ${x.theme}` : x.group) === g)) {
      const where = i.src === 'buy' ? `to buy${i.price != null ? ` $${i.price.toFixed(2)}` : ''}` : i.src === 'other' ? `in ${i.deck}` : i.src === 'maybe' ? `in this deck's ${i.section ?? 'Maybeboard'}` : 'spare copy';
      lines.push(`- ${card(i.name)} (${where}): owner ${label[choice(i.name)]}${said(s.choices[i.name]?.text)}. Claude: ${i.why}`);
    }
  }
  if (s.maybes.length) lines.push(`Put on Maybe in earlier rounds: ${s.maybes.map((m) => `${card(m.name)}${said(m.why)}`).join('; ')}`);
  if (s.skippedBefore.length) lines.push(`Skipped on this deck before (never offered again): ${s.skippedBefore.map((m) => `${card(m.name)}${said(m.why)}`).join('; ')}`);
  if (s.maybeBefore.length) lines.push(`Put in the Maybeboard by an earlier Finish: ${s.maybeBefore.map((m) => `${card(m.name)}${said(m.why)}`).join('; ')}`);
  return lines;
}

function upgradesLines(listId: string): string[] {
  const s = upgradesStore(listId);
  if (!s.run) return ['## Upgrades', s.done ? `No list open. The last one was applied ${s.done.at.slice(0, 10)}: ${s.done.swapped} swapped in, ${s.done.maybe} to the Maybeboard.` : 'No list open.'];
  const label: Record<string, string> = { in: 'Swap in', ask: 'Rethink', skip: 'Not for me' };
  const lines = ['## Upgrades', `List ${s.run.round}: ${s.run.items.length} suggestions.`, ...(s.run.read ? [`Claude's read of the deck: ${s.run.read}`] : [])];
  for (const i of s.run.items) {
    const c = s.choices[i.name];
    const mark = c ? `${label[c.choice] ?? c.choice}${c.where === 'maybe' ? ' (Maybeboard instead)' : ''}${said(c.text)}` : 'not marked yet';
    lines.push(`- ${card(i.name)} for ${i.job}${i.out ? `, replacing ${card(i.out.name)}` : ''}: owner ${mark}. Claude: ${i.why}`);
  }
  if (s.notForMe.length) lines.push(`"Not for me" on this deck before: ${s.notForMe.map((m) => `${card(m.name)}${said(m.why)}`).join('; ')}`);
  return lines;
}

function trimLines(listId: string): string[] {
  const s = trimStore(listId);
  if (!s.run) return ['## Trim', s.done ? 'No cut list open; the last one was applied.' : 'No cut list open.'];
  const tier: Record<string, string> = { cut: 'cut', maybe: 'closer call', kept: 'Claude would keep', yours: 'the owner named it' };
  const label: Record<string, string> = { cut: 'Cut', keep: 'Keep', ask: 'Ask again' };
  const lines = ['## Trim', `List ${s.run.round}: cutting ${s.run.over}.`, ...(s.run.notes ? [`Claude: ${s.run.notes}`] : []), ...(s.run.ask ? [`Claude asked: ${s.run.ask}`] : [])];
  for (const i of s.run.items) {
    const c = s.choices[i.name];
    lines.push(`- ${card(i.name)} (${tier[i.tier] ?? i.tier}): owner ${c ? `${label[c.choice] ?? c.choice}${said(c.text)}` : 'not marked yet'}. Claude: ${i.why}`);
  }
  return lines;
}

function stagedLines(listId: string): string[] {
  const { changes } = tuneStore(listId);
  if (!changes.add.length && !changes.cut.length) return ['## Staged in Tune', 'Nothing staged.'];
  return [
    '## Staged in Tune (not applied yet)',
    ...changes.add.map((x) => `- Add ${card(x.card.name)}${x.quantity > 1 ? ` x${x.quantity}` : ''}${x.why ? `: ${x.why}` : ''}`),
    ...changes.cut.map((x) => `- Cut ${card(x.card.name)}${x.quantity > 1 ? ` x${x.quantity}` : ''}${x.why ? `: ${x.why}` : ''}`),
  ];
}

/** The Tune page as text: one part, or all of it. */
export function tuneSnapshot(listId: string, section: TuneSection = 'all'): string {
  const parts: Record<Exclude<TuneSection, 'all'>, () => string[]> = { finish: () => finishLines(listId), upgrades: () => upgradesLines(listId), trim: () => trimLines(listId), staged: () => stagedLines(listId) };
  const keys = section === 'all' ? (['finish', 'upgrades', 'trim', 'staged'] as const) : [section];
  const text = keys.map((k) => parts[k]().join('\n')).join('\n\n');
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n… (cut short: ask for one part at a time)` : text;
}
