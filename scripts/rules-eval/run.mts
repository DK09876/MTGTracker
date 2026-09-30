/*
 * Run by hand, not in CI: it spends real model requests.
 *   set -a; . ./.env; set +a; npx tsx scripts/rules-eval/run.mts openai/gpt-oss-120b [table] [ids]
 * Rules test run: the app's real pipeline (helper research, clarify, fit), each answer saved in full for grading by hand. */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { modelById } from '../../lib/ai';
import { askRules } from '../../lib/rules/ask';
import { cardNames, cardRulings, rulesIndex, wikiPage } from '../../lib/rules/sources';
import { cardsNamed } from '../../lib/scryfall';

type Case = { id: string; question: string; answer: string; clarifyWith?: string };
const hard = JSON.parse(readFileSync('scripts/rules-eval/questions.json', 'utf8')) as Array<{ id: string; question: string; answer: string; ambiguous: false | { needs: string; answers: Record<string, string> } }>;
const CASES: Case[] = [
  { id: 'kratos-count', question: 'With Blade of Selves equipped to Kratos, Stoic Father attacking in a four-player Commander game, how many experience counters do I get?', answer: '7' },
  { id: 'konrad-blade', question: 'Blade of Selves is equipped to Syr Konrad, the Grim and he attacks in a four-player Commander game. How much damage does each opponent take from Syr Konrad\'s ability?', answer: '4' },
  { id: 'two-artists', question: 'I control two Blood Artists and three other creatures, and Damnation destroys all five. How many times do my Blood Artists trigger in total?', answer: '10' },
  { id: 'kratos-attack', question: 'Do the myriad tokens from Blade of Selves trigger Kratos, Stoic Father\'s "whenever you attack with one or more Gods" ability?', answer: 'No' },
  { id: 'rest-in-peace', question: 'Does Blood Artist trigger when a creature would die while Rest in Peace is on the battlefield?', answer: 'No' },
  { id: 'legend-rule-opponent', question: 'I control Kratos, Stoic Father and an opponent creates a token copy of Kratos under their control. Does the legend rule make one of them go to the graveyard?', answer: 'No' },
  { id: 'cant-be-countered', question: 'Can I cast Counterspell targeting a spell that says it can\'t be countered, and what happens?', answer: 'Yes, legal target; Counterspell resolves, spell not countered' },
  ...hard.map((h) => ({ id: h.id, question: h.question, answer: h.answer, clarifyWith: h.ambiguous ? Object.keys(h.ambiguous.answers)[0] : undefined })),
];

const [modelId, tableArg, only] = [process.argv[2], process.argv[3], process.argv[4]];
const anchors = tableArg === 'table';
const out = `scripts/rules-eval/results-${modelId.replace(/\W+/g, '_')}-${anchors ? 'table' : 'notable'}.json`;
const rows: Record<string, unknown>[] = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [];
const deps = { rules: rulesIndex, names: cardNames, cards: cardsNamed, rulings: cardRulings, wiki: wikiPage, model: modelById(modelId)!, helper: modelById('openai/gpt-oss-20b'), inputTokens: 6000 };
for (const c of CASES) {
  if (only && !only.split(',').includes(c.id)) continue;
  if (!only && rows.some((r) => r.id === c.id && !r.error)) continue;
  const t0 = Date.now();
  const row: Record<string, unknown> = { id: c.id, expected: c.answer };
  try {
    let r = await askRules({ question: c.question, anchors }, deps, { maxBusy: 1 });
    if ('clarify' in r) {
      row.asked = r.clarify;
      const answer = c.clarifyWith ?? 'Not said - assume the usual case, and say so.';
      row.clarifiedWith = answer;
      r = await askRules({ question: c.question, anchors, clarifications: r.clarify.map((q) => ({ question: q.question, answer })) }, deps, { maxBusy: 1 });
    }
    if ('choice' in r) row.error = `asked which card: ${JSON.stringify(r.choice)}`;
    else if ('clarify' in r) row.error = 'asked again';
    else {
      const a = r.turn.answer;
      Object.assign(row, {
        verdict: a.verdict, summary: a.summary, assumptions: a.assumptions, confidence: a.confidence, looseEnds: a.looseEnds,
        concepts: a.working?.concepts.map((x) => `${x.concept} -> ${r.turn.sources.find((s) => s.id === x.source)?.label ?? 'none'}`),
        events: a.working?.events.length, count: a.working?.count, model: r.turn.model,
        sourcesSent: r.turn.sources.length, working: a.working,
      });
    }
  } catch (e) { row.error = e instanceof Error ? e.message : String(e); }
  row.seconds = Math.round((Date.now() - t0) / 1000);
  const i = rows.findIndex((x) => x.id === c.id);
  if (i >= 0) rows[i] = row; else rows.push(row);
  writeFileSync(out, JSON.stringify(rows, null, 1));
  console.log(`${c.id.padEnd(42)} ${String(row.seconds).padStart(3)}s ${row.asked ? '[ASKED] ' : ''}${row.error ? `ERR ${row.error}` : `${row.confidence} | ${String(row.verdict).slice(0, 150)}`}`);
  console.log(`${' '.repeat(47)}expected: ${c.answer.slice(0, 110)}`);
  await new Promise((res) => setTimeout(res, 20_000));
}
