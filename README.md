# MTG Tracker

Search Magic cards and keep them in lists. Runs on a Raspberry Pi on your own
network, alongside [LifeOS](https://github.com/DK09876/LifeOS).

Card data comes from [Scryfall](https://scryfall.com). The one other thing
that leaves the Pi is the text of a plain-English search, which goes to Gemini
to be turned into a Scryfall query — and only if you give it an API key.
There is no account.

## What it does

**Search** takes whatever you type. Card names are suggested as you type, and
picking one goes straight to that card. Scryfall's own syntax — `t:goblin c:r`,
`set:mh3 r:mythic`, `o:"draw a card" cmc<=2` — runs as written. Anything else
is plain English: *cheap green ramp that isn't a land*, *best board wipes for
Atraxa*, or a card name spelled wrong.

Plain English is translated into Scryfall syntax by a model, and the query it
wrote is shown above the results, where you can edit it and run it again. The
model only ever writes a query; every card you see came back from Scryfall, so
a model that misremembers a card can give you a bad search but never a card
that doesn't exist. See [how a search is read](#how-a-search-is-read).

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
Enter   → Scryfall syntax?  → run as written
          otherwise         → model writes a query → Scryfall
                              ├ rejected or empty → model tries once more, told why
                              └ still nothing     → Scryfall's fuzzy name match
```

A few choices in there are deliberate:

- **Fuzzy name matching is the last resort, not the first.** It is generous
  enough that "green ramp" finds *Greenbelt Rampager*, so trying it first
  would hijack sentences. It stays useful for a misspelled name the model
  didn't recognise.
- **The model names a commander; Scryfall supplies its colours.** For "board
  wipes for Atraxa" the model returns *Atraxa, Praetors' Voice* and the server
  looks up her colour identity and adds `id<=wubg`. A model knows names far
  more reliably than it knows colours, and a commander printed after it was
  trained still works.
- **Only verified `otag:` values are offered.** Scryfall's tags are the best
  way to say what a card *does* (`otag:ramp`, `otag:board-wipe`), but an
  unknown tag doesn't error — it quietly matches nothing. The list in
  `lib/gemini.ts` was checked against Scryfall, and an empty result is fed
  back to the model rather than shown as the answer.
- **If the model is down or unconfigured, search still works** — as a name
  search, with a note saying so.

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
