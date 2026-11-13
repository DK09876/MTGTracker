/**
 * The facts the plan read gets for one deck: what the app's code works out,
 * no AI. This is the exact pack the deck flow evaluation tested (about 8k
 * tokens for 100 cards): the commander, the numbers against their usual
 * ranges, colour sources, bracket facts, combos and every card with its full
 * rules text. Cards are listed by name, so the order says nothing about a
 * card. Server only.
 */

import { asideOf } from './bracket-aside';
import { onlyUltimate } from './bracket';
import { cardsInList, type List } from './db';
import { jobsOnDeck } from './categories';
import { deckRolesKnown } from './deck-roles';
import { analyse } from './health';
import { planState } from './plan-server';
import { combosInDeck, estimateBracket, SPELLBOOK_TAGS } from './spellbook';
import { oracleTextOf, type ScryfallCard } from './scryfall';

type Part = { value: unknown };
const front = (n: string) => n.split(' // ')[0];
const costOf = (c: ScryfallCard) => c.mana_cost ?? (c.card_faces ?? []).map((f) => f.mana_cost).filter(Boolean).join(' // ') ?? '';
const typeOf = (c: ScryfallCard) => c.type_line ?? (c.card_faces ?? []).map((f) => f.type_line).join(' // ') ?? '';
const oneLine = (s: string) => s.replace(/\n+/g, ' / ');

export async function planFacts(list: List, slug: string, name: string, commanders: string[]) {
  const key = { deck: { name } };
    const all = cardsInList(list.id);
    const main = all.filter((c) => c.board === 'main');
    // Roles already looked up (every card is, nightly): a slow or failing Scryfall never stops the read.
    const roles = await deckRolesKnown(list.id, main);
    const plan = await planState(list);
    const parts = plan.parts as unknown as Record<string, Part>;
    const ranges = (parts.ranges?.value as Array<{ job: string; label: string; count: number | null; range: [number, number] | null; from?: string; how?: { inputs: string[]; steps: string[] } }>) ?? [];
    const onDeck = jobsOnDeck(list.id);
    const lands = parts.lands?.value as { have: number; range: [number, number]; want: number } | undefined;
    const landsHow = (parts.lands as unknown as { how?: { inputs: string[]; steps: string[] } })?.how;
    const health = analyse({ commander: list.commander, cards: main });
    const deckList = { commanders, main: main.map((c) => ({ name: c.card.name, quantity: c.quantity })) };
    const [combos, bracket] = await Promise.all([
      combosInDeck(deckList).catch(() => null),
      estimateBracket(deckList).catch(() => null),
    ]);

    const jobsOf = new Map<string, string[]>();
    for (const r of roles) if (r.count > 0) for (const n of r.cards) jobsOf.set(front(n), [...(jobsOf.get(front(n)) ?? []), r.label]);
    const cmdCards = [list.commander, ...main.filter((c) => c.slot === 'partner').map((c) => c.card)].filter((c): c is ScryfallCard => !!c);
    const cards = main.filter((c) => c.slot !== 'partner').map((c) => ({
      name: c.card.name, quantity: c.quantity, cost: costOf(c.card), mv: c.card.cmc ?? 0, type: typeOf(c.card),
      text: oracleTextOf(c.card), jobs: jobsOf.get(front(c.card.name)) ?? [], gameChanger: !!c.card.game_changer,
      oracleId: c.card.oracle_id ?? null, identity: c.card.color_identity ?? [],
    })).sort((a, b) => a.name.localeCompare(b.name));
    const identity = [...new Set(cmdCards.flatMap((c) => c.color_identity ?? []))].sort();
    // Cards the owner set aside on the bracket box, and a planeswalker whose land denial is only its last ability,
    // aren't sent as land denial or extra turns (Part D 17).
    const aside = asideOf(list.id);
    const byName = new Map([...main.map((c) => c.card), ...cmdCards].map((c) => [front(c.name), c]));
    const ultimate = (n: string) => { const c = byName.get(front(n)); return !!c && /\bPlaneswalker\b/.test(c.type_line ?? '') && onlyUltimate(oracleTextOf(c)); };
    const extraTurns = (bracket ? bracket.cards.filter((c) => c.extraTurn).map((c) => c.name) : (roles.find((r) => r.id === 'extra-turn')?.cards ?? [])).filter((n) => !aside.has(front(n).toLowerCase()));
    const mld = bracket ? bracket.cards.filter((c) => c.massLandDenial).map((c) => c.name).filter((n) => !aside.has(front(n).toLowerCase()) && !ultimate(n)) : [];

    const facts = {
      slug, name: key.deck.name, commanders: cmdCards.map((c) => ({ name: c.name, cost: costOf(c), type: typeOf(c), text: oracleTextOf(c), identity: c.color_identity ?? [] })),
      identity, size: health.size, averageMv: health.averageMv, lands: lands ?? null, landsHow: landsHow ?? null,
      // A usual range only for a job counted on the deck, as on the pages; the others are sent as a plain count.
      jobs: ranges.map((r) => {
        const counted = onDeck.has(r.job === 'impulse' ? 'draw' : r.job);
        return { job: r.job, label: r.label, count: r.count, range: counted ? r.range : null, from: counted ? r.from ?? null : null, how: r.how ?? null };
      }),
      curve: health.curve.map((b) => ({ mv: b.label, count: b.count })), types: health.types,
      colours: health.colors.map((c) => ({ colour: c.color, pips: c.pips, sources: c.sources, needed: c.needed, neededFor: c.neededFor })),
      gameChangers: health.gameChangers, extraTurns, massLandDenial: mld,
      spellbookBracket: bracket ? { tag: SPELLBOOK_TAGS[bracket.tag], twoCardCombos: bracket.combos.filter((c) => c.twoCard).map((c) => c.cards) } : null,
      combos: { included: combos?.included.map((x) => ({ cards: x.cards, produces: x.produces })) ?? null, oneAway: combos?.almost.slice(0, 15).map((x) => ({ cards: x.cards, produces: x.produces, missing: x.missing })) ?? null },
      cards,
    };
  return { facts, md: factsMd(facts as unknown as Facts), plan };
}

