/**
 * What each AI step is sent, in words for the ⓘ next to its button - so
 * the owner knows what Claude sees before paying for it. Kept here, beside
 * nothing else, so the pages and the prompts are easy to check against each
 * other when a prompt changes.
 */

export const AI_READS = {
  brief: ['The commander and its rules text', 'Every card in the deck, with its rules text and built-in tags', 'Your brief, when building on it or checking it', 'The whole plan: every part and who set it, the numbers the app counted, cards never cut, changes to the usual rules and notes kept from earlier reads', 'The default ways to judge a deck, which Claude may depart from when it says why', 'Your instructions, if you write some'],
  proposeTags: ['The commander and its rules text', 'The plan (your brief)', 'The whole plan: every part and who set it, the numbers the app counted, cards never cut, changes to the usual rules and notes kept from earlier reads', 'Every card on the boards you include, with its rules text', 'Your instructions for this round'],
  tagCards: ['The commander, and the plan (your brief)', 'The whole plan: every part and who set it, the numbers the app counted, cards never cut, changes to the usual rules and notes kept from earlier reads', 'The tags you chose, with their descriptions - the test for what belongs', 'The whole deck by name and type, for context', 'Each card being tagged, with its full rules text', 'Your instructions, if you write some'],
  cutReview: ['The commander and its rules text', 'The plan (your brief) and its styles', 'The whole plan: every part and who set it, the numbers the app counted, cards never cut, changes to the usual rules and notes kept from earlier reads', 'The default ways to judge a deck, which Claude may depart from when it says why', 'Your tags, with their descriptions and how many cards each has', 'Quick review: the top of the cut list (about twice what you are over), each with its rules text, score and reasons. Whole deck: every card with its rules text',
    'What the last review said, and what you cut or ★ kept since', 'How many cards the deck is over 100', 'Your instructions, if you write some'],
  chat: ['The plan (your brief)', 'The whole plan: every part and who set it, the numbers the app counted, cards never cut, changes to the usual rules and notes kept from earlier reads', 'The default ways to judge a deck, which Claude may depart from when it says why', 'The deck list with each card\'s tags', 'This conversation', 'What it looks up while answering - Scryfall and your collection - shown above each answer'],
} as const;
