/**
 * The rules the cut list adds up, each with a short explanation and a
 * weight, and a deck's own settings on top: rules switched off, reweighted,
 * and rules the owner wrote ("tagged Discard outlet: protect"). The list is
 * shown on the Tune tab, grouped by what each rule is about, so the owner
 * can see why a card is offered and change it.
 *
 * Where the ideas come from is kept in docs/deckbuilding-reference.md, not
 * shown on the page. Pure, except the storage at the end.
 */

export type RuleGroup = 'The plan and its themes' | 'Tags and counts' | 'Curve and mana' | 'Interaction' | 'Card quality' | 'Always kept';

export interface CutRule {
  id: string;
  label: string;
  group: RuleGroup;
  /** Why the rule exists, for its tooltip. */
  why: string;
  /** Toward cutting (+) or keeping (-); the weight is a size, the sign comes from here. */
  toward: 'cut' | 'keep';
  weight: number;
  /** Only switched on or off - it protects, it has no weight. */
  protects?: boolean;
  /** Off unless the owner turns it on. */
  offByDefault?: boolean;
}

export const CUT_RULES: CutRule[] = [
  // The plan and its themes
  { id: 'style', group: 'The plan and its themes', toward: 'keep', weight: 0.8, label: 'Fits the plan\'s style',
    why: 'A card that does what the deck is built to do (its main or second style on the Plan tab) is part of the plan, so it is kept over generic cards.' },
  { id: 'theme', group: 'The plan and its themes', toward: 'keep', weight: 1.2, label: 'Carries the commander\'s theme',
    why: 'When much of the deck does one specific thing the commander cares about - a creature type, snow, curses - those cards carry the deck and cutting them breaks it. In a deck that spreads out, theme only breaks ties.' },
  { id: 'package-over', group: 'The plan and its themes', toward: 'cut', weight: 0.6, label: 'In a theme package that is over its size',
    why: 'Each of your theme tags is a package with a size - 8 by default, 16 for a key theme. Eight cards give about a 62% chance of seeing one by turn 4; past the size, extra copies of the same idea add little.' },
  { id: 'package-short', group: 'The plan and its themes', toward: 'keep', weight: 0.8, label: 'In a theme package at or under its size',
    why: 'Cutting from a package that is already at its size makes the theme show up less often - below 8, the chance of seeing one by turn 4 drops fast.' },
  { id: 'enablers', group: 'The plan and its themes', toward: 'keep', weight: 1, label: 'An enabler, while the deck has fewer than 12',
    why: 'Enablers make the resource an engine runs on, so they are the backbone: about 12 give a good chance of opening with one. Cheap, self-sufficient, repeatable enablers matter most.' },
  { id: 'payoffs', group: 'The plan and its themes', toward: 'cut', weight: 0.5, label: 'A payoff, while payoffs outnumber half the enablers',
    why: 'Payoffs do nothing until an enabler is out, so a deck wants fewer of them - about half as many as enablers. The expensive ones go first.' },
  { id: 'offtheme', group: 'The plan and its themes', toward: 'cut', weight: 0.6, label: 'Nothing the commander cares about, and not a job every deck needs',
    why: 'Generic utility (ramp, draw, removal) is fine away from the deck\'s focus; a card that is neither utility nor on theme is the easiest to replace.' },
  { id: 'repeat', group: 'The plan and its themes', toward: 'cut', weight: 0.3, label: 'Does a job the commander already does, in a role that is full',
    why: 'The commander is in every game, so a card repeating its job (draw, ramp, removal) is worth a little less - but only where the deck already has plenty of that job.' },

  // Tags and counts
  { id: 'over', group: 'Tags and counts', toward: 'cut', weight: 1, label: 'In a job the deck has more of than its range',
    why: 'Each job (ramp, card draw, interaction, board wipes, protection, ways to finish) has a range on the Plan tab. Over the range, the extras are the first place to find room. A card counts this once, for the job it is most over in.' },
  { id: 'multi', group: 'Tags and counts', toward: 'keep', weight: 0.8, label: 'Does two or more jobs every deck needs',
    why: 'A card that ramps and draws, or removes and protects, fills two slots for one. Those are the best value in a deck, so they are kept over cards that do one thing. Counts once more for each job past the first.' },
  { id: 'needed', group: 'Tags and counts', toward: 'keep', weight: 1, label: 'In a job the deck is short of',
    why: 'Cutting a card from a tag the deck is already short on makes the gap worse.' },
  { id: 'cmdcost', group: 'Tags and counts', toward: 'cut', weight: 0.4, label: 'Ramp when the commander is cheap, card draw when it is dear',
    why: 'A cheap commander needs less ramp to come down on time, and an expensive one needs more; after interaction, the other of the two is the next to trim.' },

  // Curve and mana
  { id: 'curve', group: 'Curve and mana', toward: 'cut', weight: 0.5, label: 'At a mana value the curve is heavy at',
    why: 'Where many more cards sit at one mana value than usual, hands clog there; that is the first place to look.' },
  { id: 'costly', group: 'Curve and mana', toward: 'cut', weight: 0.4, label: 'Costs 6 or more and does not end the game',
    why: 'An expensive card should win, or nearly - otherwise its cost is better spent on two cheaper ones.' },
  { id: 'highcurve', group: 'Curve and mana', toward: 'cut', weight: 0.3, label: 'The curve is high: cutting a 5+ drop brings it down',
    why: 'With an average mana value over 3.3, cutting a 5-drop rather than a 2-drop keeps the curve from creeping up.' },
  { id: 'slowramp', group: 'Curve and mana', toward: 'cut', weight: 0.5, label: 'Ramp costing 4 or more',
    why: 'Ramp is about getting ahead; at 4 mana or more it arrives when you should be casting spells. Two-mana rocks are the workhorses and three is the top end.' },

  // Interaction
  { id: 'interaction', group: 'Interaction', toward: 'cut', weight: 0.6, label: 'Narrow or plain removal when there is plenty',
    why: 'Too much removal makes a deck reactive, and a spell that removes one thing leaves two opponents untouched - so after the plan is safe, interaction is the first utility to trim, narrow removal first.' },
  { id: 'sorcery', group: 'Interaction', toward: 'cut', weight: 0.3, label: 'Single-target removal at sorcery speed',
    why: 'Instant-speed removal can answer a threat on another player\'s turn and still let you develop on yours; sorcery-speed removal costs you your turn.' },
  { id: 'flexible', group: 'Interaction', toward: 'keep', weight: 0.4, label: 'Removal that hits anything',
    why: 'Removal that answers any permanent is never dead; it is worth more than removal that only hits one kind of thing.' },
  { id: 'wipes', group: 'Interaction', toward: 'keep', weight: 1, label: 'One of the last two board wipes',
    why: 'One or two board wipes reset a game the table is winning and you are not; the last ones are kept.' },

  // Card quality
  { id: 'floor', group: 'Card quality', toward: 'cut', weight: 0.6, label: 'Low floor: slow, or often does nothing',
    why: 'A card is worth its slot when it does something most games. Cards that need a hard condition to work, or are just a body, are weak at their worst.' },
  { id: 'cantrip', group: 'Card quality', toward: 'cut', weight: 0.3, label: 'Only replaces itself',
    why: 'A cantrip with nothing else to it keeps the hand the same size without moving the plan forward.' },
  { id: 'norole', group: 'Card quality', toward: 'cut', weight: 0.5, label: 'No built-in tag and none of your tags',
    why: 'A card with no job the deck tracks may be doing something that is not written down - or nothing the deck needs.' },

  // Always kept
  { id: 'key', group: 'Always kept', toward: 'keep', weight: 0, protects: true, label: 'Tagged as a win condition, engine or payoff',
    why: 'The cards your tags say are the plan are never offered as cuts.' },
  { id: 'pet', group: 'Always kept', toward: 'keep', weight: 0, protects: true, label: 'Tagged Pet, Fun or Favourite',
    why: 'Do not cut the cards that make the deck fun for generic ones. Tag them Pet and they are never offered.' },
];

