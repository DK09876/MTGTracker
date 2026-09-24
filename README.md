# MTG Tracker

Search Magic cards and keep them in lists. Runs on a Raspberry Pi on your own
network, alongside [LifeOS](https://github.com/DK09876/LifeOS).

Card data comes from [Scryfall](https://scryfall.com) and combos from
[Commander Spellbook](https://commanderspellbook.com). The text of a
plain-English search goes to Gemini to be planned — only if you give it an
API key — and, if you switch it on, a commander's name goes to EDHREC. There
is no account.

## What it does

**Search** takes whatever you type. Card names are suggested as you type, and
picking one goes straight to that card. Scryfall's own syntax — `t:goblin c:r`,
`set:mh3 r:mythic`, `o:"draw a card" cmc<=2` — runs as written. Anything else
is plain English:

- *cheap green ramp that isn't a land*
- *enchantments that work well for Fire Lord Azula*
- *a card under 5 cmc for azula that helps me draw cards*
- *combo cards for vivi*, *what goes infinite with Doubling Season*,
  *two card infinite mana combos in izzet*
- *best commanders for a goblin deck*, *new red cards from this year*
- a card name spelled wrong

A model reads the request and plans the search; the server runs it. The
query that ran is shown above the results, where you can edit it and run it
again, and a collapsed *How this search ran* lists every step — each query in
plain English and as written, and how many results it found. The model only
ever plans: every card and combo you see came back from Scryfall or Commander
Spellbook, so a model that misremembers a card can give you a bad search but
never a card that doesn't exist. See [how a search is read](#how-a-search-is-read).

**Lists** are whatever you need them to be: a deck, a trade binder, a wishlist.
A card can sit in several at once, with its own count in each, and the search
results tell you which lists already hold a card so you don't add it twice.

**Adding a card stores its whole Scryfall record** — art, oracle text, set,
rarity, prices, legality. Browsing a list never touches the network, so it
keeps working when Scryfall is down or you're offline, and the card you added
doesn't silently change underneath you.

**Filtering a list** takes a useful subset of the same syntax, run locally:

| | |
|---|---|
| `t:` `type:` | type line contains |
| `o:` `text:` | oracle text contains |
| `c:` `id:` | colours — `c:rg` means contains both, `c:m` multicolour, `c:c` colourless |
| `cmc:` `mv:` | mana value, with `<` `>` `<=` `>=` `=` |
| `usd:` | price, same comparisons |
| `pow:` `tou:` | power and toughness |
| `r:` `set:` `a:` `kw:` | rarity, set, artist, keyword |
| `-` | exclude — `-t:land` |

A bare word searches the name. Terms combine with AND. Anything it doesn't
understand is reported rather than quietly ignored, since a filter that
silently drops cards you own is worse than one that admits defeat.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

| Variable | Default | |
|---|---|---|
| `MTG_DB_PATH` | `./data/mtg.db` | where the SQLite file lives |
| `MTG_BASE_PATH` | *(none)* | subpath to serve under, e.g. `/mtg` |
| `GEMINI_API_KEY` | *(none)* | turns on plain-English search; without it, text is searched as a card name |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` | which model translates |
| `MTG_EDHREC` | *(off)* | `on` ranks commander searches by how often that commander's decks play each card — [read this first](#edhrec) |

Put these in `.env` next to `package.json`; `next start` reads it.

```bash
npm run build && npm start
npm test
```

## On the Pi

Runs under systemd on port 3001, bound to localhost, and published to the
tailnet on its own port so it does not share a hostname with anything else:

```bash
npx next build
sudo systemctl restart mtg
tailscale serve --bg --https=8443 3001
```

That puts it at `https://<node>.<tailnet>.ts.net:8443`, reachable from any
device signed into the tailnet and from nowhere else.

**On serving it under a subpath instead.** It can be done — set
`MTG_BASE_PATH=/mtg` and mount it with `--set-path` — but two things bite.
The base path is compiled into the client bundle rather than read at runtime,
so changing it means rebuilding. And `--set-path` strips the prefix before
forwarding while the build expects it, so the serve target has to repeat it
(`http://127.0.0.1:3001/mtg`). Both produce a 404 that reads like a broken app
rather than a wrong URL. A separate port avoids the whole class of problem.

A distinct hostname would be nicer than a port, but Tailscale services require
a tagged node, and tagging changes node ownership and ACLs — not something to
do casually to a machine that is already serving something else.

## How a search is read

```
typing  → name suggestions from Scryfall's autocomplete (prefix only)
Enter   → Scryfall syntax?  → run as written, no model
          otherwise         → the model says what kind of request it is:

  one card          → exact-name search → else Scryfall's fuzzy name match
  combos            → commander or card looked up on Scryfall
                      → Commander Spellbook, in the commander's colours
                      → the pieces fetched from Scryfall
  cards             → commander looked up on Scryfall
                      → model shown its real rules text, asked again
                      → Scryfall, scoped to its colours and Commander
                      → (EDHREC on) re-ranked by what its decks play
                      ├ rejected, empty, or filters nothing → model retries once, told why
                      └ still nothing → Scryfall's fuzzy name match
```

A few choices in there are deliberate:

- **The model picks a route; code runs it.** A search box should be quick and
  predictable, and there are only a few kinds of request. Each is a fixed
  pipeline rather than the model calling tools in a loop, which would be
  slower and harder to reason about. That style is kept for a future deck
  assistant, where open-ended reasoning pays for itself.
- **Commanders are looked up, not remembered.** The model only says who the
  commander is — "azula", "vivi" is fine. Scryfall supplies the card, most
  played namesake first, and with it the real colour identity. The model is
  then shown the commander's rules text and asked again, so "works well with
  Azula" is judged against what Azula actually does. This is what makes a
  commander printed after the model was trained work at all.
- **Combos come from Commander Spellbook.** Scryfall has no notion of a
  combo, so no query the model could write would find one.
- **A query that filters nothing is sent back.** `f:commander order:edhrec`
  is 30,000 cards led by Sol Ring — a non-answer that looks like an answer.
  The model gets one more try; if it insists, it may be what was meant.
- **Fuzzy name matching is the last resort, not the first.** It is generous
  enough that "green ramp" finds *Greenbelt Rampager*, so trying it first
  would hijack sentences.
- **Only verified `otag:` values are offered.** An unknown tag doesn't error
  — it quietly matches nothing. The list in `lib/gemini.ts` was checked
  against Scryfall.
- **Model calls have a time budget.** A commander search can make three. When
  Gemini is slow the optional ones — the rules-text pass and the retry — are
  skipped rather than making you wait out every timeout, and *How this search
  ran* says so.
- **If the model is down or unconfigured, search still works** for names and
  syntax, with a note saying so.

## Sources

| | What for | Access |
|---|---|---|
| [Scryfall](https://scryfall.com/docs/api) | cards, prices, tags, popularity order | official API |
| [Commander Spellbook](https://backend.commanderspellbook.com/schema/swagger/) | combos | official API, MIT-licensed |
| [EDHREC](https://edhrec.com) | how often a commander's decks play each card | **off by default**, see below |

### EDHREC

EDHREC is the best source there is for "cards that work well with this
commander", but it has no public API, and its terms of use forbid automated
requests to the site. With `MTG_EDHREC=on`, commander searches read the JSON
behind EDHREC's commander pages anyway: results are re-ranked by the share of
that commander's decks playing each card, shown on each tile, and its most
played cards that match the search but missed the first page are added.

That is a knowing choice for a personal, self-hosted tool, and it is kept
small — each commander is fetched at most once a day, and a failure is
remembered for an hour. The endpoint is undocumented and may change or be
blocked; if it is, searches carry on without it. The *EDHREC ↗* link on
every commander search is always there, since a person following a link is
how the site is meant to be used.

## Being a good Scryfall citizen

Their API is free, unauthenticated and donation-funded. Their docs ask for
three things, and all three are honoured in `lib/scryfall.ts`: a descriptive
`User-Agent`, at least 50–100ms between requests (serialised in one place so
no call site can forget), and caching rather than re-fetching — which is why a
card's full payload is stored the moment it goes into a list.

Searches are proxied through the server rather than called from the browser,
since a browser cannot set a `User-Agent` and Scryfall refuse requests without
one.

## Tech

Next.js 16, React 19, Tailwind 4, TypeScript. SQLite through
`node-sqlite3-wasm` — the native addon segfaults on this hardware.

Not affiliated with Wizards of the Coast. Magic: The Gathering is their
trademark.

## License

MIT
