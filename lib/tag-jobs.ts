/**
 * Tagging runs as a job on the server, so it can be patient with Gemini.
 *
 * Gemini's Flash models go through spells of refusing most requests ("high
 * demand", 503) - on 2026-09-25 for hours, paid tiers included - and on the
 * free tier every refusal still counts against the day. So a job does not
 * hammer: when the model is busy it tries once, then waits a minute, two,
 * four... up to a quarter of an hour between tries, one request each,
 * rotating through the models. It gives up after MAX_REFUSALS, or at once
 * when every model has used the day.
 *
 * The job is saved as it goes - progress, requests spent, and a log of
 * every refusal and answer - so the Tags tab can show what is happening
 * after a reload, and the owner can stop it, which also cuts off a request
 * in flight. What was applied before a stop stays applied.
 *
 * One job per deck at a time. Jobs live in this server process: if it
 * restarts, a job it was running is reported as interrupted.
 */

import { randomUUID } from 'crypto';

import { ModelError, wait, type CallOptions, type ModelEvent } from './ai';
import type { Board } from './decklist';
import { BATCHES, modelLabel, type Mode } from './quota';

export type JobKind = 'propose' | 'tag';
export type JobStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'interrupted';

export interface JobParams {
  kind: JobKind;
  boards: Board[];
  /** Propose: this round's instructions. */
  instructions?: string;
  /** Tag: batch sizes, which cards, and whether to recheck each tag after. */
  mode?: Mode;
  scope?: 'all' | 'untagged';
  audit?: boolean;
}