export const RULE_GROUPS: RuleGroup[] = ['The plan and its themes', 'Tags and counts', 'Curve and mana', 'Interaction', 'Card quality', 'Always kept'];

/** A rule the owner wrote: when a card has this, protect it or move its score. */
export interface CustomRule {
  when: 'tag' | 'role' | 'mv-at-least' | 'mv-at-most' | 'card';
  value: string;
  /** 'protect', or a score change (+ toward cutting, - toward keeping). */
  then: 'protect' | number;
}

export interface CutSettings {
  /** Per rule: switched off, or a different weight. */
  rules: Record<string, { on?: boolean; weight?: number }>;
  custom: CustomRule[];
}

export const NO_SETTINGS: CutSettings = { rules: {}, custom: [] };

/** A rule's weight for this deck, 0 when it is off. */
export function weightOf(settings: CutSettings, id: string): number {
  const rule = CUT_RULES.find((r) => r.id === id);
  if (!rule || !ruleOn(settings, id)) return 0;
  return settings.rules[id]?.weight ?? rule.weight;
}

/** Whether a rule is on for this deck: as the owner set it, else its default. */
export function ruleOn(settings: CutSettings, id: string): boolean {
  const mine = settings.rules[id]?.on;
  if (mine !== undefined) return mine;
  return !CUT_RULES.find((r) => r.id === id)?.offByDefault;
}

