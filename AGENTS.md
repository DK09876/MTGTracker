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
