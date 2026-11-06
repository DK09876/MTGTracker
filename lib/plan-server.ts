/**
 * The Plan tab's whole picture of a deck: every part of the plan with its
 * value, who set it, how sure the app is, whether it is confirmed and how
 * it was worked out; what to look at first; every rule the app uses with
 * this deck's setting; the deck's changes to the usual rules; and Claude's
 * proposals from its last read, to accept or skip. Server only.
 */

import { cardTags } from './card-store';
import { CUT_RULES, ruleOn, weightOf } from './cut-rules';
import { cardsInList, createTag, deckTags, deleteTag, setCardTag, setTagBrief, type List } from './db';
import { JOB_LABELS, type Job, type JobId } from './deck-numbers';
import {
  changePlan, cutSettings, draftFromCards, effectiveCutSettings, GOALS, PARTS, planFor, saveSnapshot, type Override, type PartId, type Plan, type PlanChange, type Source,
} from './deck-plan';
import { commanderRoles, deckRoles, keeps } from './deck-roles';
import { fitProfile } from './fit';
import {
  COMMANDER_ROLES, dependentShare, detectArchetype, detectBracket, detectBuild, detectCommanderRole, detectFlip, detectLean, detectRoutes, detectStages,
  detectStyleParts, detectThemes, keyCandidates, PROTECTION_BY_LEAN, type Explained, type RouteFound, type Strength, type ThemeFound,
} from './plan-detect';
import { readsFor } from './reads';
import type { RoleCount } from './roles';
import type { ScryfallCard } from './scryfall';
import { sectionsOf } from './sections';
import { combosInDeck, estimateBracket, type BracketReport, type Combo, type DeckList } from './spellbook';
import { STYLES, VALUE } from './styles';
import { PROPOSAL_PARTS, type PlanSuggestion } from './tagging';
import { isJobTag, nextColor, tagKey } from './tags';
import { guessWinRoutes } from './wincons';

// --- what Commander Spellbook says, kept until the deck changes ----------------

const facts = new Map<string, Promise<{ bracket: BracketReport | null; combos: { included: Combo[] } | null }>>();

/** The bracket report and the combos in the deck, asked once per version of the deck. */
export function deckFacts(list: Pick<List, 'id' | 'updatedAt' | 'commander'>, commanders: string[], main: Array<{ card: ScryfallCard; quantity: number }>) {
  const key = `${list.id}:${list.updatedAt}:${commanders.join('+')}`;
  if (!facts.has(key)) {
    if (facts.size > 100) facts.clear();
    const deck: DeckList = { commanders, main: main.map((c) => ({ name: c.card.name, quantity: c.quantity })) };
    facts.set(key, Promise.all([estimateBracket(deck).catch(() => null), combosInDeck(deck).catch(() => null)]).then(([bracket, combos]) => {
      // Not kept when Spellbook could not be asked: the next look asks again.
      if (!bracket || !combos) facts.delete(key);
      return { bracket, combos };
    }));
  }
  return facts.get(key)!;
}

// --- the parts as the page shows them ----------------------------------------------

export interface PlanPart {
  id: PartId | 'archetype';
  value: unknown;
  source: Source;
  strength: Strength | null;
  confirmed: boolean;
  how: Explained;
  /** Changes to the usual rules that moved this part, in words. */
  changedBy: string[];
}

export interface ThemeView extends Omit<ThemeFound, 'cards'> {
  count: number;
  cards: string[];
  status: 'open' | 'kept' | 'dropped' | 'yours';
  tagId: string | null;
}

export interface RouteView extends RouteFound {
  main: boolean;
  dropped: boolean;
  own: boolean;
}

export interface RuleLine { group: string; name: string; rule: string; setting: string; changed: string | null }
export interface ChangeLine { id: string; what: string; why: string; affects: string; by: 'yours' | 'claude'; on: boolean; undo: PlanChange | null; note?: string }
export interface ProposalLine { key: string; kind: PlanSuggestion['kind']; part: string; label: string; value: string; why: string; detected?: string; affects?: string; status: 'open' | 'accepted' | 'skipped'; usable: boolean }

export interface PlanState {
  confirmed: boolean;
  progress: { done: number; total: number };
  parts: Record<string, PlanPart>;
  lookFirst: Array<{ id: string; text: string }>;
  rules: RuleLine[];
  changes: ChangeLine[];
  proposals: ProposalLine[];
  notes: Plan['notes'];
  styles: Array<{ id: string; label: string; note: string; cards: number }>;
  goals: readonly string[];
  roles: readonly string[];
  /** Few cards: the Plan tab asks four quick things first. */
  small: boolean;
  /** Main is short and the "Might go in" sections make up the rest: read together. */
  pile: { main: number; pool: number } | null;
  brief: string;
  draft: string;
  gameChangers: string[];
  /** Kept for the pages that read these from the plan. */
  bracket: number | null;
  flip: { value: number; mine: boolean };
  lands: [number, number];
}

