/**
 * One structured call to a model: a system prompt, a message and a JSON
 * schema in, parsed JSON out, and which model answered. For the deck
 * tagger, which asks for more thought than search does.
 *
 * Claude through Anthropic's SDK (ai-claude.ts), paid from the API credit
 * and held to the app's daily caps (spend.ts); Gemini over REST, as
 * gemini.ts is; or Mistral and Groq over their OpenAI-style APIs
 * (ai-openai.ts). Each profile picks a model per feature; a Gemini one has
 * Flash-Lite behind it. Every free plan has a daily allowance, so calls go to
 * the first model with requests left (see quota.ts) and every request is counted. A busy model (503) is passed
 * over for the next, and a step stops after a few refusals or four minutes;
 * a model out of requests for the day is passed over at once.
 */

import {
  getSetting, modelHealth, modelUsage, recordAiCall, recordModelCall, recordModelExhausted, recordModelHealth, recordModelTokens, recordSpend,
  setSetting, spendSince,
} from './db';
import { callClaude, claudeClient, ClaudeFailure, type ClaudeClient } from './ai-claude';
import { callOpenAI, parseOpenAIJson, retryAfterHeader } from './ai-openai';
import {
  costOf, DEFAULT_MODELS, EFFORTS, ENV_KEY, FALLBACK_MODEL, FEATURES, FREE_DEFAULT_MODEL, HELPER_MODEL, MODELS, modelInfo, providerOf,
  type Effort, type Feature, type Price, type Provider,
} from './models';
import { capFrom, DEFAULT_CAPS, monthStart, overBudget, summarize, type Caps, type SpendSummary } from './spend';
import { budgetFrom, ladder, modelLabel, quotaDay, quotaViolation, type Budget } from './quota';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const RETRY_STATUSES = new Set([429, 500, 503]);
// A busy model (503) is not asked again: Gemini counts each refusal against
// the day, a refusal can take a minute to arrive, and when one Flash model is
// busy the others usually are too. The next model gets one try after a
// pause, and a step gives up after a few refusals rather than spending the
// day's requests on them. On 2026-09-25 one "Suggest tags" spent 8 requests
// and five minutes on 503s before this.
const BUSY_WAIT_MS = 8_000;
const MAX_BUSY = 3;
// No step waits longer than this in all, answers included.
const STEP_DEADLINE_MS = 240_000;
// With a model to fall back on, one that has not answered by now is passed
// over rather than waited on: a busy Flash can take minutes to refuse.
const FALL_BACK_AFTER_MS = 45_000;
// Longer than this and a per-minute limit is not worth waiting out.
const MAX_ADVISED_WAIT_MS = 45_000;
// Asking a non-Gemini model again after a refusal or a timeout.
const SAME_MODEL_RETRIES = 2;
const RETRY_WAIT_MS = 3_000;

/**
 * Why a call failed: `busy` is worth trying again later, `quota` means
 * every model has used the day, `stopped` is the owner's doing, `too-big`
 * means the request is over the model's per-minute allowance - send less.
 */
export type FailureKind = 'busy' | 'quota' | 'stopped' | 'too-big' | 'other';

export class ModelError extends Error {
  constructor(message: string, readonly kind: FailureKind = 'other') {
    super(message);
  }
}

/** Something that happened on the way to an answer, for the owner to see. */
export interface ModelEvent {
  model: string;
  /** busy: 503/500; limited: a per-minute 429, waited out; spent: the model's day is used; gone: 404. */
  what: 'busy' | 'limited' | 'spent' | 'gone';
  waitMs?: number;
}

export interface CallOptions {
  /** Busy refusals before giving up; three by default. */
  maxBusy?: number;
  signal?: AbortSignal;
  onEvent?: (event: ModelEvent) => void;
  /** Told whether each model answered, for tracking whether the smarter ones work. */
  onOutcome?: (model: string, ok: boolean, detail: string) => void;
}

export interface JsonRequest {
  /** Which part of the work this is, for the AI usage trail: "plan the search", "answer". */
  step?: string;
  system: string;
  user: string;
  schema: object;
  /** Thinking depth; the tagger wants high. */
  thinking?: 'low' | 'medium' | 'high';
  temperature?: number;
  /** The whole step, retries included; four minutes by default. */
  timeoutMs?: number;
  /** The most the answer may be, thinking included (OpenAI-style providers). */
  maxOutputTokens?: number;
}

