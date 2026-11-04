/**
 * What the "?" says on each page, and the guided tour of it: each step
 * points at a part of the page (its data-tour marker), after clicking what
 * it needs to (a tab, a saved item). Tours run on the sample profile, so
 * every step has something real to show.
 */

export interface TourStep {
  /** The data-tour marker to point at; none centres the card. */
  target?: string;
  /** CSS selectors clicked first, in order: a tab, a history entry. */
  click?: string[];
  /** A page to be on first, given the sample deck's id. */
  path?: (deckId: string) => string;
  title: string;
  body: string;
}

export interface Guide {
  id: string;
  match: (path: string) => boolean;
  title: string;
  help: string[];
  steps: TourStep[];
}

const tab = (t: string) => `[data-tour-tab="${t}"]`;
// Decks open at /decks/<id>; the same page also answers at /lists/<id>.
const deck = (id: string) => `/decks/${id}`;
const closeCard = '?[data-tour="card-modal"] [aria-label="Close"]';
const closeAdd = '?[data-tour="add-panel"] [aria-label="Close"]';

/** A deck, tab by tab and how to use each - the deck's own tour, and the second half of Decks'. */
const DECK_STEPS: TourStep[] = [
  { path: deck, click: [tab('cards')], target: 'deck-tabs', title: 'A deck\'s tabs', body: 'Everything about a deck lives in these tabs, and they stay in reach as you scroll. Under them, "On this page" jumps to each part of the page - on Cards, every group. This is the sample deck; nothing in it can be changed, so press anything.' },
  { click: [closeAdd, tab('cards')], target: 'boards', title: 'Main, maybe and side', body: 'The 99 are the main board. The maybeboard holds cards you are considering; the sideboard, cards you swap in. Move a card between them from its card.' },
  { target: 'deck-glance', title: 'The deck at a glance', body: 'Its curve, lands against the plan, the built-in tags against their ranges, colour sources, bracket and the last good-start rate - without leaving Cards. Customize picks which show; click one for the tab with the detail.' },
  { target: 'card-tools', title: 'See it your way', body: 'Grid, Stacks (each group a column of overlapping cards) or Text. The slider sizes the cards - click S, M or L to snap. Filter with Scryfall syntax, group by type, mana value or tags, and click a group\'s heading to fold it. Shortcuts lists the keys: / filters, G, S and T switch views.' },
  { target: 'select-cards', title: 'Select several', body: 'Press Select, then click cards to pick them (shift-click a range) and move, tag or remove them together. Esc clears, then stops selecting. A card\'s ⋯ has the quick things for one card.' },
  { click: [closeCard, tab('cards'), '[data-tour="card-grid"] button'], target: 'card-modal', title: 'Open any card', body: 'Its text, rulings and printings. Pick a cheaper or foil printing, change how many, move it to another board, put your tags on it, and correct its built-in tags for this deck if Scryfall has them wrong.' },
  { click: [closeCard, '[data-tour="add-cards"]'], target: 'add-panel', title: 'Add cards', body: 'Search by name or in plain words, paste a list, or add from your collection. Cards in the commander\'s colours come first.' },
  { click: [closeAdd], target: 'deck-more', title: 'The ⋯ menu', body: 'Import a list (from Moxfield, Arena or MTGO) or an Archidekt link over the deck, export it, rename, duplicate, change the commander, show it on your profile (decks are private until you do), or delete it.' },

  { click: [tab('plan')], target: 'brief', title: 'Plan: what the deck does', body: 'The first thing to settle. A sentence or two on how the deck wins - drafted for you from the cards, or by Claude with your instructions. Everything else reads it: what to add and cut, how cards are tagged, what Chat knows.' },
  { target: 'plan-style', title: 'Its style', body: 'Read from the commander and the deck\'s own cards - this one is a spells deck. Change the main or second style if it reads the deck wrong; it moves the usual counts and the cut list keeps cards that fit it.' },
  { target: 'plan-flip', title: 'The flip turn', body: 'The mana the deck needs before it starts doing its thing - the commander\'s mana value unless you say otherwise. The ramp and land counts follow it, and Playtest starts with a goal from it.' },
  { target: 'plan-guidelines', title: 'Guidelines', body: 'How many lands, ramp, card draw, removal and board wipes the deck should run. Each has an ⓘ explaining why; change a range and it is yours.' },
  { target: 'plan-packages', title: 'Theme packages', body: 'Each of your tags is a package - 8 cards by default, 16 for a key theme - and how full it is. The cut list trims packages over their size first.' },
  { target: 'plan-confirm', title: 'Confirm it', body: 'Chat, the tagger and Claude\'s reviews wait for a confirmed plan, because they read it. Change it any time.' },

  { click: [tab('tune'), '[data-tune="add"]'], target: 'build-issues', title: 'Tune: what to look at', body: 'Adding and cutting toward the plan. Add opens on the few things worth fixing, in plain words: a tag well short of its range, no clear way to win, too few lands or sources of a colour. Each says why, shows the cards, and has the fix right there.' },
  { target: 'build-roles', title: 'Built-in tags', body: 'Ramp, card draw, removal and the rest against the plan\'s ranges - the green band. Click one for its cards.' },
  { click: [tab('tune'), '[data-tune="add"]', '?[data-tour="build-roles"]:not(:has([data-tour="build-fill"])) [data-tour="role-find"]'], target: 'build-fill', title: 'Find cards', body: 'Cards for a tag, ranked by how well they fit this commander and how much Commander plays them. Tick "From my collection first" to see what you own - and which box it is in. Set a price cap, then Add.' },
  { target: 'build-mana', title: 'The mana', body: 'Lands against the plan\'s range, with Karsten\'s formula as a second opinion, and each colour\'s sources against what its hungriest spell needs.' },
  { target: 'tune-combos', title: 'Combos', body: 'Every combo already in the list, and cards one away from finishing one - from Commander Spellbook.' },
  { target: 'tune-ideas', title: 'Ideas from Claude', body: 'Ask for cards that fit the plan, with your own instructions; it opens in Chat with Add buttons. The ⓘ lists exactly what Claude is sent.' },
  { click: [tab('tune'), '[data-tune="cut"]'], target: 'cut-workbench', title: 'Cut', body: 'Every card weighed, with its reasons; cards your tags mark as the plan are never offered. Tick some, see what they would leave, and cut them to the maybeboard, with undo.' },
  { click: [tab('tune'), '[data-tune="cut"]', '[data-tour="cut-views"] button:nth-child(2)'], target: 'cut-rules', title: 'The rules behind it', body: 'The cut list is these rules added up, grouped by what they are about, each with an ⓘ. Switch one off, change how much it counts, or write your own - "tagged Wheels: never cut".' },
  { click: [tab('tune'), '[data-tune="cut"]', '[data-tour="cut-views"] button:nth-child(3)'], target: 'cut-review', title: 'Ask Claude', body: 'Claude reads the plan, your tags and the top 30 cuts and says which it agrees with, with one line each - plus anything your instructions ask. It never cuts anything itself.' },

  { click: [tab('tags')], target: 'basic-roles', title: 'Built-in tags', body: 'Ramp, card draw, removal and the rest come from Scryfall\'s card tags, for free. Hover one to see its cards.' },
  { target: 'suggest-tags', title: 'Tag step 1: suggest', body: 'The model suggests tags for this deck\'s plan - engines, payoffs, enablers, ways to win - each with a test for what belongs. Ask again with instructions to refine.' },
  { target: 'your-tags', title: 'Tag step 2: keep and shape', body: 'Keep, edit or drop each suggestion, or make your own. The kind says what the tag is for; the description is the test the model tags by.' },
  { target: 'tag-scope', title: 'Tag step 3: which cards, which tags', body: 'The whole deck, the untagged, cards missing one tag, or cards you pick - with all your tags or just some, and your own instructions. The price shows before you start.' },

  { click: [tab('health')], target: 'bracket', title: 'Bracket', body: 'The lowest official bracket the list can be, and why: Game Changers, two-card combos, mass land denial.' },
  { target: 'win-read', title: 'How it wins', body: 'A free read of how the deck closes games - combos, finishers and its shape - and what it lacks.' },
  { target: 'curve', title: 'Curve and colours', body: 'Spells by mana value, and each colour\'s share of the costs against the lands that make it. Hover a column for its cards.' },
  { target: 'roles', title: 'Built-in tags against the plan', body: 'How many of each the deck runs against the plan\'s ranges. Click one to see its cards.' },
  { target: 'hands', title: 'Opening hands', body: 'How many lands a seven has. Under Geek stats, write your keep rule - a land range plus cards it must have - and see how often a seven passes it.' },

  { click: [tab('playtest'), '[data-tour-mode="goldfish"]'], target: 'how-it-plays', title: 'Playtest: how it plays', body: 'Everything the autopilot assumes is yours to set: games and turns, play or draw, your keep rule and mulligans, what it casts first, and goals like "a Discard outlet in hand by turn 3". Save a setup as a preset.' },
  { click: [tab('playtest'), '[data-tour-mode="goldfish"]', '[data-tour="goldfish-play"]'], target: 'goldfish-goals', title: 'Your goals', body: 'How often each goal is met, and how often a game hits every goal you marked as a good start. Change the deck and play again - arrows compare with the last run that used the same settings.' },
  { target: 'goldfish-stats', title: 'The numbers', body: 'When the commander comes down, missed land drops, the mana each turn and how many sevens are mulliganed.' },
  { target: 'goldfish-stuck', title: 'Stuck in hand', body: 'Cards still in hand at the end in a good share of the games they were drawn - too expensive, or a colour the lands cannot make often enough.' },
  { click: [tab('playtest'), '[data-tour-mode="best"]', '?[data-tour="best-find"]:not(:disabled)'], target: 'best-hand-cards', title: 'The best hand', body: 'The strongest seven the deck can open with, judged by your goals. It shows which cards make the deck\'s ideal start.' },
  { click: [tab('playtest'), '[data-tour-mode="play"]', '?[data-tour="play-draw"]'], target: 'play-table', title: 'Play it yourself', body: 'Draw a seven, mulligan, then click cards to play them, click again to tap, and go turn by turn. Nothing here changes the deck.' },

  { click: [tab('chat'), '[data-tour="chat-list"] [data-tour-entry]'], target: 'chat-thread', title: 'Chat about the deck', body: 'Claude reads the plan, the deck and its tags, and looks things up - Scryfall, your collection, how often cards are played - shown above each answer. Suggestions come as Add and Cut buttons; nothing changes until you press one.' },
  { target: 'chat-composer', title: 'Ask anything', body: 'Type a question or tap a starter. Every chat is saved on the left; replies keep going if you leave the page.' },

  { click: [tab('collection')], target: 'collection-summary', title: 'The physical deck', body: 'How many cards are really in the deck, which sit in a box ready to pull, which another deck is holding, and what is left to buy. Pull and return copies, or mark proxies.' },
];