const short = (name: string) => name.split(',')[0];
const PET = /^(pets?|pet cards?|fun|favou?rites?)$/i;
const JOB_IDS = new Set(['ramp', 'draw', 'impulse', 'interaction', 'wipe', 'protection', 'finishers']);
const rows = (roles: RoleCount[]): Job[] => roles.filter((r) => JOB_IDS.has(r.id))
  .map((r) => ({ id: r.id as JobId, label: r.label, group: r.group, count: r.count, cards: r.cards, range: r.target, how: (r as RoleCount & { how?: Job['how'] }).how ?? { inputs: [], steps: [] } }));

/** Everything the Plan tab shows. Also keeps the detection, for the pages that only read the plan. */
export async function planState(list: List): Promise<PlanState> {
  const all = cardsInList(list.id);
  const main = all.filter((c) => c.board === 'main');
  const sections = sectionsOf(list.id);
  const inBoards = new Set(sections.filter((s) => s.purpose === 'in').map((s) => s.id as string));
  const extra = all.filter((c) => inBoards.has(c.board ?? ''));
  const mainCount = main.reduce((n, c) => n + c.quantity, 0) + (list.commander ? 1 : 0);
  const extraCount = extra.reduce((n, c) => n + c.quantity, 0);
  const pile = mainCount < 95 && mainCount + extraCount >= 100 ? { main: mainCount, pool: extraCount } : null;
  const pool = pile ? [...main, ...extra] : main;
  const partner = main.find((c) => c.slot === 'partner')?.card ?? null;
  const companion = all.find((c) => c.slot === 'companion')?.card ?? null;
  const commander = list.commander;
  const commanders = [commander, partner].filter((c): c is ScryfallCard => !!c);
  const tags = deckTags(list.id);
  const [roles, cmdRoles, f] = await Promise.all([
    deckRoles(list.id, main).catch(() => [] as RoleCount[]),
    commanderRoles(commander).catch(() => [] as string[]),
    deckFacts(list, commanders.map((c) => c.name), main),
  ]);
  const plan = planFor(list.id, tags.brief, commander, main);
  const s = plan.stored;
  const jobs = rows(roles);
  const withCommander = [...main, ...commanders.map((card) => ({ card, quantity: 1 }))];

  // Detected, every part.
  const bracketD = detectBracket(main, commanders, f.bracket);
  const styleD = detectStyleParts(commander, main);
  const roleD = detectCommanderRole(commander, main, roles, jobs, cmdRoles);
  const role = s.role?.v ?? roleD.value;
  const fit = fitProfile(commander);
  const buildD = detectBuild(main, fit);
  const oracle = cardTags(pool.map((c) => c.card.oracle_id).filter((x): x is string => !!x));
  const themesD = detectThemes(commander, pool, (c) => oracle.get(c.oracle_id ?? '') ?? []);
  const routesFound = guessWinRoutes({ cards: withCommander, roles, combos: f.combos?.included ?? null }).routes;
  const routesD = detectRoutes(routesFound, commander, role, themesD.value);
  const rc = s.routes ?? { dropped: [], main: null, extra: {}, custom: [] };
  const routes: RouteView[] = [
    ...routesD.value.map((r) => ({ ...r, cards: [...new Set([...r.cards, ...(rc.extra[r.id] ?? [])])], own: false })),
    ...rc.custom.map((c) => ({ id: c.id, label: c.label, how: c.how, cards: [...new Set([...c.cards, ...(rc.extra[c.id] ?? [])])], strength: 'some' as const, needsCommander: !!commander && c.cards.includes(commander.name), own: true })),
  ].map((r, i, list_) => ({ ...r, dropped: rc.dropped.includes(r.id), main: rc.main ? rc.main === r.id : r.id === (list_.find((x) => x.strength === 'strong' && !rc.dropped.includes(x.id)) ?? list_.find((x) => !rc.dropped.includes(x.id)))?.id }));
  const kept = routes.filter((r) => !r.dropped);
  const share = dependentShare(commander, main);
  const leanD = detectLean(role, kept, share, main.length);
  const keyDefault = commanders.map((c) => c.name);
  const keyCards = s.key?.v?.length ? s.key.v : keyDefault;
  const candidates = keyCandidates(pool, tags.brief, routesFound, f.combos?.included ?? null, commander)
    .filter((n) => !keyCards.includes(n) && !(s.key?.dismissed ?? []).includes(n));
  const keyObjects = keyCards.map((n) => withCommander.find((c) => c.card.name === n)?.card).filter((c): c is ScryfallCard => !!c);
  const flipD = detectFlip(commander, keyObjects);
  const styleList = [plan.style, ...(plan.style2 ? [plan.style2] : [])].filter((x) => x.id !== 'value');
  const stagesD = detectStages(commander, plan.flip.value, styleList, kept, jobs);
  const archetypeD = detectArchetype(main, jobs, kept);
  const mainRoute = kept.find((r) => r.main);
  const draft = tags.brief ? '' : plan.draft || draftFromCards(commander, plan.style, plan.style2, mainRoute ? mainRoute.cards : kept.flatMap((r) => r.cards));

  // Themes: detected ones (open, kept as a tag, or dropped) and the owner's own theme tags.
  const tc = s.themes ?? { dropped: [], kept: {}, sizes: {} };
  const inMain = new Set(main.map((c) => tagKey(c.card)));
  const nameByKey = new Map(main.map((c) => [tagKey(c.card), c.card.name]));
  const tagMembers = (tagId: string) => tags.cardTags.filter((ct) => ct.on && ct.tagId === tagId).map((ct) => nameByKey.get(ct.key)).filter((n): n is string => !!n);
  const jobLists = roles.filter((r) => ['ramp', 'draw', 'removal', 'counter', 'wipe', 'protection', 'recursion', 'tutor', 'interaction'].includes(r.id));
  // Job tags (Ramp, Draw, Removal...) stay tags, but they are not themes: the built-in jobs count them.
  const ownThemeTags = tags.tags.filter((t) => t.status === 'accepted' && t.kind !== 'wincon' && !PET.test(t.name) && !isJobTag(t.name, tagMembers(t.id), jobLists));
  const keptIds = new Set(Object.values(tc.kept));
  const tagCount = (tagId: string) => tags.cardTags.filter((ct) => ct.on && ct.tagId === tagId && inMain.has(ct.key)).length;
  const kindCount = (tagId: string) => (tags.tags.find((t) => t.id === tagId)?.kind ?? null);
  const themes: ThemeView[] = [
    ...themesD.value.map((t) => {
      const tagId = tc.kept[t.id] && tags.tags.some((x) => x.id === tc.kept[t.id]) ? tc.kept[t.id] : null;
      return { ...t, cards: t.cards, count: tagId ? tagCount(tagId) : t.cards.length, size: tagId ? plan.packages[tagId] ?? t.size : tc.sizes[t.id] ?? t.size, tagId, status: (tagId ? 'kept' : tc.dropped.includes(t.id) ? 'dropped' : 'open') as ThemeView['status'] };
    }),
    ...ownThemeTags.filter((t) => !keptIds.has(t.id)).map((t) => ({
      id: `tag:${t.id}`, name: t.name, cards: [], count: tagCount(t.id), commander: false, size: plan.packages[t.id] ?? 8,
      enablers: kindCount(t.id) === 'enabler' ? tagCount(t.id) : 0, payoffs: kindCount(t.id) === 'payoff' ? tagCount(t.id) : 0, multipliers: kindCount(t.id) === 'multiplier' ? tagCount(t.id) : 0,
      strength: 'clear' as Strength, tagId: t.id, status: 'yours' as const,
    })),
  ];

  // Never cut: key cards, cards of the ways to win, pets, ★ keeps, cards tagged as a win condition.
  const starred = keeps(list.id);
  const petTags = new Set(tags.tags.filter((t) => t.status === 'accepted' && PET.test(t.name)).map((t) => t.id));
  const winTags = new Set(tags.tags.filter((t) => t.status === 'accepted' && t.kind === 'wincon').map((t) => t.id));
  const protectedList = new Map<string, string>();
  for (const n of keyCards) protectedList.set(n, commanders.some((c) => c.name === n) ? 'commander' : 'key card');
  for (const r of kept) for (const n of r.cards) if (!protectedList.has(n) && main.some((c) => c.card.name === n)) protectedList.set(n, `way to win: ${r.label.toLowerCase()}`);
  for (const c of main) {
    const k = tagKey(c.card);
    const on = tags.cardTags.filter((ct) => ct.on && ct.key === k);
    if (on.some((ct) => petTags.has(ct.tagId))) protectedList.set(c.card.name, 'pet card');
    else if (on.some((ct) => winTags.has(ct.tagId)) && !protectedList.has(c.card.name)) protectedList.set(c.card.name, 'tagged as a win condition');
    if (starred.has(c.card.oracle_id ?? c.card.id) && !protectedList.has(c.card.name)) protectedList.set(c.card.name, '★ you kept it');
  }

  // Keep the detection for the pages that only read the plan.
  saveSnapshot(list.id, {
    lean: leanD.value, role: roleD.value, build: buildD.value, keyCards, bracketLooks: bracketD.value, stages: stagesD.value, archetype: archetypeD.value,
    flip: flipD.value !== (commander?.cmc ?? 4) ? flipD.value : undefined,
    routeCards: [...new Set(kept.flatMap((r) => r.cards))].filter((n) => !commanders.some((c) => c.name === n)),
    routes: kept.map((r) => ({ label: r.label, cards: r.cards, needsCommander: r.needsCommander, main: r.main })),
    themes: themes.filter((t) => t.status !== 'dropped').map((t) => ({ id: t.id, name: t.name, size: t.size, cards: t.cards })),
  });

  // The parts.
  const ok = plan.confirmedParts;
  const on = plan.overrides.filter((o) => o.on);
  const changedBy = (pred: (o: Override) => boolean) => on.filter(pred).map((o) => o.what);
  const part = (id: PlanPart['id'], value: unknown, source: Source, strength: Strength | null, how: Explained, changed: string[] = []): PlanPart =>
    ({ id, value, source, strength: source === 'detected' ? strength : null, confirmed: id === 'archetype' ? true : ok[id as PartId], how, changedBy: changed });
  const who = (by: 'yours' | 'claude' | undefined): Source => by ?? 'yours';
  const targetsMine = plan.targets.some((t) => t.mine);
  const jobOf = (id: string) => jobs.find((j) => j.id === id);
  const parts: Record<string, PlanPart> = {
    goal: part('goal', plan.goal, s.goal ? who(s.goal.by) : 'unset', null, {
      inputs: [`Chips: ${plan.goal.chips.join(', ') || 'none'}`, ...(plan.goal.text ? [`In your words: ${plan.goal.text}`] : [])],
      steps: ['“Faster” and “Win more often” lower the curve the cut list aims for and favour cheap ramp. “More fun, keep my pets” protects pet and theme cards harder. “Spend less” keeps suggestions inside your budget. “Stay on theme” keeps suggestions inside your themes and deck rule. “Fit my table” keeps suggestions inside your bracket.', 'Claude reads the chips and your words, and may propose changes to the usual rules that serve them.'],
      idea: 'The usual guidelines fit most decks; what you are optimizing for decides when to step away from them.',
    }),
    commanders: part('commanders', { commander: commander?.name ?? null, partner: partner?.name ?? null, companion: companion?.name ?? null }, 'detected', 'clear', {
      inputs: [commander ? `Commander: ${commander.name}` : 'No commander set', partner ? `Second commander: ${partner.name}` : 'No second commander', companion ? `Companion: ${companion.name}` : 'No companion'],
      steps: ['Set when the deck was imported or from a card’s ⋯ menu. A second commander counts inside the 100; a companion sits outside it.'],
      idea: 'The commanders set the deck’s colours and are in every game.',
    }),
    bracket: part('bracket', { value: plan.bracket, looksLike: bracketD.value }, plan.bracket ? who(s.bracket?.by) : 'detected', bracketD.strength, bracketD.how),
    budget: part('budget', plan.budget, s.budget ? who(s.budget.by) : 'unset', null, {
      inputs: [plan.budget ? `Up to $${plan.budget} a card` : 'Any price'],
      steps: ['Suggestions over this price are left out, unless you own the card.'], idea: 'A budget is a choice about the deck, so it is yours to set.',
    }),
    own: part('own', plan.own, s.own ? who(s.own.by) : 'unset', null, {
      inputs: [plan.own ? 'Only cards you own' : 'Any card'], steps: ['When on, suggestions come only from your collection and your other decks, saying where each copy is.'], idea: 'Building from what you have is a choice, so it is yours to set.',
    }),
    rule: part('rule', plan.rule, s.rule ? who(s.rule.by) : 'unset', null, {
      inputs: [plan.rule.text ? `Rule: ${plan.rule.text}` : 'No rule', ...(plan.rule.filter ? [`Card filter: ${plan.rule.filter}`] : [])],
      steps: ['Suggestions keep to the rule. With a card filter (search syntax), cards that don’t match it are never suggested.', 'Nothing is cut for being weaker because of the rule.'],
      idea: 'A restriction you set yourself makes the deck what it is; a smaller card pool is expected, not a fault.',
    }),
    brief: part('brief', { text: tags.brief, draft }, tags.brief ? who(s.brief?.by) : 'detected', 'guess', {
      inputs: ['Your words, or a one-line draft from the style and the ways to win'],
      steps: ['Claude reads it in every step. The rules read the parts below it, not the words.'], idea: 'What the deck does, in your words.',
    }),
    style: part('style', { primary: plan.style.id, secondary: plan.style2?.id ?? null, own: s.style?.own ?? null }, plan.chosen.style || plan.chosen.style2 ? who(s.style?.by) : 'detected', styleD.strength, styleD.how),
    role: part('role', role, s.role ? who(s.role.by) : 'detected', roleD.strength, roleD.how),
    build: part('build', s.build?.v ?? buildD.value, s.build ? who(s.build.by) : 'detected', buildD.strength, buildD.how),
    key: part('key', { cards: keyCards, candidates }, s.key?.v?.length ? who(s.key.by) : 'detected', candidates.length ? 'likely' : 'clear', {
      inputs: [`Key cards: ${keyCards.join(', ') || 'none'}`, `Suggested: ${candidates.join(', ') || 'none'}`],
      steps: ['The commander is the key card until you name others.', 'Suggested: cards your brief names, cards in two or more ways to win, cards that win the game on their own, and pieces of a winning combo. Never added without you.', 'A key card is never cut; if it costs more than the commander, it sets the flip turn.'],
      idea: 'Sometimes the real build-around is a card in the 99, not the commander.',
    }),
    themes: part('themes', themes, s.themes?.by ? who(s.themes.by) : 'detected', themesD.strength, themesD.how, changedBy((o) => o.kind === 'theme-size')),
    stages: part('stages', s.stages?.v ?? stagesD.value, s.stages ? who(s.stages.by) : 'detected', stagesD.strength, stagesD.how),
    routes: part('routes', routes, s.routes?.by ? who(s.routes.by) : 'detected', routesD.strength, routesD.how),
    lean: part('lean', plan.lean, s.lean ? who(s.lean.by) : 'detected', leanD.strength, leanD.how),
    flip: part('flip', plan.flip.value, plan.flip.mine ? who(s.flip?.by) : 'detected', flipD.strength, flipD.how),
    lands: part('lands', { have: plan.landNumber.have, range: plan.lands, want: plan.landNumber.want }, plan.landsSource, 'clear',
      { ...plan.landNumber.how, idea: 'Higher curves need more lands; cheap ramp and cheap draw let you run a few fewer. Never cut lands just to make room.' }, changedBy((o) => o.kind === 'lands')),
    ranges: part('ranges', plan.targets.map((t) => ({ job: t.role, label: t.label, range: t.range, source: t.source, from: t.from, count: jobOf(t.role)?.count ?? null, how: jobOf(t.role)?.how ?? null })).concat(
      jobOf('impulse') ? [{ job: 'impulse', label: JOB_LABELS.impulse, range: null as unknown as [number, number], source: 'detected', from: 'counted apart from card draw', count: jobOf('impulse')!.count, how: jobOf('impulse')!.how }] : []),
    targetsMine ? who(s.ranges?.by) : 'detected', 'clear', {
      inputs: [`Flip turn: ${plan.flip.value}`, `Style: ${plan.style.label}${plan.style2 ? ` + ${plan.style2.label}` : ''}`, `Leans on the commander: ${plan.lean}`],
      steps: ['Base ranges: ramp 11–13, card draw 10–12, interaction 10–12 (board wipes 1–2 inside it), ways to finish 3–5.', `Ramp: 12 at a flip turn of 4, one more or fewer per mana → ${plan.targets.find((t) => t.role === 'ramp')?.range.join('–')}. Ramp costing the flip turn or more counts half; a commander that ramps counts.`, `Protection: low 1–2, medium 2–3, high 3–5 → ${PROTECTION_BY_LEAN[plan.lean].join('–')}.`, 'Styles move some ranges (a discard deck runs more draw). Your own ranges win, then changes to the usual rules.', 'Interaction counts removal, counterspells and wipes; removal you can use again counts twice. Impulse draw is counted apart.'],
      idea: 'Counts are ranges tied to the commander and the curve, never pass or fail.',
    }, changedBy((o) => o.kind === 'range')),
    protected: part('protected', [...protectedList.entries()].map(([name, why]) => ({ name, why })), 'detected', 'clear', {
      inputs: [`Key cards: ${keyCards.length}`, `Cards of the ways to win: ${new Set(kept.flatMap((r) => r.cards)).size}`, `Pet cards and ★ keeps: ${[...protectedList.values()].filter((w) => w === 'pet card' || w.startsWith('★')).length}`],
      steps: ['Key cards, the cards of every way to win you keep, cards tagged Pet, cards tagged as a win condition and ★ keeps are never offered as cuts.'],
      idea: 'Don’t cut the cards that are why you play the deck, or the ones that win it.',
    }),
    archetype: part('archetype', archetypeD.value, 'detected', archetypeD.strength, archetypeD.how),
  };

  // What to look at first: the weakest guesses not yet confirmed.
  const lookFirst: PlanState['lookFirst'] = [];
  const add = (id: PartId, text: string) => { if (!ok[id]) lookFirst.push({ id, text }); };
  if (!plan.bracket) add('bracket', `Which bracket are you aiming for? This list looks like ${bracketD.value}.`);
  if (!tags.brief) add('brief', 'Say in a sentence what this deck should do, or have Claude draft it.');
  if (styleD.strength === 'guess' && !plan.chosen.style) add('style', 'The style is a guess: check it.');
  if (!kept.length) add('routes', 'No way to win found yet.');
  else if (kept.every((r) => r.needsCommander)) add('routes', 'Every way to win needs the commander.');
  if (themes.some((t) => t.status === 'open' && t.strength === 'guess')) add('themes', 'Some themes are guesses: keep or drop them.');
  if (roleD.strength === 'guess' && !s.role) add('role', 'What the commander does for the deck is a guess.');
  if (leanD.strength === 'guess' && !s.lean) add('lean', 'How much the deck leans on its commander is a guess.');
  if (stagesD.strength === 'guess' && !s.stages) add('stages', 'The game plan by stage is a first draft: check the three lines.');

  // Every rule, with this deck's setting.
  const eff = effectiveCutSettings(list.id);
  const mineCut = cutSettings(list.id);
  const rules: RuleLine[] = [
    { group: 'Numbers', name: 'Lands', rule: 'The curve formula: 31.42 + 3.13 × average mana value − 0.28 × cheap ramp and draw, never below 37.', setting: `${plan.lands[0]}–${plan.lands[1]}`, changed: on.find((o) => o.kind === 'lands')?.what ?? null },
    ...plan.targets.map((t) => ({ group: 'Numbers', name: t.label, rule: ({ ramp: '12 at a flip turn of 4, one more or fewer per mana. Ramp costing the flip turn or more counts half; a ramping commander counts.', draw: 'Cards that leave you with more cards. Cantrips and impulse draw don’t count.', interaction: 'Removal, counterspells and board wipes together; removal you can use again counts twice.', wipe: 'One or two inside interaction, one more with under 15 creatures, never past 4.', protection: 'Moves with how much the deck leans on its commander: low 1–2, medium 2–3, high 3–5.', finishers: 'Alternate wins, finishers, extra turns, extra combats, overruns and drain.' } as Record<string, string>)[t.role] ?? '', setting: `${t.range[0]}–${t.range[1]}${t.mine ? ' (yours)' : ''}`, changed: t.source === 'override' ? t.from : null })),
    { group: 'The plan', name: 'Style', rule: 'Every style the commander’s text matches, ranked by how many cards share it; a second style needs 8+ cards, one the commander doesn’t name 15+.', setting: `${plan.style.label}${plan.style2 ? ` + ${plan.style2.label}` : ''}`, changed: null },
    { group: 'The plan', name: 'What the commander does', rule: 'Multiplier if it doubles things; engine if it makes value every turn and the 99 has few engines; covers a weakness if it fills a job the 99 is short of; payoff if it rewards what 10+ cards do; otherwise enabler.', setting: role, changed: null },
    { group: 'The plan', name: 'Broad or dense', rule: 'Dense when a narrow theme (a creature type, snow, curses) has 20+ cards or a broad one 30+.', setting: s.build?.v ?? buildD.value, changed: null },
    { group: 'The plan', name: 'Themes', rule: 'From the commander’s text, rules text and Scryfall tags. 8 cards each, 16 for the main theme; enablers 12+, payoffs about half, about 3 multipliers.', setting: themes.filter((t) => t.status !== 'dropped').map((t) => `${t.name} ${t.size}`).join(', ') || 'none', changed: on.filter((o) => o.kind === 'theme-size').map((o) => o.what).join('; ') || null },
    { group: 'The plan', name: 'Leans on the commander', rule: 'Engine +2, covers a weakness +0, else +1; every way to win needs it +2, some +1; a quarter of the 99 plays to it +1. 3+ high, 2 medium.', setting: plan.lean, changed: null },
    { group: 'The plan', name: 'Flip turn', rule: 'The commander’s mana value, or a key card’s when it costs more.', setting: String(plan.flip.value), changed: null },
    { group: 'The plan', name: 'Archetype', rule: 'Combo if the main way to win is a combo; control with 15+ interaction, 14+ draw and under 15 creatures; aggro with 30+ cheap creatures; else midrange.', setting: archetypeD.value, changed: null },
    { group: 'The plan', name: 'Bracket', rule: 'Suggestions never add more Game Changers than the bracket allows (none in 1–2, three in 3), nor extra turns or mass land destruction below 4.', setting: plan.bracket ? String(plan.bracket) : `not set (looks like ${bracketD.value})`, changed: null },
    { group: 'Never cut', name: 'Protected cards', rule: 'Key cards, cards of the ways to win you keep, pet cards, cards tagged as a win condition and ★ keeps.', setting: `${protectedList.size} cards`, changed: null },
    ...CUT_RULES.map((r) => ({
      group: 'The cut list', name: r.label, rule: r.why,
      setting: !ruleOn(eff.settings, r.id) ? 'off' : r.protects ? 'on' : `on, weight ${weightOf(eff.settings, r.id)}${mineCut.rules[r.id] ? ' (yours)' : ''}`,
      changed: eff.changed[r.id]?.what ?? null,
    })),
  ];

  // Changes to the usual rules: overrides, and the ones the owner made by setting a value.
  const changes: ChangeLine[] = [
    ...plan.overrides.map((o) => ({ id: o.id, what: o.what, why: o.why, affects: o.affects, by: o.by, on: o.on, undo: { overrides: { toggle: { id: o.id, on: !o.on } } } as PlanChange })),
    ...plan.targets.filter((t) => t.mine).map((t) => ({ id: `range:${t.role}`, what: `${t.label} ${t.styleRange.join('–')} → ${t.range.join('–')}`, why: 'Your range.', affects: 'Plan, Tune, Check', by: 'yours' as const, on: true, undo: { targets: { [t.role]: null } } })),
    ...(plan.landNumber.mine && !on.some((o) => o.kind === 'lands') ? [{ id: 'range:lands', what: `Lands ${plan.landNumber.want} → ${plan.lands.join('–')}`, why: 'Your range.', affects: 'Lands, Cuts', by: 'yours' as const, on: true, undo: { targets: { lands: null } } }] : []),
    ...Object.entries(mineCut.rules).map(([id, v]) => ({ id: `cut:${id}`, what: `${CUT_RULES.find((r) => r.id === id)?.label ?? id}: ${v.on === false ? 'off' : `weight ${v.weight}`}`, why: 'Your cut-rule setting.', affects: 'Cuts', by: 'yours' as const, on: true, undo: null, note: 'Change it on Tune → Cut → Rules.' })),
  ];

  // Claude's proposals from its last read.
  const reads = readsFor(list.id);
  const latest = [reads.draft, ...reads.saved].filter((r) => r && r.model && r.suggestions?.length).sort((a, b) => (a!.at < b!.at ? 1 : -1))[0] ?? null;
  const names = new Set(pool.map((c) => c.card.name));
  const proposals: ProposalLine[] = (latest?.suggestions ?? []).filter((x) => x.kind !== 'note').map((x, i) => {
    const key = `${latest!.id}:${i}`;
    return {
      key, kind: x.kind, part: x.part, label: proposalLabel(x), value: x.value, why: x.why, detected: x.detected, affects: x.affects,
      status: plan.proposalStatus[key] ?? 'open', usable: !!toChange(x, names, themesD.value, routes).change,
    };
  });

  const total = PARTS.length;
  return {
    confirmed: plan.confirmed,
    progress: { done: PARTS.filter((id) => ok[id]).length, total },
    parts, lookFirst: lookFirst.slice(0, 4), rules, changes, proposals, notes: plan.notes,
    styles: [...STYLES, VALUE].map((x) => ({ id: x.id, label: x.label, note: x.note, cards: plan.detected.support[x.id] ?? 0 })),
    goals: GOALS, roles: COMMANDER_ROLES,
    small: mainCount < 10, pile,
    brief: tags.brief, draft,
    gameChangers: [...commanders, ...main.map((c) => c.card)].filter((c) => c.game_changer === true).map((c) => c.name),
    bracket: plan.bracket, flip: plan.flip, lands: plan.lands,
  };
}

