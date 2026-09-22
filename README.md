# MTG Tracker

Search Magic cards and keep them in lists. Runs on a Raspberry Pi on your own
network, alongside [LifeOS](https://github.com/DK09876/LifeOS).

Card data comes from [Scryfall](https://scryfall.com). Nothing is sent
anywhere else, and there is no account.

## What it does

**Search** takes Scryfall's own syntax, because reinventing it would be worse
than learning it — `t:goblin c:r`, `set:mh3 r:mythic`, `o:"draw a card" cmc<=2`
— and a plain card name works too.

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

```bash
npm run build && npm start
npm test
```

## On the Pi

Runs under systemd on port 3001 and is published to the tailnet at `/mtg`,
so LifeOS keeps the root:

```bash
MTG_BASE_PATH=/mtg npx next build
sudo systemctl restart mtg
tailscale serve --bg --set-path /mtg http://127.0.0.1:3001/mtg
```

Two things that are easy to get wrong. `MTG_BASE_PATH` is baked into the
client bundle at build time, not read at runtime, so changing it means
rebuilding. And the serve target must repeat the path — `--set-path /mtg`
strips the prefix before forwarding, while a build with `basePath` expects it,
so pointing at a bare `3001` gives a 404 that looks like the app is broken
when it is only the URL.

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