export interface JobEvent {
  at: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface TagJob {
  id: string;
  listId: string;
  params: JobParams;
  status: JobStatus;
  phase: 'propose' | 'assign' | 'audit';
  /** Cards (assign) or tags (audit) done of the total. */
  done: number;
  total: number;
  added: number;
  removed: number;
  proposed: number;
  /** Requests this job has sent, refused ones included - what the quota counts. */
  requests: number;
  refusals: number;
  /** While waiting on a busy model: when it will try again. */
  nextTryAt: string | null;
  models: string[];
  /** Batches that failed for a reason waiting would not fix. */
  failed: string[];
  error: string | null;
  events: JobEvent[];
  startedAt: string;
  finishedAt: string | null;
}

export const ACTIVE: JobStatus[] = ['running', 'waiting'];
export const isActive = (job: TagJob | null) => !!job && ACTIVE.includes(job.status);

/** Waits between tries while the model stays busy. */
export const PATIENCE_MS = [60_000, 120_000, 240_000, 480_000, 900_000];
/** Refusals before a job gives up: about two hours of trying, a dozen requests. */
export const MAX_REFUSALS = 12;
const MAX_EVENTS = 60;

/** What a job needs from the rest of the app; the tests give their own. */
export interface JobDeps {
  propose: (instructions: string, options: CallOptions) => Promise<{ proposed: number; model: string }>;
  assign: (keys: string[], options: CallOptions) => Promise<{ added: number; skipped: number; model: string | null }>;
  audit: (tagIds: string[], options: CallOptions) => Promise<{ added: number; removed: number; model: string | null }>;
  /** The cards to tag, by key, and the accepted tags' ids - read when the job starts. */
  plan: (scope: 'all' | 'untagged') => { cards: string[]; tags: string[] };
  save: (job: TagJob) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export function newJob(listId: string, params: JobParams, now = Date.now()): TagJob {
  return {
    id: randomUUID(), listId, params, status: 'running', phase: params.kind === 'propose' ? 'propose' : 'assign',
    done: 0, total: 0, added: 0, removed: 0, proposed: 0, requests: 0, refusals: 0, nextTryAt: null,
    models: [], failed: [], error: null, events: [], startedAt: new Date(now).toISOString(), finishedAt: null,
  };
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Run a job to its end. Never throws: how it ended is on the job. */
export async function runJob(job: TagJob, deps: JobDeps, signal: AbortSignal): Promise<TagJob> {
  const sleep = deps.sleep ?? wait;
  const now = deps.now ?? Date.now;
  const log = (level: JobEvent['level'], text: string) => {
    job.events.push({ at: new Date(now()).toISOString(), level, text });
    if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS);
  };
  const save = () => deps.save(job);

  const onEvent = (e: ModelEvent) => {
    const name = modelLabel(e.model);
    if (e.what === 'busy') {
      job.requests++;
      job.refusals++;
      log('warn', `${name} is busy (refused with 503)`);
    } else if (e.what === 'limited') {
      log('info', `${name} hit its per-minute limit - waiting ${Math.round((e.waitMs ?? 0) / 1000)}s`);
    } else if (e.what === 'spent') {
      log('warn', `${name} has used today's free requests`);
    } else {
      log('warn', `${name} is not available`);
    }
    save();
  };

  /** One step, tried until it answers, the owner stops, or patience runs out. */
  const patiently = async <T extends { model: string | null }>(work: (options: CallOptions) => Promise<T>): Promise<T> => {
    for (let tries = 0; ; tries++) {
      try {
        const result = await work({ maxBusy: 1, rotate: job.refusals, signal, onEvent });
        if (result.model) {
          job.requests++;
          if (!job.models.includes(result.model)) job.models.push(result.model);
        }
        return result;
      } catch (e) {
        if (!(e instanceof ModelError) || e.kind !== 'busy' || signal.aborted) throw e;
        if (job.refusals >= MAX_REFUSALS) {
          throw new ModelError(`Gave up after ${plural(job.refusals, 'refusal')} - Gemini has been overloaded for a while. Try again later.`, 'busy');
        }
        const pause = PATIENCE_MS[Math.min(tries, PATIENCE_MS.length - 1)];
        job.status = 'waiting';
        job.nextTryAt = new Date(now() + pause).toISOString();
        log('info', `Waiting - next try at ${clock(now() + pause)}`);
        save();
        await sleep(pause, signal);
        if (signal.aborted) throw new ModelError('stopped', 'stopped');
        job.status = 'running';
        job.nextTryAt = null;
        save();
      }
    }
  };

  const reason = (e: unknown) => (e instanceof Error ? e.message : 'failed');
  /** A failure that ends the job rather than one batch. */
  const fatal = (e: unknown) => signal.aborted || (e instanceof ModelError && e.kind !== 'other') || !(e instanceof ModelError);

  try {
    if (job.params.kind === 'propose') {
      log('info', 'Reading the deck to suggest tags');
      save();
      const r = await patiently((o) => deps.propose(job.params.instructions ?? '', o));
      job.proposed = r.proposed;
      log('info', `${modelLabel(r.model)} suggested ${plural(r.proposed, 'tag')}`);
    } else {
      const size = BATCHES[job.params.mode ?? 'free'];
      const { cards, tags } = deps.plan(job.params.scope ?? 'all');
      const cardBatches = evenBatches(cards, size.cards);
      job.total = cards.length;
      log('info', `Tagging ${plural(cards.length, 'card')} with ${plural(tags.length, 'tag')} in ${plural(cardBatches.length, 'batch')}`);
      save();
      for (const keys of cardBatches) {
        if (signal.aborted) break;
        try {
          const r = await patiently((o) => deps.assign(keys, o));
          job.added += r.added;
          log('info', `${plural(keys.length, 'card')} tagged by ${r.model ? modelLabel(r.model) : 'nobody'} - ${plural(r.added, 'tag')} applied${r.skipped ? `, ${r.skipped} skipped` : ''}`);
        } catch (e) {
          if (fatal(e)) throw e;
          job.failed.push(`${plural(keys.length, 'card')}: ${reason(e)}`);
          log('error', `A batch of ${plural(keys.length, 'card')} failed: ${reason(e)}`);
        }
        job.done += keys.length;
        save();
      }
      // Checking tags that were never applied would spend requests on nothing.
      const anyTagged = job.failed.length < cardBatches.length;
      if (job.params.audit && anyTagged && tags.length && !signal.aborted) {
        job.phase = 'audit';
        job.done = 0;
        job.total = tags.length;
        log('info', `Checking ${plural(tags.length, 'tag')} across the whole deck`);
        save();
        for (const ids of evenBatches(tags, size.tags)) {
          if (signal.aborted) break;
          try {
            const r = await patiently((o) => deps.audit(ids, o));
            job.added += r.added;
            job.removed += r.removed;
            log('info', `Checked ${plural(ids.length, 'tag')} - ${r.added} added, ${r.removed} taken off`);
          } catch (e) {
            if (fatal(e)) throw e;
            job.failed.push(`checking ${plural(ids.length, 'tag')}: ${reason(e)}`);
            log('error', `Checking ${plural(ids.length, 'tag')} failed: ${reason(e)}`);
          }
          job.done += ids.length;
          save();
        }
      }
    }
    if (signal.aborted) throw new ModelError('stopped', 'stopped');
    job.status = 'done';
    log('info', `Done - ${plural(job.requests, 'request')} spent`);
  } catch (e) {
    if (signal.aborted || (e instanceof ModelError && e.kind === 'stopped')) {
      job.status = 'stopped';
      log('info', `Stopped - ${plural(job.requests, 'request')} spent; what was applied stays`);
    } else {
      job.status = 'failed';
      job.error = e instanceof ModelError || e instanceof Error ? e.message : 'Something went wrong';
      if (!(e instanceof Error)) console.error('[tags] job failed', e);
      log('error', job.error);
    }
  }
  job.nextTryAt = null;
  job.finishedAt = new Date(now()).toISOString();
  save();
  return job;
}

/** Even batches: 92 cards at 50 a batch is 46 and 46, not 50 and 42. */
export function evenBatches<T>(items: T[], size: number): T[][] {
  const count = Math.ceil(items.length / size);
  const per = Math.ceil(items.length / Math.max(1, count));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

// --- the jobs this process is running ----------------------------------------

// On globalThis so a dev-server reload of this module keeps track of them.
const store = globalThis as unknown as { __tagJobs?: Map<string, AbortController> };
const running = (store.__tagJobs ??= new Map());

export const isRunningHere = (listId: string) => running.has(listId);

/** Start a job in the background. The caller has checked none is running. */
export function launch(job: TagJob, deps: JobDeps): void {
  const controller = new AbortController();
  running.set(job.listId, controller);
  deps.save(job);
  void runJob(job, deps, controller.signal).finally(() => {
    if (running.get(job.listId) === controller) running.delete(job.listId);
  });
}

/** Stop the deck's job: at once if it is waiting, cutting off a request in flight. */
export function stop(listId: string): boolean {
  const controller = running.get(listId);
  if (!controller) return false;
  controller.abort();
  return true;
}
