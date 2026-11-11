/**
 * The suggestion log's shared words, safe for the browser (the log itself,
 * lib/suggestion-log.ts, is server only).
 */

export const REASON_CHIPS = ['pet_card', 'part_of_plan', 'too_slow', 'already_tried', 'off_plan', 'have_better', 'other'] as const;
/** The reasons offered when a suggestion is turned down in Tune. Trim has its own two sets (lib/trim-shared.ts). */
export const WHY_NOT_CHIPS = ['pet_card', 'part_of_plan', 'too_slow', 'already_tried', 'other'] as const;
export type ReasonChip = (typeof REASON_CHIPS)[number];
export const REASON_LABELS: Record<ReasonChip, string> = { pet_card: 'Pet card', part_of_plan: 'Part of my plan', too_slow: 'Too slow', already_tried: 'Already tried it', off_plan: 'Off-plan', have_better: 'Have better', other: 'Other' };
