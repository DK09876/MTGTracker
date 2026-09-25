/**
 * One structured call to a model: a system prompt, a message and a JSON
 * schema in, parsed JSON out, and which model answered. For the deck
 * tagger, which asks for more thought than search does.
 *
 * Gemini over REST, as gemini.ts is. The free tier gives each model a small
 * daily allowance, so calls go to the smartest model with requests left
 * (see quota.ts) and every request is counted. A busy model (503) is waited
 * on a few times and then passed over; a model out of requests for the day
 * is passed over at once.
 */

import { modelUsage, recordModelCall, recordModelExhausted } from './db';
import { budgetFrom, ladder, quotaDay, quotaViolation, type Budget } from './quota';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const RETRY_STATUSES = new Set([429, 500, 503]);
// Gemini counts a refused 503 against the day, so a busy model gets two
// more tries with long waits - waiting is free, asking is not - and then
// the next model is tried.
const RETRY_WAITS_MS = [8_000, 20_000];
// Longer than this and a per-minute limit is not worth waiting out.
const MAX_ADVISED_WAIT_MS = 45_000;

export class ModelError extends Error {}

export interface JsonRequest {
  system: string;
  user: string;
  schema: object;
  /** Thinking depth; the tagger wants high. */
  thinking?: 'low' | 'medium' | 'high';
  temperature?: number;
  timeoutMs?: number;
}

export interface Answer {
  data: unknown;
  /** The model that answered. */
  model: string;
}

export type JsonModel = (request: JsonRequest) => Promise<Answer>;

/** Which models to try, and the record of what was spent on them. */
export interface Usage {
  /** Models with requests left today, best first. */
  available: () => string[];
  called: (model: string) => void;
  /** The model is out of requests for the day. */
  spent: (model: string, limit: number | null) => void;
}

/** Usage kept in the database, by quota day. */
export function storedUsage(): Usage {
  return {
    available: () => budgetFrom(ladder(), modelUsage(quotaDay())).models.filter((m) => m.remaining > 0).map((m) => m.id),
    called: (model) => recordModelCall(quotaDay(), model),
    spent: (model, limit) => recordModelExhausted(quotaDay(), model, limit),
  };
}

/** Today's requests left on each model of the ladder. */
export function currentBudget(): Budget {
  return budgetFrom(ladder(), modelUsage(quotaDay()));
}

/** The tagging model, or null when no API key is configured. */
export function taggingModel(usage: Usage = storedUsage()): JsonModel | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return (request) => generate(key, usage, request);
}

async function generate(key: string, usage: Usage, request: JsonRequest, sleep = wait): Promise<Answer> {
  const models = usage.available();
  if (!models.length) {
    throw new ModelError('every model has used today\'s free requests - they reset at midnight Pacific');
  }
  let lastError: ModelError | null = null;
  for (const model of models) {
    for (let attempt = 0; ; attempt++) {
      const response = await call(key, model, request);
      // Count what the quota counts, which includes a busy model's 503s:
      // on 2026-09-24 3.5 Flash ran out after one answer and a run of 503s.
      if (response.status !== 404 && response.status !== 429) usage.called(model);
      if (response.ok) return { data: parseJson(await response.json()), model };

      const detail = await errorDetail(response);
      const error = new ModelError(describe(model, response.status, detail.message));
      if (response.status === 404) {
        lastError = new ModelError(`model ${model} is not available`);
        break;
      }
      if (!RETRY_STATUSES.has(response.status)) throw error;

      if (response.status === 429) {
        const violation = quotaViolation(detail.body);
        if (violation?.daily) {
          usage.spent(model, violation.limit);
          lastError = error;
          break;
        }
      }
      const advised = retryAfterMs(detail.body);
      if (attempt >= RETRY_WAITS_MS.length || (advised !== null && advised > MAX_ADVISED_WAIT_MS)) {
        lastError = error;
        break;
      }
      await sleep(Math.max(advised ?? 0, RETRY_WAITS_MS[attempt]));
    }
  }
  throw lastError ?? new ModelError('no model to call');
}

async function call(key: string, model: string, request: JsonRequest): Promise<Response> {
  try {
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
      signal: AbortSignal.timeout(request.timeoutMs ?? 300_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new ModelError(timedOut ? 'the model took too long' : 'could not reach the model');
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
  const name = model.replace(/^gemini-/, 'Gemini ').replace(/-flash/, ' Flash');
  if (status === 429) return `${name} is out of free requests for now`;
  if (status >= 500) return `${name} is overloaded right now - try again in a few minutes`;
  return `${name} returned ${status}${message ? `: ${message}` : ''}`;
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const testing = { generate };
