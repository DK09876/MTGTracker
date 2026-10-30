/**
 * The models the app can use for its AI features (rules answers, deck
 * tagging, search), across providers, with what each costs. Pure: shared by
 * the server and the settings page.
 *
 *   - Anthropic Claude: paid per token from the API credit (see spend.ts),
 *     so no daily request allowance - the app's own dollar caps instead.
 *
 *   - Google Gemini: about 20 requests a day per model; Flash often refuses
 *     ("overloaded") on the free tier.
 *   - Mistral: $10 of credits a month on the free plan, no card.
 *   - Groq: 1,000 requests a day per model, but only 8,000 tokens a minute -
 *     about one rules question a minute.
 *
 * Each profile picks its own model per feature (lib/ai.ts modelFor).
 */

export type Provider = 'anthropic' | 'gemini' | 'mistral' | 'groq';

/**
 * What a model is used for. Rules and tagging share the header's picker (the
 * thinking model); search is chosen in Settings. Kept apart so any of them
 * can get its own choice later without moving data around.
 */
export type Feature = 'rules' | 'tagging' | 'search';
export const FEATURES: Feature[] = ['rules', 'tagging', 'search'];

/** How hard a Claude model thinks (its effort level). */
export type Effort = 'low' | 'medium' | 'high';
export const EFFORTS: Effort[] = ['low', 'medium', 'high'];

/** Dollars per million tokens. Cache reads cost a tenth of input, writes a quarter more. */
export interface Price { input: number; output: number }

export interface ModelInfo {
  id: string;
  provider: Provider;
  label: string;
  /** What it is good for, and its catch. */
  note: string;
  /** Requests a day it is counted against; learned lower from a refusal. */
  dailyLimit: number;
  /** A reasoning model: thinks before it answers (slower, better at rules). */
  reasoning: boolean;
  /**
   * The most a request should send, in tokens (about 3.6 characters each),
   * leaving room for the answer. Groq's free tier counts everything sent and
   * written against 8,000 tokens a minute; a worked rules answer writes 2-3K,
   * so GPT-OSS 120B gets 5,000 - more, and each question waits a minute.
   */
  inputTokens: number;
  /** Only a helper for another model's work (the rules lookup), not offered in Settings. */
  helper?: boolean;
  /** Tokens a day on the free tier, where that is the tighter limit (Groq: 200,000, refilled through the day). */
  dailyTokens?: number;
  /** Paid models: dollars per million tokens. */
  price?: Price;
}

// Claude prices from Anthropic's price list (2026-10-30). Haiku 5.5 costs five
// times as much past 100K tokens sent; requests here stay well under that.
// Claude has no daily allowance: dailyLimit is only a ceiling for the counts.
const PAID = 1_000_000;