/** Settings as sent by the page, kept to what makes sense. */
export function cleanSettings(raw: unknown): CutSettings {
  const r = (raw ?? {}) as Partial<CutSettings>;
  const rules: CutSettings['rules'] = {};
  for (const [id, v] of Object.entries(r.rules ?? {})) {
    if (!CUT_RULES.some((x) => x.id === id) || !v || typeof v !== 'object') continue;
    const out: { on?: boolean; weight?: number } = {};
    if (typeof v.on === 'boolean') out.on = v.on;
    if (typeof v.weight === 'number' && Number.isFinite(v.weight)) out.weight = Math.max(0, Math.min(3, Math.round(v.weight * 10) / 10));
    if (Object.keys(out).length) rules[id] = out;
  }
  const custom = (Array.isArray(r.custom) ? r.custom : []).filter((c): c is CustomRule =>
    !!c && ['tag', 'role', 'mv-at-least', 'mv-at-most', 'card'].includes(c.when) && typeof c.value === 'string' && c.value.trim() !== ''
    && (c.then === 'protect' || (typeof c.then === 'number' && Number.isFinite(c.then))))
    .slice(0, 30)
    .map((c): CustomRule => ({ when: c.when, value: c.value.trim().slice(0, 120), then: c.then === 'protect' ? 'protect' : Math.max(-3, Math.min(3, Math.round(c.then * 10) / 10)) }));
  return { rules, custom };
}

/** Whether a custom rule applies to a card. */
export function customApplies(rule: CustomRule, card: { name: string; cmc: number; roles: string[]; tags: string[] }): boolean {
  const v = rule.value.toLowerCase();
  switch (rule.when) {
    case 'tag': return card.tags.some((t) => t.toLowerCase() === v);
    case 'role': return card.roles.some((r) => r.toLowerCase() === v);
    case 'card': return card.name.toLowerCase() === v || card.name.split(' // ')[0].toLowerCase() === v;
    case 'mv-at-least': return card.cmc >= Number(rule.value);
    case 'mv-at-most': return card.cmc <= Number(rule.value);
  }
}

export function describeCustom(rule: CustomRule): string {
  const when = { tag: `tagged ${rule.value}`, role: `in the role ${rule.value}`, card: rule.value, 'mv-at-least': `mana value ${rule.value} or more`, 'mv-at-most': `mana value ${rule.value} or less` }[rule.when];
  return rule.then === 'protect' ? `Your rule: ${when} - never cut` : `Your rule: ${when} ${rule.then > 0 ? '+' : ''}${rule.then}`;
}