export interface Answer {
  data: unknown;
  /** The model that answered. */
  model: string;
}

export type JsonModel = (request: JsonRequest, options?: CallOptions) => Promise<Answer>;

/** Which models to try, and the record of what was spent on them. */
export interface Usage {
  /** Models with requests left today, best first. */
  available: () => string[];
  called: (model: string) => void;
  /** The model is out of requests for the day. */
  spent: (model: string, limit: number | null) => void;
  /** Tokens a request used, sent and written. */
  tokens?: (model: string, count: number) => void;
}

const tokensRecorded = (model: string, count: number) => recordModelTokens(quotaDay(), model, count);

/** Usage kept in the database, by quota day, over a list of models. */
export function storedUsage(models = ladder()): Usage {
  return {
    available: () => budgetFrom(models, modelUsage(quotaDay())).models.filter((m) => m.remaining > 0).map((m) => m.id),
    called: (model) => recordModelCall(quotaDay(), model),
    spent: (model, limit) => recordModelExhausted(quotaDay(), model, limit),
    tokens: tokensRecorded,
  };
}

/**
 * Today's requests left on the models a profile's feature uses: the chosen
 * one, then Flash-Lite for a Gemini one - and, for Claude, today's spending
 * against the caps.
 */
export function currentBudget(profile: string | null, feature: Feature = 'tagging'): Budget {
  const ids = featureModels(profile, feature);
  const budget = budgetFrom(ids.map((id) => ({ id, label: modelLabel(id) })), modelUsage(quotaDay()));
  return providerOf(ids[0]) === 'anthropic' ? { ...budget, spend: currentSpend(profile) } : budget;
}

// --- the models each profile uses ------------------------------------------------

const modelKey = (profile: string | null, feature: Feature) => `ai.model.${profile ?? '-'}.${feature}`;
const EFFORT_KEY = (profile: string | null) => `ai.effort.${profile ?? '-'}`;
const CAP_KEYS: Record<keyof Caps, string> = { daily: 'ai.cap.daily', perProfile: 'ai.cap.profile' };

/**
 * The model a profile uses for a feature: its own choice, or the default -
 * only one whose provider has a key - or else GPT-OSS, or else Flash-Lite.
 */
export function modelFor(profile: string | null, feature: Feature): string {
  const id = getSetting(modelKey(profile, feature));
  if (id && modelInfo(id) && !modelInfo(id)?.helper && hasKey(id)) return id;
  if (hasKey(DEFAULT_MODELS[feature])) return DEFAULT_MODELS[feature];
  return hasKey(FREE_DEFAULT_MODEL) ? FREE_DEFAULT_MODEL : FALLBACK_MODEL;
}

/** Use a model for some of a profile's features. */
export function chooseModel(profile: string | null, id: string, features: Feature[]): void {
  if (!modelInfo(id) || modelInfo(id)?.helper) throw new ModelError(`Unknown model ${id}`);
  if (!hasKey(id)) throw new ModelError(`No ${ENV_KEY[providerOf(id)]} on the server`);
  for (const f of features) if (FEATURES.includes(f)) setSetting(modelKey(profile, f), id);
}

/** How hard a profile's Claude model thinks on rules and tagging; medium unless changed. */
export function effortFor(profile: string | null): Effort {
  const e = getSetting(EFFORT_KEY(profile));
  return EFFORTS.includes(e as Effort) ? e as Effort : 'medium';
}

export function chooseEffort(profile: string | null, effort: string): void {
  if (!EFFORTS.includes(effort as Effort)) throw new ModelError(`Unknown effort ${effort}`);
  setSetting(EFFORT_KEY(profile), effort);
}

export function caps(): Caps {
  const read = (k: keyof Caps) => capFrom(getSetting(CAP_KEYS[k])) ?? DEFAULT_CAPS[k];
  return { daily: read('daily'), perProfile: read('perProfile') };
}

