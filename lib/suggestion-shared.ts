/**
 * The suggestion log's shared words, safe for the browser (the log itself,
 * lib/suggestion-log.ts, is server only).
 */

export const REASON_CHIPS = ['pet_card', 'part_of_plan', 'too_slow', 'already_tried', 'other'] as const;
export type ReasonChip = (typeof REASON_CHIPS)[number];
export const REASON_LABELS: Record<ReasonChip, string> = { pet_card: 'Pet card', part_of_plan: 'Part of my plan', too_slow: 'Too slow', already_tried: 'Already tried it', other: 'Other' };
