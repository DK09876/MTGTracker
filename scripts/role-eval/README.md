# Role tagging eval

Scores the app's Scryfall-based roles and no-AI win guess (lib/roles.ts,
lib/wincons.ts) against four popular Archidekt decks whose authors sorted
every card into categories. Baseline (2026-10-31): 161 of 212 cards, 76%;
win conditions 2 of 15. After text-read finishers and wider protection
(2026-11-02): 175 of 212, 83%; win conditions 8 of 15, protection 20 of 26.
See docs/deckbuilding-reference.md.

- `truth.json`: each deck's Archidekt link, views, author, primer and the
  author's category per card, plus `listId` in the local Test profile.
- `ours-baseline.json`: the app's roles and win guesses at the baseline.
- `score.py`: maps author categories to the app's roles and prints recall
  per category and per deck.

To re-run (no local app needed):

    npx jiti scripts/role-eval/run.ts && (cd scripts/role-eval && python3 score.py)

`run.ts` reads each deck from Archidekt's public API, its roles from
Scryfall and combos from Commander Spellbook, and writes `ours.json`.
Answers are kept in `.cache.json` (not committed) so a re-run only asks
for what changed; delete it to start fresh.
