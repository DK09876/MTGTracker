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
const closeCard = '?[data-tour="card-modal"] [aria-label="Close"]';
const closeAdd = '?[data-tour="add-panel"] [aria-label="Close"]';
const buildStep = (n: number) => `[data-tour="build-steps"] button:nth-child(${n})`;

/** A deck, tab by tab and how to use each - the deck's own tour, and the second half of Decks'. */
const DECK_STEPS: TourStep[] = [
  { path: deck, click: [tab('cards')], target: 'deck-tabs', title: 'A deck\'s tabs', body: 'Everything about a deck lives in these tabs. This is the sample deck, a Grixis spellslinger; nothing in it can be changed, so press anything.' },
  { click: [closeAdd, tab('cards')], target: 'boards', title: 'Main, maybe and side', body: 'The 99 are the main board. The maybeboard holds cards you are considering; the sideboard, cards you swap in. Move a card between them from its card.' },
  { target: 'card-tools', title: 'Filter, view, group, sort', body: 'Filter with Scryfall syntax - t:creature, cmc<=2, usd>5. Switch between pictures and a text list, group by type, mana value, your tags or the automatic roles, and sort.' },
  { click: [closeCard, tab('cards'), '[data-tour="card-grid"] button'], target: 'card-modal', title: 'Open any card', body: 'Its text, rulings and printings. Pick a cheaper or foil printing, change how many, move it to another board, and put your tags on it here.' },
  { click: [closeCard, '[data-tour="add-cards"]'], target: 'add-panel', title: 'Add cards', body: 'Search by name or in plain words, paste a list, or add from your collection. Cards in the commander\'s colours come first.' },
  { click: [closeAdd], target: 'deck-more', title: 'The ⋯ menu', body: 'Edit the whole list as text, rename the deck, change its commander, show it on your profile (decks are private until you do), or delete it.' },

  { click: [tab('build'), buildStep(1)], target: 'build-steps', title: 'Build: a checklist', body: 'Seven steps from the commander\'s style to a final check, each marked done, needs work, or to do. Click a step for what to do about it. All worked out from the cards, no AI.' },
  { click: [tab('build'), buildStep(4)], target: 'build-fill', title: 'Fill the gaps', body: 'Pick a role the deck is short on. Cards for it are ranked by how often this commander\'s decks play them; tick "From my collection first" to see what you own - and which box it is in - before what you would buy. Set a price cap, then Add.' },
  { click: [tab('build'), buildStep(5)], target: 'build-mana', title: 'The mana', body: 'How many lands Karsten\'s formula wants for this curve, against what the deck runs. The button copies the decklist and opens Salubrious Snail\'s tool to check how often each spell is castable on time.' },

  { click: [tab('chat'), '[data-tour="chat-list"] [data-tour-entry]'], target: 'chat-thread', title: 'Chat about the deck', body: 'Claude reads the deck, its brief and its roles, and looks things up - Scryfall, your collection, EDHREC - shown above each answer. What it suggests comes as Add and Cut buttons; nothing changes until you press one.' },
  { target: 'chat-composer', title: 'Ask anything', body: 'Type a question or tap a starter - what to cut, upgrades from your collection, whether the deck can win. Every chat is saved on the left; replies keep going if you leave the page.' },

  { click: [tab('tags')], target: 'basic-roles', title: 'Basic roles, automatic', body: 'Ramp, draw, removal and the rest come from Scryfall\'s card tags, for free. Hover a role to see its cards.' },
  { target: 'draft-menu', title: 'Read the deck', body: 'Draft with AI writes how the deck wins and what it needs. The arrow has more: a free quick read, a draft from scratch, building on your brief, or checking it.' },
  { target: 'brief', title: 'The brief', body: 'What the deck should do, in your words. Every AI step reads it. A new read waits for you to save it, use it as the brief, or discard it.' },
  { target: 'saved-reads', title: 'Saved reads', body: 'Reads you kept, with the cards in and out of the deck since and how its ways to win changed - a light history of the deck.' },
  { target: 'suggest-tags', title: 'Tag step 1: suggest', body: 'The model suggests categories for this deck\'s plan - engines, payoffs, enablers, ways to win - each with a test for what belongs. Ask again with instructions to refine.' },
  { target: 'your-tags', title: 'Tag step 2: keep and shape', body: 'Keep, edit or drop each suggestion, or make your own. The kind says what the tag is for; the description is the test the model tags by.' },
  { target: 'tag-cards', title: 'Tag step 3: put them on the cards', body: 'The model applies your tags to every card and double-checks each tag, with the price shown before you start. Group the Cards tab by your tags to look them over.' },

  { click: [tab('health')], target: 'bracket', title: 'Bracket', body: 'The lowest official bracket the list can be, and why: Game Changers, two-card combos, mass land denial.' },
  { target: 'win-read', title: 'How it wins', body: 'A free read of how the deck closes games - combos, finishers and its shape - and what it lacks.' },
  { target: 'curve', title: 'Curve and colours', body: 'Spells by mana value, and each colour\'s share of the costs against the lands that make it. Hover a column for its cards.' },
  { target: 'roles', title: 'Roles against the guidelines', body: 'How many of each role the deck runs against common Commander counts. Click a role\'s name to see its cards.' },
  { target: 'hands', title: 'Opening hands', body: 'The odds of a keepable seven and of hitting land drops, from the real list.' },

  { click: [tab('suggestions')], target: 'combos', title: 'Combos it has', body: 'Every combo already in the list, from Commander Spellbook, and what each one makes.' },
  { target: 'one-away', title: 'One card away', body: 'Cards that would finish a combo with what the deck already holds, the ones completing the most first. Add one straight from here.' },
  { target: 'cuts', title: 'Cuts to consider', body: 'Where to look first when the deck needs room: roles it is over on, and cards this commander\'s decks rarely play. Prompts, not verdicts.' },

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
      'Open a deck for its tabs: Cards, Build, Chat, Tags, Health, Suggestions, Collection.',
      'Decks are private until you show one on your profile.',
    ],
    steps: [
      { target: 'new-deck', title: 'Make a deck', body: 'Start from a commander, or paste a decklist (Moxfield, Archidekt and plain text all work). The cards come from Scryfall, and their roles are read in the background.' },
      { target: 'deck-grid', title: 'Your decks', body: 'Each deck in its commander\'s colours, with its card count and value. Next, the tour opens the sample deck and goes through every tab.' },
      ...DECK_STEPS,
    ],
  },
  {
    id: 'deck',
    match: (p) => /^\/lists\/[^/]+$/.test(p),
    title: 'A deck',
    help: [
      'Cards: the list, grouped and sorted how you like. Build: a checklist to build by. Chat: ask Claude about the deck.',
      'Tags: your own categories and the brief. Health: curve, colours, roles, bracket and how it wins. Suggestions: combos and cuts. Collection: the physical deck.',
      'The ⋯ menu edits as text, renames, changes the commander, and shows the deck on your profile.',
    ],
    steps: DECK_STEPS,
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
