/**
 * One structured call to a model: a system prompt, a message and a JSON
 * schema in, parsed JSON out, and which model answered. For the deck
 * tagger, which asks for more thought than search does.
 *
 * Gemini over REST, as gemini.ts is. The free tier gives each model a small
 * daily allowance, so calls go to the smartest model with requests left
 * (see quota.ts) and every request is counted. A busy model (503) is passed
 * over for the next, and a step stops after a few refusals or four minutes;
 * a model out of requests for the day is passed over at once.
 */

import { modelHealth, modelUsage, recordModelCall, recordModelExhausted, recordModelHealth } from './db';
import { budgetFrom, ladder, ladderFor, quotaDay, quotaViolation, SMARTER_MODELS, type AiMode, type Budget } from './quota';

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

/**
 * Why a call failed: `busy` is worth trying again later, `quota` means
 * every model has used the day, `stopped` is the owner's doing.
 */
export type FailureKind = 'busy' | 'quota' | 'stopped' | 'other';

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
  system: string;
  user: string;
  schema: object;
  /** Thinking depth; the tagger wants high. */
  thinking?: 'low' | 'medium' | 'high';
  temperature?: number;
  /** The whole step, retries included; four minutes by default. */
  timeoutMs?: number;
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
}

/** Usage kept in the database, by quota day, over the models of a mode. */
export function storedUsage(mode: AiMode = 'standard'): Usage {
  return {
    available: () => budgetFrom(ladderFor(mode), modelUsage(quotaDay())).models.filter((m) => m.remaining > 0).map((m) => m.id),
    called: (model) => recordModelCall(quotaDay(), model),
    spent: (model, limit) => recordModelExhausted(quotaDay(), model, limit),
  };
}

/** Today's requests left on each model of the ladder. */
export function currentBudget(): Budget {
  return budgetFrom(ladder(), modelUsage(quotaDay()));
}

/**
 * The model for a feature, in standard or smarter mode, or null when no API
 * key is configured. Smarter mode tries the smarter models first and falls
 * back to the standard one quickly, and records whether they answered.
 */
export function modelFor(mode: AiMode = 'standard'): JsonModel | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const usage = storedUsage(mode);
  const smarter = new Set(SMARTER_MODELS.map((m) => m.id));
  return (request, options) => generate(key, usage, request, {
    ...options,
    ...(mode === 'smarter' ? { maxBusy: Math.max(2, options?.maxBusy ?? 2) } : {}),
    onOutcome: (model, ok, detail) => {
      if (smarter.has(model)) recordModelHealth(model, ok, detail);
      options?.onOutcome?.(model, ok, detail);
    },
  });
}

/** The tagging model (standard), or null when no API key is configured. */
export function taggingModel(usage?: Usage): JsonModel | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!usage) return modelFor('standard');
  return (request, options) => generate(key, usage, request, options);
}

