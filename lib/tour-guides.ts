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
const deck = (id: string) => `/lists/${id}`;

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
      'Uses Claude: the header shows today\'s budget.',
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
      'Your Commander decks. Make one from a commander, or paste or import a decklist.',
      'Decks are private until you show one on your profile.',
    ],
    steps: [
      { target: 'deck-grid', title: 'Your decks', body: 'Each deck in its commander\'s colours. Open one for its cards, the Build checklist, chat, tags, health and more - the deck has its own tour.' },
    ],
  },
  {
    id: 'deck',
    match: (p) => /^\/lists\/[^/]+$/.test(p),
    title: 'A deck',
    help: [
      'Cards: the list, grouped and sorted how you like. Build: a checklist to build by. Chat: ask Claude about the deck.',
      'Tags: your own categories and the brief. Health: curve, colours, roles, bracket and how it wins. Suggestions: combos and cuts.',
      'The ⋯ menu edits as text, renames, changes the commander, and shows the deck on your profile.',
    ],
    steps: [
      { path: deck, click: [tab('cards')], target: 'deck-tabs', title: 'A deck\'s tabs', body: 'Everything about a deck lives in these tabs. This is the sample deck, a Grixis spellslinger; nothing in it can be changed.' },
      { target: 'deck-more', title: 'The ⋯ menu', body: 'Edit the list as text, rename it, change the commander, show it on your profile (decks are private until you do), or delete it.' },
      { click: [tab('build')], target: 'build-steps', title: 'Build: a checklist', body: 'Seven steps from commander style to a final check, each marked done or needs work. All worked out from the cards - no AI.' },
      { click: [tab('build'), '[data-tour="build-steps"] button:nth-child(4)'], target: 'build-fill', title: 'Fill the gaps', body: 'Cards for the roles the deck is short on, ranked by how often this commander\'s decks play them, with the ones you own - and where they are - first.' },
      { click: [tab('chat'), '[data-tour="chat-list"] [data-tour-entry]'], target: 'chat-thread', title: 'Chat about the deck', body: 'Claude reads the deck and its brief and looks things up - Scryfall, your collection, EDHREC. What it suggests comes as Add and Cut buttons; nothing changes until you press one.' },
      { click: [tab('tags')], target: 'brief', title: 'What the deck should do', body: 'The brief every AI step reads. Draft it with AI, or a free quick read from the cards; save the reads you want and see what changed since.' },
      { target: 'basic-roles', title: 'Basic roles, automatic', body: 'Ramp, draw, removal and the rest come from Scryfall\'s card tags, for free. Hover one to see its cards.' },
      { target: 'your-tags', title: 'Your own tags', body: 'Categories for this deck\'s plan - engines, payoffs, enablers, ways to win. Make them by hand or let the model suggest some.' },
      { target: 'tag-cards', title: 'Tag the cards with AI', body: 'The model puts your tags on every card and double-checks each one, with the price shown before you start. It runs in the background.' },
      { click: [tab('health')], target: 'win-read', title: 'How it wins', body: 'A free read of how the deck closes games - combos, finishers and its shape - and what it lacks.' },
      { target: 'roles', title: 'Roles against the guidelines', body: 'How many of each role the deck runs against common Commander counts. Click a role\'s name to see its cards.' },
      { click: [tab('suggestions')], target: 'suggestions', title: 'Combos and cuts', body: 'Combos the deck already has, cards that would complete one, and where to look first for cuts.' },
      { click: [tab('collection')], target: 'deck-collection', title: 'The physical deck', body: 'Which cards are in the deck, which sit in a box ready to pull, which another deck holds, and what is left to buy.' },
    ],
  },
  {
    id: 'collection',
    match: (p) => p.startsWith('/collection'),
    title: 'Collection',
    help: [
      'Every card you own, by box. Add cards by search, import a list, or scan them with the camera.',
      'Decks show which of their cards you own and where; Build and chat suggest from your collection first.',
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
      'Your profile: add a password, sign out. Today\'s AI budget, your model choice and how hard Claude thinks.',
      'Admins also see the model for each AI step, People, card data, and the error log.',
    ],
    steps: [
      { target: 'my-profile', title: 'Your profile', body: 'Add a password so only you can open your profile, or sign out of this browser.' },
      { target: 'ai-budget', title: 'Today\'s AI budget', body: 'What the app and you have spent today against the daily caps. Most of the app needs no AI at all.' },
      { target: 'ai-model', title: 'Your model', body: 'The model for rules answers and reading decks. Stronger costs more; the header picker changes it too.' },
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