export type Facts = {
  name: string; commanders: Array<{ name: string; cost: string; type: string; text: string; identity: string[] }>; identity: string[]; size: number; averageMv: number;
  lands: { have: number; range: [number, number]; want: number } | null; landsHow: { inputs: string[]; steps: string[] } | null;
  jobs: Array<{ job: string; label: string; count: number | null; range: [number, number] | null; from: string | null; how: { inputs: string[]; steps: string[] } | null }>;
  curve: Array<{ mv: string; count: number }>; types: Array<{ label: string; count: number }>;
  colours: Array<{ colour: string; pips: number; sources: number; needed: number | null; neededFor: string | null }>;
  gameChangers: string[]; extraTurns: string[]; massLandDenial: string[]; spellbookBracket: { tag: string; twoCardCombos: string[][] } | null;
  combos: { included: Array<{ cards: string[]; produces: string[] }> | null; oneAway: Array<{ cards: string[]; produces: string[]; missing: string[] }> | null };
  cards: Array<{ name: string; quantity: number; cost: string; mv: number; type: string; text: string; jobs: string[]; gameChanger: boolean }>;
};

export function factsMd(f: Facts): string {
  const L: string[] = [];
  L.push(`# Deck: ${f.name}`, '');
  L.push('## Commander' + (f.commanders.length > 1 ? 's' : ''));
  for (const c of f.commanders) L.push(`- **${c.name}** ${c.cost} — ${c.type}. ${oneLine(c.text)}`);
  L.push(`- Colour identity: ${f.identity.join('') || 'colourless'}`, '');
  L.push('## Numbers worked out by code (facts, not judgements)');
  L.push(`- Cards: ${f.size} including the commander${f.commanders.length > 1 ? 's' : ''}. Average mana value of the non-land cards: ${f.averageMv}.`);
  if (f.lands) {
    L.push(`- Lands: ${f.lands.have} (counting double-faced cards with a land back partly). The usual formula for this curve says ${f.lands.want}; usual range ${f.lands.range[0]}–${f.lands.range[1]}.`);
    if (f.landsHow) L.push(`  - Inputs: ${f.landsHow.inputs.join('; ')}`);
  }
  for (const j of f.jobs) {
    L.push(`- ${j.label}: ${j.count ?? '?'}${j.range ? ` (usual range ${j.range[0]}–${j.range[1]}${j.from ? `, ${j.from}` : ''})` : ''}`);
  }
  L.push(`- Curve (non-land): ${f.curve.map((b) => `${b.mv}: ${b.count}`).join(', ')}`);
  L.push(`- Card types: ${f.types.map((t) => `${t.label} ${t.count}`).join(', ')}`, '');
  L.push('## Colour sources');
  for (const c of f.colours) L.push(`- ${c.colour}: ${c.pips} coloured symbols in costs; ${c.sources} sources${c.needed !== null ? `; the hungriest card (${c.neededFor}) wants about ${c.needed} to be cast on time most games` : ''}`);
  L.push('');
  L.push('## Bracket facts');
  L.push(`- Game Changers: ${f.gameChangers.length ? f.gameChangers.join(', ') : 'none'}`);
  L.push(`- Extra-turn cards: ${f.extraTurns.length ? f.extraTurns.join(', ') : 'none'}`);
  L.push(`- Mass land denial: ${f.massLandDenial.length ? f.massLandDenial.join(', ') : 'none'}`);
  if (f.spellbookBracket) {
    L.push(`- Two-card combos (Commander Spellbook): ${f.spellbookBracket.twoCardCombos.length ? f.spellbookBracket.twoCardCombos.map((c) => c.join(' + ')).join('; ') : 'none'}`);
    L.push(`- Commander Spellbook's own power label (its scale, not the official brackets): ${f.spellbookBracket.tag}`);
  }
  L.push('');
  L.push('## Combos Commander Spellbook finds');
  if (!f.combos.included) L.push('- (Commander Spellbook could not be reached)');
  else if (!f.combos.included.length) L.push('- None in the deck.');
  else for (const c of f.combos.included) L.push(`- ${c.cards.join(' + ')} → ${c.produces.join(', ')}`);
  if (f.combos.oneAway?.length) {
    L.push('', 'One card away (within the colours):');
    for (const c of f.combos.oneAway) L.push(`- ${c.cards.join(' + ')} → ${c.produces.slice(0, 3).join(', ')} (missing: ${c.missing.join(', ')})`);
  }
  L.push('');
  L.push('## Every card (name — cost — type — jobs from card tags — rules text)');
  for (const c of f.cards) {
    L.push(`- ${c.quantity > 1 ? `${c.quantity}× ` : ''}**${c.name}** — ${c.cost || '—'} — ${c.type}${c.jobs.length ? ` — jobs: ${c.jobs.join(', ')}` : ''}${c.gameChanger ? ' — Game Changer' : ''} — ${oneLine(c.text) || '(no text)'}`);
  }
  return L.join('\n') + '\n';
}

