# Deck-flow evaluation runner

Scores the app's **code route** (no AI) on the frozen kits from the 2026-11-10 deck-flow evaluation, and prints each number beside the one in `FINDINGS.md`. The kits stay outside the repo.

```
npm run deck-eval                         # regenerate with the current code, then score (seconds to a minute or two)
npm run deck-eval -- --frozen             # score the frozen code runs only: every number must match FINDINGS.md (✓)
npm run deck-eval -- --kits real,triage   # some kit sets only: real, primer, triage, swaps, orphan, graded
npm run deck-eval -- --out <dir>          # keep the regenerated runs here (default: a new temp folder)
npm run deck-eval -- --run <name>         # also score <kit>/out/<name>, e.g. an AI run, on the recall and judge tables
```

**Data:** `DECK_EVAL_DATA` (default `~/Desktop/Development/mtg-eval-data`). Each kit set is a folder there. Its `README.md` describes it; never give those to an AI reader.

**Regenerating** copies each kit set's `db/eval.db` (`work.db` for swaps) and `db/cards.db` into a temp folder. It then runs `regen.ts` once per set with `MTG_DB_PATH` / `MTG_CARDS_DB_PATH` pointing there. The kits' own databases and frozen `out/` runs are never written. No model is called. Role lookups use cached roles; only a card never looked up would go to Scryfall through the app's client.

## Tables

| Kit set | What it measures | Code runs |
| --- | --- | --- |
| `real` (29 keyed kits, 14 "archidekt-cut") | Share of an owner's real cuts (K cards they left out) in a ranker's first K. Also a blind per-card judge's score for each run's top K: cut 1, ok 0.5, keep 0. "Bad-cut rate" is the share rated keep. | `A-sb`: `lib/cut-list.ts` `deckCutList`, the Tune tab's cut list, with the remaining spells appended. `A3n`: the pre-ranker (`prerank-lib.ts`) without popularity. `rand`: the analytic random pick. |
| `primer` (16) | The same recall, where the key is 12 cards from another owner's build of the same commander. | same |
| `triage` (32 decks in 6 groups) | How many decks the code warns about, per group, and whether it catches the 4 decks with broken basics. Frozen = every job outside its range and every health warning, as the app had it. Now = what the Check tab shows (`lib/hard-checks.ts`). | |
| `swaps` (8 of the owner's decks) | The judge's verdict on the code route's 5 swaps per deck: better / even / worse. Now: what Tune → Swaps offers, which is a same-job lookup over Maybeboard cards (none here). | |
| `orphan` (13) | How far a combo piece moves toward "cut" when its partner is removed (0 = cut first, 100 = last). | `A3n` |
| `graded` (6) | Share of good / mediocre / bad inserted cards in the top K; bad minus good. | `A-sb`, `A3n` |

Intervals are bootstraps over kits (10,000 resamples) with the original seeds. `lib/deck-eval/pyrandom.ts` reproduces Python's generator, so frozen intervals match exactly. Judge numbers use the candidate map `real/judge4/map` and the merged ratings `real/judge-merged3/fable`. A regenerated run's new picks that the judge never rated are left out; the "rated / picks" column shows the coverage.

## Files

- `lib/deck-eval/score.ts`: the scorers, pure (tested in `score.test.ts`). `lib/deck-eval/pyrandom.ts`: Python-compatible random.
- `scripts/deck-eval/kits.ts`: reads the kits. `run.ts`: the command. `regen.ts`: one kit set with the current code.
- `scripts/deck-eval/prerank-lib.ts`: the pre-ranker from the evaluation, with its frozen weights.

The kit builders, fetchers and AI-reader packs stay on the local branch `feat/flow-eval` (`scripts/plan-eval/`). They need network access and the evaluation's scratch data. Only scoring and the code route live here.