export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', provider: 'anthropic', label: 'Claude Opus 5.5', dailyLimit: PAID, reasoning: true, inputTokens: 30_000,
    price: { input: 4, output: 20 },
    note: 'Anthropic\'s strongest everyday model. Best at working through rules and reading a deck closely; about 10-20 cents a rules answer.' },
  { id: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Claude Sonnet 5.5', dailyLimit: PAID, reasoning: true, inputTokens: 30_000,
    price: { input: 2, output: 10 },
    note: 'Half the price of Opus, a little less careful. A good middle.' },
  { id: 'claude-haiku-5-5', provider: 'anthropic', label: 'Claude Haiku 5.5', dailyLimit: PAID, reasoning: true, inputTokens: 30_000,
    price: { input: 0.1, output: 0.5 },
    note: 'Fast and very cheap - a fraction of a cent a search. The default for search; light for hard rules questions.' },
  { id: 'claude-fable-5-1', provider: 'anthropic', label: 'Claude Fable 5.1', dailyLimit: PAID, reasoning: true, inputTokens: 30_000,
    price: { input: 10, output: 50 },
    note: 'Anthropic\'s most capable model, at two and a half times Opus\'s price. Slower; for the hardest questions.' },
  { id: 'gemini-3.5-flash-lite', provider: 'gemini', label: 'Gemini 3.5 Flash-Lite', dailyLimit: 20, reasoning: true, inputTokens: 30_000,
    note: 'Google, free: about 20 a day. Reliable, slow on hard questions, and the backstop when another model refuses.' },
  { id: 'gemini-3.8-flash', provider: 'gemini', label: 'Gemini 3.8 Flash', dailyLimit: 20, reasoning: true, inputTokens: 30_000,
    note: 'Google, free: about 20 a day. Often refuses ("overloaded") on the free tier.' },
  { id: 'mistral-medium-latest', provider: 'mistral', label: 'Mistral Medium 3.5', dailyLimit: 500, reasoning: true, inputTokens: 30_000,
    note: 'Mistral, free: $10 of credits a month (a few hundred questions). Paid-grade service, rarely refuses.' },
  { id: 'magistral-medium-latest', provider: 'mistral', label: 'Magistral Medium', dailyLimit: 300, reasoning: true, inputTokens: 30_000,
    note: 'Mistral\'s reasoning model, same $10 a month. Slower; thinks step by step.' },
  { id: 'mistral-small-latest', provider: 'mistral', label: 'Mistral Small', dailyLimit: 1000, reasoning: false, inputTokens: 30_000,
    note: 'Mistral, small and cheap; stretches the $10 furthest.' },
  { id: 'openai/gpt-oss-120b', provider: 'groq', label: 'GPT-OSS 120B (Groq)', dailyLimit: 1000, reasoning: true, inputTokens: 5_000, dailyTokens: 200_000,
    note: 'OpenAI\'s open reasoning model on Groq, free: 200,000 tokens a day (about 25 rules questions, or many more searches) and 8,000 a minute. Very fast; the default.' },
  { id: 'qwen/qwen3.8-27b', provider: 'groq', label: 'Qwen 3.8 27B (Groq)', dailyLimit: 1000, reasoning: true, inputTokens: 6_000, dailyTokens: 200_000,
    note: 'Alibaba\'s Qwen on Groq, free: same limits. Fast, but miscounted and was sure of wrong answers in testing.' },
  { id: 'openai/gpt-oss-20b', provider: 'groq', label: 'GPT-OSS 20B (Groq)', dailyLimit: 1000, reasoning: true, inputTokens: 6_000, dailyTokens: 200_000, helper: true,
    note: 'The small GPT-OSS, with its own allowance: looks up what a rules question needs before GPT-OSS 120B answers.' },
];

/**
 * Claude unless changed: Opus for the thinking work (rules, tagging), Haiku
 * for search, which wants speed and only plans a query. The free models
 * (2026-09) were not good enough at rules or tagging. Without an Anthropic
 * key, GPT-OSS on Groq, which did best of the free ones in a rules bake-off.
 */
export const DEFAULT_MODELS: Record<Feature, string> = {
  rules: 'claude-opus-5-5',
  tagging: 'claude-opus-5-5',
  search: 'claude-haiku-5-5',
};
export const FREE_DEFAULT_MODEL = 'openai/gpt-oss-120b';

/**
 * A quick, cheap model on the same provider for small preparatory jobs (what
 * a rules question needs looked up), so they do not spend the main model's
 * per-minute allowance.
 */
export const HELPER_MODEL: Record<Provider, string> = {
  anthropic: 'claude-haiku-5-5',
  groq: 'openai/gpt-oss-20b',
  gemini: 'gemini-3.5-flash-lite',
  mistral: 'mistral-small-latest',
};

/** What answers when a chosen Gemini model refuses, and what is used when the chosen model's key is missing. */
export const FALLBACK_MODEL = 'gemini-3.5-flash-lite';

export const modelInfo = (id: string): ModelInfo | undefined => MODELS.find((m) => m.id === id);

export function providerOf(id: string): Provider {
  const known = modelInfo(id);
  if (known) return known.provider;
  if (id.startsWith('claude')) return 'anthropic';
  if (id.startsWith('gemini')) return 'gemini';
  if (/^(mistral|magistral|ministral|codestral)/.test(id)) return 'mistral';
  return id.includes('/') ? 'groq' : 'gemini';
}

export const ENV_KEY: Record<Provider, string> = { anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', mistral: 'MISTRAL_API_KEY', groq: 'GROQ_API_KEY' };

/** What a request cost in dollars, from the tokens the provider says it used. Free models cost nothing. */
export function costOf(id: string, used: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): number {
  const price = modelInfo(id)?.price;
  if (!price) return 0;
  const input = used.input + (used.cacheRead ?? 0) * 0.1 + (used.cacheWrite ?? 0) * 1.25;
  return (input * price.input + used.output * price.output) / 1_000_000;
}