async function generate(
  key: string, usage: Usage, request: JsonRequest, options: CallOptions = {}, sleep = wait, now = Date.now,
): Promise<Answer> {
  const { maxBusy = MAX_BUSY, signal, onEvent, onOutcome } = options;
  const models = usage.available();
  if (!models.length) {
    throw new ModelError('every model has used today\'s free requests - they reset at midnight Pacific', 'quota');
  }
  const deadline = now() + (request.timeoutMs ?? STEP_DEADLINE_MS);
  let busyCount = 0;
  const busy = () => new ModelError(
    `Gemini is overloaded right now - try again in a few minutes (${busyCount} request${busyCount === 1 ? '' : 's'} spent on refusals)`, 'busy',
  );
  const stopped = () => new ModelError('stopped', 'stopped');
  let lastError: ModelError | null = null;
  for (const [index, model] of models.entries()) {
    const fallback = index < models.length - 1;
    for (;;) {
      if (signal?.aborted) throw stopped();
      const left = deadline - now();
      if (left <= 0) throw busyCount ? busy() : new ModelError('the model took too long', 'busy');
      let response: Response;
      try {
        response = await call(key, model, request, fallback ? Math.min(left, FALL_BACK_AFTER_MS) : left, signal);
      } catch (error) {
        // Too slow, or unreachable: with another model to try, try it.
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
        return { data: parseJson(await response.json()), model };
      }
      onOutcome?.(model, false, `refused (${response.status})`);

      const detail = await errorDetail(response);
      const error = new ModelError(describe(model, response.status, detail.message));
      if (response.status === 404) {
        onEvent?.({ model, what: 'gone' });
        lastError = new ModelError(`model ${model} is not available`);
        break;
      }
      if (!RETRY_STATUSES.has(response.status)) throw error;

      if (response.status === 429) {
        const violation = quotaViolation(detail.body);
        if (violation?.daily) {
          usage.spent(model, violation.limit);
          onEvent?.({ model, what: 'spent' });
          lastError = new ModelError(error.message, 'quota');
          break;
        }
        // A per-minute limit: wait it out on the same model if it is short.
        const advised = retryAfterMs(detail.body) ?? BUSY_WAIT_MS;
        if (advised > MAX_ADVISED_WAIT_MS || now() + advised >= deadline) {
          lastError = new ModelError(error.message, 'busy');
          break;
        }
        onEvent?.({ model, what: 'limited', waitMs: advised });
        await sleep(advised, signal);
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
    throw new ModelError('every model has used today\'s free requests - they reset at midnight Pacific', 'quota');
  }
  throw lastError ?? new ModelError('no model to call');
}

async function call(key: string, model: string, request: JsonRequest, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
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
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (signal?.aborted) throw new ModelError('stopped', 'stopped');
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new ModelError(timedOut ? 'the model took too long' : 'could not reach the model', 'busy');
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

// --- smarter mode --------------------------------------------------------------

// How recently a smarter model must have answered to be offered.
const SMARTER_FRESH_MS = 6 * 60 * 60 * 1000;

export interface SmarterStatus {
  model: string;
  label: string;
  /** It answered its last request, recently: smarter mode can be turned on. */
  available: boolean;
  /** When it was last asked, and what happened. */
  checkedAt: string | null;
  detail: string;
}

export function smarterStatus(): SmarterStatus {
  const { id, label } = SMARTER_MODELS[0];
  const h = modelHealth(id);
  const fresh = !!h && Date.now() - Date.parse(h.at) < SMARTER_FRESH_MS;
  return {
    model: id, label,
    available: !!h?.ok && fresh,
    checkedAt: h?.at ?? null,
    detail: !h ? 'Not checked yet' : h.ok ? (fresh ? 'Answering' : 'Answered, but not recently - check again') : `Not answering: ${h.detail}`,
  };
}

/** Standard or smarter, as asked - smarter only while it has been answering. */
export function resolveMode(wantSmarter: unknown): AiMode {
  return wantSmarter === true && smarterStatus().available ? 'smarter' : 'standard';
}

/** Ask the smarter model something tiny, to see whether it answers. One request of its own allowance. */
export async function checkSmarter(): Promise<SmarterStatus> {
  const key = process.env.GEMINI_API_KEY;
  const { id } = SMARTER_MODELS[0];
  if (!key) return { ...smarterStatus(), detail: 'No GEMINI_API_KEY on the server' };
  const usage: Usage = {
    available: () => (budgetFrom(SMARTER_MODELS, modelUsage(quotaDay())).models[0].remaining > 0 ? [id] : []),
    called: (m) => recordModelCall(quotaDay(), m),
    spent: (m, limit) => recordModelExhausted(quotaDay(), m, limit),
  };
  try {
    await generate(key, usage, {
      system: 'Answer with JSON.', user: 'Reply {"ok": true}.',
      schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
      thinking: 'low', timeoutMs: FALL_BACK_AFTER_MS,
    }, { maxBusy: 1, onOutcome: (m, ok, detail) => recordModelHealth(m, ok, detail) });
  } catch (error) {
    recordModelHealth(id, false, error instanceof Error ? error.message : 'failed');
  }
  return smarterStatus();
}