// --- Claude's proposals ---------------------------------------------------------------

const PART_LABEL: Record<string, string> = {
  style: 'Main style', style2: 'Second style', role: 'What the commander does', build: 'Broad or dense', key: 'Key card', theme: 'Theme', rule: 'Deck rule', route: 'Way to win',
  lean: 'Leans on the commander', flip: 'Flip turn', 'stage-early': 'Early game', 'stage-mid': 'Middle game', 'stage-close': 'Closing the game',
};

function proposalLabel(x: PlanSuggestion): string {
  if (x.kind === 'override') return `Change to the usual rules: ${x.part}`;
  return `${x.kind === 'disagreement' ? 'I’d change what was detected · ' : ''}${PART_LABEL[x.part] ?? x.part}`;
}

const range = (v: string): [number, number] | null => {
  const m = v.match(/(\d+)\s*(?:[-–to]+\s*(\d+))?/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2] ?? m[1]);
  return a <= b && b <= 99 ? [a, b] : null;
};
const cardsIn = (v: string, names: Set<string>) => v.split(/[,;]/).map((x) => x.trim()).map((x) => [...names].find((n) => n.toLowerCase() === x.toLowerCase() || short(n).toLowerCase() === x.toLowerCase())).filter((n): n is string => !!n);

/** What accepting a suggestion changes, or why it can't be used. */
export function toChange(x: PlanSuggestion, names: Set<string>, themes: ThemeFound[], routes: RouteView[]): { change: PlanChange | null; theme?: { name: string; cards: string[] }; brief?: string } {
  const v = x.value.trim();
  const by = 'claude' as const;
  if (x.kind === 'override') {
    const [kind, target = ''] = x.part.split(':').map((p) => p.trim());
    const what = `${x.part} → ${v}`;
    const base = { why: x.why, affects: x.affects ?? '', by };
    if (kind === 'range' && range(v)) return { change: { overrides: { add: { kind: 'range', target, value: range(v), what: `${JOB_LABELS[target as JobId] ?? target} → ${range(v)!.join('–')}`, ...base } } } };
    if (kind === 'lands' && range(v)) return { change: { overrides: { add: { kind: 'lands', target: 'lands', value: range(v), what: `Lands → ${range(v)![0] === range(v)![1] ? range(v)![0] : range(v)!.join('–')}`, ...base } } } };
    if (kind === 'theme-size' && Number.isInteger(Number(v.match(/\d+/)?.[0]))) {
      const t = themes.find((th) => th.name.toLowerCase() === target.toLowerCase() || th.id === target.toLowerCase());
      return t ? { change: { overrides: { add: { kind: 'theme-size', target: t.id, value: Number(v.match(/\d+/)![0]), what: `${t.name} → ${v.match(/\d+/)![0]} cards`, ...base } } } } : { change: null };
    }
    if (kind === 'rule' && CUT_RULES.some((r) => r.id === target)) {
      const label = CUT_RULES.find((r) => r.id === target)!.label;
      return /off/i.test(v)
        ? { change: { overrides: { add: { kind: 'rule-off', target, value: null, what: `“${label}” off`, ...base } } } }
        : Number.isFinite(Number(v)) ? { change: { overrides: { add: { kind: 'rule-weight', target, value: Number(v), what: `“${label}” weight ${v}`, ...base } } } } : { change: null };
    }
    return { change: { overrides: { add: { kind: 'exception', target: x.part, value: null, what: v.slice(0, 120) || what, ...base } } } };
  }
  switch (x.part) {
    case 'style': case 'style2': {
      if (/^own\s*:/i.test(v)) return x.part === 'style' ? { change: { styleOwn: { label: v.replace(/^own\s*:/i, '').trim(), ranges: {} }, by } } : { change: null };
      const st = [...STYLES, VALUE].find((y) => y.id === v.toLowerCase() || y.label.toLowerCase() === v.toLowerCase());
      return st ? { change: x.part === 'style' ? { style: st.id, by } : { style2: st.id, by } } : { change: null };
    }
    case 'role': { const r = COMMANDER_ROLES.find((y) => y.toLowerCase() === v.toLowerCase()); return { change: r ? { role: r, by } : null }; }
    case 'build': return { change: /dense/i.test(v) ? { build: 'Dense', by } : /broad/i.test(v) ? { build: 'Broad', by } : null };
    case 'lean': { const l = ['Low', 'Medium', 'High'].find((y) => y.toLowerCase() === v.toLowerCase()) as 'Low' | 'Medium' | 'High' | undefined; return { change: l ? { lean: l, by } : null }; }
    case 'flip': { const n = Number(v.match(/\d+/)?.[0]); return { change: n >= 1 && n <= 10 ? { flip: n, by } : null }; }
    case 'key': { const c = cardsIn(v, names)[0]; return { change: c ? { key: { add: c }, by } : null }; }
    case 'rule': return { change: { rule: { text: v, filter: '' }, by } };
    case 'theme': {
      const [name, list_ = ''] = v.split(':');
      const cards = cardsIn(list_, names);
      return name.trim() && cards.length ? { change: { by }, theme: { name: name.trim(), cards } } : { change: null };
    }
    case 'route': {
      const [label, list_ = ''] = v.split(':');
      const cards = cardsIn(list_, names);
      if (!label.trim() || !cards.length) return { change: null };
      return routes.some((r) => r.label.toLowerCase() === label.trim().toLowerCase()) ? { change: null } : { change: { routes: { custom: { label: label.trim(), how: x.why, cards } }, by } };
    }
    case 'stage-early': case 'stage-mid': case 'stage-close': return { change: { by } };
    default: return { change: null };
  }
}

