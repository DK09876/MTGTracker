/**
 * The models the app can use for its AI features (rules answers, deck
 * tagging), across providers, with what each costs on its free plan. Pure:
 * shared by the server and the settings page.
 *
 *   - Google Gemini: about 20 requests a day per model; Flash often refuses
 *     ("overloaded") on the free tier.
 *   - Mistral: $10 of credits a month on the free plan, no card.
 *   - Groq: 1,000 requests a day per model, but only 8,000 tokens a minute -
 *     about one rules question a minute.
 *
 * Which is used is one setting for the whole app (lib/ai-settings-server).
 */

export type Provider = 'gemini' | 'mistral' | 'groq';

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
   * written against 8,000 tokens a minute, so its models get about 6,000.
   */
  inputTokens: number;
  /** Only a helper for another model's work (the rules lookup), not offered in Settings. */
  helper?: boolean;
  /** Tokens a day on the free tier, where that is the tighter limit (Groq: 200,000, refilled through the day). */
  dailyTokens?: number;
}

export const MODELS: ModelInfo[] = [
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
  { id: 'openai/gpt-oss-120b', provider: 'groq', label: 'GPT-OSS 120B (Groq)', dailyLimit: 1000, reasoning: true, inputTokens: 6_000, dailyTokens: 200_000,
    note: 'OpenAI\'s open reasoning model on Groq, free: 200,000 tokens a day (about 25 rules questions, or many more searches) and 8,000 a minute. Very fast; the default.' },
  { id: 'qwen/qwen3.8-27b', provider: 'groq', label: 'Qwen 3.8 27B (Groq)', dailyLimit: 1000, reasoning: true, inputTokens: 6_000, dailyTokens: 200_000,
    note: 'Alibaba\'s Qwen on Groq, free: same limits. Fast, but miscounted and was sure of wrong answers in testing.' },
  { id: 'openai/gpt-oss-20b', provider: 'groq', label: 'GPT-OSS 20B (Groq)', dailyLimit: 1000, reasoning: true, inputTokens: 6_000, dailyTokens: 200_000, helper: true,
    note: 'The small GPT-OSS, with its own allowance: looks up what a rules question needs before GPT-OSS 120B answers.' },
];

/**
 * GPT-OSS on Groq, unless changed in Settings. In a bake-off on rules
 * questions with known answers (2026-09-30) it scored the same as Flash-Lite
 * and Qwen - all right except a count of triggers from creatures dying
 * together - in 3-8 seconds, with 1,000 requests a day to Flash-Lite's 20.
 */
export const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/**
 * A quick, cheap model on the same provider for small preparatory jobs (what
 * a rules question needs looked up), so they do not spend the main model's
 * per-minute allowance.
 */
export const HELPER_MODEL: Record<Provider, string> = {
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
  if (id.startsWith('gemini')) return 'gemini';
  if (/^(mistral|magistral|ministral|codestral)/.test(id)) return 'mistral';
  return id.includes('/') ? 'groq' : 'gemini';
}

export const ENV_KEY: Record<Provider, string> = { gemini: 'GEMINI_API_KEY', mistral: 'MISTRAL_API_KEY', groq: 'GROQ_API_KEY' };
