# Role tagging eval

Scores the app's Scryfall-based roles and no-AI win guess (lib/roles.ts,
lib/wincons.ts) against four popular Archidekt decks whose authors sorted
every card into categories. Baseline (2026-10-31): 161 of 212 cards, 76%;
win conditions 2 of 15. See docs/deckbuilding-reference.md.

- `truth.json`: each deck's Archidekt link, views, author, primer and the
  author's category per card, plus `listId` in the local Test profile.
- `ours-baseline.json`: the app's roles and win guesses at the baseline.
- `score.py`: maps author categories to the app's roles and prints recall
  per category and per deck.

To re-run: start the app locally with the four decks imported into a profile
called `test` (import each deck from Archidekt as a decklist; `listId`s change
per database), fetch `/api/lists/<id>/health?roles=1&profile=test` and
`/api/lists/<id>/insights?profile=test` for each into `ours.json` (same shape
as the baseline), then `python3 score.py`. No AI is involved.
