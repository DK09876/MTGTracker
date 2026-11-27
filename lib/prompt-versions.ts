/**
 * A short version for each prompt that makes suggestions, logged with every
 * suggestion it makes (lib/suggestion-log.ts) so accept rates can be compared
 * across prompt changes. Bump the one you change, in the same commit; a change to
 * the agent context (lib/agent-context.ts) changes them all.
 */
export const PROMPT_VERSIONS = {
  tuneIdeas: 'tune-ideas-3',
  finishPicks: 'finish-9',
  essentials: 'essentials-3',
  upgrades: 'upgrades-6',
  cutReview: 'cut-review-3',
  chat: 'chat-10',
  planRead: 'plan-read-3',
  planPass: 'plan-pass-4',
  planHelp: 'plan-help-5',
  tagsAi: 'tags-6',
  trim: 'trim-6',
  trimApproach: 'trim-approach-5',
} as const;

export type PromptName = keyof typeof PROMPT_VERSIONS;
