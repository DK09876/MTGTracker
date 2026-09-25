/**
 * One structured call to a model: a system prompt, a message and a JSON
 * schema in, parsed JSON out. For the deck tagger, which asks for more
 * thought than search does and so uses a larger model with more patience.
 *
 * Gemini over REST, as gemini.ts is. Its free tier refuses with 429 or 503
 * whenever it is busy, often for a few seconds at a time, so a refused call
 * is retried with growing waits rather than failing the whole run.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Measured on the Pi's key on 2026-09-24: the Pro models are not on the free
// tier (429 on every call), and 3.8 Flash thinks at `high` for a few
// seconds a call. Model ids come and go, so a 404 moves down the list.
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest'];

const RETRY_STATUSES = new Set([429, 500, 503]);
const RETRY_WAITS_MS = [2_000, 5_000, 10_000, 20_000];
// A Retry-After this long means a daily quota, not a busy minute.
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

export type JsonModel = (request: JsonRequest) => Promise<unknown>;

/** The tagging model, or null when no API key is configured. */
export function taggingModel(): JsonModel | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const preferred = process.env.GEMINI_TAG_MODEL;
  const models = preferred ? [preferred, ...FALLBACK_MODELS.filter((m) => m !== preferred)] : FALLBACK_MODELS;
  return (request) => generate(key, models, request);
}

async function generate(key: string, models: string[], request: JsonRequest, sleep = wait): Promise<unknown> {
  let lastError: ModelError | null = null;
  for (const model of models) {
    for (let attempt = 0; ; attempt++) {
      const response = await call(key, model, request);
      if (response.ok) return parseJson(await response.json());

      const detail = await errorDetail(response);
      if (response.status === 404) {
        lastError = new ModelError(`model ${model} is not available`);
        break;
      }
      const error = new ModelError(`the model returned ${response.status}${detail.message ? `: ${detail.message}` : ''}`);
      if (!RETRY_STATUSES.has(response.status)) throw error;
      // Busy or out of quota: each model has its own demand and its own
      // quota, so after a few waits - or at once, for a daily quota - the
      // next model is worth a try.
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
      signal: AbortSignal.timeout(request.timeoutMs ?? 180_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new ModelError(timedOut ? 'the model took too long' : 'could not reach the model');
  }
}

async function errorDetail(response: Response): Promise<{ message: string; body: unknown }> {
  try {
    const body = await response.json();
    return { message: (body as { error?: { message?: string } }).error?.message ?? '', body };
  } catch {
    return { message: '', body: null };
  }
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
