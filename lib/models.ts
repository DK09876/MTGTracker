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
 * thinking model); the rest are set for the whole app by an admin in
 * Settings. tagging is reading the deck (the brief, suggesting tags);
 * tagcards is putting tags on cards and checking them - many small guided
 * calls, so a cheaper model does.
 */
export type Feature = 'rules' | 'tagging' | 'tagcards' | 'chat' | 'search' | 'finish' | 'upgrades' | 'essentials';
/** Finish (filling a deck from the owner's cards) has its own line so Settings and the budget show it by name; it runs on Opus whatever the page picked. */
export const FEATURES: Feature[] = ['rules', 'tagging', 'tagcards', 'chat', 'search', 'finish', 'upgrades', 'essentials'];

/** Each feature in words, for Settings. */
export const FEATURE_INFO: Record<Feature, { label: string; why: string }> = {
  rules: { label: 'Rules answers', why: 'Hard reasoning; mistakes cost games' },
  tagging: { label: 'Reading a deck', why: 'Drafting the brief and suggesting tags' },
  tagcards: { label: 'Tagging cards', why: 'Many small guided calls, and the double-check' },
  chat: { label: 'Deck chat', why: 'Conversation, with look-ups' },
  search: { label: 'Search', why: 'Turns words into a Scryfall query' },
  finish: { label: 'Finish the deck', why: 'Searches your cards and picks what fills the deck' },
  upgrades: { label: 'Upgrades', why: 'What would make a finished deck better, from your cards or to buy' },
  essentials: { label: 'Cards that matter', why: 'Names the key cards for a commander before Finish fills the rest' },
};

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
  /** One line for a compact list: who, and the catch or the cost. */
  short: string;
  /** Claude's levels, most capable first: "Most capable", "Strong", "Balanced", "Fast". */
  level?: string;
}

// Claude prices from Anthropic's price list (2026-10-30). Haiku 5.5 costs five
// times as much past 100K tokens sent; requests here stay well under that.
// Claude has no daily allowance: dailyLimit is only a ceiling for the counts.
const PAID = 1_000_000;

export const MODELS: ModelInfo[] = [
  { id: 'claude-fable-5-1', provider: 'anthropic', label: 'Claude Fable 5.1', dailyLimit: PAID, reasoning: true, inputTokens: 30_000, short: 'Slowest and dearest; for the hardest questions · about 30-50¢ a rules answer', level: 'Most capable',
    price: { input: 10, output: 50 },
    note: 'Anthropic\'s most capable model, at two and a half times Opus\'s price. Slower; for the hardest questions.' },
  { id: 'claude-opus-5-5', provider: 'anthropic', label: 'Claude Opus 5.5', dailyLimit: PAID, reasoning: true, inputTokens: 30_000, short: 'The best everyday pick for rules and tagging · about 5-15¢ a rules answer', level: 'Strong',
    price: { input: 4, output: 20 },
    note: 'Anthropic\'s strongest everyday model. Best at working through rules and reading a deck closely; about 5-15 cents a rules answer (4-6 cents in testing).' },
  { id: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Claude Sonnet 5.5', dailyLimit: PAID, reasoning: true, inputTokens: 30_000, short: 'Half Opus\'s price, a little less careful · about 3-8¢ a rules answer', level: 'Balanced',
    price: { input: 2, output: 10 },
    note: 'Half the price of Opus, a little less careful. A good middle.' },
  { id: 'claude-haiku-5-5', provider: 'anthropic', label: 'Claude Haiku 5.5', dailyLimit: PAID, reasoning: true, inputTokens: 30_000, short: 'Quick and nearly free; the default for search · well under 1¢', level: 'Fast',
    price: { input: 0.1, output: 0.5 },
    note: 'Fast and very cheap - a fraction of a cent a search. The default for search; light for hard rules questions.' },
  { id: 'gemini-3.5-flash-lite', provider: 'gemini', label: 'Gemini 3.5 Flash-Lite', dailyLimit: 20, reasoning: true, inputTokens: 30_000, short: 'Google · about 20 a day',
    note: 'Google, free: about 20 a day. Reliable, slow on hard questions, and the backstop when another model refuses.' },
  { id: 'gemini-3.8-flash', provider: 'gemini', label: 'Gemini 3.8 Flash', dailyLimit: 20, reasoning: true, inputTokens: 30_000, short: 'Google · about 20 a day, often busy',
    note: 'Google, free: about 20 a day. Often refuses ("overloaded") on the free tier.' },
  { id: 'mistral-medium-latest', provider: 'mistral', label: 'Mistral Medium 3.5', dailyLimit: 500, reasoning: true, inputTokens: 30_000, short: 'Mistral · $10 of credit a month',
    note: 'Mistral, free: $10 of credits a month (a few hundred questions). Paid-grade service, rarely refuses.' },
  { id: 'magistral-medium-latest', provider: 'mistral', label: 'Magistral Medium', dailyLimit: 300, reasoning: true, inputTokens: 30_000, short: 'Mistral · reasoning, slower',
    note: 'Mistral\'s reasoning model, same $10 a month. Slower; thinks step by step.' },
  { id: 'mistral-small-latest', provider: 'mistral', label: 'Mistral Small', dailyLimit: 1000, reasoning: false, inputTokens: 30_000, short: 'Mistral · small and cheap',
    note: 'Mistral, small and cheap; stretches the $10 furthest.' },
  { id: 'openai/gpt-oss-120b', provider: 'groq', label: 'GPT-OSS 120B (Groq)', dailyLimit: 1000, reasoning: true, inputTokens: 5_000, short: 'Groq · 200K tokens a day, very fast', dailyTokens: 200_000,
    note: 'OpenAI\'s open reasoning model on Groq, free: 200,000 tokens a day (about 25 rules questions, or many more searches) and 8,000 a minute. Very fast.' },
  { id: 'qwen/qwen3.8-27b', provider: 'groq', label: 'Qwen 3.8 27B (Groq)', dailyLimit: 1000, reasoning: true, inputTokens: 6_000, short: 'Groq · 200K tokens a day', dailyTokens: 200_000,
    note: 'Alibaba\'s Qwen on Groq, free: same limits. Fast, but miscounted and was sure of wrong answers in testing.' },
  { id: 'openai/gpt-oss-20b', provider: 'groq', label: 'GPT-OSS 20B (Groq)', dailyLimit: 1000, reasoning: true, inputTokens: 6_000, short: 'Groq · helper for rules lookups', dailyTokens: 200_000, helper: true,
    note: 'The small GPT-OSS, with its own allowance: looks up what a rules question needs before GPT-OSS 120B answers.' },
];