export function setCaps(change: Partial<Record<keyof Caps, unknown>>): void {
  for (const k of Object.keys(CAP_KEYS) as Array<keyof Caps>) {
    if (change[k] === undefined) continue;
    const value = capFrom(change[k]);
    if (value === null) throw new ModelError('A cap is a number of dollars from 0 to 200');
    setSetting(CAP_KEYS[k], String(value));
  }
}

/** Today's and this month's Claude spending, as a profile sees it. */
export function currentSpend(profile: string | null, now = new Date()): SpendSummary {
  return summarize(spendSince(monthStart(now)), profile, caps(), now);
}

const hasKey = (id: string) => !!process.env[ENV_KEY[providerOf(id)]];

/**
 * A feature's model, and for a Gemini one, Flash-Lite to fall back on when it
 * refuses. Another provider's model is not swapped for Gemini's: a request
 * that Claude or Groq turns away fails or is asked again on the same model
 * (see generate), since a different model answering changes the answers.
 */
function featureModels(profile: string | null, feature: Feature): string[] {
  const chosen = modelFor(profile, feature);
  const gemini = providerOf(chosen) === 'gemini';
  return gemini && hasKey(FALLBACK_MODEL) && chosen !== FALLBACK_MODEL ? [chosen, FALLBACK_MODEL] : [chosen];
}

/** The rules model's own size limit for a request, in tokens. */
export function inputTokens(profile: string | null): number {
  return modelInfo(modelFor(profile, 'rules'))?.inputTokens ?? 30_000;
}

/** A small model on the rules model's provider, for preparatory jobs; null without a key. */
export function helperModel(profile: string | null, label?: string): JsonModel | null {
  const helper = HELPER_MODEL[providerOf(modelFor(profile, 'rules'))];
  return modelById(helper, [], { profile, feature: 'rules', label });
}

/**
 * The model a profile uses for a feature (rules answers, deck tagging,
 * search). Null when no provider has a key.
 */
export function appModel(profile: string | null, feature: Feature, label?: string): JsonModel | null {
  const [id, ...fallbacks] = featureModels(profile, feature);
  return modelById(id, fallbacks, { profile, feature, label });
}

/** Who a paid request is charged to, and for what. */
export interface Charge {
  profile: string | null;
  feature: Feature;
  /** What it is for, for the AI usage trail: the search typed, the question, the deck. */
  label?: string;
}

/**
 * A Claude model, charged to a profile: the caps are checked before each
 * request, and what it cost is recorded after, answered or not. No
 * fallback to a free model - its answers would not be Claude's.
 */
export function claudeModel(id: string, charge: Charge, client: () => ClaudeClient = claudeClient, now = () => new Date()): JsonModel {
  return async (request, options = {}) => {
    const over = overBudget(currentSpend(charge.profile, now()));
    if (over) {
      recordAiCall({
        profileId: charge.profile ?? '-', feature: charge.feature, label: charge.label ?? '', step: request.step ?? '',
        model: id, answeredBy: '', inputTokens: 0, outputTokens: 0, cost: 0, outcome: 'blocked', detail: 'over the daily cap',
      });
      throw new ModelError(over, 'quota');
    }
    if (options.signal?.aborted) throw new ModelError('stopped', 'stopped');
    // Search plans want speed; a preparatory step asks for little thought.
    const effort: Effort = charge.feature === 'search' || request.thinking === 'low' ? 'low' : effortFor(charge.profile);
    const day = quotaDay(now());
    const log = (outcome: string, detail = '', usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }, answeredBy?: string) => {
      recordAiCall({
        profileId: charge.profile ?? '-', feature: charge.feature, label: charge.label ?? '', step: request.step ?? '',
        model: id, answeredBy: answeredBy && answeredBy !== id ? answeredBy : '',
        inputTokens: usage ? usage.input + usage.cacheRead + usage.cacheWrite : 0, outputTokens: usage?.output ?? 0,
        cost: usage ? Math.max(costOf(id, usage), costOf(answeredBy ?? id, usage)) : 0, outcome, detail,
      });
    };
    const record = (usage: { input: number; output: number; cacheRead: number; cacheWrite: number }, answeredBy?: string) => {
      recordModelCall(day, id);
      recordModelTokens(day, id, usage.input + usage.output + usage.cacheRead + usage.cacheWrite);
      recordSpend({
        day, profileId: charge.profile ?? '-', model: id, feature: charge.feature,
        inputTokens: usage.input + usage.cacheRead + usage.cacheWrite, outputTokens: usage.output,
        // Anthropic's fallback may have answered: priced as the dearer of the two.
        cost: Math.max(costOf(id, usage), costOf(answeredBy ?? id, usage)),
      });
    };
    try {
      const answer = await callClaude(client(), id, request, effort, options.signal);
      record(answer.usage, answer.model);
      log('ok', '', answer.usage, answer.model);
      recordModelHealth(id, true, 'answered');
      options.onOutcome?.(id, true, 'answered');
      return { data: answer.data, model: id };
    } catch (error) {
      const f = error instanceof ClaudeFailure ? error : new ClaudeFailure(error instanceof Error ? error.message : 'Claude failed', 'other');
      if (f.usage) record(f.usage, f.model);
      log(f.kind === 'stopped' ? 'stopped' : /declined/.test(f.message) ? 'declined' : 'failed', f.message, f.usage, f.model);
      if (f.kind !== 'stopped') {
        recordModelHealth(id, false, f.message);
        options.onOutcome?.(id, false, f.message);
      }
      throw new ModelError(f.message, f.kind);
    }
  };
}

