/**
 * What Claude has cost, against the app's own caps. Pure: shared by the
 * server, which checks the caps before every paid request, and the pages
 * that show what is left.
 *
 * Claude is paid per token from the API credit that comes with the owner's
 * Anthropic plan ($200 a month). Two caps keep a bug or one keen friend from
 * spending it: a daily cap for the whole app, and a smaller one per profile.
 * Both are checked before a request, so a request can go a little over -
 * by what one request costs - but never two. Free models are not counted.
 */

import type { SpendRow } from './db';
import { msUntilReset, quotaDay } from './quota';

export interface Caps {
  /** Dollars a day across every profile. */
  daily: number;
  /** Dollars a day for any one profile. */
  perProfile: number;
}

export const DEFAULT_CAPS: Caps = { daily: 5, perProfile: 2 };

/** The API credit the owner's plan includes each month, in dollars. */
export const MONTHLY_CREDIT = 200;

export interface SpendSummary {
  day: string;
  resetsInMs: number;
  caps: Caps;
  /** Spent today, by everyone. */
  today: number;
  profile: string | null;
  /** Spent today by this profile. */
  profileToday: number;
  /** What this profile can still spend today: the smaller of its own cap and the app's. */
  left: number;
  /** Today, by profile, most first. */
  byProfile: Array<{ profile: string; cost: number; requests: number }>;
  /** Today, by model, most first. */
  byModel: Array<{ model: string; cost: number; requests: number }>;
  /** This calendar month, everyone. */
  month: number;
  monthlyCredit: number;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

function totals<K extends 'profileId' | 'model'>(rows: SpendRow[], key: K): Array<{ name: string; cost: number; requests: number }> {
  const by = new Map<string, { cost: number; requests: number }>();
  for (const r of rows) {
    const t = by.get(r[key]) ?? { cost: 0, requests: 0 };
    t.cost += r.cost;
    t.requests += r.requests;
    by.set(r[key], t);
  }
  return [...by].map(([name, t]) => ({ name, cost: round(t.cost), requests: t.requests })).sort((a, b) => b.cost - a.cost);
}

/** Today's and this month's spending, from the rows of this month so far. */
export function summarize(rows: SpendRow[], profile: string | null, caps: Caps, now = new Date()): SpendSummary {
  const day = quotaDay(now);
  const month = day.slice(0, 7);
  const today = rows.filter((r) => r.day === day);
  const spentToday = today.reduce((n, r) => n + r.cost, 0);
  const profileToday = today.filter((r) => r.profileId === profile).reduce((n, r) => n + r.cost, 0);
  return {
    day,
    resetsInMs: msUntilReset(now),
    caps,
    today: round(spentToday),
    profile,
    profileToday: round(profileToday),
    left: round(Math.max(0, Math.min(caps.daily - spentToday, caps.perProfile - profileToday))),
    byProfile: totals(today, 'profileId').map(({ name, ...t }) => ({ profile: name, ...t })),
    byModel: totals(today, 'model').map(({ name, ...t }) => ({ model: name, ...t })),
    month: round(rows.filter((r) => r.day.startsWith(month)).reduce((n, r) => n + r.cost, 0)),
    monthlyCredit: MONTHLY_CREDIT,
  };
}

/** Why a paid request may not be sent now, or null if it may. */
export function overBudget(s: SpendSummary): string | null {
  if (s.today >= s.caps.daily) {
    return `today's AI budget for the app ($${s.caps.daily.toFixed(2)}) is used up - it resets at midnight Pacific. Pick a free model in the header to keep going, or raise the cap in Settings.`;
  }
  if (s.profileToday >= s.caps.perProfile) {
    return `your share of today's AI budget ($${s.caps.perProfile.toFixed(2)}) is used up - it resets at midnight Pacific. Pick a free model in the header to keep going, or raise the cap in Settings.`;
  }
  return null;
}

/** The first day of the month a moment falls in, for reading this month's rows. */
export function monthStart(now = new Date()): string {
  return `${quotaDay(now).slice(0, 7)}-01`;
}

/** Dollars as people read them: "$0.0004" or "$0.004" for small amounts, "$1.20" otherwise. */
export function dollars(n: number): string {
  if (n > 0 && n < 0.001) return `$${n.toFixed(4)}`;
  if (n > 0 && n < 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/** A cap typed in Settings, as a number of dollars, or null if it is not one. */
export function capFrom(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 200 ? Math.round(n * 100) / 100 : null;
}
