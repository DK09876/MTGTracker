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
  { path: deck, click: [tab('cards')], target: 'deck-tabs', title: 'A deck\'s tabs', body: 'Everything about a deck lives here and stays in reach as you scroll: the deck itself with its count and Add cards on top, its tabs, then "On this page", which jumps to each part of the page - on Cards, every group. This is the sample deck; nothing in it can be changed, so press anything.' },
  { click: [closeAdd, tab('cards')], target: 'boards', title: 'Main, maybe and side', body: 'The 99 are the main board. The maybeboard holds cards you might add; the sideboard, cards you took out. Add sections of your own, and move a card between them from its card.' },
  { target: 'deck-glance', title: 'The deck at a glance', body: 'Its curve, lands against the plan, the built-in tags against their ranges, colour sources, bracket and the last good-start rate - without leaving Cards. Customize picks which show; click one for the tab with the detail.' },
  { target: 'card-tools', title: 'See it your way', body: 'Grid, Stacks (each group a column of overlapping cards) or Text. The slider sizes the cards - click S, M or L to snap. Filter with Scryfall syntax, group by type, mana value or tags, and click a group\'s heading to fold it. Shortcuts lists the keys: / filters, G, S and T switch views.' },
  { target: 'select-cards', title: 'Select several', body: 'Press Select, then click cards to pick them (shift-click a range) and move, tag or remove them together. Esc clears, then stops selecting. A card\'s ⋯ has the quick things for one card.' },
  { click: [closeCard, tab('cards'), '[data-tour="card-grid"] button'], target: 'card-modal', title: 'Open any card', body: 'Its text, rulings and printings. Pick a cheaper or foil printing, change how many, move it to another board, put your tags on it, and correct its built-in tags for this deck if Scryfall has them wrong.' },
  { click: [closeCard, '[data-tour="add-cards"]'], target: 'add-panel', title: 'Add cards', body: 'Search by name or in plain words, paste a list, or add from your collection. Cards in the commander\'s colours come first.' },
  { click: [closeAdd], target: 'deck-more', title: 'The ⋯ menu', body: 'Import a list (from Moxfield, Arena or MTGO) or an Archidekt link over the deck, export it, rename, duplicate, change the commander, show it on your profile (decks are private until you do), or delete it.' },

  { click: [tab('plan')], target: 'plan-commander', title: 'Plan: what the commander does', body: 'Start here. The Plan tab is what you want the deck to be. Pick what the commander does for the deck, or leave it on Not sure. Every AI step reads what you set here.' },
  { target: 'plan-settings', title: 'Your settings', body: 'What you want from the deck and the bracket, then the limits Tune stays inside: never cut, budget, only cards you own and a deck rule. Never cut is the only thing that blocks a cut.' },
  { target: 'plan-notes', title: 'Your notes', body: 'Anything you want every AI step to know, in your words. Your answers to AI\'s questions land here when you confirm.' },
  { target: 'plan-read', title: 'The plan', body: 'How the deck wins, its ways to win and its key cards. Fill them in, or ask AI for suggestions you accept or skip. Confirm the plan to open Tune; you can confirm with everything on Not sure.' },

  { click: [tab('tags')], target: 'tags-on-deck', title: 'Tags', body: 'A deck starts with no tags. Accept the jobs to count and the tags that stand out from the card data, refine them with AI if you like, or name your own. Nothing is added until you accept it.' },

  { click: [tab('tune')], target: 'tune-intents', title: 'Tune: what do you want to do?', body: 'Finish the deck, find cards, swaps, cuts, fix a problem, or lands. The deck\'s size picks one for you - marked "suggested" - and you can switch any time.' },
  { target: 'tune-changes', title: 'Your changes', body: 'Everything you accept lands here: cards to add, cards to cut, swaps paired up, and what they would do to the deck\'s numbers. Nothing touches the deck until you press Apply; cuts go to the section for cards that came out, with their reason.' },
  { target: 'tune-groups', title: 'Suggestions wait for you', body: 'Each group says why it is there. Accept a whole group or single cards, save a group to a section for later, or dismiss it. How? on a card shows what went in and which rules moved it.' },
  { click: [tab('tune'), '[data-intent="cuts"]'], target: 'tune-groups', title: 'Cuts', body: 'Where to find room, in the order to look: flagged cards, a heavy curve, your bracket, jobs over their range, cards off the plan. Cuts on their own stop at 100; past that, a cut needs an add.' },
  { click: [tab('tune'), '[data-intent="cuts"]', '[data-tour="cut-rules-toggle"]'], target: 'cut-rules', title: 'The rules behind it', body: 'The cut list is these rules added up, each with an ⓘ. Switch one off, change how much it counts, or write your own - "tagged Wheels: never cut".' },
  { target: 'tune-claude', title: 'Ask Claude', body: 'Claude reads the whole plan, the numbers and what the rules suggest, and its ideas join the same groups - marked Claude. It may go against a usual rule when it makes sense for this deck, and says which. The ⓘ lists exactly what it is sent.' },
  { click: [tab('tune'), '[data-intent="fix"]'], target: 'tune-groups', title: 'Fix a problem', body: 'Pick what went wrong in your last games. The numbers behind it show first, then at most three swaps. Next time, it asks whether they helped.' },

  { click: [tab('check'), '[data-check="health"]'], target: 'bracket', title: 'Check: the numbers', body: 'Health and Playtest, the one place for the deck\'s numbers. The bracket first: the lowest official bracket the list can be, and why.' },
  { target: 'win-read', title: 'How it wins', body: 'A free read of how the deck closes games - combos, finishers and its shape - and what it lacks.' },
  { target: 'curve', title: 'Curve and colours', body: 'Spells by mana value, and each colour\'s share of the costs against the lands that make it. Hover a column for its cards.' },
  { target: 'roles', title: 'Built-in tags against the plan', body: 'How many of each the deck runs against the plan\'s ranges. Click one to see its cards.' },
  { target: 'hands', title: 'Opening hands', body: 'How many lands a seven has. Under Geek stats, write your keep rule - a land range plus cards it must have - and see how often a seven passes it.' },

  { click: [tab('check'), '[data-check="playtest"]', '[data-tour-mode="goldfish"]'], target: 'how-it-plays', title: 'Playtest: how it plays', body: 'Everything the autopilot assumes is yours to set: games and turns, play or draw, your keep rule and mulligans, what it casts first, and goals like "a Discard outlet in hand by turn 3". Save a setup as a preset.' },
  { click: [tab('check'), '[data-check="playtest"]', '[data-tour-mode="goldfish"]', '[data-tour="goldfish-play"]'], target: 'goldfish-goals', title: 'Your goals', body: 'How often each goal is met, and how often a game hits every goal you marked as a good start. Change the deck and play again - arrows compare with the last run that used the same settings.' },
  { target: 'goldfish-stats', title: 'The numbers', body: 'When the commander comes down, missed land drops, the mana each turn and how many sevens are mulliganed.' },
  { target: 'goldfish-stuck', title: 'Stuck in hand', body: 'Cards still in hand at the end in a good share of the games they were drawn - too expensive, or a colour the lands cannot make often enough.' },
  { click: [tab('check'), '[data-check="playtest"]', '[data-tour-mode="best"]', '?[data-tour="best-find"]:not(:disabled)'], target: 'best-hand-cards', title: 'The best hand', body: 'The strongest seven the deck can open with, judged by your goals. It shows which cards make the deck\'s ideal start.' },
  { click: [tab('check'), '[data-check="playtest"]', '[data-tour-mode="play"]', '?[data-tour="play-draw"]'], target: 'play-table', title: 'Play it yourself', body: 'Draw a seven, mulligan, then click cards to play them, click again to tap, and go turn by turn. Nothing here changes the deck.' },

  { click: [tab('chat'), '[data-tour="chat-list"] [data-tour-entry]'], target: 'chat-thread', title: 'Chat about the deck', body: 'Claude reads the plan, the deck and its tags, and looks things up - Scryfall, your collection, how often cards are played - shown above each answer. Suggestions can be sent to Tune, where they wait with the rest; nothing changes until you press one.' },
  { target: 'chat-composer', title: 'Ask anything', body: 'Type a question or tap a starter. Every chat is saved on the left; replies keep going if you leave the page.' },

  { click: [tab('cards'), '[data-owner="mine"]'], target: 'collection-summary', title: 'The physical deck', body: 'Show Mine or Missing to see which cards you own. Below the cards: which are in the deck, which sit in a box ready to pull, which another deck is holding, and what is left to buy. Pull and return copies, or mark proxies.' },
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
      'Folders keep decks apart: ＋ New folder, then drag decks onto it. Find, filter, sort and New deck stay at the top as you scroll.',
      'Open a deck for its tabs: Cards, Plan, Tune, Tags, Health, Playtest, Chat, Collection. Start with Plan.',
      'Decks are private until you show one on your profile.',
    ],
    steps: [
      { target: 'new-deck', title: 'Make a deck', body: 'Start from a commander - with a suggested starter list if you like: roles first, then what fits the commander, then lands for its colours - or paste a list (most sites\' text export) or an Archidekt link.' },
      { target: 'deck-folders', title: 'Folders', body: 'Folders keep decks apart; each one\'s swatch mixes the colours of its decks. Drag a deck onto one (on a phone, use the deck\'s ⋯ → Move to). A deck made while a folder is open goes in it.' },
      { target: 'deck-sort', title: 'Find and sort', body: 'Find a deck by name or commander, filter by colour or decks not at 100 yet, and sort - recently edited first by default. This bar stays under the top of the screen as you scroll.' },
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
      'Tune: pick what you want to do - finish the deck, find cards, swaps, cuts, fix a problem, lands. Suggestions wait until you accept them into Your changes, which you apply. Check: Health and Playtest, the deck\'s numbers. Tags: every card\'s role from the plan, and your tags; Cards shows which cards you own.',
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