/** The app model with a caller's own usage record (tests). */
export function taggingModel(usage?: Usage): JsonModel | null {
  if (!usage) return appModel(null, 'tagging');
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return (request, options) => generate(key, usage, request, options);
}

async function generate(
  key: string, usage: Usage, request: JsonRequest, options: CallOptions = {}, sleep = wait, now = Date.now,
): Promise<Answer> {
  const { maxBusy = MAX_BUSY, signal, onEvent, onOutcome } = options;
  const models = usage.available();
  if (!models.length) {
    throw new ModelError('every model has used today\'s free requests - try again tomorrow, or pick another model in Settings', 'quota');
  }
  const deadline = now() + (request.timeoutMs ?? STEP_DEADLINE_MS);
  let busyCount = 0;
  const busy = () => new ModelError(
    `the model is overloaded right now - try again in a few minutes (${busyCount} request${busyCount === 1 ? '' : 's'} spent on refusals)`, 'busy',
  );
  const stopped = () => new ModelError('stopped', 'stopped');
  let lastError: ModelError | null = null;
  for (const [index, model] of models.entries()) {
    const fallback = index < models.length - 1;
    // Groq and Mistral do not count a refusal against the day as Gemini does,
    // so a model with nothing to fall back on is asked again, a few times.
    let retries = providerOf(model) !== 'gemini' && !fallback ? SAME_MODEL_RETRIES : 0;
    let badShape = 0;
    for (;;) {
      if (signal?.aborted) throw stopped();
      const left = deadline - now();
      if (left <= 0) throw busyCount ? busy() : new ModelError('the model took too long', 'busy');
      let response: Response;
      const provider = providerOf(model);
      const apiKey = provider === 'gemini' ? key : process.env[ENV_KEY[provider]];
      if (!apiKey) {
        lastError = new ModelError(`no ${ENV_KEY[provider]} is set on the server for ${modelLabel(model)}`);
        break;
      }
      try {
        response = await call(provider, apiKey, model, request, fallback || retries > 0 ? Math.min(left, FALL_BACK_AFTER_MS) : left, signal);
      } catch (error) {
        // Too slow, or unreachable: with another model to try, try it; with
        // none, ask this one again if it may be.
        if (error instanceof ModelError && error.kind === 'busy' && !fallback && retries > 0) {
          retries--;
          usage.called(model);
          onOutcome?.(model, false, error.message);
          onEvent?.({ model, what: 'busy', waitMs: RETRY_WAIT_MS });
          await sleep(RETRY_WAIT_MS, signal);
          continue;
        }
        if (!(error instanceof ModelError) || error.kind !== 'busy' || !fallback) throw error;
        usage.called(model);
        onOutcome?.(model, false, error.message);
        busyCount++;
        lastError = error;
        if (busyCount >= maxBusy) throw busy();
        onEvent?.({ model, what: 'busy' });
        break;
      }
      // Count what the quota counts, which includes a busy model's 503s:
      // on 2026-09-24 3.5 Flash ran out after one answer and a run of 503s.
      if (response.status !== 404 && response.status !== 429) usage.called(model);
      if (response.ok) {
        onOutcome?.(model, true, 'answered');
        const body = await response.json();
        usage.tokens?.(model, tokensIn(body));
        if (provider === 'gemini') return { data: parseJson(body), model };
        try {
          return { data: parseOpenAIJson(body), model };
        } catch {
          throw new ModelError('the model returned something other than JSON');
        }
      }
      onOutcome?.(model, false, `refused (${response.status})`);

      const detail = await errorDetail(response);
      const error = new ModelError(describe(model, response.status, detail.message));
      if (response.status === 404) {
        onEvent?.({ model, what: 'gone' });
        lastError = new ModelError(`model ${model} is not available`);
        break;
      }
      // Too big for the model's per-minute token allowance (Groq's free tier): the next model may take it.
      if (response.status === 413) {
        lastError = new ModelError(`${modelLabel(model)}: the request is too long for its free tier`, 'too-big');
        if (fallback) break;
        throw lastError;
      }
      // Groq checks the model's JSON against the schema and refuses a miss
      // (GPT-OSS once wrote a count as "1"; 2026-09-30). The refusal carries
      // what it wrote: if that is whole JSON, the callers' own parsing copes
      // with such slips, and asking again would cost another minute of Groq's
      // per-minute allowance. Cut-off or broken JSON is asked for again: once
      // more on the same model, then the next.
      if (response.status === 400 && /does not match the expected schema|failed to validate json|json_validate_failed/i.test(detail.message)) {
        const written = failedGeneration(detail.body);
        if (written !== undefined) {
          onOutcome?.(model, true, 'answered (slightly off the schema)');
          return { data: written, model };
        }
        lastError = new ModelError(`${modelLabel(model)} wrote an answer in the wrong shape`);
        if (badShape++ < (providerOf(model) === 'gemini' ? 1 : 2)) continue;
        break;
      }
      if (!RETRY_STATUSES.has(response.status)) throw error;

      if (response.status === 429) {
        // Groq's free tier also caps tokens (and requests) a day, refilling as
        // the day goes on: say so, and when there will be room again.
        const daily = provider !== 'gemini' ? /(tokens|requests) per day[\s\S]*?Limit (\d+)[\s\S]*?try again in ([\dhms.]+)/i.exec(detail.message + ' ' + JSON.stringify(detail.body)) : null;
        if (daily) {
          const what = daily[1].toLowerCase() === 'tokens' ? `${Number(daily[2]).toLocaleString('en-US')} free tokens` : `${Number(daily[2]).toLocaleString('en-US')} free requests`;
          throw new ModelError(`${modelLabel(model)} has used its ${what} for today - there is room again in about ${roughly(daily[3])}. Or pick another model in Settings.`, 'quota');
        }
        const violation = provider === 'gemini' ? quotaViolation(detail.body) : null;
        if (violation?.daily) {
          usage.spent(model, violation.limit);
          onEvent?.({ model, what: 'spent' });
          lastError = new ModelError(error.message, 'quota');
          break;
        }
        // A per-minute limit: wait it out on the same model if it is short.
        const advised = retryAfterMs(detail.body) ?? retryAfterHeader(response) ?? BUSY_WAIT_MS;
        if (advised > MAX_ADVISED_WAIT_MS || now() + advised >= deadline) {
          lastError = new ModelError(error.message, 'busy');
          break;
        }
        onEvent?.({ model, what: 'limited', waitMs: advised });
        await sleep(advised, signal);
        continue;
      }

      // Busy, with nothing to fall back on: ask the same model again.
      if (retries > 0) {
        retries--;
        onEvent?.({ model, what: 'busy', waitMs: RETRY_WAIT_MS });
        await sleep(RETRY_WAIT_MS, signal);
        continue;
      }
      // Busy: on to the next model after a pause, or stop.
      busyCount++;
      lastError = busy();
      if (busyCount >= maxBusy) {
        onEvent?.({ model, what: 'busy' });
        throw lastError;
      }
      onEvent?.({ model, what: 'busy', waitMs: BUSY_WAIT_MS });
      await sleep(BUSY_WAIT_MS, signal);
      break;
    }
  }
  // Every model passed over: out for the day if none has requests left.
  if (!usage.available().length) {
    throw new ModelError('every model has used today\'s free requests - try again tomorrow, or pick another model in Settings', 'quota');
  }
  throw lastError ?? new ModelError('no model to call');
}