export const GUIDES: Guide[] = [
  {
    id: 'search',
    match: (p) => p === '/',
    title: 'Search',
    help: [
      'Type what you want in plain words - "cheap green ramp for Omnath" - or Scryfall syntax.',
      'Every search is kept in your history. Opening one runs it again on Scryfall without AI, so prices are today\'s.',
      'Follow-up chips narrow the same search; star one to keep it.',
    ],
    steps: [
      { target: 'search-box', title: 'Ask in plain words', body: 'Type what you are looking for the way you would say it. A fast, cheap AI turns it into a Scryfall search; Scryfall syntax works too, with no AI at all.' },
      { target: 'history|history-button', title: 'Your searches are kept', body: 'Every search lands in your history (here, or behind History on a phone). Opening one runs it again on Scryfall without spending AI, so cards and prices are today\'s. Star the ones you want to keep.' },
      { click: ['?[data-tour="history-button"]', '[data-tour-entry]'], target: 'results', title: 'Results, live from Scryfall', body: 'This is one of the sample\'s searches, run again just now. Open any card for its printings, prices and which of your lists hold it.' },
      { target: 'search-box', title: 'Narrow it down', body: 'Type again or tap a follow-up - "only instants", "under $2" - to refine the same search instead of starting over.' },
    ],
  },
  {
    id: 'rules',
    match: (p) => p.startsWith('/rules'),
    title: 'Rules',
    help: [
      'Ask how cards interact. Answers come from the official rulings, the Comprehensive Rules and the MTG Wiki, each cited.',
      'Conversations are kept on the left; ask a follow-up in the same one.',
      'Uses Claude: the picker at the top chooses the model - Haiku, Sonnet or Opus - with about what a question costs.',
    ],
    steps: [
      { target: 'rules-composer', title: 'Ask a rules question', body: 'Name the cards and the situation. If a name could be several cards, it asks which; if something matters, it asks before answering.' },
      { target: 'history|history-button', title: 'Your conversations', body: 'Every question and answer is kept here, so reopening one costs nothing.' },
      { click: ['?[data-tour="history-button"]', '[data-tour-entry]'], target: 'rules-answer', title: 'An answer, with its sources', body: 'The verdict first, then the reasoning, every step cited: official rulings, the Comprehensive Rules and the MTG Wiki. This one is a real answer - 243 Scute Swarms.' },
      { target: 'rules-composer', title: 'Follow up', body: 'Ask "what if I had two Doubling Seasons?" and it answers in the same conversation, with what came before in mind.' },
    ],
  },
  {
    id: 'decks',
    match: (p) => p === '/decks',
    title: 'Decks',
    help: [
      'Your Commander decks. Make one from a commander, a pasted list, or an Archidekt link. Each deck\'s ⋯ duplicates, files or deletes it.',
      'Folders keep decks apart: ＋ Folder, then drag decks onto it. Find, filter and sort sit under the folders.',
      'Open a deck for its tabs: Cards, Plan, Tune, Tags, Health, Playtest, Chat, Collection. Start with Plan.',
      'Decks are private until you show one on your profile.',
    ],
    steps: [
      { target: 'new-deck', title: 'Make a deck', body: 'Start from a commander - with a suggested starter list if you like: roles first, then what fits the commander, then lands for its colours - or paste a list (most sites\' text export) or an Archidekt link.' },
      { target: 'deck-folders', title: 'Folders', body: 'Make folders to keep decks apart. Drag a deck onto one, or use a deck\'s ⋯ → Move to. A deck made while a folder is open goes in it.' },
      { target: 'deck-sort', title: 'Find and sort', body: 'Find a deck by name or commander, filter by colour or decks not at 100 yet, and sort - recently edited first by default. Remembered in this browser.' },
      { target: 'deck-grid', title: 'Your decks', body: 'Each deck in its commander\'s colours, with its card count and value. Next, the tour opens the sample deck and goes through every tab.' },
      ...DECK_STEPS,
    ],
  },
  {
    id: 'deck',
    match: (p) => /^\/(decks|lists)\/[^/]+$/.test(p),
    title: 'A deck',
    help: [
      'Start with Plan: what the deck does, its style, flip turn and guidelines. Everything else reads it. Cards: the list, grouped by type or tags.',
      'Tune: what to add and what to cut, with rules you can change and Claude\'s review. Tags: your own tags next to the built-in ones. Health: curve, colours, bracket, your keep rule. Playtest: goldfish by your own goals, the best hand, or play by hand. Chat: ask Claude. Collection: the physical deck.',
      'The ⋯ menu imports a list or a link, exports, sets the card size, renames, duplicates, changes the commander, and shows the deck on your profile.',
    ],
    steps: DECK_STEPS,
  },
  {
    id: 'collection',
    match: (p) => p.startsWith('/collection'),
    title: 'Collection',
    help: [
      'Every card you own, by box. Add cards by search, import a list, or scan them with the camera.',
      'Decks show which of their cards you own and where; Tune and Chat suggest from your collection first.',
    ],
    steps: [
      { target: 'collection-head', title: 'Your collection', body: 'What you own, what it is worth, and how much sits in decks. The sample has one box with a few cards.' },
    ],
  },
  {
    id: 'settings',
    match: (p) => p.startsWith('/settings'),
    title: 'Settings',
    help: [
      'Your profile: add a password, sign out. Today\'s AI budget, and how each AI page lets you pick its model.',
      'Admins also see the model for each AI step, People, card data, and the error log.',
    ],
    steps: [
      { target: 'my-profile', title: 'Your profile', body: 'Add a password so only you can open your profile, or sign out of this browser.' },
      { target: 'ai-budget', title: 'Today\'s AI budget', body: 'What the app and you have spent today against the daily caps. Most of the app needs no AI at all.' },
      { target: 'ai-model', title: 'Pick the AI per page', body: 'Search, Rules, a deck\'s Tags and Chat each let you pick the model - Haiku, Sonnet or Opus - with about what a request costs. Stronger models think harder and cost more.' },
    ],
  },
  {
    id: 'people',
    match: (p) => p.startsWith('/people'),
    title: 'People',
    help: [
      'Everyone on the app, each with a favourite commander as their picture.',
      'Your profile page sets that, your featured deck, your theme, and which decks others can see.',
    ],
    steps: [
      { path: () => '/people/tour', target: 'profile-banner', title: 'A profile', body: 'A favourite commander\'s art as the banner and picture, a featured deck, and the decks shown to others.' },
      { target: 'profile-edit', title: 'Make it yours', body: 'On your own page: pick your commander, your featured deck, a theme for the whole app, and whether it moves.' },
    ],
  },
  {
    id: 'lists',
    match: (p) => p === '/lists',
    title: 'Lists',
    help: [
      'Lists that are not decks: wishlists, trade binders, cards to look at later.',
      'Search results can be added to any list.',
    ],
    steps: [],
  },
];

export const guideFor = (path: string) => GUIDES.find((g) => g.match(path)) ?? null;
export const guideById = (id: string) => GUIDES.find((g) => g.id === id) ?? null;
