# Working on MTG Tracker

Standards every agent working on this codebase follows. Read this before changing code.

**Adding to this file, or to the agent context (`lib/agent-context.ts`): ask the owner first.** When something
comes up that looks like it belongs here (a convention that should hold everywhere, a mistake worth never
repeating), propose the wording and wait for a yes. Never add to either file on your own.

## Showing text: `CardText`

Every piece of text the app shows that may name a card goes through `components/CardText.tsx`. That covers AI
answers, reasons and replies, the owner's notes and messages, rules answers, search explanations and check
messages. It is always on; there is no flag. Only text inside an input box stays plain, because it is being edited.

- `[[Card Name]]` in text is a card: highlighted, its picture on hover (a real mouse only), and the card popup on a
  click or tap. The brackets never show. A card the app hasn't seen is looked up when it's pointed at.
- Text with no `[[marks]]` (older answers, the owner's words) links the card names its page knows. A page says what
  it knows with `CardTextContext`: `cardOf` (cards it holds), `names` (names to link in unmarked text) and `onOpen`
  (its own popup, as the deck page has, with the deck's actions). The deck page and each Rules turn set it.
- `<CardText text={…} />` for a reason or a note (inline); `<CardText text={…} blocks />` for a long answer
  (paragraphs, `- ` lists, `**bold**`). One name on its own: `<CardLink name={…} />`; a list: `<CardLinks names={…} />`.
- Mana symbols (`{R}{G}`) are drawn either way.
- Where a link can't go (a button's label, a title, a list of past chats), show `withoutMarks(text)` from
  `lib/chat-text.ts`: the names, with no brackets.
- Leave as plain text: a card's own rules text quoted as a source, fixed app wording, error logs, toasts.

The card popup for the whole app is `components/CardPopup.tsx`, mounted once in the layout: `openCard(card)` or
`openCard('Name')`. It shows Scryfall's data and the card's other printings.

## Getting a card: `lib/cards.ts`

All card data by name or id goes through `lib/cards.ts`. Don't query the `cards` table, `cards.db` or Scryfall by
name anywhere else.

- `findCards(names)` / `findCard(name)`, async: the cards the app has stored, then the weekly copy of Scryfall's
  card data (`cards.db`), then Scryfall itself for a card newer than the copy. What Scryfall returns is stored
  (`storeCard`), so the next ask is local and the weekly refresh keeps it fresh.
- `cardsNamed(names)`, sync: the first two only, for code that must not wait on the network.
- `cardById(id)`: the stored copy, else Scryfall's (stored). `printingsFor(oracleId)`: every printing, cached.
- Names match exactly, by the front face, ignoring case and accents. The returned `CardMap` finds any spelling of a
  name. A loose match ("did you mean") is offered to the owner to choose, never taken silently.
- In the browser: `/api/cards?name=…&name=…` or `?id=…`, through `lib/card-cache.ts` (`lookCard`, `useCardState`,
  `rememberCards`). It's one cache for the whole app, and names asked for together go in one request.

## Reading the owner's words: `lib/card-names.ts`

Card names in what the owner types (a question, a search, a chat message) are found with `findMentions`, never by
matching text yourself. Exact names are taken; a word that could be several cards, or a misspelt name, comes back as a
choice, and the page shows it with `<CardChoice>` before any AI call. A near match is never taken silently.

- An AI call only gets a card we're sure the owner meant. A page that sends typed text to an AI checks it first with
  `useCardCheck` (`components/CardChoice.tsx`): `const text = await cardCheck.check(typed, { known })`, then sends
  `text`, or nothing when it's `null`. The server side is `readCards` in `lib/cards.ts` (`POST /api/cards/read`).
- The sure cards come back marked `[[like this]]`, so the AI is given exactly those cards. `known` is the cards in
  play on that page (the deck's, the conversation's): they win when the words could be them.
- The owner's picks are remembered for their profile (`lib/card-picks.ts`), so the same words aren't asked twice; the
  page says how it read them, with a way to forget. "None of these" sends nothing and asks them to check the spelling.
- Everyday English in lower case stays words ("flicker effect"): the list is `lib/everyday-words.ts`, made by
  `scripts/everyday-words.mts`. Run it again now and then, as new sets add names.
- A card's name in everyday words ("lightning bolt", "last chance") is never asked about: `<CardSuggestions text
  onText known />` beside the box offers it as the owner types: the name is a card link, Use marks it, ✕ is
  remembered; ignored, it's words.

## AI calls and the agent context

Every AI call passes one of three places:
- `modelById` in `lib/ai.ts` (JSON calls, any provider)
- `claudeCall` in `lib/ai.ts` (Claude tool loops)
- `call`/`translate` in `lib/gemini.ts` (search's direct Gemini call)

At each, and nowhere else:
- `AGENT_CONTEXT` (`lib/agent-context.ts`) goes first in the system prompt. It is the conventions every agent
  follows, such as writing card names as `[[Card Name]]`. Keep it byte-identical on every call (nothing per-profile,
  per-deck or dated), so it stays inside each feature's cached prefix. Don't repeat its rules in a feature's prompt.
- Cards the owner named with `[[ ]]` in what goes to the model are looked up exactly and added as "Cards the owner
  named", so the model knows exactly which card was meant.
- `[[ ]]` is taken off card names in fields that hold only a name (`plainNames`), before any code reads them.

A new AI feature goes through one of these three places. Changing a prompt means bumping its entry in
`lib/prompt-versions.ts`; changing the agent context means bumping them all.

## Testing with a stubbed Claude

To try the app in a browser without spending anything, start it with `MTG_AI_STUB=1` and
`ANTHROPIC_API_KEY=stub`. Every AI call is then answered by `lib/ai-stub.ts`, with well-formed answers that name
real cards as `[[Card Name]]`. Each request it would have sent is written to `data/ai-stub.log`, so you can check
what Claude would have read. Never set it on the Pi. Use a copy of the data in `data/`, never the Pi's own files.

## Phones

The owner uses the app on an iPhone. Hover effects that change the page (a highlight, a preview, a tip) run for a
real mouse only (`lib/mouse-only.ts`); otherwise Safari treats the first tap as a hover and drops the click.

## Deploying to the Pi

Only when the owner asks. The Pi's address and sign-in are in `AGENTS.local.md` at the root of the main checkout
(`$(git rev-parse --git-common-dir)/../AGENTS.local.md` from a worktree). It is gitignored: never copy what it says into a
tracked file, a commit, a PR, a log or a memory. How a deploy runs is `scripts/DEPLOY.md`: on the Pi, inside tmux,
`bash ~/mtg/current/scripts/deploy.sh`.

## Releases: every change the owner will notice gets a note

The app has a version and release notes the people using it read: a "What's new" line under the header after a new
version (`components/WhatsNew.tsx`), a ✦ button in the header, and the Releases page (`/releases`). The notes are
`lib/release-notes.ts`; the types and helpers are `lib/releases.ts`. They're built into the app, so a deploy shows
them with nothing more to do.

There are two parts:
- **`UNRELEASED`**: notes since the newest version, oldest first. Every agent adds its notes here, on its own,
  with no version. The Releases page shows them as "Since v…", already in the app. No banner.
- **`RELEASE_NOTES`**: the versions, newest first. **Only the owner decides when there's a new version.** A new
  version is what shows the banner.

### Adding your notes (every PR the owner would notice)

A PR that changes what someone using the app sees or can do adds one or more items to the end of `UNRELEASED`, in
the same PR. A PR they wouldn't notice (tests, docs, internal clean-up, deploy scripts) adds nothing. Never add a
version, and never edit a version that exists, except to fix its wording.

```ts
{ kind: 'new', date: '2026-11-24', title: 'Sort your collection by price', details: 'The Collection page has a Price sort, so the cards worth the most come first.' },
```

- `kind`: `'new'` for something new (a feature, a new tool, a visible change in how something works); `'fix'` for a
  fix or a small touch. It tells the owner what the next version should be.
- `date`: the day it's merged, `YYYY-MM-DD` (today's date is fine).
- `title`: one line that stands alone in the banner. At most 70 characters, no full stop. Lead with what matters.
- `details`: 1–3 sentences (at most 400 characters): what it does, where to find it, why it helps.
- One item per thing someone would notice; a big feature may take two or three. If an unreleased item already
  covers what you changed (you're finishing or fixing it), edit that item instead of adding another.
- Card names as `[[Card Name]]`: the notes go through `CardText`.
- Two PRs adding to the end of the list conflict: keep both items, oldest first.

**Put your notes in the PR description** under a "Release note" heading, exactly as they will appear, so the owner
reads them at review and can reword them before merging.

### Suggesting a new version

When you finish work and `UNRELEASED` holds something worth announcing (a `'new'` item that people will want to
know about, or a good number of items building up), you may say so to the owner in one line at the end, with
what it would be: "There are 4 unreleased notes (2 new, 2 fixes): a good time for v1.31.0?". Once per piece of
work, not in every reply, and only a suggestion: never cut a version without the owner's yes.

### Cutting a version (only when the owner says so)

1. The number is one step up from the top version: minor (`1.30.0` → `1.31.0`) when any item is `'new'`; patch
   (`1.30.0` → `1.30.1`) when they're all fixes. A patch is quiet: listed on the Releases page, no banner of its own,
   and the next banner mentions it ("plus 2 fixes"). Major (`2.0.0`) only when the owner says so. Use the number
   the owner gives if they give one.
2. Add the version at the top of `RELEASE_NOTES`: `version`, `date` (today), a `title` (the headline, 3–8 words,
   sentence case, no full stop) and the `items`: the unreleased ones, most important first, merged where they
   overlap, at most 8 (the banner shows the first three, two on a phone). Drop `kind` and `date` from the items.
3. Empty `UNRELEASED`.
4. Show the owner the version as it will read before committing.

### Writing it for the person using the app

Plain words, second person, calm and concrete. Say what they can do now or what got better, and where to find it.
No PR numbers, handoffs, review rounds, file or component names, endpoints, tables, prompts, models' internals or
"refactor". No marketing words ("powerful", "seamless"), emoji or exclamation marks. Leave out what they can't
notice; if a change is mostly internal, say the one thing they'd feel.

| Not this | This |
| --- | --- |
| Finish's name lookups use an index | Finish no longer freezes the app |
| Mythic deck import reads the collection once per deck | Deck imports from Mythic Tools finish in seconds |
| Chat tool loop gets a `read_tune` tool with consent gate | Ask Chat about your Finish, Upgrades or Trim lists |
| Refactor card popup to one shared component | (nothing: nobody notices) |
| Massive upgrade to search! | Search understands partner commanders |

`npm test` checks the shape, the order, that each version is one step up, the lengths and the wording
(`lib/releases.test.ts`).

What follows from that, with nothing more to do:
- The newest version is the app's version (`APP_VERSION`), shown at the foot of every page. Don't put it anywhere
  else (`package.json` stays as it is: changing it changes the lockfile, and a deploy would reinstall every
  package).
- Each profile's banner shows until it closes it or opens the Releases page, on every device (`releases-server.ts`).
- Each time the server starts on a build it hasn't run before, the build and version are written to the `deploys`
  table; the Releases page shows them as the deploy history and "Live since" on each version.
