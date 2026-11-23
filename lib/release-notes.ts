/**
 * What changed, for the people who use the app. Read by lib/releases.ts, which says what each field is;
 * AGENTS.md ("Releases") says how to add to it; lib/releases.test.ts checks the shape.
 */

import type { Release, UnreleasedItem } from './releases';

/**
 * Changes merged since the newest version, oldest first: every agent adds its notes here, with no version. The owner
 * decides when they become a version (AGENTS.md, "Cutting a version"). On the Releases page they show as "Since
 * v…", with no banner.
 */
export const UNRELEASED: UnreleasedItem[] = [
];

/** Every version, newest first. Only cut by the owner's say-so. */
export const RELEASE_NOTES: Release[] = [
  {
    version: '1.30.0',
    date: '2026-11-18',
    title: 'What’s new, and every past update',
    items: [
      {
        title: 'A short note after each update',
        details: 'When the app has something new, a line under the header says what changed. Close it, or open the Releases page, and it goes on every device you use.',
      },
      {
        title: 'The Releases page lists every update',
        details: 'Every version the app has had, newest first, each one opening to what changed. Open it from the ✦ at the top of any page: it turns gold with a dot when there’s something you haven’t seen.',
      },
      {
        title: 'Small fixes don’t interrupt you',
        details: 'Fixes are listed on the Releases page without a note under the header. The next note about something new mentions them.',
      },
      {
        title: 'See when each version went live',
        details: 'The Releases page keeps a deploy history: when each update reached the app, from this one on.',
      },
    ],
  },
  {
    version: '1.29.0',
    date: '2026-11-18',
    title: 'Chat can read your Tune page',
    items: [
      {
        title: 'Ask Chat about your Finish, Upgrades or Trim lists',
        details: 'Chat can now see what’s on the deck’s Tune page: open lists with Claude’s reasons and your marks, past skips and Maybes, and staged changes.',
      },
      {
        title: 'Only when you let it',
        details: 'Chat reads Tune when your message asks about it, or when you allow it. Otherwise it asks with “Claude wants to read your Tune page”, and a switch above the message box shows whether this chat may read it.',
      },
      {
        title: 'A new teleportation-circle icon',
        details: 'The app icon is now a card at the heart of a teleportation circle.',
      },
    ],
  },
  {
    version: '1.28.0',
    date: '2026-11-18',
    title: 'Card names you can tap everywhere',
    items: [
      {
        title: 'Every card name opens the card',
        details: 'Card names in AI answers, notes, reasons, Rules and Search are highlighted. Hover shows the picture; a click or tap opens one popup with the card’s details and other printings.',
      },
      {
        title: 'Write [[Card Name]] to mean an exact card',
        details: 'When you name a card in double brackets, Claude is told exactly which card you meant, with its rules text.',
      },
      {
        title: 'Search has a Commander field',
        details: 'A new optional Commander field sets the commander, so a legendary creature mentioned in your text isn’t taken as one. The name you typed wins, and a loose match asks “Did you mean…?”',
      },
      {
        title: 'Tokens and extras on the Cards tab',
        details: 'A deck’s Cards tab lists its tokens, emblems and other pieces like The Monarch or dungeons, each with the cards that make it.',
      },
      {
        title: 'Newer cards and plural names found',
        details: 'Cards newer than the weekly card data are fetched and kept. Rules finds a name written in the plural, like “forsaken monuments” for [[Forsaken Monument]].',
      },
    ],
  },
  {
    version: '1.27.0',
    date: '2026-11-17',
    title: 'Save Finish picks to the Maybeboard',
    items: [
      {
        title: 'Maybe sends a pick to the Maybeboard',
        details: 'Each Finish pick now has Add, Rethink, Maybe and Skip. Maybe cards go to the Maybeboard on Apply, Claude learns you liked them somewhat, and they aren’t offered again unless you choose Offer it again.',
      },
      {
        title: 'The unsure hint no longer covers your reason',
        details: '“Sounds unsure. Rethink?” now sits beside the reason box, or under it on a narrow screen.',
      },
      {
        title: 'The new icon in the header',
        details: 'The header logo now matches the app icon.',
      },
    ],
  },
  {
    version: '1.26.2',
    date: '2026-11-17',
    title: 'Finish no longer freezes the app',
    items: [
      {
        title: 'Finish loads quickly with cards to buy',
        details: 'Opening a Finish list with many cards to buy could stall the whole app for a minute or more. Card names are now looked up quickly, so the page opens straight away.',
      },
    ],
  },
  {
    version: '1.26.1',
    date: '2026-11-17',
    title: 'A new app icon',
    items: [
      {
        title: 'New icon: a card rising from a five-colour circle',
        details: 'The home-screen icon and browser tab now show the new art. If the app is already on your home screen, remove it and add it again to see the new icon.',
      },
    ],
  },
  {
    version: '1.26.0',
    date: '2026-11-14',
    title: 'Upgrades, and Finish with cards to buy',
    items: [
      {
        title: 'Upgrades suggests swaps for a deck at 100',
        details: 'A new Tune tool suggests 5, 10 or 20 swaps from your cards, cards to buy, or both. Each row says what it replaces and why, with its price; review, apply and undo work as in Finish, and you can copy a buy list.',
      },
      {
        title: 'Finish can include cards to buy',
        details: 'Choose none, the ones that matter, or any card, and set a total you’re willing to spend for the deck. Picks over the total are listed with prices and an Add anyway.',
      },
      {
        title: 'Find cards and Swaps fold into Upgrades',
        details: 'Their free, no-AI ideas now appear as Upgrades’ free list: jobs under range, your groups, themes, near-combos and Maybeboard pairs.',
      },
      {
        title: 'Chat knows each card’s rules text',
        details: 'Chat now reads the rules text of every card in the deck. A card name it can’t place still opens on hover or tap after a quick lookup.',
      },
      {
        title: 'Budgets hold everywhere',
        details: 'A card with no known price no longer passes a budget, and every add is checked against your bracket and the deck’s limits.',
      },
    ],
  },
  {
    version: '1.25.0',
    date: '2026-11-13',
    title: 'Chat searches your cards; updates take seconds',
    items: [
      {
        title: 'Chat searches the cards you own',
        details: 'Claude now searches your collection instead of naming cards from memory, and says where each copy is: a spare, in this deck’s sideboard, or in another deck. Off-colour cards no longer slip in.',
      },
      {
        title: 'Chat opens the right page for big jobs',
        details: 'When a change is large, Chat shows the first few and a button to open Trim, Finish, Tags, Check or Plan with the numbers filled in. Every card in an answer is a link.',
      },
      {
        title: 'Claude picks the lands worth playing',
        details: 'On a fill to 100, Claude chooses which of your nonbasic lands earn a slot and the app adds basics for the rest. Untick a land and a basic takes its place.',
      },
      {
        title: 'Lists you can fold, filter and sort',
        details: 'Finish and Trim lists can be filtered, sorted and folded, remembered per deck. Skips are remembered with their reasons, and a later round shows what changed.',
      },
      {
        title: 'Updates take seconds and a line tells you',
        details: 'The app is down for about a second when updated. Open tabs say when it’s updating and offer Refresh when a new version is out.',
      },
    ],
  },
  {
    version: '1.24.0',
    date: '2026-11-13',
    title: 'Finish a deck from cards you own',
    items: [
      {
        title: 'Finish the deck fills it from your collection',
        details: 'In Tune, Finish the deck has Claude search the cards you own and pick the rest. You can include cards held by other decks, and each one names its deck.',
      },
      {
        title: 'Talk it through over several rounds',
        details: 'Mark each pick Add, Rethink or Skip and say what to change. Later rounds keep your keeps, never offer a skipped card again, and refill only the open slots.',
      },
      {
        title: 'Combos when your plan wants them',
        details: 'The Plan has a new choice for combos. When you build around them, combos you own every piece of go to Claude, and complete ones are listed after each round.',
      },
      {
        title: 'Lands added for you on a fill to 100',
        details: 'Your dual lands go in first, then basics split by the colours in the deck.',
      },
      {
        title: 'Trim can cut to a number',
        details: 'Choose “Cut N” or “Cut to N”, and Trim stays open on decks at 100 or under.',
      },
    ],
  },
  {
    version: '1.23.0',
    date: '2026-11-12',
    title: 'Chat can make changes to your deck',
    items: [
      {
        title: 'Chat suggests changes you apply with a click',
        details: 'Claude can propose cuts, adds, swaps, moves, groups, notes, ways to win and key cards. Each comes as a row with Apply and Undo, or Apply all, and it gets the same checks as Tune.',
      },
      {
        title: 'Refine with AI can focus on one kind of change',
        details: 'On Tags, narrow Refine with AI to fixing groups, one group, looking for a kind of card, tidying groups or describing them.',
      },
      {
        title: 'Rethink a card in Trim',
        details: 'Each row is now Keep, Rethink or Cut. Rethink sends your reason for Claude to weigh without settling anything.',
      },
      {
        title: 'Manage groups from the card window',
        details: 'Click a card to add it to a group, take it out, or start a new group with it. Card names in suggestions show their picture on hover.',
      },
      {
        title: 'Skip all, and no more double-sent questions',
        details: 'Skip all sits beside Accept all on Plan and Tags. Tapping Send several times now sends one question.',
      },
    ],
  },
  {
    version: '1.22.0',
    date: '2026-11-12',
    title: 'New Plan and Tags tabs, and Trim',
    items: [
      {
        title: 'Every deck starts fresh with a plan to confirm',
        details: 'Plan, Tags and Tune settings were reset on every deck; cards, sections, history, chats and games are untouched. Tune stays locked until you confirm the deck’s plan, which takes one click and uses no AI.',
      },
      {
        title: 'A new Plan tab and Tags tab',
        details: 'Plan walks through what the commander does, your settings, your notes and the plan, with optional AI suggestions you accept one by one. Tags shows each job as a tile with its count, plus your own groups.',
      },
      {
        title: 'Trim cuts an over-full deck down to 100',
        details: 'Claude drafts a ranked cut list, and you mark Keep or Cut with a reason and reply in your own words. Each new list builds on what you said, and it never cuts your commander, a never-cut card or too many lands.',
      },
      {
        title: 'One count per job everywhere',
        details: 'Trim, Tune, Tags, Cards and Check now agree on how many cards fill each job. Every AI button shows its price before you run it.',
      },
      {
        title: 'Fixes for crashes and odd warnings',
        details: 'Five-colour decks no longer crash on Swaps, one-shot Treasure makers don’t count as ramp, and warnings only flag real problems. Deck pages load faster.',
      },
    ],
  },
  {
    version: '1.21.0',
    date: '2026-11-10',
    title: 'Deck editing basics: undo, history, fast add',
    items: [
      {
        title: 'Undo any change, and go back in history',
        details: 'Every change can be undone with the Undo note or Cmd/Ctrl+Z. Under ⋯ → History and snapshots you can go back to before any change, and named snapshots can be compared and restored. One is taken automatically before an import.',
      },
      {
        title: 'Imports keep tags, foils and set numbers',
        details: 'Pasted lists from Moxfield or Archidekt keep their tags, foil and etched markers, set and number, and commander or companion markers. A re-import shows what will change first.',
      },
      {
        title: 'Add cards by name in a fraction of a second',
        details: 'Type a name and press Enter to add the top hit; Shift+Enter sends it to the Maybeboard. Names come up instantly, in the deck’s colours, with cards already in the deck marked.',
      },
      {
        title: 'A denser list and keyboard shortcuts',
        details: 'The compact list is now the default and runs in two columns on wide screens. Hover a card and press keys like B for Sideboard or M for Maybeboard; ? lists them all.',
      },
      {
        title: 'Deck pages fit an iPhone better',
        details: 'All five tabs fit the bar, the Undo note doesn’t block taps, and card menus fit short screens.',
      },
    ],
  },
  {
    version: '1.20.0',
    date: '2026-11-07',
    title: 'See which deck cards you own',
    items: [
      {
        title: 'Every card in a deck shows whether you own it',
        details: 'A small mark beside each card says yours, proxy, in your boxes, in another deck, or to buy. Tap it to pull from a box, take from another deck, return a copy or mark a proxy, each with Undo.',
      },
      {
        title: 'A summary chip for the whole deck',
        details: 'Beside Show, a line like “86/100 yours · 2 proxies · 0 to buy” jumps to where your copies are, and its counts work as quick filters.',
      },
      {
        title: 'Filter by ownership',
        details: 'Type is:held, is:proxy, is:inbox, is:otherdeck or is:tobuy in a deck’s filter to see just those cards.',
      },
      {
        title: 'Deck tiles show how much you own',
        details: 'On the Decks page each tile shows how many of its cards are yours, plus proxies or cards to buy when there are any.',
      },
    ],
  },
  {
    version: '1.19.1',
    date: '2026-11-06',
    title: 'Faster Mythic Tools deck imports',
    items: [
      {
        title: 'Deck imports finish in seconds, not minutes',
        details: 'Linking an imported deck to your copies now reads your boxes once per deck, so a large import that took many minutes now takes under a minute.',
      },
    ],
  },
  {
    version: '1.19.0',
    date: '2026-11-06',
    title: 'Import from Mythic Tools',
    items: [
      {
        title: 'Bring your collection over from Mythic Tools',
        details: 'Import a Mythic Tools CSV and its containers become boxes and binders. Each copy keeps its language, condition, proxy and other marks, plus what you paid. A preview lets you choose Add or Replace first.',
      },
      {
        title: 'Import decks with their linked copies',
        details: 'Deck import moves the right copies out of your boxes into the deck, maybeboard included. Importing a deck with an existing name updates it in place, keeping its plan, tags, notes and games.',
      },
      {
        title: 'See what’s in boxes and what’s in decks',
        details: 'The Collection page shows how many copies are in boxes and in decks, and each card lists every copy and where it is. A deck shows its collection status, with basic lands never counted as to buy.',
      },
    ],
  },
  {
    version: '1.18.0',
    date: '2026-11-06',
    title: 'Game nights with playgroups and a life counter',
    items: [
      {
        title: 'Playgroups for the people you play with',
        details: 'The new Games section holds playgroups: friends on the app, or guests by name. Only members see a group, and any member can add people, start a game or fix one.',
      },
      {
        title: 'A life counter for one phone flat on the table',
        details: 'Each player gets a panel facing them: tap left to lose life, right to gain, hold for ten. Commander damage, poison, monarch, dice and a first-player roulette are there too, and the game picks up where it was after a reload or a locked phone.',
      },
      {
        title: 'Pick seats, decks and who goes first',
        details: 'Choose who’s playing and where they sit, then each player picks a deck. A Borrow decks switch lets anyone pilot anyone’s deck; the deck keeps its record and the win goes to the pilot.',
      },
      {
        title: 'Standings and win rates by player and deck',
        details: 'Stats show standings, each deck’s win rate, win rate by turn order and highlights like the longest game and biggest rivalry. Every game has its own page with a life chart, and deck tiles show each deck’s record.',
      },
      {
        title: 'Pages no longer spill sideways on a phone',
        details: 'The background no longer widens pages on a phone held sideways, and the header fits at mid-size widths.',
      },
    ],
  },
  {
    version: '1.17.0',
    date: '2026-11-05',
    title: 'Tune your deck from its plan',
    items: [
      {
        title: 'Five deck tabs: Cards, Plan, Tune, Check, Chat',
        details: 'Tags now live in Plan, Health and Playtest are together in Check, and your collection is a Mine / Missing filter on Cards.',
      },
      {
        title: 'Every change is a swap you review first',
        details: 'Tune offers six goals, from finishing the deck to cuts and lands. Suggestions wait in groups; you stage adds and cuts, see the impact, then Apply, with undo. Chat’s ideas arrive here too, never changing the deck directly.',
      },
      {
        title: 'A fuller plan you confirm part by part',
        details: 'The plan has 19 parts, such as bracket, budget, key cards, themes and game plan, each showing where it came from and how it was worked out. Confirm it to unlock Tune and Chat.',
      },
      {
        title: 'Sections for maybe and cut cards',
        details: 'Main, Might go in, Came out, plus your own sections. Cuts go to Came out with their reason, and problem cards like duplicates or off-colour ones are flagged with a one-click fix.',
      },
      {
        title: 'One set of numbers everywhere',
        details: 'Lands, draw, interaction and ramp are counted the same way on every tab. Looting no longer counts as card draw, cards doing two jobs are kept, and Game Changers get a badge. EDHREC is gone, and search now shows newest first.',
      },
    ],
  },
  {
    version: '1.16.0',
    date: '2026-11-05',
    title: 'A calmer, quicker app',
    items: [
      {
        title: 'Jump anywhere with ⌘K',
        details: 'Press ⌘K or Ctrl-K, or tap “Jump to…” in the header, to open a deck or list, go to a page, start a new deck, or turn what you typed into a card search or rules question.',
      },
      {
        title: 'One small chip for the AI model',
        details: 'The model picker is now a single “✦ Opus · ≈ $0.11” chip that opens a menu with models, prices and budget left.',
      },
      {
        title: 'A cleaner deck page, especially on a phone',
        details: 'The header is shorter with the commander’s art on the right. On a phone there’s one bottom bar with back and ＋ fixed while the tabs swipe, and view options sit behind one View button.',
      },
      {
        title: 'Empty pages tell you where to start',
        details: 'Empty Decks, Collection and Lists pages explain what goes there and offer one first step. Settings is split into tabs.',
      },
      {
        title: 'Fixes for popups and the deck bar',
        details: 'The card popup no longer crops its image, deck imports no longer show twice, and on a phone the deck’s tabs no longer stack on the app’s tab bar.',
      },
    ],
  },
  {
    version: '1.15.1',
    date: '2026-11-05',
    title: 'Better cut reviews and phone fixes',
    items: [
      {
        title: 'Act on Claude’s cut review',
        details: 'Each verdict now has Cut it, Keep ★ and Discuss in Chat, with undo, or cut all the cards Claude agrees on. The next review remembers what the last one said, so you stop seeing the same suggestions.',
      },
      {
        title: 'Rate the whole deck in tiers',
        details: 'Claude can rate every card S to C. Disagree on a card and it re-rates it with your reason, and you can cut the C tier in one go.',
      },
      {
        title: 'No more dark band at the top of the page',
        details: 'Sticky search and tool rows are plain at rest and only get their backdrop once they pin to the top.',
      },
      {
        title: 'Tidier layouts on a phone',
        details: 'Prices in the model picker wrap properly, the Settings usage table fits, and Collection’s sort no longer squeezes the filter.',
      },
      {
        title: 'Small deck touches',
        details: 'The commander has its own ⋯ menu, stacks open up on hover, and dragging a deck lights up the folders you can drop it on.',
      },
    ],
  },
  {
    version: '1.15.0',
    date: '2026-11-04',
    title: 'Plan first, then tune',
    items: [
      {
        title: 'Plan: say what the deck does first',
        details: 'The Plan tab holds the brief, the deck’s style, how it wins and the turn it gets going. Land and role targets follow from it and can be changed, and your themes each get a target size.',
      },
      {
        title: 'Tune: add and cut toward the plan',
        details: 'Tune shows what to add against the plan and a cut list with every reason tied to a rule you can switch off, reweight or write yourself. Ask Claude to review the cuts; it never cuts anything on its own.',
      },
      {
        title: 'New card views and many-at-once editing',
        details: 'Cards show as Grid, Stacks or Text with a size slider, groups fold, and Select moves, tags or removes many cards at once. Each card has a ⋯ menu, and keyboard shortcuts are listed under Shortcuts.',
      },
      {
        title: 'Folders, filters and sorting on the Decks page',
        details: 'Drag decks into folders or use ⋯ to move them. Find, filter by colour, show decks not at 100 yet, and sort by recent edits, name, commander or price.',
      },
      {
        title: 'Easier imports',
        details: 'Start a deck from an Archidekt link or paste a list in more formats, including categories and sideboard lines. Unknown lines are reported and the rest comes in.',
      },
    ],
  },
  {
    version: '1.14.0',
    date: '2026-11-03',
    title: 'Playtest your decks',
    items: [
      {
        title: 'Goldfish a deck over 2,000 games',
        details: 'The new Playtest tab plays your deck on autopilot and reports when the commander comes down, missed land drops, mana by turn, mulligans and cards stuck in hand. Arrows show what your last change did, not luck.',
      },
      {
        title: 'Find the best opening hand',
        details: 'Best hand searches for the strongest opening seven by playing hands out against shuffled libraries, in about a second.',
      },
      {
        title: 'Play a hand yourself',
        details: 'Draw seven, mulligan, play lands and spells, tap and untap, track life and the graveyard, and cast your commander with tax.',
      },
      {
        title: 'Card details load for the commander',
        details: 'Opening the commander’s card now shows its roles, which used to fail.',
      },
    ],
  },
  {
    version: '1.13.1',
    date: '2026-11-03',
    title: 'A better sample deck for the tour',
    items: [
      {
        title: 'The tour’s sample deck is now properly built',
        details: 'It used to run short on lands, so Build and Health flagged it everywhere. It now has a full mana base, with every colour close to its target and every Build step done.',
      },
    ],
  },
  {
    version: '1.13.0',
    date: '2026-11-03',
    title: 'Cutting to 100, and starter lists',
    items: [
      {
        title: 'A cut helper to get your deck to 100',
        details: 'Build → Cuts weighs every card with its reasons, starting where the curve is crowded. Cards you mark as a win condition, engine or payoff, or star, are never offered. Tick cards to see what’s left, then cut to the maybeboard with undo.',
      },
      {
        title: 'Start a new deck from its commander',
        details: 'Pick a commander and get a full 100-card starter list: roles first, then cards that fit the commander, then lands split by colour. It can use cards you own first and leaves out Game Changers.',
      },
      {
        title: 'Check your colour sources',
        details: 'Health and the mana step compare each colour’s sources with recommended counts, and warn you when a nearly built deck is short.',
      },
      {
        title: 'Correct a card’s roles',
        details: 'From a card’s view in a deck you can fix the roles it was given, and the correction counts everywhere.',
      },
      {
        title: 'Suggestions fit your commander better',
        details: 'Fill the gaps reads what your commander cares about and ranks cards by how well they fit it.',
      },
    ],
  },
  {
    version: '1.12.0',
    date: '2026-11-03',
    title: 'Help and a guided tour',
    items: [
      {
        title: 'A guided tour of every page',
        details: 'The ? in the header gives help for the page you’re on and a guided tour using a sample deck. The tour never spends AI, and ending it brings you back to where you were.',
      },
      {
        title: 'Choose Regular or Smart on each page',
        details: 'Search, Rules, a deck’s Tags and Chat each have a Regular / Smart switch, remembered per profile. Smart uses a stronger model that thinks harder; Rules start on Smart.',
      },
      {
        title: 'AI usage is easier to read',
        details: 'Settings shows AI usage grouped by kind, with count and cost, or every request, 25 to a page. Old logs are cleared weekly; your decks, chats and answers are never touched.',
      },
      {
        title: 'The ⋯ menu on deck pages opens on top',
        details: 'It used to open hidden inside the deck header.',
      },
    ],
  },
  {
    version: '1.11.0',
    date: '2026-11-03',
    title: 'Deck plans, chat and profiles',
    items: [
      {
        title: 'Chat with Claude about a deck',
        details: 'Each deck has a chat that can look up cards, your collection and cards for a role. Suggested changes come back as Add and Cut buttons, and chats are saved.',
      },
      {
        title: 'A Build tab walks you through a deck',
        details: 'A seven-step checklist covers commander style, plan, skeleton, filling gaps, lands, cuts and a final check. Fill the gaps suggests cards, your collection first, under a price cap.',
      },
      {
        title: 'See how a deck wins, free',
        details: 'The Health tab reads how a deck wins from its cards without asking the AI, including finishers, protection and combos. A quick read of your brief is free too.',
      },
      {
        title: 'Faster deck setup and fresh prices',
        details: 'Card roles for a new deck now appear almost instantly, and the prices of cards you own are refreshed every night.',
      },
      {
        title: 'Profiles, passwords and seven themes',
        details: 'Set a favourite commander and featured deck, browse others on the People page, and share decks read-only. Decks are private by default, admins set a password, and you can pick from seven themes.',
      },
    ],
  },
  {
    version: '1.10.0',
    date: '2026-10-31',
    title: 'Draft a deck’s brief with AI',
    items: [
      {
        title: '✦ Draft with AI writes what your deck should do',
        details: 'On a deck’s Tags tab, next to “What should this deck do?”, Claude drafts the brief in your voice. If you’ve already written something, it keeps your intent.',
      },
      {
        title: 'See how your deck wins',
        details: 'The draft starts by working out each way the deck wins and the cards that make it happen, shown in a “How it wins” card.',
      },
      {
        title: 'An honest word when a deck can’t win yet',
        details: 'If the deck has no real way to win, an amber “What it needs” card says so and suggests a card or two in its colours.',
      },
    ],
  },
  {
    version: '1.9.0',
    date: '2026-10-30',
    title: 'A new look',
    items: [
      {
        title: 'Real mana symbols, and cards that catch the light',
        details: 'Mana symbols are drawn everywhere, cards tilt and shine as you move over them, and the app has new fonts and a new header.',
      },
      {
        title: 'Search in your commander’s colours',
        details: 'A commander search wears its colours, with the commander’s banner at the top, refinements as chips beside the box, and the cheapest priced printing on each result.',
      },
      {
        title: 'Decks in their commanders’ colours',
        details: 'Deck tiles show the commander’s art and colours, each deck has a new header, and there is one clear ＋ Add cards button. The controls fit on one row on a phone.',
      },
      {
        title: 'Rules as a conversation',
        details: 'Ask rules questions like a chat, start from suggested questions, and see the verdict stand out at the top of each answer.',
      },
    ],
  },
  {
    version: '1.8.1',
    date: '2026-10-30',
    title: 'History menus fully visible',
    items: [
      {
        title: 'The ⋯ menu on history entries is no longer cut off',
        details: 'On the last entries in the History panel the menu used to be clipped. It now opens on top of the page, upward when there’s no room below, and closes when you scroll or tap elsewhere.',
      },
    ],
  },
  {
    version: '1.8.0',
    date: '2026-10-30',
    title: 'History for Search and Rules',
    items: [
      {
        title: 'Your past searches and questions stay in reach',
        details: 'A History column sits beside Search and Rules on wide screens, and a History button opens it on your phone. It stays visible while you work, not only on the empty page.',
      },
      {
        title: 'Save, rename and tidy your history',
        details: 'Saved entries are kept until you delete them, and Recent keeps your newest 50, grouped by day. Each entry’s ⋯ menu can save, rename or delete it, and ＋ New starts fresh.',
      },
      {
        title: 'Reopening a search costs nothing',
        details: 'Opening a past search replays it with today’s cards and prices, and a past conversation shows its stored answers, without asking the AI again. A refined search is now one entry, not one per step.',
      },
      {
        title: 'See every AI request in Settings',
        details: 'Settings lists each Claude request with who asked, what it was for, the model and its cost, including ones declined or blocked by a cap. Filter by person and feature over 7 to 90 days.',
      },
    ],
  },
  {
    version: '1.7.1',
    date: '2026-10-30',
    title: 'A tidier model picker',
    items: [
      {
        title: 'The model menu has Claude and Free models tabs',
        details: 'Instead of one long list, models sit in two tabs. The menu opens on the tab you’re using, and Claude models are ordered by level, from Most capable to Fast, each with its price.',
      },
      {
        title: 'One line per model, and a folded budget',
        details: 'Each model is a single short line, and only the one you chose shows its longer note. The budget folds to “left today, resets in …”, with the details a tap away.',
      },
      {
        title: 'Search understands partner commanders',
        details: 'Ask about two commanders together and search now plans for both, in their combined colours. A search for [[Atreus, Impulsive Son]] and [[Kratos, Stoic Father]] finds the pair and its cards.',
      },
    ],
  },
  {
    version: '1.7.0',
    date: '2026-10-30',
    title: 'Claude answers your rules questions',
    items: [
      {
        title: 'Rules, tagging and search now run on Claude',
        details: 'Rules questions and tagging use Claude Opus by default, and search uses Haiku. The answers are much better than the free models gave, and tricky counts like [[Kratos, Stoic Father]] with [[Blade of Selves]] now come out right.',
      },
      {
        title: 'Pick your own model from the header',
        details: 'Each profile chooses its model for rules and tagging from a picker in the header, which also shows how much of today’s budget is left. Sonnet, Fable and the free models are there too.',
      },
      {
        title: 'A daily AI budget keeps spending in check',
        details: 'Every request’s cost is counted, with a daily cap for the app and for each profile. When a cap is reached you get a clear message straight away, and Settings shows spending by person and for the month.',
      },
      {
        title: 'Rules answers say when they’re unsure',
        details: 'When an answer can’t be checked fully it is marked as unsure, with the reason, instead of sounding certain.',
      },
      {
        title: 'A Settings page for models',
        details: 'The gear in the header opens Settings, where each model shows whether it’s ready, today’s requests and a Test button. Search model, how hard Claude thinks and the daily caps are set here.',
      },
    ],
  },
  {
    version: '1.6.1',
    date: '2026-09-30',
    title: 'Smoother rules follow-ups',
    items: [
      {
        title: 'Follow-ups remember the cards you’ve discussed',
        details: 'Naming a card already in the conversation no longer asks which one you meant. When a question is needed, it appears by the ask box where you can see it, and slow lookups time out instead of hanging.',
      },
    ],
  },
  {
    version: '1.6.0',
    date: '2026-09-30',
    title: 'Ask rules questions',
    items: [
      {
        title: 'A Rules tab that answers from the rules',
        details: 'Ask how cards interact or how a rule works. The answer draws on the cards’ text, official rulings, the current Comprehensive Rules and MTG Wiki.',
      },
      {
        title: 'Every answer cites its sources',
        details: 'Answers give a verdict, the steps and a confidence, with numbered citations linking to the exact rule, the card’s rulings or the wiki page.',
      },
      {
        title: 'Follow up, and save conversations',
        details: 'Ask follow-up questions, revisit recent conversations, star the ones you want to keep and rename them.',
      },
      {
        title: 'The app asks which card you meant',
        details: 'When a name fits several cards, you pick from pictures before the question is answered.',
      },
    ],
  },
  {
    version: '1.5.0',
    date: '2026-09-30',
    title: 'Save searches for later',
    items: [
      {
        title: 'Save a search and pick it up later',
        details: 'Save a search with all its follow-ups, tabs, sort and loaded pages, then open it later just as you left it, with fresh results.',
      },
      {
        title: 'Rename, update or forget saved searches',
        details: 'Save changes to a saved search or save it as a new one, and rename or remove it when you’re done.',
      },
      {
        title: 'Reloads return you to the same spot',
        details: 'The search on screen comes back exactly as it was after a reload, including where you’d scrolled.',
      },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-09-28',
    title: 'Scan cards with your camera',
    items: [
      {
        title: 'Scan cards into your collection',
        details: 'Collection then Scan reads a card’s name and set details with your phone’s camera to find the exact printing. Photos from your library work too.',
      },
      {
        title: 'Scans only suggest cards they’re sure of',
        details: 'A card is offered only when its name reading agrees, so the scanner would rather miss a card than pick the wrong one.',
      },
      {
        title: 'Steadier card lookups across the app',
        details: 'The app now paces its requests to Scryfall properly, so searches and lookups are refused less often.',
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-09-28',
    title: 'Track your collection',
    items: [
      {
        title: 'Keep your cards in boxes and binders',
        details: 'The new Collection tab tracks each card by printing, finish and count, in boxes and binders you name.',
      },
      {
        title: 'Decks take copies from your collection',
        details: 'A deck’s Collection tab shows what to pull, what to take from another deck, and what to buy or proxy. Cutting a card or deleting a deck puts copies back where they came from.',
      },
      {
        title: 'Import from ManaBox, Moxfield, Deckbox or TCGplayer',
        details: 'Bring in a collection from a CSV or a plain list, and export it as CSV. ManaBox binders become boxes.',
      },
      {
        title: 'Search shows cards you own',
        details: 'Search results now mark the cards that are already in your collection.',
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-09-28',
    title: 'Recent searches that stay',
    items: [
      {
        title: 'Recent searches saved to your profile',
        details: 'Your recent searches appear on the landing page and in the empty search box, and running one again is instant.',
      },
      {
        title: 'The search on screen survives a reload',
        details: 'Reloading, or iPhone closing the home screen app in the background, no longer loses your current search.',
      },
      {
        title: 'Clear the search box with one tap',
        details: 'A clear button in the search box empties it.',
      },
    ],
  },
  {
    version: '1.1.1',
    date: '2026-09-26',
    title: 'Steadier taps and a home screen app',
    items: [
      {
        title: 'Cards land in the list you tapped',
        details: 'On iPhone, taps in the Add to list window no longer slip onto the wrong list when the keyboard closes. Your last-used list comes first.',
      },
      {
        title: 'Undo any add from search',
        details: 'Every card added from search comes with an Undo.',
      },
      {
        title: 'Install the app on your iPhone',
        details: 'Use Add to Home Screen in Safari to open the app like any other, with its own icon.',
      },
      {
        title: 'Phone fixes',
        details: 'Inputs no longer zoom the page, small screens no longer overflow, and the decks page no longer counts the commander twice.',
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-09-25',
    title: 'Tag your deck’s cards',
    items: [
      {
        title: 'Make your own tags for a deck',
        details: 'Give a deck its own categories, such as Sac outlets or Win conditions, and group the Cards tab by tag or by automatic role. A card can carry several tags.',
      },
      {
        title: 'AI suggests tags for your deck',
        details: 'In the Tags tab, say what the deck should do and the AI suggests tags with examples. Keep, edit or drop each one, or ask again.',
      },
      {
        title: 'AI tags the cards, with a reason for each',
        details: 'Have the AI tag every card or only untagged ones, with a progress bar and a stop button. It never removes a tag you added or re-adds one you took off.',
      },
      {
        title: 'Edit tags from a card or the tag editor',
        details: 'A card’s window shows its tags and lets you add or remove them. The tag editor renames, recolours, reorders, merges and deletes tags.',
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-09-24',
    title: 'The first version',
    items: [
      {
        title: 'Search for cards in plain English',
        details: 'Describe what you want in your own words, or type Scryfall syntax. Search for cards that suit a commander or find combos, then narrow the results with follow-ups, a sort menu and tabs for played cards, all matches and combos.',
      },
      {
        title: 'Profiles, and decks you can import',
        details: 'Each person has their own profile, lists and decks. Bring decks in from Moxfield, Archidekt, Arena or MTGO: they count to 100 with the commander, and foil and etched cards are kept.',
      },
      {
        title: 'A deck editor, and editing as text',
        details: 'Add cards from inside a deck, use main, maybe and side boards, and choose each card’s printing and finish. Or edit the whole deck as a decklist in Moxfield’s format: a typo never deletes a card.',
      },
      {
        title: 'Deck health at a glance',
        details: 'Warnings for problems, the mana curve, colour sources (land-fetchers included), counts of ramp, draw and removal, and the odds of your opening hands.',
      },
      {
        title: 'Brackets, combos and cuts',
        details: 'See the lowest bracket a deck can be, the combos in it and the cards that would complete more, suggested cuts, and Geek stats for the numbers.',
      },
    ],
  },
];