async function call(provider: Provider, key: string, model: string, request: JsonRequest, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  try {
    if (provider !== 'gemini') return await callOpenAI(provider, key, model, request, timeoutMs, signal);
    return await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
        generationConfig: {
          temperature: request.temperature ?? 0.2,
          responseMimeType: 'application/json',
          responseSchema: request.schema,
          thinkingConfig: { thinkingLevel: request.thinking ?? 'high' },
        },
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (signal?.aborted) throw new ModelError('stopped', 'stopped');
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new ModelError(timedOut ? 'the model took too long' : 'could not reach the model', 'busy');
  }
}

/** The JSON a provider refused for missing the schema (Groq's failed_generation), if it is whole JSON. */
export function failedGeneration(body: unknown): unknown {
  const text = (body as { error?: { failed_generation?: unknown } })?.error?.failed_generation;
  if (typeof text !== 'string' || !text.trim()) return undefined;
  try {
    const data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, ''));
    return data && typeof data === 'object' ? data : undefined;
  } catch {
    return undefined;
  }
}

async function errorDetail(response: Response): Promise<{ message: string; body: unknown }> {
  try {
    const body = await response.json();
    return { message: (body as { error?: { message?: string } }).error?.message?.split('\n')[0] ?? '', body };
  } catch {
    return { message: '', body: null };
  }
}