/** Accept or skip one of Claude's proposals; accepting applies it with Claude as the source. */
export async function settleProposal(list: List, key: string, status: 'accepted' | 'skipped'): Promise<boolean> {
  const [readId, index] = key.split(':');
  const reads = readsFor(list.id);
  const read = [reads.draft, ...reads.saved].find((r) => r?.id === readId);
  const x = read?.suggestions?.filter((s) => s.kind !== 'note')[Number(index)];
  if (!read || !x) return false;
  if (status === 'skipped') { changePlan(list.id, { proposal: { key, status } }); return true; }
  const all = cardsInList(list.id);
  const names = new Set(all.map((c) => c.card.name));
  const state = await planState(list);
  const themes = (state.parts.themes.value as ThemeView[]).map((t) => ({ ...t, cards: t.cards }));
  const routes = state.parts.routes.value as RouteView[];
  const { change, theme } = toChange(x, names, themes, routes);
  if (!change) return false;
  if (x.part.startsWith('stage-')) {
    const k = x.part.slice(6) as 'early' | 'mid' | 'close';
    const now = state.parts.stages.value as { early: string; mid: string; close: string };
    changePlan(list.id, { stages: { ...now, [k]: x.value }, by: 'claude' });
  } else if (theme) {
    keepTheme(list, { id: theme.name.toLowerCase(), name: theme.name, cards: theme.cards }, 'claude');
  } else {
    changePlan(list.id, change);
  }
  changePlan(list.id, { proposal: { key, status: 'accepted' } });
  return true;
}

