/**
 * The deck's plan as every Claude step reads it: each part with who set it,
 * the numbers the app computed, the cards never cut, the deck's changes to
 * the usual rules and the notes kept from earlier reads - then the default
 * ways to judge a deck, which Claude may depart from when it says why.
 *
 * The app computes the numbers; Claude explains and judges, it does not
 * count. Server only.
 */

import { cardsInList, deckTags, type List } from './db';
import { noteBy, planFor, type Plan } from './deck-plan';
import { owner, planForAi } from './plan-pass';
import { deckRolesKnown } from './deck-roles';
import type { RoleCount } from './roles';

/** The default ways to judge a Commander deck, in plain words (docs/deckbuilding-reference.md, "Rules for the app's deck-analysis AI"). */
export const AI_RULES = `\
Default ways to judge a Commander deck. Follow them unless this deck's plan
or what the owner is optimizing for says otherwise; when you depart from
one, say which and why.
1. Cantrips are not card draw: only cards that leave you with more cards count. Selection is its own thing.
2. Note every job a card fills. Cards doing two or more jobs are the most valuable; single-job generic cards are the easiest to swap.
3. Counts are ranges tied to the commander and the curve. Flag a count outside its range; don't call it an error.
4. Lands: flag fewer than about 36 unless the deck has lots of cheap ramp or a cheap drawing commander; more, up to 42, for an expensive drawing commander or a high curve.
5. Colour sources: flag a colour under about 20 sources if it has double-pip cards, or under about 15 at all. Demand the strict numbers only for cards that must come down on curve.
6. Check ramp against the commander's cost. A cheap commander wants cheap dorks and untapped lands over three- and four-mana land ramp; ramp that costs as much as the commander comes too late.
7. Taplands are a problem when the plan needs plays on turns 1-3; fine in slow or colour-hungry decks.
8. Estimate how much the deck depends on its commander, and check it has draw, removal and a way to win that don't need it. High dependence needs more protection than a couple of equipment.
9. Decide what the commander does for the deck (engine, payoff, enabler, covers a weakness, multiplier) before judging dependence, and back up in the 99 any job only the commander does.
10. State the plan as a board you build toward, when, and how it wins. Flag decks with a theme but no way to win, and decks whose theme is their only way to win.
11. Flag cards that only matter when you are already winning, and narrow, expensive payoffs. Suggest a lower curve when the average cost is high.
12. When a deck isn't working, suggest more draw and filtering first, then lands if short.
13. Prefer flexible removal. Repeatable removal counts as more than one piece. Warn against around ten board wipes, or only one-for-one removal without heavy draw.
14. For cards that answer a weakness, prefer modal cards, double-faced cards and utility lands, or ones that fit an existing synergy.
15. Tune a few cards at a time against one problem you saw, not a twenty-card rebuild, unless the commander or plan itself is wrong.`;

const by = (who: 'yours' | 'claude' | undefined, detected = 'detected') => (who === 'claude' ? "Claude's, accepted by the owner" : who === 'yours' ? "the owner's" : detected);

/**
 * The plan in words, from what is stored and the last detection. With a
 * current plan read (`read`), the parts the code detected - what the
 * commander does, how the deck is built, how much it leans on the commander,
 * key cards, themes, ways to win and the game plan - are left out: the read
 * says them, and two versions could disagree. The owner's settings, the
 * numbers and their notes stay.
 */