/** A refusal in words someone at the table can act on. */
function describe(model: string, status: number, message: string): string {
  const name = modelLabel(model);
  if (status === 429) return `${name} is out of free requests for now`;
  if (status >= 500) return `${name} is overloaded right now - try again in a few minutes`;
  return `${name} returned ${status}${message ? `: ${message}` : ''}`;
}

/** Tokens a reply says it used: Gemini's usageMetadata, or an OpenAI-style usage. */
export function tokensIn(body: unknown): number {
  const b = body as { usageMetadata?: { totalTokenCount?: number }; usage?: { total_tokens?: number } };
  return Number(b?.usageMetadata?.totalTokenCount ?? b?.usage?.total_tokens ?? 0) || 0;
}

/** "9m31.968s" as "10 minutes", "1h2m" as "an hour". */
export function roughly(wait: string): string {
  const [, h = '0', m = '0', s = '0'] = /(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/.exec(wait) ?? [];
  const minutes = Math.ceil(Number(h) * 60 + Number(m) + Number(s) / 60);
  if (minutes <= 1) return 'a minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'an hour' : `${hours} hours`;
}

/** Gemini's advised wait, from the RetryInfo detail of a 429 ("23s"). */
export function retryAfterMs(body: unknown): number | null {
  const details = (body as { error?: { details?: Array<{ retryDelay?: string }> } })?.error?.details ?? [];
  for (const d of details) {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay ?? '');
    if (match) return Math.ceil(Number(match[1]) * 1000);
  }
  return null;
}

/** The JSON a generateContent response carries, skipping any thought parts. */
export function parseJson(body: unknown): unknown {
  const parts = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> })
    ?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  if (!text) throw new ModelError('the model returned nothing');
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelError('the model returned something other than JSON');
  }
}

/** A pause that ends early when the signal aborts. */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });
}

export const testing = { generate };

// --- model status, for Settings ------------------------------------------------

