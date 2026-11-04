/**
 * The rules the cut list adds up, each with where it came from and its
 * weight, and a deck's own settings on top: rules switched off, reweighted,
 * and rules the owner wrote ("tagged Discard outlet: protect"). The list is
 * shown on the Tune tab so the owner can see why a card is offered and
 * change it. Pure, except the storage at the end.
 */

export type RuleSource = 'Commander Template' | '3/3 Elk' | 'Salubrious Snail' | 'EDHREC' | 'Scryfall' | 'Your plan' | 'Your tags';

export interface CutRule {
  id: string;
  label: string;
  source: RuleSource;
  /** Toward cutting (+) or keeping (-); the weight is a size, the sign comes from here. */
  toward: 'cut' | 'keep';
  weight: number;
  /** Only switched on or off - it protects, it has no weight. */
  protects?: boolean;
}

export const CUT_RULES: CutRule[] = [
  { id: 'over', label: 'In a role the deck has more of than its range', source: 'Commander Template', toward: 'cut', weight: 1 },
  { id: 'needed', label: 'In a role the deck is short of', source: 'Commander Template', toward: 'keep', weight: 1 },
  { id: 'curve', label: 'At a mana value the curve is heavy at', source: 'Commander Template', toward: 'cut', weight: 0.5 },
  { id: 'interaction', label: 'Narrow or plain removal when there is plenty: interaction is trimmed first', source: 'Commander Template', toward: 'cut', weight: 0.6 },
  { id: 'flexible', label: 'Removal that hits anything', source: 'Commander Template', toward: 'keep', weight: 0.4 },
  { id: 'wipes', label: 'One of the last two board wipes', source: 'Commander Template', toward: 'keep', weight: 1 },
  { id: 'cmdcost', label: 'Ramp when the commander is cheap, draw when it is dear: the next to trim', source: 'Commander Template', toward: 'cut', weight: 0.4 },
  { id: 'style', label: 'Fits the plan\'s style', source: 'Your plan', toward: 'keep', weight: 0.8 },
  { id: 'theme', label: 'Carries the commander\'s theme (counts most in a Type B deck)', source: 'Salubrious Snail', toward: 'keep', weight: 1.2 },
  { id: 'offtheme', label: 'Nothing the commander cares about, and not a job every deck needs', source: '3/3 Elk', toward: 'cut', weight: 0.6 },
  { id: 'repeat', label: 'Does a job the commander already does, in a role that is full', source: '3/3 Elk', toward: 'cut', weight: 0.3 },
  { id: 'floor', label: 'Low floor: slow, or often does nothing', source: '3/3 Elk', toward: 'cut', weight: 0.6 },
  { id: 'costly', label: 'Costs 6 or more and does not end the game', source: '3/3 Elk', toward: 'cut', weight: 0.4 },
  { id: 'highcurve', label: 'The curve is high: cutting a 5+ drop brings it down', source: '3/3 Elk', toward: 'cut', weight: 0.3 },
  { id: 'staple', label: 'A staple most Commander decks play', source: 'Scryfall', toward: 'keep', weight: 0.8 },
  { id: 'rare', label: 'Rarely played (EDHREC with this commander, or Commander overall)', source: 'EDHREC', toward: 'cut', weight: 0.6 },
  { id: 'cantrip', label: 'Only replaces itself', source: 'Scryfall', toward: 'cut', weight: 0.3 },
  { id: 'norole', label: 'No role and none of your tags', source: 'Scryfall', toward: 'cut', weight: 0.5 },
  { id: 'key', label: 'Tagged as a win condition, engine or payoff: never offered', source: 'Your tags', toward: 'keep', weight: 0, protects: true },
  { id: 'pet', label: 'Tagged Pet, Fun or Favourite: never offered', source: '3/3 Elk', toward: 'keep', weight: 0, protects: true },
];

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
  if (!rule) return 0;
  const mine = settings.rules[id];
  if (mine?.on === false) return 0;
  return mine?.weight ?? rule.weight;
}

export const ruleOn = (settings: CutSettings, id: string) => settings.rules[id]?.on !== false;

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
