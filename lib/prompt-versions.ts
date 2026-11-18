/**
 * A short version for each prompt that makes suggestions, logged with every
 * suggestion it makes (lib/suggestion-log.ts) so accept rates can be compared
 * across prompt changes. Bump the one you change, in the same commit; a change to
 * the agent context (lib/agent-context.ts) changes them all.
 */
export const PROMPT_VERSIONS = {
  tuneIdeas: 'tune-ideas-2',
  finishPicks: 'finish-8',
  essentials: 'essentials-2',
  upgrades: 'upgrades-5',
  cutReview: 'cut-review-2',
  chat: 'chat-9',
  planRead: 'plan-read-2',
  planPass: 'plan-pass-3',
  planHelp: 'plan-help-4',
  tagsAi: 'tags-5',
  trim: 'trim-5',
  trimApproach: 'trim-approach-4',
} as const;

export type PromptName = keyof typeof PROMPT_VERSIONS;