export interface ModelStatus {
  id: string;
  label: string;
  provider: Provider;
  note: string;
  reasoning: boolean;
  /** Paid models: dollars per million tokens. */
  price: Price | null;
  short: string;
  level: string | null;
  /** The server has this provider's key. */
  hasKey: boolean;
  /** The profile's features that use it. */
  chosenFor: Feature[];
  used: number;
  remaining: number;
  limit: number;
  /** Tokens used today, and the free tier's daily token cap where that is what binds (Groq). */
  tokens: number;
  dailyTokens: number | null;
  /** Dollars spent on it today, by everyone. */
  spentToday: number;
  /** The last time it was asked, and whether it answered. */
  health: { ok: boolean; detail: string; at: string } | null;
}

/** Everything Settings and the header's picker show, for one profile. */
export interface AiState {
  models: ModelStatus[];
  effort: Effort;
  spend: SpendSummary;
}

export function aiState(profile: string | null): AiState {
  const usage = modelUsage(quotaDay());
  const budget = budgetFrom(MODELS, usage);
  const spend = currentSpend(profile);
  const chosen = Object.fromEntries(FEATURES.map((f) => [f, modelFor(profile, f)])) as Record<Feature, string>;
  const models = MODELS.filter((m) => !m.helper).map((m) => {
    const b = budget.models.find((x) => x.id === m.id);
    const h = modelHealth(m.id);
    return {
      id: m.id, label: m.label, provider: m.provider, note: m.note, reasoning: m.reasoning, price: m.price ?? null,
      short: m.short, level: m.level ?? null,
      hasKey: hasKey(m.id), chosenFor: FEATURES.filter((f) => chosen[f] === m.id),
      used: b?.used ?? 0, remaining: b?.remaining ?? m.dailyLimit, limit: b?.limit ?? m.dailyLimit,
      tokens: usage.find((u) => u.model === m.id)?.tokens ?? 0, dailyTokens: m.dailyTokens ?? null,
      spentToday: spend.byModel.find((x) => x.model === m.id)?.cost ?? 0,
      health: h && { ok: h.ok, detail: h.detail, at: h.at },
    };
  });
  return { models, effort: effortFor(profile), spend };
}

/** Ask one model something tiny, to see whether it answers. One of its requests; a Claude one costs a fraction of a cent. */
export async function testModel(profile: string | null, id: string): Promise<AiState> {
  if (!modelInfo(id)) throw new ModelError(`Unknown model ${id}`);
  const model = modelById(id, [], { profile, feature: 'search', label: 'Test button in Settings' });
  if (!model) {
    recordModelHealth(id, false, `No ${ENV_KEY[providerOf(id)]} on the server`);
    return aiState(profile);
  }
  try {
    await model({
      step: 'test', system: 'Answer with JSON.', user: 'Reply {"ok": true}.',
      schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
      thinking: 'low', timeoutMs: FALL_BACK_AFTER_MS, maxOutputTokens: 2_000,
    }, { maxBusy: 1 });
  } catch (error) {
    recordModelHealth(id, false, error instanceof Error ? error.message : 'failed');
  }
  return aiState(profile);
}

/**
 * A model by id, then any fallbacks in order - for a profile's chosen model,
 * or to test one exactly (no fallbacks). A Claude model is charged to the
 * profile and feature given. Null if the first model's provider has no key
 * on the server.
 */
export function modelById(id: string, fallbacks: string[] = [], charge: Charge = { profile: null, feature: 'search' }): JsonModel | null {
  if (!process.env[ENV_KEY[providerOf(id)]]) return null;
  if (providerOf(id) === 'anthropic') return claudeModel(id, charge);
  const ids = [id, ...fallbacks.filter((f) => f !== id)];
  const list = ids.map((m) => ({ id: m, label: modelLabel(m) }));
  const usage: Usage = {
    available: () => budgetFrom(list, modelUsage(quotaDay())).models.filter((m) => m.remaining > 0).map((m) => m.id),
    called: (m) => recordModelCall(quotaDay(), m),
    spent: (m, limit) => recordModelExhausted(quotaDay(), m, limit),
    tokens: tokensRecorded,
  };
  const key = process.env.GEMINI_API_KEY ?? '';
  return (request, options) => generate(key, usage, request, {
    ...options,
    maxBusy: Math.max(ids.length, options?.maxBusy ?? 1),
    onOutcome: (m, ok, detail) => { recordModelHealth(m, ok, detail); options?.onOutcome?.(m, ok, detail); },
  });
}