export function planText(plan: Plan, roles: RoleCount[] | null, read = false): string {
  const s = plan.stored;
  const snap = plan.snapshot;
  const lines: string[] = [read ? "The owner's settings for the deck (who set each part in brackets):" : "The deck's plan, as the app holds it (who set each part in brackets):"];
  const goal = plan.goal;
  lines.push(`- Optimizing for: ${goal.chips.join(', ') || 'the usual guidelines'}${goal.text ? `. In their words: "${goal.text}"` : ''} [${by(s.goal?.by, 'not set')}]`);
  lines.push(`- Bracket aimed for: ${plan.bracket ?? `not set${snap.bracketLooks ? `; the list looks like ${snap.bracketLooks}` : ''}`}`);
  lines.push(`- Budget per card: ${plan.budget ? `$${plan.budget}, cards they own always allowed` : 'any'}. Only cards they own: ${plan.own ? 'yes' : 'no'}.`);
  if (plan.rule.text || plan.rule.filter) lines.push(`- Deck rule: ${plan.rule.text}${plan.rule.filter ? ` (cards must match: ${plan.rule.filter})` : ''} [${by(s.rule?.by)}]`);
  if (!read) {
    lines.push(`- Style: ${plan.style.label}${plan.style2 ? ` + ${plan.style2.label}` : ''} [${by(s.style?.by ?? (plan.chosen.style ? 'yours' : undefined))}]`);
    if (s.role?.v ?? snap.role) lines.push(`- What the commander does for the deck: ${s.role?.v ?? snap.role} [${by(s.role?.by)}]`);
    if (s.build?.v ?? snap.build) lines.push(`- How the deck is built: ${s.build?.v ?? snap.build} [${by(s.build?.by)}]`);
    lines.push(`- Leans on the commander: ${plan.lean} [${by(s.lean?.by)}]`);
    const key = s.key?.v ?? snap.keyCards ?? [];
    // Key cards are not protected from cuts by code; only the commanders and the ★ never-cut list are.
    if (key.length) lines.push(`- Key cards (built around): ${key.join(', ')}`);
    if (snap.themes?.length) lines.push(`- Themes: ${snap.themes.map((t) => `${t.name} (${t.cards.length} of ${t.size})`).join('; ')}`);
    if (snap.routes?.length) lines.push(`- Ways to win: ${snap.routes.map((r) => `${r.label}${r.main ? ' (main)' : ''}: ${r.cards.slice(0, 6).join(', ')}${r.needsCommander ? ' - needs the commander' : ''}`).join('; ')}`);
    const stages = s.stages?.v ?? snap.stages;
    if (stages) lines.push(`- Game plan: early - ${stages.early} Middle - ${stages.mid} Close - ${stages.close}`);
  }
  lines.push(`- Flip turn (mana needed to get going): ${plan.flip.value}`);
  lines.push('', 'The numbers, as the app counted them:');
  lines.push(`- Lands: ${plan.landNumber.have}, the plan wants ${plan.lands[0]}-${plan.lands[1]}`);
  for (const r of (roles ?? []).filter((x) => ['ramp', 'draw', 'impulse', 'interaction', 'wipe', 'protection', 'finishers'].includes(x.id))) {
    lines.push(`- ${r.label}: ${r.count}${r.target ? ` (range ${r.target[0]}-${r.target[1]})` : ''}`);
  }
  const on = plan.overrides.filter((o) => o.on);
  if (on.length) lines.push('', 'Changes to the usual rules for this deck:', ...on.map((o) => `- ${o.what}: ${o.why} [${by(o.by)}]`));
  // Only the owner's notes, in their words. Notes Claude wrote in earlier reads are left out: read back as
  // the owner's view, "the easiest cuts are..." steered later answers (deck flow evaluation, 2026-11-10).
  const owners = plan.notes.filter((n) => noteBy(n) === 'owner');
  if (owners.length) lines.push('', "The owner's notes on this deck, in their words:", ...owners.map((n) => `- ${n.text}`));
  lines.push('', AI_RULES);
  return lines.join('\n');
}

/**
 * The plan in words for one deck, reading what it needs: the plan read when
 * it is current, else the code's detection, then settings, numbers and notes.
 */
export async function planContext(list: Pick<List, 'id' | 'commander'>): Promise<string> {
  const main = cardsInList(list.id).filter((c) => c.board === 'main');
  const tags = deckTags(list.id);
  const plan = planFor(list.id, tags.brief, list.commander, main);
  const roles = await deckRolesKnown(list.id, main).catch(() => null);
  // The plan read, with the owner's edits, when it matches the deck (or the owner said to use it anyway).
  const read = planForAi(list);
  const commander = owner(list.id).commanderRoles.filter((r) => r !== 'unsure');
  return [
    ...(read ? [read.text, ''] : commander.length ? [`What the commander does for the deck (the owner's pick): ${commander.join(', ')}`, ''] : []),
    planText(plan, roles, !!read),
  ].join('\n');
}
