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

- *green ramp spells for Omnath*
- *cheap green ramp that isn't a land*
- *enchantments that work well for Fire Lord Azula*
- *a card under 5 cmc for azula that helps me draw cards*
- *combo cards for vivi*, *what goes infinite with Doubling Season*,
  *two card infinite mana combos in izzet*
- *best commanders for a goblin deck*, *new red cards from this year*
- a card name spelled wrong

A model reads the request and plans the search; the server runs it. The
model only ever plans: every card and combo you see came back from Scryfall,
EDHREC or Commander Spellbook, so a model that misremembers a card can give
you a bad search but never a card that doesn't exist.

The *All matching cards* view shows 175 cards at a time, with *Load more*
for the next page in the same order.

**Name a commander and the answer comes in three tabs:**

| Tab | Shows | Order |
|---|---|---|
| *Played in Omnath decks* (opens first) | what that commander's decks actually run, from EDHREC — narrowed by the conditions you stated ("enchantments", "under 5 mana") but not by the AI's guesses at synergy, or EDHREC's own lists when you stated none | share of its decks |
| *All matching cards* | everything that fits the search in its colours and legal in Commander, from Scryfall — including cards nobody has tried yet | the sort menu; most played in Commander by default |
| *Combos* | Commander Spellbook's combos for it | most popular |

Without a commander there is just the one view the search was for.

**If a name could mean several commanders** — "omnath" is six — it asks
which, rather than guessing, and carries on with your pick.

**Refine with a follow-up** — *only instants*, *under $3*, *for Atraxa
instead*. The model changes what you asked and keeps the rest, and the chain
shows above the box.

The query that ran is shown and editable, and a collapsed *How this search
ran* lists every step — each query in plain English and as written, and how
many results it found. See [how a search is read](#how-a-search-is-read).

**Profiles** keep people's lists apart, as LifeOS's do. A new browser asks
who is using it, and anyone can add themselves from there or from the switcher
in the header. It is separation, not a login: anyone on the tailnet can pick
any profile.

**Building a deck** happens on its page:

- **Add cards** opens a window that starts on suggestions - what the
  commander's decks play on EDHREC that this deck does not have yet - and
  takes plain English (*ramp that fetches lands*), Scryfall syntax or a card
  name, always for the deck's commander. Each card has *Add* and *Maybe*.
- **Main, maybeboard and sideboard.** Only the main board and the commander
  count towards 100.
- **Grouped views**: visual stacks or a compact text list, grouped by type or
  mana value, sorted by name, mana value or price.
- **Printing and finish**: open a card to pick any of its printings, and
  foil, non-foil or etched - priced accordingly.
- **Edit as text** opens the deck in Moxfield's export format and saves it
  back exactly; sideboard and maybeboard keep their own sections.
- **Deck health**: warnings (not 100 cards, off-colour cards, duplicates,
  bans, Game Changers), the mana curve, each colour's share of the costs
  against the lands that make it, role counts - ramp, card advantage,
  removal, board wipes, tutors - against common guidelines, and how often
  an opening hand has 2-4 lands. Roles come from Scryfall's tags, looked up
  once per card and saved.

**Decks** are lists with a commander. Pick the commander from a search that
shows each card's art and type line; the deck counts towards 100 with the
commander included. **Import** a decklist from Moxfield, Archidekt, Arena or
MTGO when making a deck or into an existing one:

```
1x Kratos, God of War (SLD) 2207
1x Lightning Bolt (PF19) 1 *F*
33x Mountain (ACR) 107
```

Each line keeps its exact printing (set and collector number), falling back
to the card's name when Scryfall does not know that printing. The commander
comes from a *Commander* section, or else the first card if it can be one.
Sideboards and maybeboards are left out, and any line that cannot be found
is listed so it can be fixed. Foil markers are read but not yet kept.

**Lists** are whatever you need them to be: a trade binder, a wishlist.
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
| `MTG_EDHREC` | *(off)* | `on` adds the *Played in … decks* tab to commander searches — [read this first](#edhrec) |

Put these in `.env` next to `package.json`; `next start` reads it.

```bash
npm run build && npm start
npm test
```

## On the Pi

Runs under systemd on port 3001, bound to localhost:

```bash
npx next build
sudo systemctl restart mtg
```

It has its own hostname on the tailnet, `https://mtg.<tailnet>.ts.net`, from
a second Tailscale node on the same Pi — `tailscaled-mtg.service`, with its
own state directory and socket, in userspace networking mode — which serves
it:

```bash
sudo tailscale --socket=/run/tailscale-mtg.sock serve --bg 3001
```

Reachable from any device signed into the tailnet and from nowhere else. To
let a friend in without giving them the rest of the tailnet, share the `mtg`
machine with them from the Tailscale admin console.

Profiles can also be managed on the Pi:

```bash
node scripts/profile.cjs list
node scripts/profile.cjs add kevin "Kevin"
node scripts/profile.cjs rename kevin "Kev"
```

**Why a second node.** The Pi's main node already serves LifeOS, and a node
has one hostname. The alternatives were worse: a subpath (`/mtg`) is
compiled into the client bundle, and Tailscale's `--set-path` strips the
prefix while the build expects it, so both produce 404s that read like a
broken app; a separate port (`:8443`) works but is not a name anyone
remembers; Tailscale services need a tagged node, which changes ownership
and ACLs on a machine already serving something else.

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
                        (several fit? → ask which, carry on with the pick)
                      → model shown its real rules text, asked again
                      → All matching cards: Scryfall, scoped to its colours
                      → Played in its decks: EDHREC's cards checked
                        against the same search, by share of decks
                      ├ rejected, empty, or filters nothing → model retries once, told why
                      └ still nothing → Scryfall's fuzzy name match

follow-up           → the model gets the plan that ran, applies the change
sort / edit / tab   → re-run without the model
```

The sort is sent to Scryfall rather than applied in the browser: only the
first page of results is on screen, and sorting that would show "the
cheapest of the 175 most played" rather than the cheapest.

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
requests to the site. Its website loads each commander's data as a JSON
file (`json.edhrec.com/pages/commanders/<name>.json`); with `MTG_EDHREC=on`,
the server reads that same file. From it come the *Played in … decks* tab
and the "in 74% of Omnath decks" line on each card. Off, commander searches
still work, without that tab.

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