/**
 * Each AI page lets a profile pick the Claude model it uses - Haiku, Sonnet,
 * Opus or Fable - remembered per profile and page. Stronger models think
 * harder and cost more. Fable is listed but off for now, while it is tried
 * out. The free models (2026-09) were not good enough at rules or tagging;
 * without an Anthropic key, GPT-OSS on Groq, which did best of them in a
 * rules bake-off.
 */
export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable';
export const TIERS: Tier[] = ['haiku', 'sonnet', 'opus', 'fable'];
export const TIER_MODEL: Record<Tier, string> = {
  haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1',
};
export const TIER_INFO: Record<Tier, { label: string; note: string }> = {
  haiku: { label: 'Haiku', note: 'Fast and nearly free' },
  sonnet: { label: 'Sonnet', note: 'Balanced' },
  opus: { label: 'Opus', note: 'Strongest everyday model; thinks hard' },
  fable: { label: 'Fable', note: 'Most capable; off for now while it is tried out' },
};
/** Shown, but not yet choosable. */
export const TIERS_OFF: Tier[] = ['fable'];
export const TIER_EFFORT: Record<Tier, Effort> = { haiku: 'low', sonnet: 'medium', opus: 'high', fable: 'high' };

/** The pages with a model picker, and the steps each one's choice covers. */
export type AiArea = 'search' | 'rules' | 'deck' | 'chat';
export const AREAS: AiArea[] = ['search', 'rules', 'deck', 'chat'];
export const AREA_OF: Record<Feature, AiArea> = { search: 'search', rules: 'rules', tagging: 'deck', tagcards: 'deck', chat: 'chat', finish: 'deck', upgrades: 'deck', essentials: 'deck' };

/** Where each page starts: Opus for rules, where a wrong answer costs a game; Haiku for search; Sonnet otherwise. */
export const DEFAULT_TIER: Record<AiArea, Tier> = { search: 'haiku', rules: 'opus', deck: 'sonnet', chat: 'sonnet' };

export const DEFAULT_MODELS: Record<Feature, string> = Object.fromEntries(
  FEATURES.map((f) => [f, TIER_MODEL[DEFAULT_TIER[AREA_OF[f]]]]),
) as Record<Feature, string>;

/** A typical request on each step, for a price before a model has been used there. */
export const TYPICAL_TOKENS: Record<Feature, { input: number; output: number }> = {
  search: { input: 3_200, output: 150 },
  rules: { input: 10_000, output: 1_800 },
  tagging: { input: 9_500, output: 2_500 },
  tagcards: { input: 10_000, output: 3_800 },
  chat: { input: 9_000, output: 800 },
  // One Finish call (a round is several); from the real Opus run of 2026-11-13: $0.41 over 7 calls.
  finish: { input: 12_000, output: 600 },
  // Guesses until there is a real run: one Upgrades call sends the deck with rules text (about 15K) and a search.
  upgrades: { input: 18_000, output: 900 },
  essentials: { input: 8_000, output: 1_500 },
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
// Models Anthropic's fallback may answer with, which are not offered here.
const OTHER_PRICES: Array<[string, Price]> = [
  ['claude-opus-5', { input: 5, output: 25 }], ['claude-opus-4', { input: 5, output: 25 }],
  ['claude-sonnet-5', { input: 2, output: 10 }], ['claude-sonnet-4', { input: 3, output: 15 }],
  ['claude-haiku-4', { input: 1, output: 5 }],
];

export function costOf(id: string, used: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): number {
  const price = modelInfo(id)?.price ?? OTHER_PRICES.find(([prefix]) => id.startsWith(prefix))?.[1];
  if (!price) return 0;
  const input = used.input + (used.cacheRead ?? 0) * 0.1 + (used.cacheWrite ?? 0) * 1.25;
  return (input * price.input + used.output * price.output) / 1_000_000;
}