/** Keep a detected theme: it becomes one of the deck's own tags, with its cards. */
export function keepTheme(list: Pick<List, 'id'>, theme: { id: string; name: string; cards: string[] }, by: 'yours' | 'claude' = 'yours'): string {
  const tags = deckTags(list.id);
  const existing = tags.tags.find((t) => t.name.toLowerCase() === theme.name.toLowerCase() && t.status === 'accepted');
  const tag = existing ?? createTag(list.id, {
    name: theme.name, description: `Cards that play to ${theme.name.toLowerCase()}.`, color: nextColor(tags.tags.filter((t) => t.status === 'accepted').map((t) => t.color)),
    kind: null, status: 'accepted', origin: 'manual',
  });
  const byName = new Map(cardsInList(list.id).map((c) => [c.card.name, c.card]));
  for (const n of theme.cards) { const c = byName.get(n); if (c) setCardTag(list.id, tagKey(c), tag.id, true); }
  changePlan(list.id, { themes: { kept: { id: theme.id, tagId: tag.id } }, by });
  return tag.id;
}

/** Take back keeping a theme: its tag goes, and it is a detected theme again. */
export function unkeepTheme(list: Pick<List, 'id'>, themeId: string): void {
  const tagId = planFor(list.id, '', null, []).stored.themes?.kept[themeId];
  if (tagId) deleteTag(list.id, tagId);
  changePlan(list.id, { themes: { unkeep: themeId } });
}

/** Accepting Claude's brief: it becomes the brief, marked as Claude's. */
export function acceptBrief(listId: string, brief: string): void {
  setTagBrief(listId, brief.slice(0, 4000));
  changePlan(listId, { briefBy: 'claude', by: 'claude' });
}

export { PROPOSAL_PARTS };
