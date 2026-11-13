/**
 * A short version for each prompt that makes suggestions, logged with every
 * suggestion it makes (lib/suggestion-log.ts) so accept rates can be compared
 * across prompt changes. Bump the one you change, in the same commit.
 */
export const PROMPT_VERSIONS = {
  tuneIdeas: 'tune-ideas-1',
  finishPicks: 'finish-picks-1',
  cutReview: 'cut-review-1',
  chat: 'chat-1',
  planRead: 'plan-read-1',
  planPass: 'plan-pass-2',
  planHelp: 'plan-help-3',
  tagsAi: 'tags-3',
  trim: 'trim-2',
  trimApproach: 'trim-approach-2',
} as const;

export type PromptName = keyof typeof PROMPT_VERSIONS;
