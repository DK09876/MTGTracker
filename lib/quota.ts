/**
 * Gemini's free tier, as the tagger spends it.
 *
 * Each model has its own allowance of requests per day - 20 for the Flash
 * models, measured on 2026-09-24 from the quota Gemini names when it
 * refuses (GenerateRequestsPerDayPerProjectPerModel-FreeTier) - and the day
 * turns over at midnight Pacific. Gemini cannot be asked what is left, so
 * the app counts what it sends and believes a refusal over its own count.
 *
 * The tagger could climb down a ladder of models, the smartest with requests
 * left answering; for now the ladder is a single model (see DEFAULT_LADDER).
 * Aliases are left off it: gemini-flash-latest is 3.8 Flash and shares its
 * allowance.
 */

import type { ModelUsage } from './db';

export interface LadderModel {
  id: string;
  label: string;
}

// The Flash models are off: Gemini was failing too much on them. On
// 2026-09-25 all four refused nearly every request for hours ("high demand",
// 503), a one-line prompt included, while 3.5 Flash-Lite answered the same
// requests in seconds. Every refusal also counts against the free day. Put
// them back here (or in GEMINI_TAG_MODELS) if they become dependable.
//   { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
//   { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
//   { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
//   { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
export const DEFAULT_LADDER: LadderModel[] = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
];

/** "gemini-3.8-flash" as people say it: "Gemini 3.8 Flash". */
export function modelLabel(model: string): string {
  return DEFAULT_LADDER.find((m) => m.id === model)?.label
    ?? model.replace(/^gemini-/, 'Gemini ').replace(/-flash/, ' Flash').replace(/-lite/, ' Lite');
}

/** Assumed until a refusal says otherwise. */
export const FREE_DAILY_LIMIT = 20;

/** The ladder, or GEMINI_TAG_MODELS - ids, best first, comma-separated. */
export function ladder(env = process.env.GEMINI_TAG_MODELS): LadderModel[] {
  const ids = env?.split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids?.length) return DEFAULT_LADDER;
  return ids.map((id) => DEFAULT_LADDER.find((m) => m.id === id) ?? { id, label: modelLabel(id) });
}

const PACIFIC = 'America/Los_Angeles';

/** The quota day a moment falls in: the date in Pacific time. */
export function quotaDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** How long until the allowances reset, at the next midnight Pacific. */
export function msUntilReset(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getMilliseconds();
  return 86_400_000 - elapsed;
}

export interface ModelBudget extends LadderModel {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}

export interface Budget {
  day: string;
  resetsInMs: number;
  /** Best first. */
  models: ModelBudget[];
  /** Requests left today across the ladder. */
  remaining: number;
}

export function budgetFrom(models: LadderModel[], usage: ModelUsage[], now = new Date()): Budget {
  const byModel = new Map(usage.map((u) => [u.model, u]));
  const rows = models.map((m) => {
    const u = byModel.get(m.id);
    const limit = u?.quotaLimit ?? FREE_DAILY_LIMIT;
    const used = u?.used ?? 0;
    const exhausted = !!u?.exhausted || used >= limit;
    return { ...m, used, limit, exhausted, remaining: exhausted ? 0 : limit - used };
  });
  return {
    day: quotaDay(now),
    resetsInMs: msUntilReset(now),
    models: rows,
    remaining: rows.reduce((n, r) => n + r.remaining, 0),
  };
}

/**
 * What a 429 says about the quota it hit: whether it is the daily one (so
 * the model is done for the day) and its limit.
 */
export function quotaViolation(body: unknown): { daily: boolean; limit: number | null } | null {
  const details = (body as { error?: { details?: Array<{ violations?: Array<{ quotaId?: string; quotaValue?: string }> }> } })
    ?.error?.details ?? [];
  for (const d of details) {
    for (const v of d.violations ?? []) {
      if (!v.quotaId) continue;
      const limit = Number(v.quotaValue);
      return { daily: /PerDay/i.test(v.quotaId), limit: Number.isFinite(limit) && limit > 0 ? limit : null };
    }
  }
  return null;
}

// --- how many requests a run takes ----------------------------------------

export type Mode = 'free' | 'smart';

/**
 * Free mode reads the deck in two large batches and checks every tag in one
 * pass - a handful of requests. Smart mode reads a dozen cards at a time and
 * checks a few tags per pass: each card gets closer attention, at about
 * three times the requests.
 */
export const BATCHES: Record<Mode, { cards: number; tags: number }> = {
  free: { cards: 50, tags: 100 },
  smart: { cards: 12, tags: 4 },
};

export function requestsFor(mode: Mode, cards: number, tags: number, audit: boolean): number {
  const size = BATCHES[mode];
  return Math.ceil(cards / size.cards) + (audit && tags ? Math.ceil(tags / size.tags) : 0);
}
